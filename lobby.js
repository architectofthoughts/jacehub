/* ═══════════════════════════════════════════════
   JaceHub Lobby — iOS App Store style launcher
   Token-less: reads snapshot saved by management page
   ═══════════════════════════════════════════════ */

(() => {
  'use strict';

  const STORAGE_KEYS = {
    lobbyCache: 'jacehub_lobby_cache',
    lobbyMeta:  'jacehub_lobby_meta',
    favorites:  'jacehub_favorites',
    cache:      'jacehub_cache',
  };

  const DAY_MS = 24 * 60 * 60 * 1000;
  const NEW_DAYS = 14;
  const UPDATED_DAYS = 7;

  // Bundled SVG tile icons (see icons/lobby/README.md). Loaded from the
  // manifest at init; apps without an entry fall back to emoji/initial tiles.
  const ICON_BASE = 'icons/lobby/';
  let iconManifest = {};

  // Manifest keys and app names are both normalized (trim + lowercase) so
  // cosmetic mismatches (stray whitespace, case drift) never break icons.
  function normalizeName(name) {
    return String(name || '').trim().toLowerCase();
  }

  async function loadIconManifest() {
    try {
      const res = await fetch(`${ICON_BASE}manifest.json`, { cache: 'no-cache' });
      if (!res.ok) return;
      const parsed = await res.json();
      if (parsed && typeof parsed === 'object') {
        iconManifest = {};
        for (const [key, file] of Object.entries(parsed)) {
          iconManifest[normalizeName(key)] = file;
        }
      }
    } catch {
      /* offline/file:// — emoji/initial fallback keeps working */
    }
  }

  // App names that only exist in pre-2026-07-04 snapshots (renamed/absorbed:
  // ideabox→crossbell, transparenty→jacemaster, utajlpt→learneverything).
  // Their presence means the snapshot is stale — we show a gentle notice
  // instead of hiding them.
  const LEGACY_APP_NAMES = new Set(['ideabox', 'transparenty', 'utajlpt']);

  const CATEGORY_LABELS = {
    game:        '게임',
    tool:        '도구',
    experiment:  '실험',
    util:        '유틸',
    productivity:'생산성',
    learning:    '학습',
    other:       '기타',
  };

  // Deterministic gradient palette per icon (seeded by app name).
  const GRADIENT_PALETTES = [
    { from: '#FF6B6B', to: '#FF4B4B' },
    { from: '#0EA5E9', to: '#0284C7' },
    { from: '#17C964', to: '#0E9F4D' },
    { from: '#F5A623', to: '#F37C20' },
    { from: '#A78BFA', to: '#7C3AED' },
    { from: '#F472B6', to: '#DB2777' },
    { from: '#22D3EE', to: '#0891B2' },
    { from: '#FBBF24', to: '#D97706' },
    { from: '#34D399', to: '#059669' },
    { from: '#818CF8', to: '#4F46E5' },
    { from: '#F87171', to: '#DC2626' },
    { from: '#FB923C', to: '#EA580C' },
  ];

  // ── DOM ──
  const $ = (id) => document.getElementById(id);
  const els = {
    hero:          $('lobby-hero'),
    heroSubtitle:  $('lobby-hero-subtitle'),
    categories:    $('lobby-categories'),
    chips:         $('lobby-chips'),
    gridWrap:      $('lobby-grid-wrap'),
    grid:          $('lobby-grid'),
    empty:         $('lobby-empty'),
    nomatch:       $('lobby-nomatch'),
    footerCount:   $('lobby-footer-count'),
    footerUpdated: $('lobby-footer-updated'),
  };

  // ── State ──
  let allApps = [];
  let activeCategory = 'all';

  // ── Storage readers ──
  function loadLobbyCache() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.lobbyCache);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !Array.isArray(parsed.apps)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function loadLobbyMeta() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.lobbyMeta);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  function loadFavorites() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.favorites) || '[]');
      if (!Array.isArray(raw)) return new Set();
      return new Set(raw.map((n) => String(n || '').trim()).filter(Boolean));
    } catch {
      return new Set();
    }
  }

  // Legacy fallback: derive from `jacehub_cache` (full project cache) + favorites
  // for users who already have favorites set up but haven't refreshed since the
  // lobby feature shipped.
  function loadLegacyDerivedCache() {
    try {
      const favorites = loadFavorites();
      if (favorites.size === 0) return null;
      const raw = localStorage.getItem(STORAGE_KEYS.cache);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const projects = Array.isArray(parsed) ? parsed : parsed?.projects;
      if (!Array.isArray(projects)) return null;
      const apps = projects
        .filter((p) => favorites.has(String(p.name || '').trim()))
        .map(snapshotFromProject);
      if (apps.length === 0) return null;
      return {
        savedAt: parsed?.timestamp || 0,
        apps,
      };
    } catch {
      return null;
    }
  }

  function snapshotFromProject(project) {
    return {
      name: project.name,
      type: project._type || 'pages',
      description: project._description || '',
      subdomain: project.subdomain || '',
      domains: project.domains || [],
      framework: project.framework || '',
      created_on: project.created_on || '',
      latest_deployment_on: project.latest_deployment?.created_on || '',
    };
  }

  // ── Derivations ──
  function getPrimaryUrl(app) {
    const domains = app.domains || [];
    if (domains.length > 0) return `https://${domains[0]}`;
    if (app.subdomain) return `https://${app.subdomain}`;
    return '';
  }

  function hashString(str) {
    let hash = 0;
    const value = String(str || '');
    for (let i = 0; i < value.length; i++) {
      hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  function paletteFor(name, override) {
    if (override && typeof override === 'string' && override.startsWith('#')) {
      return { from: override, to: override };
    }
    const index = hashString(name) % GRADIENT_PALETTES.length;
    return GRADIENT_PALETTES[index];
  }

  function getInitial(name) {
    const s = String(name || '').trim();
    if (!s) return '?';
    // Strip type prefix like "(Worker) " just in case
    const stripped = s.replace(/^[\(\[][^\)\]]*[\)\]]\s*/, '');
    // Take first non-whitespace char
    const ch = [...stripped][0] || '?';
    return ch.toUpperCase();
  }

  function isEmoji(value) {
    if (!value) return false;
    const trimmed = String(value).trim();
    if (!trimmed) return false;
    // Heuristic: emoji are typically not ASCII letters/digits
    return /\p{Extended_Pictographic}/u.test(trimmed);
  }

  function daysSince(isoDate) {
    if (!isoDate) return Infinity;
    const ts = Date.parse(isoDate);
    if (!Number.isFinite(ts)) return Infinity;
    return (Date.now() - ts) / DAY_MS;
  }

  function inferCategory(app, metaCategory) {
    if (metaCategory && CATEGORY_LABELS[metaCategory]) return metaCategory;
    // Soft heuristic from name (purely for display; can be overridden in meta)
    const name = String(app.name || '').toLowerCase();
    if (/timer|day|deadline|task|todo|note/.test(name)) return 'productivity';
    if (/game|crawler|stress|nimble/.test(name)) return 'game';
    if (/learn|study|lecture|lang/.test(name)) return 'learning';
    if (/blur|akashic|transparent|null|hoochoob/.test(name)) return 'experiment';
    return 'other';
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ── Build display app list ──
  function buildApps() {
    const cache = loadLobbyCache() || loadLegacyDerivedCache();
    if (!cache || !Array.isArray(cache.apps) || cache.apps.length === 0) {
      allApps = [];
      return cache?.savedAt || 0;
    }
    const meta = loadLobbyMeta();

    allApps = cache.apps.map((app) => {
      const m = meta[app.name] || {};
      const iconFile = iconManifest[normalizeName(app.name)];
      const primaryUrl = getPrimaryUrl(app);
      const description = (m.description || app.description || '').trim();
      const category = inferCategory(app, m.category);
      const palette = paletteFor(app.name, m.color);
      const days = daysSince(app.latest_deployment_on || app.created_on);
      const createdDays = daysSince(app.created_on);
      const isNew = createdDays <= NEW_DAYS;
      const isUpdated = !isNew && days <= UPDATED_DAYS;

      return {
        ...app,
        primaryUrl,
        description,
        category,
        categoryLabel: CATEGORY_LABELS[category] || category,
        palette,
        svgIcon: iconFile ? ICON_BASE + iconFile : '',
        icon: m.icon || '',
        iconIsEmoji: m.icon ? isEmoji(m.icon) : false,
        initial: getInitial(app.name),
        isNew,
        isUpdated,
      };
    });

    return cache.savedAt || 0;
  }

  // ── Stale snapshot notice ──
  function renderStaleBanner() {
    const existing = document.getElementById('lobby-stale-banner');
    const isStale = allApps.some((app) => LEGACY_APP_NAMES.has(normalizeName(app.name)));

    if (!isStale || allApps.length === 0) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;

    const banner = document.createElement('section');
    banner.id = 'lobby-stale-banner';
    banner.className = 'lobby-stale';
    banner.setAttribute('role', 'note');
    banner.innerHTML = `
      <svg class="lobby-stale__icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-2.64-6.36"/>
        <polyline points="21 3 21 9 15 9"/>
      </svg>
      <p class="lobby-stale__msg">즐겨찾기 목록이 예전 상태예요. 메인 페이지를 한 번 열면 최신으로 갱신돼요.</p>
      <a class="lobby-stale__btn" href="index.html">메인 페이지 열기</a>
    `;
    els.hero.insertAdjacentElement('afterend', banner);
  }

  // ── Render ──
  function render() {
    if (allApps.length === 0) {
      els.empty.style.display = 'flex';
      els.hero.style.display = 'none';
      els.categories.style.display = 'none';
      els.gridWrap.style.display = 'none';
      els.nomatch.style.display = 'none';
      els.footerCount.textContent = '0개의 앱';
      renderStaleBanner();
      return;
    }

    els.empty.style.display = 'none';
    els.hero.style.display = 'block';
    els.heroSubtitle.textContent = `즐겨찾기한 ${allApps.length}개의 앱이에요. 아이콘을 눌러 들어가보세요.`;

    renderStaleBanner();
    renderCategories();
    renderGrid();
    els.footerCount.textContent = `${allApps.length}개의 앱 (현재 ${visibleApps().length}개 표시)`;
  }

  function renderCategories() {
    const counts = new Map();
    counts.set('all', allApps.length);
    for (const app of allApps) {
      counts.set(app.category, (counts.get(app.category) || 0) + 1);
    }
    // Show only categories with members
    const known = Object.keys(CATEGORY_LABELS).filter((k) => counts.get(k));
    const visibleChips = ['all', ...known];

    if (visibleChips.length <= 2) {
      els.categories.style.display = 'none';
      return;
    }

    els.categories.style.display = 'block';
    els.chips.innerHTML = visibleChips.map((key) => {
      const label = key === 'all' ? '전체' : (CATEGORY_LABELS[key] || key);
      const count = counts.get(key) || 0;
      const isActive = activeCategory === key;
      return `
        <button class="lobby-chip${isActive ? ' is-active' : ''}" type="button" data-category="${escapeHtml(key)}">
          <span>${escapeHtml(label)}</span>
          <span class="lobby-chip__count">${count}</span>
        </button>
      `;
    }).join('');
  }

  function visibleApps() {
    if (activeCategory === 'all') return allApps;
    return allApps.filter((app) => app.category === activeCategory);
  }

  function renderGrid() {
    const list = visibleApps();
    if (list.length === 0) {
      els.gridWrap.style.display = 'none';
      els.nomatch.style.display = 'block';
      return;
    }
    els.nomatch.style.display = 'none';
    els.gridWrap.style.display = 'block';

    els.grid.innerHTML = list.map((app) => {
      const url = app.primaryUrl;
      const tag = url ? 'a' : 'button';
      const linkAttrs = url
        ? `href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer"`
        : `type="button" disabled aria-disabled="true" title="연결된 주소 없음"`;

      const badges = [];
      if (app.isNew) badges.push('<span class="app-badge app-badge--new">NEW</span>');
      else if (app.isUpdated) badges.push('<span class="app-badge app-badge--updated">UPD</span>');

      const iconStyle = app.svgIcon
        ? ''
        : `background: linear-gradient(135deg, ${app.palette.from}, ${app.palette.to});`;
      const iconContent = app.svgIcon
        ? `<img src="${escapeHtml(app.svgIcon)}" alt="" loading="lazy">`
        : app.icon && app.iconIsEmoji
          ? `<span class="app-tile__icon-emoji" aria-hidden="true">${escapeHtml(app.icon)}</span>`
          : escapeHtml(app.initial);

      return `
        <${tag} class="app-tile" ${linkAttrs} aria-label="${escapeHtml(app.name)} 열기">
          ${badges.length ? `<div class="app-tile__badges">${badges.join('')}</div>` : ''}
          <div class="app-tile__icon${app.svgIcon ? ' app-tile__icon--svg' : ''}"${iconStyle ? ` style="${iconStyle}"` : ''}>
            ${iconContent}
          </div>
          <div class="app-tile__name" title="${escapeHtml(app.name)}">${escapeHtml(app.name)}</div>
          ${app.description ? `<div class="app-tile__desc" title="${escapeHtml(app.description)}">${escapeHtml(app.description)}</div>` : ''}
          <div class="app-tile__category">${escapeHtml(app.categoryLabel)}</div>
        </${tag}>
      `;
    }).join('');
  }

  // ── Events ──
  function bindEvents() {
    els.chips.addEventListener('click', (event) => {
      const chip = event.target.closest('[data-category]');
      if (!chip) return;
      const next = chip.getAttribute('data-category') || 'all';
      activeCategory = next;
      renderCategories();
      renderGrid();
      els.footerCount.textContent = `${allApps.length}개의 앱 (현재 ${visibleApps().length}개 표시)`;
    });

    // Refresh when the management page updates the snapshot in another tab.
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEYS.lobbyCache || event.key === STORAGE_KEYS.lobbyMeta) {
        const savedAt = buildApps();
        render();
        setFooterUpdated(savedAt);
      }
    });
  }

  function setFooterUpdated(savedAt) {
    if (!savedAt) {
      els.footerUpdated.textContent = '관리 페이지에서 즐겨찾기를 갱신해보세요.';
      return;
    }
    const date = new Date(savedAt);
    if (!Number.isFinite(date.getTime())) {
      els.footerUpdated.textContent = '관리 페이지에서 즐겨찾기를 갱신해보세요.';
      return;
    }
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    els.footerUpdated.textContent = `마지막 동기화 ${yyyy}-${mm}-${dd} ${hh}:${min}`;
  }

  // ── Init ──
  async function init() {
    await loadIconManifest();
    const savedAt = buildApps();
    bindEvents();
    render();
    setFooterUpdated(savedAt);
    window.__READY = true; // headless screenshot hook
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
