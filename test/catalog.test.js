import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CatalogError,
  decodeBase64Utf8,
  encodeUtf8Base64,
  formatCatalog,
  moveAppSection,
  onRequest,
} from '../functions/api/catalog.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 고정된 카탈로그로 이동 규칙을 검증한다. 운영 앱 배치 변경과 독립적이다.
const REAL = await readFile(path.join(ROOT, 'test/fixtures/catalog.json'), 'utf8');
const TODAY = '2026-09-05';

const appLinesOf = (text) => text.split('\n').filter((line) => /"slug"\s*:/.test(line));
const sectionOfLine = (line) => line.match(/"section"\s*:\s*"([^"]*)"/)?.[1];

// ── 순수 함수: 줄 단위 이동 ──

test('youtubewc game → life: 줄 하나만 옮기고 나머지는 바이트 그대로', () => {
  const { text, changed, method, from, to } = moveAppSection(REAL, 'youtubewc', 'life', { today: TODAY });
  assert.equal(changed, true);
  assert.equal(method, 'line');
  assert.equal(from, 'game');
  assert.equal(to, 'life');

  const parsed = JSON.parse(text);
  assert.equal(parsed.apps.find((app) => app.slug === 'youtubewc').section, 'life');
  assert.equal(parsed.updatedAt, TODAY);
  assert.equal(parsed.apps.length, JSON.parse(REAL).apps.length);

  // 옮긴 줄은 life 그룹의 마지막(learneverything 바로 다음)에 놓인다
  const lines = appLinesOf(text);
  const movedIndex = lines.findIndex((line) => line.includes('"youtubewc"'));
  assert.ok(lines[movedIndex - 1].includes('"learneverything"'), 'life 그룹 끝에 붙어야 한다');
  assert.equal(sectionOfLine(lines[movedIndex]), 'life');
  assert.equal(lines.filter((line) => sectionOfLine(line) === 'game').length, 3);

  // diff 최소: 원본에서 youtubewc 줄과 updatedAt 줄만 제외하면 동일 (빈 줄 정리 포함)
  const strip = (source) => source.split('\n').filter((line) => !line.includes('"youtubewc"') && !line.includes('"updatedAt"') && line.trim() !== '');
  assert.deepEqual(strip(text), strip(REAL));
  // 원본 youtubewc 줄에서 section 값만 바뀐 줄이어야 한다 (열 정렬·나머지 필드 그대로)
  const originalLine = appLinesOf(REAL).find((line) => line.includes('"youtubewc"'));
  assert.equal(lines[movedIndex], originalLine.replace('"section": "game"', '"section": "life"'));
});

test('마지막 원소(jacehub, hangar)를 옮기면 쉼표가 보정된다', () => {
  const { text, method } = moveAppSection(REAL, 'jacehub', 'tool', { today: TODAY });
  assert.equal(method, 'line');
  const parsed = JSON.parse(text);
  assert.equal(parsed.apps.find((app) => app.slug === 'jacehub').section, 'tool');
  const lines = appLinesOf(text);
  assert.ok(lines[lines.length - 1].includes('"refboard"'), '새 마지막 원소는 refboard');
  assert.ok(!lines[lines.length - 1].trimEnd().endsWith(','), '마지막 원소엔 쉼표가 없어야 한다');
  assert.ok(lines.slice(0, -1).every((line) => line.trimEnd().endsWith(',')), '나머지는 전부 쉼표');
  const movedIndex = lines.findIndex((line) => line.includes('"jacehub"'));
  assert.ok(lines[movedIndex - 1].includes('"jacefiles"'), 'tool 그룹 끝에 붙어야 한다');
});

test('빈 섹션으로 옮기면 섹션 순서 자리에 빈 줄을 띄우고 그룹을 만든다', () => {
  // retire 그룹을 비운 원본을 만든다
  const emptied = REAL.split('\n').filter((line) => !/"section": "retire"/.test(line)).join('\n');
  const source = moveAppSection(emptied, 'jacehub', 'hangar', { today: TODAY }).text; // 쉼표·빈줄 정규화만
  const { text, method } = moveAppSection(source, 'maai', 'retire', { today: TODAY });
  assert.equal(method, 'line');
  const parsed = JSON.parse(text);
  assert.equal(parsed.apps.find((app) => app.slug === 'maai').section, 'retire');

  const raw = text.split('\n');
  const movedAt = raw.findIndex((line) => line.includes('"maai"'));
  assert.equal(raw[movedAt - 1].trim(), '', '앞에 빈 줄');
  assert.ok(raw[movedAt - 2].includes('"section": "unreviewed"'), 'unreviewed 그룹 뒤에');
  assert.equal(raw[movedAt + 1].trim(), '', '뒤에 빈 줄');
  assert.ok(raw[movedAt + 2].includes('"section": "hangar"'), 'hangar 그룹 앞에');
  assert.ok(!/\n\s*\n\s*\n/.test(text), '빈 줄이 두 번 연속되면 안 된다');
});

