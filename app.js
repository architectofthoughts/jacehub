/* ═══════════════════════════════════════════════
   JaceHub — Application Logic
   Cloudflare Pages Dashboard Client
   ═══════════════════════════════════════════════ */

(() => {
  'use strict';

  // ── Constants ──
  const CACHE_TTL_MS = 10 * 60 * 1000;
  const TOAST_DURATION_MS = 3000;
  const STORAGE_KEYS = {
    accountId: 'jacehub_account_id',
    apiToken:  'jacehub_api_token',
    ghToken:   'jacehub_gh_token',
    cache:     'jacehub_cache',
    favorites: 'jacehub_favorites',
  };

  // ── DOM References ──
  const $ = (sel) => document.querySelector(sel);
  const dom = {
    // States
    main:             $('#main'),
    stateEmpty:       $('#state-empty'),
    stateEmptyTitle:  $('#state-empty-title'),
    stateEmptyMessage: $('#state-empty-message'),
    stateLoading:     $('#state-loading'),
    stateError:       $('#state-error'),
    errorMessage:     $('#error-message'),
    resultsEmpty:     $('#results-empty'),
    // Grid & Stats
    projectGrid:      $('#project-grid'),
    stats:            $('#stats'),
    statTotal:        $('#stat-total'),
    statActive:       $('#stat-active'),
    statDomains:      $('#stat-domains'),
    toolbar:          $('#toolbar'),
    inputSearch:      $('#input-search'),
    filterStatus:     $('#filter-status'),
    sortProjects:     $('#sort-projects'),
    toolbarSummary:   $('#toolbar-summary'),
    // Modal
    modalOverlay:     $('#modal-overlay'),
    modal:            $('#modal'),
    inputAccountId:   $('#input-account-id'),
    inputApiToken:    $('#input-api-token'),
    inputGhToken:     $('#input-gh-token'),
    // Buttons
    btnSettings:      $('#btn-settings'),
    btnSetup:         $('#btn-setup'),
    btnRefresh:       $('#btn-refresh'),
    btnRetry:         $('#btn-retry'),
    btnSave:          $('#btn-save'),
    btnCancel:        $('#btn-cancel'),
    btnModalClose:    $('#btn-modal-close'),
    // Toast
    toastContainer:   $('#toast-container'),
  };

  // ── State ──
  let activeFetchController = null;
  let latestLoadRequestId = 0;
  let lastFocusedElement = null;
  let currentProjects = [];
  let favoriteProjects = loadFavorites();

  // ── Storage ──
  function getConfig() {
    return {
      accountId: localStorage.getItem(STORAGE_KEYS.accountId) || '',
      apiToken:  localStorage.getItem(STORAGE_KEYS.apiToken) || '',
      ghToken:   localStorage.getItem(STORAGE_KEYS.ghToken) || '',
    };
  }

  function saveConfig(accountId, apiToken, ghToken) {
    localStorage.setItem(STORAGE_KEYS.accountId, accountId.trim());
    localStorage.setItem(STORAGE_KEYS.apiToken, apiToken.trim());
    localStorage.setItem(STORAGE_KEYS.ghToken, (ghToken || '').trim());
  }

  function hasConfig() {
    const { accountId, apiToken } = getConfig();
    return accountId.length > 0 && apiToken.length > 0;
  }

  function saveCache(projectList) {
    const { accountId } = getConfig();
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify({
      accountId,
      timestamp: Date.now(),
      projects: projectList,
    }));
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.cache);
      if (!raw) return null;

      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return { accountId: '', timestamp: 0, projects: parsed };
      }

      if (!parsed || !Array.isArray(parsed.projects)) {
        return null;
      }

      const { accountId } = getConfig();
      if (parsed.accountId && accountId && parsed.accountId !== accountId) {
        return null;
      }

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

  function loadFavorites() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEYS.favorites) || '[]');
      if (!Array.isArray(raw)) return new Set();
      return new Set(raw.map((name) => String(name || '').trim()).filter(Boolean));
    } catch {
      return new Set();
    }
  }

  function saveFavorites() {
    localStorage.setItem(STORAGE_KEYS.favorites, JSON.stringify([...favoriteProjects]));
  }

  function isFavoriteProject(projectName) {
    return favoriteProjects.has(String(projectName || '').trim());
  }

  function toggleFavoriteProject(projectName) {
    const normalizedName = String(projectName || '').trim();
    if (!normalizedName) return false;

    if (favoriteProjects.has(normalizedName)) {
      favoriteProjects.delete(normalizedName);
      saveFavorites();
      return false;
    }

    favoriteProjects.add(normalizedName);
    saveFavorites();
    return true;
  }

  // ── UI State Management ──
  function showState(state) {
    dom.stateEmpty.style.display = state === 'empty' ? 'flex' : 'none';
    dom.stateLoading.style.display = state === 'loading' ? 'flex' : 'none';
    dom.stateError.style.display = state === 'error' ? 'flex' : 'none';
    dom.projectGrid.style.display = state === 'grid' ? 'grid' : 'none';
    dom.stats.style.display = state === 'grid' ? 'flex' : 'none';
    dom.toolbar.style.display = state === 'grid' ? 'grid' : 'none';
    dom.resultsEmpty.style.display = 'none';
    dom.main.setAttribute('data-view-state', state);
  }

  function showEmptyState(kind = 'config') {
    currentProjects = [];
    dom.toolbarSummary.textContent = '0개 표시';

    if (kind === 'no-projects') {
      dom.stateEmptyTitle.textContent = '등록된 프로젝트가 없습니다';
      dom.stateEmptyMessage.innerHTML = '이 계정에 Pages 프로젝트가 아직 없습니다.<br>새 프로젝트를 배포한 뒤 다시 새로고침하세요.';
      dom.btnSetup.hidden = true;
    } else {
      dom.stateEmptyTitle.textContent = 'Cloudflare 계정을 연결하세요';
      dom.stateEmptyMessage.innerHTML = '설정에서 Account ID와 API Token을 입력하면<br>배포한 모든 사이트를 한눈에 볼 수 있습니다.';
      dom.btnSetup.hidden = false;
    }

    showState('empty');
  }

  function setLoading(isLoading) {
    [dom.btnRefresh, dom.btnRetry, dom.btnSave].forEach((button) => {
      button.disabled = isLoading;
      button.setAttribute('aria-disabled', String(isLoading));
    });
    dom.btnRefresh.classList.toggle('is-loading', isLoading);
    dom.main.setAttribute('aria-busy', String(isLoading));
  }

  function updateToolbarSummary(totalCount, visibleCount) {
    dom.toolbarSummary.textContent = totalCount === visibleCount
      ? `${visibleCount}개 표시`
      : `${totalCount}개 중 ${visibleCount}개 표시`;
  }

  // ── Modal ──
  function isModalOpen() {
    return dom.modalOverlay.classList.contains('is-open');
  }

  function getFocusableModalElements() {
    return [...dom.modal.querySelectorAll('button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.disabled);
  }

  function openModal() {
    const { accountId, apiToken, ghToken } = getConfig();
    lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dom.inputAccountId.value = accountId;
    dom.inputApiToken.value = apiToken;
    dom.inputGhToken.value = ghToken;
    dom.modalOverlay.classList.add('is-open');
    dom.modalOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => dom.inputAccountId.focus(), 200);
  }

  function closeModal() {
    dom.modalOverlay.classList.remove('is-open');
    dom.modalOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.removeProperty('overflow');
    if (lastFocusedElement) {
      lastFocusedElement.focus();
      lastFocusedElement = null;
    }
  }

  // ── Toast ──
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      if (!toast.isConnected) return;
      toast.classList.add('is-leaving');
      toast.addEventListener('animationend', () => toast.remove(), { once: true });
    }, TOAST_DURATION_MS);
  }

  // ── API ──
  async function fetchProjects(signal) {
    const { accountId, apiToken, ghToken } = getConfig();
    const headers = {
      'X-CF-Account-Id': accountId,
      'X-CF-Api-Token': apiToken,
    };

    if (ghToken) {
      headers['X-GH-Token'] = ghToken;
    }

    const response = await fetch('/api/projects', { headers, signal });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const errorMsg = body?.errors?.[0]?.message || `HTTP ${response.status}`;
      throw new Error(errorMsg);
    }

    const data = await response.json();
    return data.result || [];
  }

  // ── Render Helpers ──
  function getProjectStatusKey(project) {
    const stage = project.latest_deployment?.latest_stage;
    if (!stage) return 'active';

    switch (stage.status) {
      case 'success':
        return 'success';
      case 'failure':
        return 'failure';
      default:
        return 'active';
    }
  }

  function getDeploymentStatus(project) {
    const statusKey = getProjectStatusKey(project);

    switch (statusKey) {
      case 'success':
        return { key: 'success', label: '활성', class: 'success' };
      case 'failure':
        return { key: 'failure', label: '실패', class: 'failure' };
      default:
        return { key: 'active', label: '진행 중', class: 'active' };
    }
  }

  function getRelativeTime(dateStr) {
    if (!dateStr) return '배포 기록 없음';

    const now = new Date();
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '배포 기록 없음';

    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return '방금 전';
    if (diffMin < 60) return `${diffMin}분 전`;
    if (diffHour < 24) return `${diffHour}시간 전`;
    if (diffDay < 30) return `${diffDay}일 전`;
    return date.toLocaleDateString('ko-KR');
  }

  function getDeploymentTimestamp(project) {
    const timestamp = new Date(project.latest_deployment?.created_on || '').getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttribute(str) {
    return String(str).replace(/[&<>"']/g, (char) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      '\'': '&#39;',
    })[char]);
  }

  function getPrimaryUrl(project) {
    const preferredUrl = project.domains?.[0] || project.subdomain || '';
    if (!preferredUrl) return '';

    const normalized = preferredUrl.startsWith('http://') || preferredUrl.startsWith('https://')
      ? preferredUrl
      : `https://${preferredUrl}`;

    try {
      return new URL(normalized).toString();
    } catch {
      return '';
    }
  }

  function matchesSearch(project, query) {
    if (!query) return true;

    const haystack = [
      project.name,
      project.framework,
      project._description,
      project.subdomain,
      ...(project.domains || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(query);
  }

  function filterProjects(projectList) {
    const query = dom.inputSearch.value.trim().toLowerCase();
    const statusFilter = dom.filterStatus.value;

    return projectList.filter((project) => {
      if (!matchesSearch(project, query)) {
        return false;
      }

      if (statusFilter === 'all') {
        return true;
      }

      if (statusFilter === 'favorites') {
        return isFavoriteProject(project.name);
      }

      return getProjectStatusKey(project) === statusFilter;
    });
  }

  function sortProjects(projectList) {
    const sortValue = dom.sortProjects.value;
    const sortedProjects = [...projectList];

    sortedProjects.sort((left, right) => {
      const favoriteDelta = Number(isFavoriteProject(right.name)) - Number(isFavoriteProject(left.name));
      if (favoriteDelta !== 0) {
        return favoriteDelta;
      }

      if (sortValue === 'name') {
        return String(left.name || '').localeCompare(String(right.name || ''), 'ko');
      }

      if (sortValue === 'domains') {
        const domainDelta = (right.domains?.length || 0) - (left.domains?.length || 0);
        if (domainDelta !== 0) {
          return domainDelta;
        }
      }

      return getDeploymentTimestamp(right) - getDeploymentTimestamp(left);
    });

    return sortedProjects;
  }

  function renderProjects(projectList) {
    const safeProjectList = Array.isArray(projectList) ? projectList : [];
    const totalDomains = currentProjects.reduce((sum, project) => sum + (project.domains?.length || 0), 0);
    const activeCount = currentProjects.filter((project) => getProjectStatusKey(project) === 'success').length;

    dom.statTotal.textContent = currentProjects.length;
    dom.statActive.textContent = activeCount;
    dom.statDomains.textContent = totalDomains;
    updateToolbarSummary(currentProjects.length, safeProjectList.length);

    if (safeProjectList.length === 0) {
      showState('grid');
      dom.projectGrid.innerHTML = '';
      dom.projectGrid.style.display = 'none';
      dom.resultsEmpty.style.display = 'flex';
      return;
    }

    dom.resultsEmpty.style.display = 'none';
    dom.projectGrid.style.display = 'grid';
    dom.projectGrid.innerHTML = safeProjectList.map((project, index) => {
      const status = getDeploymentStatus(project);
      const domains = project.domains || [];
      const framework = project.framework || '';
      const deployedAt = project.latest_deployment?.created_on;
      const primaryUrl = getPrimaryUrl(project);
      const description = project._description || '';
      const displayUrl = primaryUrl ? primaryUrl.replace(/^https?:\/\//, '') : '연결된 주소 없음';
      const isFavorite = isFavoriteProject(project.name);
      const meta = [
        framework ? `<span class="card__tag">${escapeHtml(framework)}</span>` : '',
        domains.length > 0 ? `<span class="card__tag">${domains.length}개 도메인</span>` : '',
      ].filter(Boolean).join('');

      return `
        <article class="card" style="animation-delay: ${0.05 * (index + 1)}s">
          <div class="card__header">
            <div class="card__header-main">
              <button
                class="card__favorite${isFavorite ? ' is-active' : ''}"
                type="button"
                data-project-favorite="${escapeAttribute(project.name)}"
                aria-label="${isFavorite ? '즐겨찾기 해제' : '즐겨찾기에 추가'}"
                aria-pressed="${String(isFavorite)}"
                title="${isFavorite ? '즐겨찾기 해제' : '즐겨찾기에 추가'}"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
              </button>
              <span class="card__name">${escapeHtml(project.name)}</span>
            </div>
            <span class="card__status card__status--${status.class}">
              <span class="card__status-dot"></span>
              ${status.label}
            </span>
          </div>
          ${description ? `<p class="card__desc">${escapeHtml(description)}</p>` : ''}
          ${meta ? `<div class="card__meta">${meta}</div>` : ''}
          <div class="card__footer">
            <div class="card__actions">
              <div class="card__url">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
                </svg>
                <span>${escapeHtml(displayUrl)}</span>
              </div>
              ${primaryUrl ? `
                <a class="card__link" href="${escapeAttribute(primaryUrl)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeAttribute(project.name)} 열기" title="사이트 열기">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M7 17 17 7"/>
                    <path d="M7 7h10v10"/>
                  </svg>
                </a>
              ` : `
                <span class="card__link" aria-disabled="true" title="연결된 주소 없음">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 19V5"/>
                    <path d="m5 12 7-7 7 7"/>
                  </svg>
                </span>
              `}
            </div>
            <span class="card__time">${getRelativeTime(deployedAt)}</span>
          </div>
        </article>
      `;
    }).join('');

    showState('grid');
  }

  function renderDashboard() {
    if (currentProjects.length === 0) {
      showEmptyState(hasConfig() ? 'no-projects' : 'config');
      return;
    }

    const filteredProjects = filterProjects(currentProjects);
    const sortedProjects = sortProjects(filteredProjects);
    renderProjects(sortedProjects);
  }

  // ── Load ──
  async function loadProjects(forceRefresh = false) {
    if (!hasConfig()) {
      showEmptyState('config');
      return;
    }

    const requestId = ++latestLoadRequestId;
    const cachedEntry = loadCache();
    const cachedProjects = cachedEntry?.projects || [];
    const hasCachedProjects = cachedProjects.length > 0;
    const canUseFreshCache = !forceRefresh && hasCachedProjects && isCacheFresh(cachedEntry);

    if (canUseFreshCache) {
      currentProjects = cachedProjects;
      renderDashboard();
      return;
    }

    if (!forceRefresh && hasCachedProjects) {
      currentProjects = cachedProjects;
      renderDashboard();
      showToast('캐시된 데이터를 먼저 표시하고 최신 상태를 확인합니다.', 'info');
    } else {
      showState('loading');
    }

    if (activeFetchController) {
      activeFetchController.abort();
    }

    const controller = new AbortController();
    activeFetchController = controller;
    setLoading(true);

    try {
      const projectList = await fetchProjects(controller.signal);
      if (requestId !== latestLoadRequestId) return;

      if (projectList.length === 0) {
        currentProjects = [];
        saveCache([]);
        showEmptyState('no-projects');
        showToast('등록된 프로젝트가 없습니다.', 'info');
        return;
      }

      currentProjects = projectList;
      saveCache(projectList);
      renderDashboard();
      showToast(`${projectList.length}개 프로젝트를 불러왔습니다.`, 'success');
    } catch (err) {
      if (err.name === 'AbortError' || requestId !== latestLoadRequestId) return;

      if (hasCachedProjects) {
        currentProjects = cachedProjects;
        renderDashboard();
        showToast('최신 정보를 가져오지 못해 캐시된 데이터를 표시합니다.', 'error');
      } else {
        dom.errorMessage.textContent = err.message || '알 수 없는 오류가 발생했습니다.';
        showState('error');
        showToast('프로젝트 로딩에 실패했습니다.', 'error');
      }
    } finally {
      if (requestId === latestLoadRequestId) {
        setLoading(false);
      }
      if (activeFetchController === controller) {
        activeFetchController = null;
      }
    }
  }

  // ── Events ──
  function saveSettings() {
    const accountId = dom.inputAccountId.value.trim();
    const apiToken = dom.inputApiToken.value.trim();
    const ghToken = dom.inputGhToken.value.trim();

    if (!accountId || !apiToken) {
      showToast('Account ID와 API Token을 모두 입력해주세요.', 'error');
      return;
    }

    saveConfig(accountId, apiToken, ghToken);
    closeModal();
    showToast('설정이 저장되었습니다.', 'success');
    loadProjects(true);
  }

  function handleDocumentKeydown(event) {
    if (event.key === 'Escape' && isModalOpen()) {
      closeModal();
      return;
    }

    if (!isModalOpen()) return;

    if (event.key === 'Tab') {
      const focusableElements = getFocusableModalElements();
      if (focusableElements.length === 0) return;

      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      saveSettings();
    }
  }

  function handleGridClick(event) {
    const favoriteButton = event.target.closest('[data-project-favorite]');
    if (!favoriteButton) return;

    const projectName = favoriteButton.getAttribute('data-project-favorite') || '';
    const isFavorite = toggleFavoriteProject(projectName);
    renderDashboard();
    showToast(
      isFavorite ? `${projectName}을 즐겨찾기에 추가했습니다.` : `${projectName}을 즐겨찾기에서 제거했습니다.`,
      'success'
    );
  }

  function bindEvents() {
    dom.btnSettings.addEventListener('click', openModal);
    dom.btnSetup.addEventListener('click', openModal);

    dom.btnCancel.addEventListener('click', closeModal);
    dom.btnModalClose.addEventListener('click', closeModal);
    dom.modalOverlay.addEventListener('click', (event) => {
      if (event.target === dom.modalOverlay) {
        closeModal();
      }
    });

    dom.btnSave.addEventListener('click', saveSettings);
    dom.btnRefresh.addEventListener('click', () => loadProjects(true));
    dom.btnRetry.addEventListener('click', () => loadProjects(true));
    dom.projectGrid.addEventListener('click', handleGridClick);
    dom.inputSearch.addEventListener('input', renderDashboard);
    dom.filterStatus.addEventListener('change', renderDashboard);
    dom.sortProjects.addEventListener('change', renderDashboard);

    document.addEventListener('keydown', handleDocumentKeydown);
    window.addEventListener('beforeunload', () => activeFetchController?.abort());
  }

  // ── Init ──
  function init() {
    bindEvents();
    loadProjects();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
