// Cloudflare Pages Function — 카탈로그 정본 편집 (섹션 이동)
// Route: /api/catalog
//
//   PATCH /api/catalog   body { slug, section }   header X-GH-Token
//
// GitHub Contents API로 레포의 catalog.json(main)을 읽어 해당 앱의 section만 바꿔 다시 커밋한다.
// 서버 시크릿은 없다 — 호출자의 GitHub 토큰(레포 contents 쓰기)으로만 동작한다.
// main push = GH Actions 프로덕션 배포이므로 "커밋 성공"이 곧 "화면 반영"은 아니다 —
// 클라이언트는 낙관 반영(jacehub_pending_moves) 뒤 배포된 catalog.json과 합쳐지면 흔적을 지운다.
//
// 편집 방식 — 정본의 diff를 최소로:
//   · 파일이 "앱 1개 = 1줄" 관행을 지키면(현재 catalog.json) 그 줄만 떼어 목적지 섹션 그룹 끝으로 옮긴다.
//     결과 diff = 옮긴 줄 1개 + updatedAt 1줄 (+ 마지막 원소 쉼표 보정).
//   · 관행이 깨져 있으면(여러 줄 객체·압축 JSON) 정규 포맷(formatCatalog)으로 전체를 다시 쓴다.
//   어느 쪽이든 결과는 유효 JSON이고, 쓰기 전에 파싱·불변 항목 대조로 자가 검증한다.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'PATCH, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-GH-Token',
  'Access-Control-Max-Age': '86400',
};

const DEFAULT_REPO = 'architectofthoughts/jacehub';
const DEFAULT_BRANCH = 'main';
const CATALOG_PATH = 'catalog.json';
const GITHUB_API = 'https://api.github.com';
const FETCH_TIMEOUT_MS = 10_000;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

const SLUG_RE = /"slug"\s*:\s*"([^"]*)"/;
const SECTION_RE = /("section"\s*:\s*")([^"]*)(")/;
const UPDATED_AT_RE = /("updatedAt"\s*:\s*")[^"]*(")/;

export class CatalogError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'CatalogError';
    this.code = code;
    this.status = status;
  }
}