test('그룹의 유일한 앱을 옮기면 남는 빈 줄이 정리된다', () => {
  const { text } = moveAppSection(REAL, 'yongin-bezanson-2026', 'hangar', { today: TODAY });
  const { text: again } = moveAppSection(text, 'fighting-combo-archive', 'hangar', { today: TODAY });
  assert.ok(!/\n\s*\n\s*\n/.test(again));
  JSON.parse(again);
});

test('같은 섹션이면 changed=false, 원문 그대로', () => {
  const result = moveAppSection(REAL, 'youtubewc', 'game', { today: TODAY });
  assert.equal(result.changed, false);
  assert.equal(result.text, REAL);
});

test('모르는 slug / 모르는 section / internal / 나쁜 형식은 CatalogError', () => {
  assert.throws(() => moveAppSection(REAL, 'nope', 'life'), (error) => error instanceof CatalogError && error.code === 'unknown-slug' && error.status === 404);
  assert.throws(() => moveAppSection(REAL, 'youtubewc', 'zzz'), (error) => error.code === 'unknown-section' && error.status === 400);
  assert.throws(() => moveAppSection(REAL, 'youtubewc', 'internal'), (error) => error.code === 'unknown-section');
  assert.throws(() => moveAppSection(REAL, '', 'life'), (error) => error.code === 'bad-request');
  assert.throws(() => moveAppSection(REAL, 'a b', 'life'), (error) => error.code === 'bad-request');
  assert.throws(() => moveAppSection('{ nope', 'youtubewc', 'life'), (error) => error.code === 'invalid-json' && error.status === 422);
});

// ── 순수 함수: 폴백 재작성 ──

test('압축 JSON(관행 깨짐)은 정규 포맷으로 다시 쓴다', () => {
  const minified = JSON.stringify(JSON.parse(REAL));
  const { text, method } = moveAppSection(minified, 'youtubewc', 'life', { today: TODAY });
  assert.equal(method, 'rewrite');
  const parsed = JSON.parse(text);
  assert.equal(parsed.apps.find((app) => app.slug === 'youtubewc').section, 'life');
  assert.equal(parsed.updatedAt, TODAY);
  // 그룹은 섹션 순서, 옮긴 앱은 life 그룹 끝
  const lines = appLinesOf(text);
  const movedIndex = lines.findIndex((line) => line.includes('"youtubewc"'));
  assert.equal(sectionOfLine(lines[movedIndex - 1]), 'life');
  assert.equal(sectionOfLine(lines[movedIndex + 1]), 'tool');
  assert.ok(text.includes('\n\n'), '그룹 사이 빈 줄');
});

test('formatCatalog는 파싱 왕복이 되고 메타·섹션을 보존한다', () => {
  const catalog = JSON.parse(REAL);
  const formatted = formatCatalog(catalog);
  const back = JSON.parse(formatted);
  assert.deepEqual(back.sections, catalog.sections);
  assert.equal(back.note, catalog.note);
  assert.equal(back.version, catalog.version);
  assert.deepEqual(new Set(back.apps.map((app) => app.slug)), new Set(catalog.apps.map((app) => app.slug)));
});

test('base64 UTF-8 왕복 (한글 포함)', () => {
  assert.equal(decodeBase64Utf8(encodeUtf8Base64(REAL)), REAL);
  // GitHub는 content를 60자마다 줄바꿈해서 준다
  const wrapped = encodeUtf8Base64('유튜브뮤직 월드컵 → 생활').replace(/(.{10})/g, '$1\n');
  assert.equal(decodeBase64Utf8(wrapped), '유튜브뮤직 월드컵 → 생활');
});

// ── 핸들러: GitHub를 가짜 fetch로 ──

function fakeGithub({ text, sha = 'sha-1', putStatus = 200, putStatuses = null, getStatus = 200 }) {
  const calls = [];
  let current = { text, sha };
  let putCount = 0;
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ url: String(url), method, headers: init.headers, body: init.body ? JSON.parse(init.body) : null });
    if (method === 'GET') {
      if (getStatus !== 200) return Response.json({ message: 'Not Found' }, { status: getStatus });
      return Response.json({ sha: current.sha, content: encodeUtf8Base64(current.text).replace(/(.{60})/g, '$1\n'), encoding: 'base64' });
    }
    if (method === 'PUT') {
      const status = putStatuses ? putStatuses[putCount] : putStatus;
      putCount += 1;
      if (status !== 200) return Response.json({ message: status === 409 ? 'is at sha-x but expected sha-1' : 'Resource not accessible by personal access token' }, { status });
      const body = JSON.parse(init.body);
      current = { text: decodeBase64Utf8(body.content), sha: `sha-${putCount + 1}` };
      return Response.json({ content: { sha: 'blob' }, commit: { sha: `commit-${putCount}`, html_url: `https://github.com/x/y/commit/commit-${putCount}` } });
    }
    return new Response(null, { status: 500 });
  };
  return { fetchImpl, calls, get current() { return current; } };
}

