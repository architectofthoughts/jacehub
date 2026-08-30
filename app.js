/* ═══════════════════════════════════════════════
   JaceHub — 정문 (런처 + 디테일 시트 + 관제 레이어 + 설정/볼트)
   2026-08-31 전면 개선 · 기준 목업 a-cream.html (F01 크림 페이퍼)
   데이터 정본: catalog.json (런타임 fetch) · 관제: /api/projects (토큰 있을 때만)
   ═══════════════════════════════════════════════ */

(() => {
  'use strict';

  // ── Constants ──
  const CATALOG_URL = 'catalog.json';
  const ICON_BASE = 'icons/apps/';
  const SHOT_BASE = 'shots/';
  const CACHE_TTL_MS = 10 * 60 * 1000;
  const TOAST_DURATION_MS = 3000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  // 정체 판정 — 리디자인에서 30일로 조정 (구 대시보드 21일). 시트 배지 라벨과 동일 값.
  const STALE_PROJECT_DAYS = 30;
  const DEFAULT_PINNED = ['jacemaster', 'weneedstress', 'jacepages', 'jacefiles'];
  const OPS_SECTION_ORDER = ['unreviewed', 'retire', 'hangar', 'internal'];
  const INTERNAL_SECTION = { key: 'internal', emoji: '🔒', label: '내부', blurb: 'CF Access 뒤 — 정문 제외', front: false };

  // localStorage 키 — 구 대시보드와 동일 (크레덴셜·즐겨찾기·볼트 연결은 그대로 계승)
  const STORAGE_KEYS = {
    accountId:   'jacehub_account_id',
    apiToken:    'jacehub_api_token',
    ghToken:     'jacehub_gh_token',
    vercelToken: 'jacehub_vercel_token',
    cache:       'jacehub_cache',
    favorites:   'jacehub_favorites',
    vaultLinked: 'jacehub_vault_linked',
    vaultPin:    'jacehub_vault_pin',
    opsEnabled:  'jacehub_ops_enabled',
  };
  // 폐기된 키 — 읽지 않고, 있으면 지운다.
  const LEGACY_STORAGE_KEYS = ['jacehub_lobby_cache', 'jacehub_lobby_meta', 'jacehub_quicklobby_open'];

  const PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3l5 5-4 1-3 3 1 5-2 2-4-4-5 5-1-1 5-5-4-4 2-2 5 1 3-3z"/></svg>';
  const CHEV_SVG = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';

  // ── DOM ──
  const $ = (sel) => document.querySelector(sel);
  const dom = {
    front:        $('#front'),
    pinned:       $('#pinned'),
    pinrow:       $('#pinrow'),
    opsblock:     $('#opsblock'),
    opsSecs:      $('#ops-secs'),
    opsLeadNote:  $('#ops-lead-note'),
    colophon:     $('#colophon'),
    dlVer:        $('#dl-ver'),
    dlDate:       $('#dl-date'),
    opsToggle:    $('#ops-toggle'),
    btnSettings:  $('#btn-settings'),
    toastContainer: $('#toast-container'),
    // 시트
    sheet:        $('#sheet'),
    sheetBox:     $('#sheet .sheet'),
    spread:       $('#spread'),
    shPg:         $('#sh-pg'),
    shPrev:       $('#sh-prev'),
    shNext:       $('#sh-next'),
    shClose:      $('#sh-close'),
    shFrame:      $('#sh-frame'),
    shCap:        $('#sh-cap'),
    shIco:        $('#sh-ico'),
    shKick:       $('#sh-kick'),
    shName:       $('#sh-name'),
    shSlug:       $('#sh-slug'),
    shTag:        $('#sh-tag'),
    shDep:        $('#sh-dep'),
    shBadge:      $('#sh-badge'),
    shOpen:       $('#sh-open'),
    shCopy:       $('#sh-copy'),
    shPin:        $('#sh-pin'),
    shPinLabel:   $('#sh-pin-label'),
    tPrev:        $('#t-prev'),
    tNext:        $('#t-next'),
    // 설정 모달
    settings:     $('#settings'),
    modalBox:     $('#settings .modal'),
    inputAccountId:   $('#input-account-id'),
    inputApiToken:    $('#input-api-token'),
    inputGhToken:     $('#input-gh-token'),
    inputVercelToken: $('#input-vercel-token'),
    btnSave:      $('#btn-save'),
    btnCancel:    $('#btn-cancel'),
    btnModalClose: $('#btn-modal-close'),
    btnClearLocal: $('#btn-clear-local'),
    // 볼트
    vaultStatus:  $('#vault-status'),
    vaultForm:    $('#vault-form'),
    btnVaultUpdate: $('#btn-vault-update'),
    btnVaultDelete: $('#btn-vault-delete'),
    vaultTabLoad: $('#vault-tab-load'),
    vaultTabSave: $('#vault-tab-save'),
    vaultPanelLoad: $('#vault-panel-load'),
    vaultPanelSave: $('#vault-panel-save'),
    inputVaultPinLoad:    $('#input-vault-pin-load'),
    inputVaultPinSave:    $('#input-vault-pin-save'),
    inputVaultPinConfirm: $('#input-vault-pin-confirm'),
    btnVaultLoad: $('#btn-vault-load'),
    btnVaultSave: $('#btn-vault-save'),
  };

  // ── State ──
  let catalog = null;                 // { version, updatedAt, sections[], apps[] }
  let favoriteSlugs = new Set();      // 고정 앱 slug
  let opsOn = false;                  // 관제 레이어 표시 여부
  let liveProjects = [];              // /api/projects 결과
  let liveLoaded = false;
  let liveLoading = false;
  let liveError = '';
  let activeFetchController = null;
  let latestLoadRequestId = 0;
  const expandedOps = new Set();      // 펼쳐둔 관제 섹션 key
  const iconMissing = new Set();      // 404 난 아이콘 slug → 이후 렌더는 폴백 직행
  const shotMissing = new Set();      // 404 난 스크린샷 slug
  let firstRenderDone = false;
  let revealObserver = null;
  // 시트
  let currentApp = null;
  let sheetOpener = null;
  let touchStartX = 0;
  let touchStartY = 0;
  // 볼트 동기
  let vaultSyncTimer = null;
  let lastVaultSyncBody = '';

  // ── Utils ──
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;',
  })[char]);
  const pad2 = (n) => String(n).padStart(2, '0');

  function hashString(value) {
    let hash = 2166136261;
    for (const char of String(value || '')) {
      hash ^= char.charCodeAt(0);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return hash;
  }

  function getAppInitial(name) {
    const stripped = String(name || '').trim().replace(/^[([][^)\]]*[)\]]\s*/, '');
    return ([...stripped][0] || '?').toUpperCase();
  }

  function hostOf(url) {
    try {
      return new URL(url).host;
    } catch {
      return '';
    }
  }

  function storageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // private 모드 등 — 메모리 상태로만 동작
    }
  }

  function storageRemove(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }

  // ── Credentials (구 대시보드와 동일 스키마) ──
  function getConfig() {
    return {
      accountId:   storageGet(STORAGE_KEYS.accountId)   || '',
      apiToken:    storageGet(STORAGE_KEYS.apiToken)    || '',
      ghToken:     storageGet(STORAGE_KEYS.ghToken)     || '',
      vercelToken: storageGet(STORAGE_KEYS.vercelToken) || '',
    };
  }

  function saveConfig(accountId, apiToken, ghToken, vercelToken) {
    storageSet(STORAGE_KEYS.accountId,   String(accountId || '').trim());
    storageSet(STORAGE_KEYS.apiToken,    String(apiToken || '').trim());
    storageSet(STORAGE_KEYS.ghToken,     String(ghToken || '').trim());
    storageSet(STORAGE_KEYS.vercelToken, String(vercelToken || '').trim());
  }

  function clearConfig() {
    [STORAGE_KEYS.accountId, STORAGE_KEYS.apiToken, STORAGE_KEYS.ghToken, STORAGE_KEYS.vercelToken, STORAGE_KEYS.cache]
      .forEach(storageRemove);
    setVaultLinked(false);
  }

  function hasConfig() {
    const { accountId, apiToken } = getConfig();
    return accountId.length > 0 && apiToken.length > 0;
  }

  // ── Project cache (10분 TTL, 계정 ID 매칭) ──
  function saveCache(projectList) {
    const { accountId } = getConfig();
    storageSet(STORAGE_KEYS.cache, JSON.stringify({
      accountId,
      timestamp: Date.now(),
      projects: projectList,
    }));
  }

  function loadCache() {
    try {
      const raw = storageGet(STORAGE_KEYS.cache);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.projects)) return null;
      const { accountId } = getConfig();
      if (parsed.accountId && accountId && parsed.accountId !== accountId) return null;
      return {
        accountId: parsed.accountId || '',
        timestamp: Number(parsed.timestamp) || 0,
        projects: parsed.projects,
      };
    } catch {
      return null;
    }
  }

  function isCacheFresh(cacheEntry) {
    return Boolean(cacheEntry?.timestamp) && (Date.now() - cacheEntry.timestamp) < CACHE_TTL_MS;
  }

  // ── Favorites → 고정 행 (키 `jacehub_favorites` 계승, 값은 slug) ──
  function loadFavorites() {
    try {
      const raw = JSON.parse(storageGet(STORAGE_KEYS.favorites) || '[]');
      if (!Array.isArray(raw)) return new Set();
      return new Set(raw.map((name) => String(name || '').trim()).filter(Boolean));
    } catch {
      return new Set();
    }
  }

  function saveFavorites() {
    storageSet(STORAGE_KEYS.favorites, JSON.stringify([...favoriteSlugs]));
    queueVaultSync();
  }

  function applyServerFavorites(rawFavorites) {
    if (!Array.isArray(rawFavorites)) return;
    const next = rawFavorites.map((name) => String(name || '').trim()).filter(Boolean);
    if (next.length === 0) return; // 서버가 비어 있으면 로컬(기본값 포함) 유지
    favoriteSlugs = new Set(next);
    storageSet(STORAGE_KEYS.favorites, JSON.stringify([...favoriteSlugs]));
  }

  function isFavorite(slug) {
    return favoriteSlugs.has(String(slug || '').trim());
  }

  function toggleFavorite(slug) {
    const normalized = String(slug || '').trim();
    if (!normalized) return false;
    if (favoriteSlugs.has(normalized)) {
      favoriteSlugs.delete(normalized);
      saveFavorites();
      return false;
    }
    favoriteSlugs.add(normalized);
    saveFavorites();
    return true;
  }

  // ── Vault link state ──
  function isVaultLinked() {
    return storageGet(STORAGE_KEYS.vaultLinked) === '1';
  }

  function setVaultLinked(linked) {
    if (linked) {
      storageSet(STORAGE_KEYS.vaultLinked, '1');
    } else {
      storageRemove(STORAGE_KEYS.vaultLinked);
      storageRemove(STORAGE_KEYS.vaultPin);
    }
  }

  function setVaultPin(pin) {
    if (typeof pin === 'string' && /^\d{6}$/.test(pin)) {
      storageSet(STORAGE_KEYS.vaultPin, pin);
    }
  }

  // 고정 변경을 하나의 봉투 POST로 묶는다 (연쇄 저장 코얼레싱). lobby 필드는 더 이상 보내지 않는다.
  function queueVaultSync() {
    if (!isVaultLinked()) return;
    clearTimeout(vaultSyncTimer);
    vaultSyncTimer = setTimeout(syncVaultToServer, 1500);
  }

  async function syncVaultToServer() {
    const pin = storageGet(STORAGE_KEYS.vaultPin) || '';
    if (!/^\d{6}$/.test(pin)) return; // PIN 분실 — 다음 unlock까지 보류
    const { accountId, apiToken, ghToken, vercelToken } = getConfig();
    if (!accountId || !apiToken) return;
    const body = JSON.stringify({ pin, accountId, apiToken, ghToken, vercelToken, favorites: [...favoriteSlugs] });
    if (body === lastVaultSyncBody) return;
    try {
      await fetch('/api/vault', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      lastVaultSyncBody = body;
    } catch {
      // 네트워크 오류는 localStorage 미러로 우회 — 다음 변경에서 재시도
    }
  }

  // ── Toast ──
  function showToast(message, type = 'info') {
    if (!dom.toastContainer) return;
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      if (!toast.isConnected) return;
      toast.classList.add('is-leaving');
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (reduced) {
        toast.remove();
      } else {
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
        setTimeout(() => toast.remove(), 600);
      }
    }, TOAST_DURATION_MS);
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('클립보드에 복사하지 못했습니다.');
  }

  // ── /api/projects (기존 헤더 규약 그대로) ──
  async function fetchProjects(signal) {
    const { accountId, apiToken, ghToken, vercelToken } = getConfig();
    const headers = { 'X-CF-Account-Id': accountId, 'X-CF-Api-Token': apiToken };
    if (ghToken) headers['X-GH-Token'] = ghToken;
    if (vercelToken) headers['X-Vercel-Api-Token'] = vercelToken;

    const response = await fetch('/api/projects', { headers, signal });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.errors?.[0]?.message || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return { projects: Array.isArray(data.result) ? data.result : [], meta: data._meta || {} };
  }

  // ── 상태 계산 (구 getProjectStatusKey 계승) ──
  function getProjectStatusKey(project) {
    if (project._type === 'service') {
      switch (project._health) {
        case 'healthy': return 'success';
        case 'down':
        case 'inactive': return 'failure';
        case 'degraded': return 'active';
        default: return 'unknown';
      }
    }
    const stage = project.latest_deployment?.latest_stage;
    if (!stage) return 'active';
    switch (stage.status) {
      case 'success': return 'success';
      case 'failure': return 'failure';
      default: return 'active';
    }
  }

  function getDeploymentTimestamp(project) {
    const timestamp = new Date(project.latest_deployment?.created_on || '').getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  function getProjectAgeDays(project) {
    const timestamp = getDeploymentTimestamp(project);
    if (!timestamp) return null;
    return Math.max(0, Math.floor((Date.now() - timestamp) / DAY_MS));
  }

  function formatDeploymentAge(days) {
    if (days === null) return '배포 이력 없음';
    if (days === 0) return '오늘 배포';
    if (days === 1) return '1일 전 배포';
    return `${days}일 전 배포`;
  }

  // 타일 상태점·시트 배지용 4단 상태: ok / fail / run / idle
  function getLiveStatus(project) {
    const isService = project._type === 'service';
    const key = getProjectStatusKey(project);
    if (key === 'failure') return { key: 'fail', label: isService ? '오프라인' : '배포 실패', short: isService ? '오프라인' : '실패' };
    if (key === 'active') return { key: 'run', label: isService ? '불안정' : '배포 진행 중', short: isService ? '불안정' : '진행 중' };
    if (key === 'unknown') return { key: 'idle', label: '상태 미확인', short: '미확인' };
    if (!isService) {
      const ageDays = getProjectAgeDays(project);
      if (ageDays === null) return { key: 'idle', label: '배포 기록 없음', short: '기록 없음' };
      if (ageDays >= STALE_PROJECT_DAYS) return { key: 'idle', label: `정체 · ${STALE_PROJECT_DAYS}일+`, short: '정체' };
    }
    return { key: 'ok', label: isService ? '라이브' : '배포 성공', short: isService ? '온라인' : '활성' };
  }

  function getPrimaryUrl(project) {
    const preferredUrl = project.domains?.[0] || project.subdomain || '';
    if (!preferredUrl) return '';
    const normalized = /^https?:\/\//.test(preferredUrl) ? preferredUrl : `https://${preferredUrl}`;
    try {
      return new URL(normalized).toString();
    } catch {
      return '';
    }
  }

  function platformLabel(app, project) {
    const type = project?._type || app.type || 'pages';
    switch (type) {
      case 'worker': return 'Cloudflare Workers';
      case 'vercel': return 'Vercel';
      case 'service': return 'Self-hosted';
      default: return 'Cloudflare Pages';
    }
  }

  function platformKick(app, project) {
    if (app.internal) return 'INTERNAL';
    if (app.unregistered) return '미등록';
    const type = project?._type || app.type || 'pages';
    return type === 'worker' ? 'WORKER' : type === 'vercel' ? 'VERCEL' : 'PAGES';
  }

  // ── 모델 — 카탈로그 + 라이브 매칭 ──
  function isLiveActive() {
    return opsOn && liveLoaded;
  }

  function buildModel() {
    const sections = catalog.sections;
    const catalogApps = catalog.apps.map((app) => ({ ...app, key: app.slug, catalog: true }));

    // 라이브 매칭 — cfName → slug → URL 호스트(프로젝트명에 -4hm 같은 접미사가 붙은 경우)
    const liveByName = new Map();
    const liveByHost = new Map();
    if (isLiveActive()) {
      liveProjects.forEach((project) => {
        if (!project?.name) return;
        liveByName.set(String(project.name), project);
        [project.subdomain, ...(project.domains || [])].forEach((host) => {
          const normalized = String(host || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
          if (normalized && !liveByHost.has(normalized)) liveByHost.set(normalized, project);
        });
      });
    }
    const matchedNames = new Set();
    catalogApps.forEach((app) => {
      const project = liveByName.get(app.cfName || '')
        || liveByName.get(app.slug)
        || liveByHost.get(hostOf(app.url).toLowerCase());
      if (project && !matchedNames.has(project.name)) {
        app.live = project;
        matchedNames.add(project.name);
      }
    });

    // 미등록(API에만 있음) + 내부 서비스
    const unregistered = [];
    const internal = [];
    if (isLiveActive()) {
      liveProjects.forEach((project) => {
        if (!project?.name) return;
        if (project._type === 'service') {
          internal.push({
            key: `svc:${project.name}`,
            slug: project.name,
            name: project.name,
            tag: project._description || '내부 서비스',
            section: 'internal',
            url: getPrimaryUrl(project),
            type: 'service',
            internal: true,
            live: project,
          });
          return;
        }
        if (matchedNames.has(project.name)) return;
        unregistered.push({
          key: `unreg:${project.name}`,
          slug: project.name,
          name: project.name,
          tag: project._description || '',
          section: 'hangar',
          url: getPrimaryUrl(project),
          type: project._type || 'pages',
          unregistered: true,
          live: project,
        });
      });
      unregistered.sort((a, b) => a.name.localeCompare(b.name));
      internal.sort((a, b) => a.name.localeCompare(b.name));
    }

    const allApps = [...catalogApps, ...unregistered, ...internal];
    const byKey = (sectionKey) => allApps.filter((app) => app.section === sectionKey);

    const frontSections = sections.filter((s) => s.front).map((sec) => ({ sec, apps: byKey(sec.key) }));
    const opsSections = OPS_SECTION_ORDER.map((sectionKey) => {
      const sec = sectionKey === 'internal' ? INTERNAL_SECTION : sections.find((s) => s.key === sectionKey);
      if (!sec) return null;
      return { sec, apps: byKey(sec.key) };
    }).filter(Boolean);

    const pinned = [...favoriteSlugs].map((slug) => catalogApps.find((app) => app.slug === slug)).filter(Boolean);
    const order = [
      ...frontSections.flatMap((entry) => entry.apps),
      ...(opsOn ? opsSections.flatMap((entry) => entry.apps) : []),
    ];

    return { frontSections, opsSections, pinned, order, allApps, unregisteredCount: unregistered.length };
  }

  let model = null;

  function findApp(key) {
    return model?.allApps.find((app) => app.key === key) || null;
  }

  function sectionOf(app) {
    if (app.section === 'internal') return INTERNAL_SECTION;
    return catalog.sections.find((s) => s.key === app.section) || { key: app.section, emoji: '', label: app.section, blurb: '' };
  }

  // ── 아이콘 마크업 — <img> + 이니셜 폴백 ──
  function fallbackIconMarkup(app, extraClass = '') {
    const variant = `v${(hashString(app.slug) % 5) + 1}`;
    return `<div class="ico fb ${variant} ${extraClass}" aria-hidden="true">${esc(getAppInitial(app.name))}</div>`;
  }

  function iconMarkup(app) {
    if (!app.catalog || iconMissing.has(app.slug)) return fallbackIconMarkup(app);
    return `<div class="ico"><img src="${esc(ICON_BASE + app.slug + '.svg')}" alt="" loading="lazy" decoding="async" data-kind="icon" data-slug="${esc(app.slug)}"></div>`;
  }

  function swapIconToFallback(img) {
    const slug = img.dataset.slug;
    iconMissing.add(slug);
    const app = model?.allApps.find((entry) => entry.slug === slug && entry.catalog);
    const holder = img.parentElement;
    if (!holder || !app) return;
    holder.outerHTML = fallbackIconMarkup(app);
  }

  function statusDotMarkup(app) {
    if (!app.live) return '';
    return `<span class="dot ${getLiveStatus(app.live).key}" aria-hidden="true"></span>`;
  }

  function tileMarkup(app, index) {
    const pinned = app.catalog && isFavorite(app.slug);
    const classes = ['tile'];
    if (app.unregistered) classes.push('unreg');
    return `<button class="${classes.join(' ')}" type="button" data-key="${esc(app.key)}" style="--i:${index}" aria-label="${esc(app.name)} 상세 보기">
      ${iconMarkup(app)}
      ${pinned ? `<span class="pinmark" title="고정">${PIN_SVG}</span>` : ''}
      ${statusDotMarkup(app)}
      <span class="txt"><span class="nm">${esc(app.name)}</span><span class="sl">${esc(app.slug)}</span>${
        app.unregistered
          ? '<span class="flag">미등록</span>'
          : `<span class="tg">${esc(app.tag || '—')}</span>`
      }</span>
    </button>`;
  }

  // ── Render ──
  function render() {
    if (!catalog) return;
    model = buildModel();
    renderPinned();
    renderFront();
    renderOps();
    renderColophon();
    updateOpsSwitch();
    observeReveals();
    if (dom.sheet.open && currentApp) {
      const refreshed = findApp(currentApp.key);
      if (refreshed) fillSheet(refreshed);
    }
  }

  function renderPinned() {
    if (model.pinned.length === 0) {
      dom.pinrow.innerHTML = '<span class="empty">고정한 앱이 없어요 — 시트에서 📌 고정을 눌러보세요</span>';
      return;
    }
    dom.pinrow.innerHTML = model.pinned.map((app) => `
      <button class="pin" type="button" data-key="${esc(app.key)}" aria-label="${esc(app.name)} 상세 보기">
        ${iconMarkup(app)}${statusDotMarkup(app)}
        <span><span class="nm">${esc(app.name)}</span><br><span class="sl">${esc(app.slug)}</span></span>
      </button>`).join('');
  }

  function renderFront() {
    const revealClass = firstRenderDone ? 'rv in' : 'rv';
    dom.front.innerHTML = model.frontSections.map(({ sec, apps }, sectionIndex) => `
      <section class="sec ${revealClass}" id="sec-${esc(sec.key)}" aria-labelledby="h-${esc(sec.key)}">
        <header class="sh">
          <span class="no">${pad2(sectionIndex + 1)}</span>
          <h2 id="h-${esc(sec.key)}"><span class="em" aria-hidden="true">${esc(sec.emoji)}</span><span>${esc(sec.label)}</span><span class="blurb">${esc(sec.blurb)}</span></h2>
          <span class="cnt"><b>${apps.length}</b> apps</span>
        </header>
        <div class="grid">${apps.map(tileMarkup).join('')}</div>
      </section>`).join('');
    dom.front.setAttribute('aria-busy', 'false');
  }

  function renderOps() {
    const offset = model.frontSections.length;
    dom.opsSecs.innerHTML = model.opsSections.map(({ sec, apps }, index) => {
      const expanded = expandedOps.has(sec.key);
      let hint = '';
      if (sec.key === 'hangar') {
        hint = liveLoaded
          ? `<p class="hint">미등록 ${model.unregisteredCount}개 — API엔 있는데 catalog.json에 없는 프로젝트. 정문에 올리려면 catalog.json apps[]에 추가하세요.</p>`
          : '<p class="hint">미등록 프로젝트가 여기 자동으로 들어온다 (API 조회 후)</p>';
      } else if (sec.key === 'internal') {
        hint = liveLoaded && apps.length === 0
          ? '<p class="hint">내부 서비스 없음 — functions/api/projects.js SELF_HOSTED_SERVICES로 합류</p>'
          : '<p class="hint">CF Access 뒤 셀프호스트 — 토큰에 Cloudflare Tunnel:Read가 있으면 헬스가 보인다</p>';
      }
      const ghost = sec.key === 'hangar' && model.unregisteredCount === 0
        ? '<div class="tile ghost" aria-hidden="true">+ 미등록<br>자동 합류</div>'
        : '';
      return `<section class="osec" id="osec-${esc(sec.key)}">
        <button class="oh" type="button" id="oh-${esc(sec.key)}" data-ops-section="${esc(sec.key)}" aria-expanded="${String(expanded)}" aria-controls="op-${esc(sec.key)}">
          <span class="no">${pad2(offset + index + 1)}</span>
          <span class="em" aria-hidden="true">${esc(sec.emoji)}</span>
          <span class="lb"><span>${esc(sec.label)}</span><span class="blurb">${esc(sec.blurb)}</span></span>
          <span class="cnt">${apps.length}</span>
          ${CHEV_SVG}
        </button>
        <div class="opanel" id="op-${esc(sec.key)}"${expanded ? '' : ' hidden'}>${hint}<div class="grid">${apps.map(tileMarkup).join('')}${ghost}</div></div>
      </section>`;
    }).join('');

    if (!opsOn) {
      dom.opsLeadNote.textContent = '';
      dom.opsLeadNote.classList.remove('warn');
    } else if (liveLoading && !liveLoaded) {
      dom.opsLeadNote.textContent = 'API 조회 중…';
      dom.opsLeadNote.classList.remove('warn');
    } else if (liveError) {
      dom.opsLeadNote.textContent = `API 실패 · 카탈로그만 표시 — ${liveError}`;
      dom.opsLeadNote.classList.add('warn');
    } else if (liveLoaded) {
      dom.opsLeadNote.textContent = `라이브 ${liveProjects.length}개 · 기본 접힘 · 헤더를 눌러 펼침`;
      dom.opsLeadNote.classList.remove('warn');
    } else {
      dom.opsLeadNote.textContent = '기본 접힘 · 헤더를 눌러 펼침';
      dom.opsLeadNote.classList.remove('warn');
    }
  }

  function renderColophon() {
    const frontCount = model.frontSections.reduce((sum, entry) => sum + entry.apps.length, 0);
    dom.colophon.innerHTML = `<span><b>${frontCount}개 앱</b> · catalog v${esc(catalog.version)} · ${esc(catalog.updatedAt)}</span><span><a href="https://jacehub.pages.dev" rel="noopener">jacehub.pages.dev</a> · F01 크림 페이퍼</span>`;
    dom.dlVer.textContent = String(catalog.version ?? '—');
    dom.dlDate.textContent = String(catalog.updatedAt ?? '—');
  }

  function observeReveals() {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const targets = document.querySelectorAll('.rv:not(.in)');
    if (firstRenderDone || reduced || !('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('in'));
      firstRenderDone = true;
      return;
    }
    if (!revealObserver) {
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('in');
          revealObserver.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -8% 0px' });
    }
    targets.forEach((el) => revealObserver.observe(el));
    firstRenderDone = true;
  }

  // ── 관제 토글 ──
  function updateOpsSwitch() {
    const available = hasConfig();
    dom.opsToggle.setAttribute('aria-checked', String(opsOn));
    dom.opsToggle.classList.toggle('is-unavailable', !available);
    dom.opsToggle.title = available
      ? (opsOn ? '관제 레이어 끄기' : '관제 레이어 켜기')
      : '관제 레이어 — 설정에서 토큰을 넣으면 켜집니다';
  }

  function setOps(on, { persist = true } = {}) {
    const next = Boolean(on) && hasConfig();
    opsOn = next;
    document.body.classList.toggle('ops', next);
    if (persist) storageSet(STORAGE_KEYS.opsEnabled, next ? '1' : '0');
    if (!next) {
      // 레이어를 끄면 열려 있던 관제 섹션의 시트는 정문 목록으로 재계산됨
      if (dom.sheet.open && currentApp && !currentApp.catalog) closeSheet();
    }
    render();
    if (next && !liveLoaded && !liveLoading) loadProjects(false);
  }

  function handleOpsToggle() {
    if (!hasConfig()) {
      showToast('토큰을 넣으면 관제 레이어가 켜져요.', 'info');
      openSettings();
      return;
    }
    setOps(!opsOn);
    showToast(opsOn ? '관제 레이어 ON' : '관제 레이어 OFF — 정문만 표시', 'info');
  }

  // ── 라이브 로드 ──
  function applyLive(projects) {
    liveProjects = Array.isArray(projects) ? projects : [];
    liveLoaded = true;
    liveError = '';
    render();
  }

  async function loadProjects(forceRefresh = false) {
    if (!hasConfig()) return;
    const requestId = ++latestLoadRequestId;
    const cachedEntry = loadCache();
    const cachedProjects = cachedEntry?.projects || [];

    if (!forceRefresh && cachedProjects.length > 0 && isCacheFresh(cachedEntry)) {
      applyLive(cachedProjects);
      return;
    }
    if (!forceRefresh && cachedProjects.length > 0) {
      applyLive(cachedProjects); // stale-while-revalidate
    }

    if (activeFetchController) activeFetchController.abort();
    const controller = new AbortController();
    activeFetchController = controller;
    liveLoading = true;
    renderOps();

    try {
      const { projects, meta } = await fetchProjects(controller.signal);
      if (requestId !== latestLoadRequestId) return;
      saveCache(projects);
      applyLive(projects);

      const parts = [];
      if (meta.pagesCount) parts.push(`Pages ${meta.pagesCount}`);
      if (meta.workersCount) parts.push(`Workers ${meta.workersCount}`);
      if (meta.vercelCount) parts.push(`Vercel ${meta.vercelCount}`);
      if (meta.servicesCount) parts.push(`내부 ${meta.servicesCount}`);
      showToast(`관제 동기화 — ${parts.length > 0 ? parts.join(' · ') : `${projects.length}개`}`, 'success');
      if (meta.pagesError) showToast('Pages 조회 실패: 토큰에 Cloudflare Pages:Read 권한을 추가하세요.', 'error');
      if (meta.workersError) showToast('Workers 조회 실패: 토큰에 Workers Scripts:Read 권한을 추가하세요.', 'error');
      if (meta.vercelError) showToast('Vercel 조회 실패: 토큰을 확인해주세요.', 'error');
    } catch (error) {
      if (error.name === 'AbortError' || requestId !== latestLoadRequestId) return;
      liveError = error.message || '알 수 없는 오류';
      if (!liveLoaded) liveProjects = [];
      showToast(`관제 API 실패 — 카탈로그만 표시합니다 (${liveError})`, 'error');
      render();
    } finally {
      if (requestId === latestLoadRequestId) {
        liveLoading = false;
        renderOps();
      }
      if (activeFetchController === controller) activeFetchController = null;
    }
  }

  // ── 디테일 시트 ──
  function lockScroll(lock) {
    if (lock) {
      document.body.style.overflow = 'hidden';
    } else if (!dom.sheet.open && !dom.settings.open) {
      document.body.style.removeProperty('overflow');
    }
  }

  function shotPlaceholder(app) {
    const reason = app.internal
      ? 'CF Access 뒤 · 캡처 제외'
      : app.unregistered
        ? '미등록 · 카탈로그에 추가하면 캡처됨'
        : app.url
          ? (app.section === 'hangar' ? '격납고 · 캡처 제외' : '캡처 대기')
          : '미배포';
    return `<div class="none"><span><b>스크린샷 없음</b>${esc(reason)}</span></div>`;
  }

  function shotMarkup(app) {
    if (!app.catalog || !app.url || shotMissing.has(app.slug)) return shotPlaceholder(app);
    return `<img src="${esc(SHOT_BASE + app.slug + '.jpg')}" alt="${esc(app.name)} 스크린샷" loading="eager" decoding="async" data-kind="shot" data-slug="${esc(app.slug)}">`;
  }

  function deployLine(app) {
    const project = app.live;
    if (app.internal) {
      const status = project ? getLiveStatus(project) : null;
      return `Self-hosted · CF Access 뒤${status ? ` · ${status.short}` : ''}`;
    }
    if (!app.url && !project) return '미배포 · 카탈로그 등록만';
    const type = platformLabel(app, project);
    if (!project) {
      return isLiveActive() ? `${type} · 라이브 정보 없음` : type;
    }
    const status = getLiveStatus(project);
    return `${type} · ${formatDeploymentAge(getProjectAgeDays(project))} · ${status.short}`;
  }

  function fillSheet(app) {
    currentApp = app;
    const list = model.order;
    const index = list.findIndex((entry) => entry.key === app.key);
    const sec = sectionOf(app);
    const position = index >= 0 ? `<b>${pad2(index + 1)}</b> / ${pad2(list.length)} · ` : '';
    dom.shPg.innerHTML = `${position}${esc(sec.label)}`;
    dom.shKick.textContent = `${sec.emoji} ${sec.label} · ${platformKick(app, app.live)}`;
    dom.shIco.innerHTML = iconMarkup(app);
    dom.shName.textContent = app.name;
    dom.shSlug.textContent = app.slug;
    dom.shTag.textContent = app.tag || '—';
    dom.shDep.textContent = deployLine(app);

    const status = app.live ? getLiveStatus(app.live) : null;
    dom.shBadge.className = `badge${status ? ` ${status.key}` : ''}`;
    dom.shBadge.textContent = status ? status.label : '';

    dom.shFrame.innerHTML = shotMarkup(app);
    const host = app.url ? hostOf(app.url) : '';
    dom.shCap.textContent = `FIG. ${pad2(Math.max(index, 0) + 1)} — ${host || '미배포'}${app.catalog && app.url && !shotMissing.has(app.slug) ? ' · 1280×800' : ''}`;

    if (app.url) {
      dom.shOpen.href = app.url;
      dom.shOpen.removeAttribute('aria-disabled');
      dom.shOpen.removeAttribute('tabindex');
    } else {
      dom.shOpen.removeAttribute('href');
      dom.shOpen.setAttribute('aria-disabled', 'true');
      dom.shOpen.setAttribute('tabindex', '-1');
    }

    const pinnable = Boolean(app.catalog);
    const pinned = pinnable && isFavorite(app.slug);
    dom.shPin.hidden = !pinnable;
    dom.shPin.setAttribute('aria-pressed', String(pinned));
    dom.shPinLabel.textContent = pinned ? '고정 해제' : '고정';

    const prev = index > 0 ? list[index - 1] : null;
    const next = index >= 0 ? list[index + 1] || null : null;
    [[dom.shPrev, prev], [dom.tPrev, prev], [dom.shNext, next], [dom.tNext, next]].forEach(([button, target]) => {
      button.disabled = !target;
      const value = button.querySelector('.v');
      if (value) value.textContent = target ? target.name : '—';
    });
  }

  function openSheet(key, opener) {
    const app = findApp(key);
    if (!app) return;
    sheetOpener = opener || null;
    fillSheet(app);
    if (!dom.sheet.open) {
      dom.sheet.showModal();
      lockScroll(true);
    }
    dom.sheetBox.focus({ preventScroll: true });
  }

  function closeSheet() {
    if (dom.sheet.open) dom.sheet.close();
  }

  function stepSheet(delta) {
    if (!currentApp) return;
    const list = model.order;
    const index = list.findIndex((entry) => entry.key === currentApp.key);
    const target = list[index + delta];
    if (target) fillSheet(target);
  }

  async function handleSheetCopy() {
    if (!currentApp?.url) {
      showToast('복사할 주소가 없어요 (미배포)', 'info');
      return;
    }
    try {
      await copyText(currentApp.url);
      showToast(`주소를 복사했어요 · ${hostOf(currentApp.url)}`, 'success');
    } catch {
      showToast(currentApp.url, 'info');
    }
  }

  function handleSheetPin() {
    if (!currentApp?.catalog) return;
    const pinned = toggleFavorite(currentApp.slug);
    render();
    showToast(pinned ? `${currentApp.name} — 고정 행에 올렸어요 📌` : `${currentApp.name} — 고정 해제`, 'success');
  }

  // ── 설정 모달 ──
  function clearVaultPinInputs() {
    dom.inputVaultPinLoad.value = '';
    dom.inputVaultPinSave.value = '';
    dom.inputVaultPinConfirm.value = '';
  }

  function updateVaultUI() {
    const linked = isVaultLinked();
    dom.vaultStatus.hidden = !linked;
    dom.vaultForm.hidden = linked;
  }

  function switchVaultTab(tab) {
    const isLoad = tab === 'load';
    dom.vaultTabLoad.classList.toggle('is-active', isLoad);
    dom.vaultTabSave.classList.toggle('is-active', !isLoad);
    dom.vaultTabLoad.setAttribute('aria-selected', String(isLoad));
    dom.vaultTabSave.setAttribute('aria-selected', String(!isLoad));
    dom.vaultPanelLoad.hidden = !isLoad;
    dom.vaultPanelSave.hidden = isLoad;
    clearVaultPinInputs();
  }

  function openSettings() {
    const { accountId, apiToken, ghToken, vercelToken } = getConfig();
    dom.inputAccountId.value = accountId;
    dom.inputApiToken.value = apiToken;
    dom.inputGhToken.value = ghToken;
    dom.inputVercelToken.value = vercelToken;
    dom.btnClearLocal.hidden = !hasConfig();
    updateVaultUI();
    if (!dom.settings.open) {
      dom.settings.showModal();
      lockScroll(true);
    }
    setTimeout(() => dom.inputAccountId.focus({ preventScroll: true }), 60);
  }

  function closeSettings() {
    if (dom.settings.open) dom.settings.close();
  }

  function saveSettings() {
    const accountId = dom.inputAccountId.value.trim();
    const apiToken = dom.inputApiToken.value.trim();
    const ghToken = dom.inputGhToken.value.trim();
    const vercelToken = dom.inputVercelToken.value.trim();

    if (!accountId || !apiToken) {
      showToast('Account ID와 API Token을 모두 입력해주세요.', 'error');
      dom.inputAccountId.focus();
      return;
    }

    saveConfig(accountId, apiToken, ghToken, vercelToken);
    storageRemove(STORAGE_KEYS.cache);
    liveLoaded = false;
    closeSettings();
    showToast('설정을 저장했어요. 관제 레이어를 켭니다.', 'success');
    setOps(true);
    loadProjects(true);
  }

  function clearLocalSettings() {
    if (!confirm('이 기기에 저장된 토큰을 지우고 관제 레이어를 끌까요? (클라우드 보관소는 그대로 남습니다)')) return;
    if (activeFetchController) activeFetchController.abort();
    clearConfig();
    liveProjects = [];
    liveLoaded = false;
    liveError = '';
    lastVaultSyncBody = '';
    closeSettings();
    setOps(false);
    showToast('이 기기의 토큰을 지웠어요. 정문만 표시합니다.', 'info');
  }

  // ── Vault API (기존 흐름 그대로, lobby 봉투만 제거) ──
  async function handleVaultLoad() {
    const pin = dom.inputVaultPinLoad.value.trim();
    if (!/^\d{6}$/.test(pin)) {
      showToast('PIN은 6자리 숫자여야 합니다.', 'error');
      dom.inputVaultPinLoad.focus();
      return;
    }
    dom.btnVaultLoad.disabled = true;
    try {
      const response = await fetch(`/api/vault?pin=${encodeURIComponent(pin)}`);
      const data = await response.json();
      if (!response.ok || !data.success) {
        showToast(data?.errors?.[0]?.message || '불러오기에 실패했습니다.', 'error');
        return;
      }
      const { credentials } = data;
      dom.inputAccountId.value = credentials.accountId || '';
      dom.inputApiToken.value = credentials.apiToken || '';
      dom.inputGhToken.value = credentials.ghToken || '';
      dom.inputVercelToken.value = credentials.vercelToken || '';

      saveConfig(credentials.accountId, credentials.apiToken, credentials.ghToken, credentials.vercelToken);
      setVaultLinked(true);
      setVaultPin(pin);
      applyServerFavorites(credentials.favorites);
      updateVaultUI();
      clearVaultPinInputs();
      dom.btnClearLocal.hidden = false;

      showToast('클라우드에서 토큰과 고정 앱을 불러왔어요.', 'success');
      storageRemove(STORAGE_KEYS.cache);
      liveLoaded = false;
      closeSettings();
      setOps(true);
      loadProjects(true);
    } catch (error) {
      showToast(error.message || '네트워크 오류가 발생했습니다.', 'error');
    } finally {
      dom.btnVaultLoad.disabled = false;
    }
  }

  function readVaultFormCredentials() {
    return {
      accountId: dom.inputAccountId.value.trim(),
      apiToken: dom.inputApiToken.value.trim(),
      ghToken: dom.inputGhToken.value.trim(),
      vercelToken: dom.inputVercelToken.value.trim(),
    };
  }

  async function postVault(pin, credentials) {
    const response = await fetch('/api/vault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin, ...credentials, favorites: [...favoriteSlugs] }),
    });
    const data = await response.json();
    return { ok: response.ok && data.success, data };
  }

  async function handleVaultSave() {
    const credentials = readVaultFormCredentials();
    const pin = dom.inputVaultPinSave.value.trim();
    const pinConfirm = dom.inputVaultPinConfirm.value.trim();

    if (!credentials.accountId || !credentials.apiToken) {
      showToast('Account ID와 API Token을 먼저 입력해주세요.', 'error');
      dom.inputAccountId.focus();
      return;
    }
    if (!/^\d{6}$/.test(pin)) {
      showToast('PIN은 6자리 숫자여야 합니다.', 'error');
      dom.inputVaultPinSave.focus();
      return;
    }
    if (pin !== pinConfirm) {
      showToast('PIN이 일치하지 않습니다.', 'error');
      dom.inputVaultPinConfirm.focus();
      return;
    }

    dom.btnVaultSave.disabled = true;
    try {
      const { ok, data } = await postVault(pin, credentials);
      if (!ok) {
        showToast(data?.errors?.[0]?.message || '저장에 실패했습니다.', 'error');
        return;
      }
      setVaultLinked(true);
      setVaultPin(pin);
      updateVaultUI();
      clearVaultPinInputs();
      showToast('클라우드 보관소에 저장했어요. PIN을 기억해주세요!', 'success');
    } catch (error) {
      showToast(error.message || '네트워크 오류가 발생했습니다.', 'error');
    } finally {
      dom.btnVaultSave.disabled = false;
    }
  }

  async function handleVaultUpdate() {
    const pin = prompt('덮어쓸 보관소의 PIN을 입력하세요 (6자리 숫자):');
    if (pin === null) return;
    const trimmedPin = pin.trim();
    if (!/^\d{6}$/.test(trimmedPin)) {
      showToast('PIN은 6자리 숫자여야 합니다.', 'error');
      return;
    }
    const credentials = readVaultFormCredentials();
    if (!credentials.accountId || !credentials.apiToken) {
      showToast('Account ID와 API Token을 먼저 입력해주세요.', 'error');
      return;
    }
    dom.btnVaultUpdate.disabled = true;
    try {
      const { ok, data } = await postVault(trimmedPin, credentials);
      if (!ok) {
        showToast(data?.errors?.[0]?.message || '업데이트에 실패했습니다.', 'error');
        return;
      }
      setVaultLinked(true);
      setVaultPin(trimmedPin);
      updateVaultUI();
      showToast('보관소를 업데이트했어요.', 'success');
    } catch (error) {
      showToast(error.message || '네트워크 오류가 발생했습니다.', 'error');
    } finally {
      dom.btnVaultUpdate.disabled = false;
    }
  }

  async function handleVaultDelete() {
    const pin = prompt('삭제할 보관소의 PIN을 입력하세요 (6자리 숫자):');
    if (pin === null) return;
    const trimmedPin = pin.trim();
    if (!/^\d{6}$/.test(trimmedPin)) {
      showToast('PIN은 6자리 숫자여야 합니다.', 'error');
      return;
    }
    if (!confirm('정말로 클라우드 보관소를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;

    dom.btnVaultDelete.disabled = true;
    try {
      const response = await fetch(`/api/vault?pin=${encodeURIComponent(trimmedPin)}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok || !data.success) {
        showToast(data?.errors?.[0]?.message || '삭제에 실패했습니다.', 'error');
        return;
      }
      setVaultLinked(false);
      updateVaultUI();
      showToast('클라우드 보관소를 삭제했어요.', 'success');
    } catch (error) {
      showToast(error.message || '네트워크 오류가 발생했습니다.', 'error');
    } finally {
      dom.btnVaultDelete.disabled = false;
    }
  }

  // ── 카탈로그 로드 ──
  async function loadCatalog() {
    try {
      const response = await fetch(CATALOG_URL, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || !Array.isArray(data.sections) || !Array.isArray(data.apps)) {
        throw new Error('sections[] / apps[] 없음');
      }
      catalog = data;
      if (favoriteSlugs.size === 0) favoriteSlugs = new Set(DEFAULT_PINNED);
      render();
      return true;
    } catch (error) {
      dom.front.innerHTML = `<div class="fatal"><b>catalog.json</b>을 읽지 못했어요 — ${esc(error.message || error)}<br><button class="btn btn--sm" type="button" id="btn-catalog-retry">다시 시도</button></div>`;
      dom.front.setAttribute('aria-busy', 'false');
      dom.pinrow.innerHTML = '';
      dom.pinned.classList.add('in');
      $('#btn-catalog-retry')?.addEventListener('click', () => {
        dom.front.innerHTML = '<p class="loading mono">catalog.json 불러오는 중…</p>';
        loadCatalog();
      });
      showToast('카탈로그 로딩 실패', 'error');
      return false;
    }
  }

  // ── Events ──
  function handleDocumentClick(event) {
    const tile = event.target.closest('.tile[data-key], .pin[data-key]');
    if (tile) {
      openSheet(tile.dataset.key, tile);
      return;
    }
    const opsHeader = event.target.closest('.oh[data-ops-section]');
    if (opsHeader) {
      const key = opsHeader.dataset.opsSection;
      const open = opsHeader.getAttribute('aria-expanded') !== 'true';
      opsHeader.setAttribute('aria-expanded', String(open));
      const panel = document.getElementById(opsHeader.getAttribute('aria-controls'));
      if (panel) panel.hidden = !open;
      if (open) expandedOps.add(key); else expandedOps.delete(key);
    }
  }

  function handleImageError(event) {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset.kind === 'icon') {
      swapIconToFallback(img);
    } else if (img.dataset.kind === 'shot') {
      shotMissing.add(img.dataset.slug);
      if (currentApp && currentApp.slug === img.dataset.slug) {
        dom.shFrame.innerHTML = shotPlaceholder(currentApp);
        dom.shCap.textContent = dom.shCap.textContent.replace(' · 1280×800', '');
      }
    }
  }

  function handleSettingsKeydown(event) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      saveSettings();
    }
  }

  function bindEvents() {
    // 이미지 404 → 폴백 (error는 버블링 안 함 — 캡처 단계 위임)
    document.addEventListener('error', handleImageError, true);
    document.addEventListener('click', handleDocumentClick);

    dom.opsToggle.addEventListener('click', handleOpsToggle);
    dom.btnSettings.addEventListener('click', openSettings);

    // 시트
    dom.sheet.addEventListener('click', (event) => { if (event.target === dom.sheet) closeSheet(); });
    dom.sheet.addEventListener('close', () => {
      lockScroll(false);
      let target = sheetOpener && sheetOpener.isConnected ? sheetOpener : null;
      if (!target && currentApp && window.CSS?.escape) {
        // 고정 토글 등으로 재렌더된 뒤엔 같은 key의 타일을 다시 찾는다 (핀 행보다 정문 타일 우선)
        target = document.querySelector(`.tile[data-key="${CSS.escape(currentApp.key)}"]`)
          || document.querySelector(`.pin[data-key="${CSS.escape(currentApp.key)}"]`);
      }
      if (target) target.focus({ preventScroll: true });
      sheetOpener = null;
    });
    dom.sheet.addEventListener('keydown', (event) => {
      if (event.target instanceof HTMLInputElement) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); stepSheet(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); stepSheet(1); }
    });
    dom.shClose.addEventListener('click', closeSheet);
    dom.shPrev.addEventListener('click', () => stepSheet(-1));
    dom.tPrev.addEventListener('click', () => stepSheet(-1));
    dom.shNext.addEventListener('click', () => stepSheet(1));
    dom.tNext.addEventListener('click', () => stepSheet(1));
    dom.shCopy.addEventListener('click', handleSheetCopy);
    dom.shPin.addEventListener('click', handleSheetPin);
    dom.spread.addEventListener('touchstart', (event) => {
      touchStartX = event.touches[0].clientX;
      touchStartY = event.touches[0].clientY;
    }, { passive: true });
    dom.spread.addEventListener('touchend', (event) => {
      const dx = event.changedTouches[0].clientX - touchStartX;
      const dy = event.changedTouches[0].clientY - touchStartY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) stepSheet(dx < 0 ? 1 : -1);
    }, { passive: true });

    // 설정 모달
    dom.settings.addEventListener('click', (event) => { if (event.target === dom.settings) closeSettings(); });
    dom.settings.addEventListener('close', () => {
      lockScroll(false);
      clearVaultPinInputs();
      dom.btnSettings.focus({ preventScroll: true });
    });
    dom.settings.addEventListener('keydown', handleSettingsKeydown);
    dom.btnCancel.addEventListener('click', closeSettings);
    dom.btnModalClose.addEventListener('click', closeSettings);
    dom.btnSave.addEventListener('click', saveSettings);
    dom.btnClearLocal.addEventListener('click', clearLocalSettings);

    // 볼트
    dom.vaultTabLoad.addEventListener('click', () => switchVaultTab('load'));
    dom.vaultTabSave.addEventListener('click', () => switchVaultTab('save'));
    dom.btnVaultLoad.addEventListener('click', handleVaultLoad);
    dom.btnVaultSave.addEventListener('click', handleVaultSave);
    dom.btnVaultUpdate.addEventListener('click', handleVaultUpdate);
    dom.btnVaultDelete.addEventListener('click', handleVaultDelete);

    window.addEventListener('beforeunload', () => activeFetchController?.abort());
  }

  // ── Init ──
  async function init() {
    document.documentElement.classList.add('js');
    LEGACY_STORAGE_KEYS.forEach(storageRemove);
    favoriteSlugs = loadFavorites();
    bindEvents();
    updateOpsSwitch();

    const ok = await loadCatalog();
    if (ok && hasConfig() && storageGet(STORAGE_KEYS.opsEnabled) !== '0') {
      setOps(true, { persist: false });
    }

    // 헤드리스 검증용 훅
    window.__setOps = (on) => setOps(on);
    window.__openSheet = (key) => openSheet(key, null);
    window.__openSettings = openSettings;
    window.__jacehub = { get model() { return model; }, get catalog() { return catalog; }, get live() { return liveProjects; } };
    window.__READY = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