function jsonResponse(body, init = {}) {
  return Response.json(body, {
    ...init,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

function errorResponse(code, message, status) {
  return jsonResponse({ success: false, code, errors: [{ code, message }] }, { status });
}

// ── 순수 함수 — 테스트에서 직접 호출 ──

export function kstToday(now = Date.now()) {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function parseCatalog(text) {
  let catalog;
  try {
    catalog = JSON.parse(text);
  } catch (error) {
    throw new CatalogError('invalid-json', `정본 catalog.json이 유효한 JSON이 아니에요 — ${error.message}`, 422);
  }
  if (!catalog || !Array.isArray(catalog.sections) || !Array.isArray(catalog.apps)) {
    throw new CatalogError('invalid-shape', '정본 catalog.json에 sections[] / apps[]가 없어요', 422);
  }
  return catalog;
}

// 이동 요청 검증 — 어느 앱을 어느 섹션으로. 실패는 전부 CatalogError.
export function resolveMove(catalog, slug, section) {
  if (typeof slug !== 'string' || !SLUG_PATTERN.test(slug.trim())) {
    throw new CatalogError('bad-request', 'slug가 비었거나 형식이 아니에요', 400);
  }
  if (typeof section !== 'string' || !section.trim()) {
    throw new CatalogError('bad-request', 'section이 비었어요', 400);
  }
  const normalizedSlug = slug.trim();
  const to = section.trim();
  const app = catalog.apps.find((entry) => entry?.slug === normalizedSlug);
  if (!app) {
    throw new CatalogError('unknown-slug', `카탈로그에 "${normalizedSlug}" 앱이 없어요 — 미등록 앱은 catalog.json에 먼저 추가해야 해요`, 404);
  }
  const target = catalog.sections.find((entry) => entry?.key === to);
  if (!target) {
    throw new CatalogError('unknown-section', `"${to}"는 카탈로그 섹션이 아니에요 (내부 서비스 섹션은 카탈로그 밖)`, 400);
  }
  return { app, from: app.section, to, target };
}

function oneLineObject(obj) {
  const parts = Object.entries(obj).map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  return `{ ${parts.join(', ')} }`;
}

// 정규 포맷 — 상단 메타 · sections 한 줄씩 · apps는 섹션 순서로 그룹, 그룹 사이 빈 줄.
export function formatCatalog(catalog) {
  const { sections = [], apps = [], ...rest } = catalog;
  const lines = ['{'];
  Object.entries(rest).forEach(([key, value]) => {
    lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
  });
  lines.push('  "sections": [');
  sections.forEach((section, index) => {
    lines.push(`    ${oneLineObject(section)}${index < sections.length - 1 ? ',' : ''}`);
  });
  lines.push('  ],');
  lines.push('  "apps": [');
  const groups = new Map(sections.map((section) => [section.key, []]));
  apps.forEach((app) => {
    if (!groups.has(app.section)) groups.set(app.section, []);
    groups.get(app.section).push(app);
  });
  const filled = [...groups.values()].filter((group) => group.length > 0);
  filled.forEach((group, groupIndex) => {
    if (groupIndex > 0) lines.push('');
    group.forEach((app, appIndex) => {
      const isLast = groupIndex === filled.length - 1 && appIndex === group.length - 1;
      lines.push(`    ${oneLineObject(app)}${isLast ? '' : ','}`);
    });
  });
  lines.push('  ]');
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

// apps[] 영역의 줄 인덱스 범위 — [start, end) . start = `"apps": [` 다음 줄, end = 닫는 `]` 줄.
function findAppsRegion(lines) {
  const start = lines.findIndex((line) => /"apps"\s*:\s*\[\s*$/.test(line));
  if (start < 0) return null;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\],?\s*$/.test(lines[index])) return { start: start + 1, end: index };
  }
  return null;
}

// 영역 안의 앱 줄 — `{ ... }` 또는 `{ ... },` 한 줄 관행이 지켜졌는지 함께 표시.
function findAppLines(lines, region) {
  const found = [];
  for (let index = region.start; index < region.end; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed) continue;
    const slugMatch = trimmed.match(SLUG_RE);
    const sectionMatch = trimmed.match(SECTION_RE);
    const oneLine = /^\{.*\},?$/.test(trimmed);
    found.push({ index, slug: slugMatch?.[1] ?? null, section: sectionMatch?.[2] ?? null, oneLine });
  }
  return found;
}

function canSurgeryByLine(catalog, appLines) {
  if (appLines.length !== catalog.apps.length) return false;
  if (!appLines.every((entry) => entry.oneLine && entry.slug && entry.section)) return false;
  const catalogSlugs = catalog.apps.map((app) => app.slug);
  const lineSlugs = appLines.map((entry) => entry.slug);
  return catalogSlugs.length === lineSlugs.length && catalogSlugs.every((slug, index) => slug === lineSlugs[index]);
}

function normalizeCommas(lines, region) {
  const appLines = findAppLines(lines, region);
  appLines.forEach((entry, position) => {
    const stripped = lines[entry.index].replace(/\s*,\s*$/, '');
    lines[entry.index] = position < appLines.length - 1 ? `${stripped},` : stripped;
  });
}

function collapseBlankLines(lines, region) {
  const body = lines.slice(region.start, region.end);
  const collapsed = [];
  body.forEach((line) => {
    const blank = line.trim() === '';
    if (blank && (collapsed.length === 0 || collapsed[collapsed.length - 1].trim() === '')) return;
    collapsed.push(line);
  });
  while (collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === '') collapsed.pop();
  lines.splice(region.start, region.end - region.start, ...collapsed);
  return { start: region.start, end: region.start + collapsed.length };
}

function moveByLine(text, catalog, move, today) {
  const lines = text.split('\n');
  let region = findAppsRegion(lines);
  if (!region) return null;
  const appLines = findAppLines(lines, region);
  if (!canSurgeryByLine(catalog, appLines)) return null;

  const source = appLines.find((entry) => entry.slug === move.app.slug);
  const movedLine = lines[source.index].replace(SECTION_RE, `$1${move.to}$3`);
  lines.splice(source.index, 1);
  region = { start: region.start, end: region.end - 1 };

  const remaining = findAppLines(lines, region);
  const order = catalog.sections.map((section) => section.key);
  const targetPosition = order.indexOf(move.to);
  const targetGroup = remaining.filter((entry) => entry.section === move.to);

  if (targetGroup.length > 0) {
    lines.splice(targetGroup[targetGroup.length - 1].index + 1, 0, movedLine);
  } else {
    const preceding = remaining.filter((entry) => {
      const position = order.indexOf(entry.section);
      return position >= 0 && position < targetPosition;
    });
    if (preceding.length > 0) {
      lines.splice(preceding[preceding.length - 1].index + 1, 0, '', movedLine);
    } else if (remaining.length > 0) {
      lines.splice(remaining[0].index, 0, movedLine, '');
    } else {
      lines.splice(region.start, 0, movedLine);
    }
  }
  region = findAppsRegion(lines);
  region = collapseBlankLines(lines, region);
  normalizeCommas(lines, region);

  let result = lines.join('\n');
  if (today) result = result.replace(UPDATED_AT_RE, `$1${today}$2`);
  return result;
}

function moveByRewrite(catalog, move, today) {
  const apps = catalog.apps.filter((app) => app.slug !== move.app.slug);
  apps.push({ ...move.app, section: move.to });
  const next = { ...catalog, apps };
  if (today && Object.prototype.hasOwnProperty.call(next, 'updatedAt')) next.updatedAt = today;
  return formatCatalog(next);
}

// 결과 자가 검증 — 옮긴 앱만 section이 바뀌고 나머지는 전부 그대로여야 한다.
function verifyMoved(originalCatalog, resultText, move) {
  let result;
  try {
    result = JSON.parse(resultText);
  } catch {
    return false;
  }
  if (!Array.isArray(result.apps) || result.apps.length !== originalCatalog.apps.length) return false;
  if (JSON.stringify(result.sections) !== JSON.stringify(originalCatalog.sections)) return false;
  const before = new Map(originalCatalog.apps.map((app) => [app.slug, app]));
  for (const app of result.apps) {
    const previous = before.get(app.slug);
    if (!previous) return false;
    const expected = app.slug === move.app.slug ? { ...previous, section: move.to } : previous;
    if (JSON.stringify(app) !== JSON.stringify(expected)) return false;
  }
  return true;
}

// 본체 — text(정본 원문) 안에서 slug 앱을 section으로 옮긴 새 원문을 만든다.
export function moveAppSection(text, slug, section, { today = kstToday() } = {}) {
  const catalog = parseCatalog(text);
  const move = resolveMove(catalog, slug, section);
  if (move.from === move.to) {
    return { text, changed: false, method: 'none', app: move.app, from: move.from, to: move.to };
  }
  const byLine = moveByLine(text, catalog, move, today);
  if (byLine !== null && verifyMoved(catalog, byLine, move)) {
    return { text: byLine, changed: true, method: 'line', app: move.app, from: move.from, to: move.to };
  }
  const rewritten = moveByRewrite(catalog, move, today);
  if (!verifyMoved(catalog, rewritten, move)) {
    throw new CatalogError('verify-failed', '편집 결과 검증에 실패해 커밋하지 않았어요', 500);
  }
  return { text: rewritten, changed: true, method: 'rewrite', app: move.app, from: move.from, to: move.to };
}

// ── GitHub Contents API ──

function githubHeaders(token) {
  return {
    'User-Agent': 'JaceHub/1.0',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: `Bearer ${token}`,
  };
}

async function githubRequest(url, init) {
  const signal = typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : undefined;
  let response;
  try {
    response = await fetch(url, { ...init, signal });
  } catch (error) {
    throw new CatalogError('github-unreachable', `GitHub에 연결하지 못했어요 — ${error?.message || error}`, 502);
  }
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, payload };
}

export function decodeBase64Utf8(base64) {
  const binary = atob(String(base64 || '').replace(/\s+/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeUtf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return btoa(binary);
}

function contentsUrl(repo, branch) {
  const [owner, name] = repo.split('/');
  return `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${CATALOG_PATH}?ref=${encodeURIComponent(branch)}`;
}

async function readCatalogFile(token, repo, branch) {
  const { ok, status, payload } = await githubRequest(contentsUrl(repo, branch), { headers: githubHeaders(token) });
  if (!ok) {
    if (status === 401) throw new CatalogError('github-unauthorized', 'GitHub 토큰이 유효하지 않아요 — 설정에서 다시 넣어주세요', 401);
    if (status === 403) throw new CatalogError('github-forbidden', `GitHub가 접근을 거절했어요 — ${payload?.message || '권한 또는 rate limit'}`, 403);
    if (status === 404) throw new CatalogError('github-not-found', `${repo}의 ${CATALOG_PATH}(${branch})를 찾지 못했어요 — 토큰에 이 레포 권한이 있는지 확인해주세요`, 404);
    throw new CatalogError('github-error', `GitHub 읽기 실패 (HTTP ${status}) — ${payload?.message || ''}`.trim(), 502);
  }
  if (!payload?.sha || typeof payload.content !== 'string') {
    throw new CatalogError('github-error', 'GitHub 응답에 파일 내용이 없어요', 502);
  }
  return { sha: payload.sha, text: decodeBase64Utf8(payload.content) };
}

async function writeCatalogFile(token, repo, branch, { text, sha, message }) {
  const url = contentsUrl(repo, branch).replace(/\?ref=.*$/, '');
  return githubRequest(url, {
    method: 'PUT',
    headers: { ...githubHeaders(token), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, content: encodeUtf8Base64(text), sha, branch }),
  });
}

function mapWriteFailure(status, payload, repo) {
  const detail = payload?.message ? ` — ${payload.message}` : '';
  if (status === 401) return new CatalogError('github-unauthorized', 'GitHub 토큰이 유효하지 않아요', 401);
  if (status === 409) return new CatalogError('github-conflict', '정본이 그 사이 두 번 바뀌어 커밋하지 못했어요 — 잠시 뒤 다시 시도해주세요', 409);
  if (status === 403 || status === 404) {
    return new CatalogError('github-forbidden', `GitHub 토큰에 ${repo} 레포의 contents 쓰기 권한이 없어요 (Fine-grained: Contents → Read and write / Classic: repo)${detail}`, 403);
  }
  if (status === 422) return new CatalogError('github-rejected', `GitHub가 커밋을 거절했어요${detail}`, 422);
  return new CatalogError('github-error', `GitHub 쓰기 실패 (HTTP ${status})${detail}`, 502);
}

// ── Handler ──

export async function onRequest(context) {
  const { request, env = {} } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== 'PATCH' && request.method !== 'POST') {
    return errorResponse('method-not-allowed', 'Method not allowed', 405);
  }

  const token = (request.headers.get('X-GH-Token') || '').trim();
  if (!token) {
    return errorResponse('no-token', 'GitHub 토큰이 필요해요 — 설정에서 contents 쓰기 권한이 있는 토큰을 넣어주세요', 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('bad-request', '요청 본문을 파싱할 수 없어요', 400);
  }
  const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
  const section = typeof body?.section === 'string' ? body.section.trim() : '';

  const repo = typeof env.CATALOG_REPO === 'string' && env.CATALOG_REPO.includes('/') ? env.CATALOG_REPO : DEFAULT_REPO;
  const branch = typeof env.CATALOG_BRANCH === 'string' && env.CATALOG_BRANCH ? env.CATALOG_BRANCH : DEFAULT_BRANCH;
  const today = kstToday();

  try {
    // sha 충돌(누군가 사이에 커밋)이면 한 번 다시 읽어 재시도한다.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const file = await readCatalogFile(token, repo, branch);
      const result = moveAppSection(file.text, slug, section, { today });
      if (!result.changed) {
        return jsonResponse({
          success: true,
          changed: false,
          slug: result.app.slug,
          name: result.app.name,
          from: result.from,
          to: result.to,
          message: '이미 그 섹션에 있어요',
        });
      }
      const message = `catalog: ${result.app.slug} ${result.from} → ${result.to} (jacehub 시트에서 이동)`;
      const written = await writeCatalogFile(token, repo, branch, { text: result.text, sha: file.sha, message });
      if (written.status === 409 && attempt === 0) continue; // sha 충돌 — 다시 읽어 한 번 더
      if (!written.ok) throw mapWriteFailure(written.status, written.payload, repo);
      return jsonResponse({
        success: true,
        changed: true,
        slug: result.app.slug,
        name: result.app.name,
        from: result.from,
        to: result.to,
        updatedAt: today,
        method: result.method,
        retried: attempt > 0,
        commit: {
          sha: written.payload?.commit?.sha || '',
          url: written.payload?.commit?.html_url || '',
        },
      });
    }
    throw new CatalogError('internal', '재시도 루프를 벗어났어요', 500);
  } catch (error) {
    if (error instanceof CatalogError) return errorResponse(error.code, error.message, error.status);
    return errorResponse('internal', `처리 중 오류 — ${error?.message || error}`, 500);
  }
}