function patchContext(body, { token = 'ghp_test', env = {}, method = 'PATCH' } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['X-GH-Token'] = token;
  return {
    env,
    request: new Request('http://local/api/catalog', { method, headers, body: JSON.stringify(body) }),
  };
}

async function withFetch(fetchImpl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test('PATCH: 읽기 → 편집 → sha 실어 PUT, 커밋 정보 회신', async () => {
  const gh = fakeGithub({ text: REAL });
  const response = await withFetch(gh.fetchImpl, () => onRequest(patchContext({ slug: 'youtubewc', section: 'life' })));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.equal(data.changed, true);
  assert.equal(data.from, 'game');
  assert.equal(data.to, 'life');
  assert.equal(data.method, 'line');
  assert.equal(data.retried, false);
  assert.equal(data.commit.sha, 'commit-1');
  assert.match(data.updatedAt, /^\d{4}-\d{2}-\d{2}$/);

  const [get, put] = gh.calls;
  assert.equal(get.method, 'GET');
  assert.match(get.url, /repos\/architectofthoughts\/jacehub\/contents\/catalog\.json\?ref=main$/);
  assert.equal(get.headers.Authorization, 'Bearer ghp_test');
  assert.equal(put.method, 'PUT');
  assert.match(put.url, /contents\/catalog\.json$/);
  assert.equal(put.body.sha, 'sha-1');
  assert.equal(put.body.branch, 'main');
  assert.match(put.body.message, /^catalog: youtubewc game → life/);
  assert.equal(JSON.parse(gh.current.text).apps.find((app) => app.slug === 'youtubewc').section, 'life');
});

test('PATCH: 토큰 없으면 401, GitHub는 호출하지 않는다', async () => {
  const gh = fakeGithub({ text: REAL });
  const response = await withFetch(gh.fetchImpl, () => onRequest(patchContext({ slug: 'youtubewc', section: 'life' }, { token: '' })));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'no-token');
  assert.equal(gh.calls.length, 0);
});

test('PATCH: 같은 섹션이면 PUT 없이 changed=false', async () => {
  const gh = fakeGithub({ text: REAL });
  const response = await withFetch(gh.fetchImpl, () => onRequest(patchContext({ slug: 'youtubewc', section: 'game' })));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.changed, false);
  assert.equal(gh.calls.filter((call) => call.method === 'PUT').length, 0);
});

test('PATCH: 모르는 slug는 404, 모르는 section은 400', async () => {
  const gh = fakeGithub({ text: REAL });
  const missing = await withFetch(gh.fetchImpl, () => onRequest(patchContext({ slug: 'nope', section: 'life' })));
  assert.equal(missing.status, 404);
  const badSection = await withFetch(gh.fetchImpl, () => onRequest(patchContext({ slug: 'youtubewc', section: 'internal' })));
  assert.equal(badSection.status, 400);
});

test('PATCH: 쓰기 권한 없는 토큰(403/404)은 권한 안내 403', async () => {
  const gh = fakeGithub({ text: REAL, putStatus: 404 });
  const response = await withFetch(gh.fetchImpl, () => onRequest(patchContext({ slug: 'youtubewc', section: 'life' })));
  const data = await response.json();
  assert.equal(response.status, 403);
  assert.equal(data.code, 'github-forbidden');
  assert.match(data.errors[0].message, /contents 쓰기 권한/);
});

test('PATCH: sha 충돌(409)이면 다시 읽어 한 번 재시도한다', async () => {
  const gh = fakeGithub({ text: REAL, putStatuses: [409, 200] });
  const response = await withFetch(gh.fetchImpl, () => onRequest(patchContext({ slug: 'youtubewc', section: 'life' })));
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.retried, true);
  assert.deepEqual(gh.calls.map((call) => call.method), ['GET', 'PUT', 'GET', 'PUT']);
});

test('PATCH: 두 번 연속 충돌이면 409로 포기한다', async () => {
  const gh = fakeGithub({ text: REAL, putStatuses: [409, 409] });
  const response = await withFetch(gh.fetchImpl, () => onRequest(patchContext({ slug: 'youtubewc', section: 'life' })));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'github-conflict');
});

test('env.CATALOG_REPO / CATALOG_BRANCH로 대상 레포를 바꿀 수 있다', async () => {
  const gh = fakeGithub({ text: REAL });
  await withFetch(gh.fetchImpl, () => onRequest(patchContext({ slug: 'youtubewc', section: 'life' }, { env: { CATALOG_REPO: 'someone/fork', CATALOG_BRANCH: 'dev' } })));
  assert.match(gh.calls[0].url, /repos\/someone\/fork\/contents\/catalog\.json\?ref=dev$/);
  assert.equal(gh.calls[1].body.branch, 'dev');
});

test('GET/DELETE는 405, OPTIONS는 204', async () => {
  const get = await onRequest({ env: {}, request: new Request('http://local/api/catalog', { method: 'GET' }) });
  assert.equal(get.status, 405);
  const options = await onRequest({ env: {}, request: new Request('http://local/api/catalog', { method: 'OPTIONS' }) });
  assert.equal(options.status, 204);
});
