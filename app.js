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
  };

  // ── DOM References ──
  const $ = (sel) => document.querySelector(sel);
  const dom = {
    // States
    main:         $('#main'),
    stateEmpty:   $('#state-empty'),
    stateEmptyTitle: $('#state-empty-title'),
    stateEmptyMessage: $('#state-empty-message'),
    stateLoading: $('#state-loading'),
    stateError:   $('#state-error'),
    errorMessage: $('#error-message'),
    // Grid & Stats
    projectGrid:  $('#project-grid'),
    stats:        $('#stats'),
    statTotal:    $('#stat-total'),
    statActive:   $('#stat-active'),
    statDomains:  $('#stat-domains'),
    // Modal
    modalOverlay: $('#modal-overlay'),
    modal:        $('#modal'),
    inputAccountId: $('#input-account-id'),
    inputApiToken:  $('#input-api-token'),
    inputGhToken:   $('#input-gh-token'),
    // Buttons
    btnSettings:    $('#btn-settings'),
    btnSetup:       $('#btn-setup'),
    btnRefresh:     $('#btn-refresh'),
    btnRetry:       $('#btn-retry'),
    btnSave:        $('#btn-save'),
    btnCancel:      $('#btn-cancel'),
    btnModalClose:  $('#btn-modal-close'),
    // Toast
    toastContainer: $('#toast-container'),
  };

  // ── State ──
  let activeFetchController = null;
  let latestLoadRequestId = 0;
  let lastFocusedElement = null;

  // ── Storage ──
  function getConfig() {
    return {
      accountId: localStorage.getItem(STORAGE_KEYS.accountId) || '',
      apiToken:  localStorage.getItem(STORAGE_KEYS.apiToken)  || '',
      ghToken:   localStorage.getItem(STORAGE_KEYS.ghToken)   || '',
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

  // ── UI State Management ──
  function showState(state) {
    dom.stateEmpty.style.display   = state === 'empty'   ? 'flex' : 'none';
    dom.stateLoading.style.display = state === 'loading' ? 'flex' : 'none';
    dom.stateError.style.display   = state === 'error'   ? 'flex' : 'none';
    dom.projectGrid.style.display  = state === 'grid'    ? 'grid' : 'none';
    dom.stats.style.display        = state === 'grid'    ? 'flex' : 'none';
    dom.main.setAttribute('data-view-state', state);
  }

  function showEmptyState(kind = 'config') {
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
    dom.inputApiToken.value  = apiToken;
    dom.inputGhToken.value   = ghToken;
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
    if (ghToken) headers['X-GH-Token'] = ghToken;

    const response = await fetch('/api/projects', { headers, signal });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const errorMsg = body?.errors?.[0]?.message || `HTTP ${response.status}`;
      throw new Error(errorMsg);
    }

    const data = await response.json();
    return data.result || [];
  }

  // ── Render ──
  function getDeploymentStatus(project) {
    const stage = project.latest_deployment?.latest_stage;
    if (!stage) return { label: '대기', class: 'active' };
    switch (stage.status) {
      case 'success':  return { label: '활성', class: 'success' };
      case 'failure':  return { label: '실패', class: 'failure' };
      case 'active':
      case 'idle':
      case 'queued':   return { label: '진행 중', class: 'active' };
      default:         return { label: stage.status, class: 'active' };
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

  function renderProjects(projectList) {
    const safeProjectList = Array.isArray(projectList) ? projectList : [];

    // Stats
    const totalDomains = safeProjectList.reduce((sum, p) => sum + (p.domains?.length || 0), 0);
    const activeCount = safeProjectList.filter((p) => {
      const stage = p.latest_deployment?.latest_stage;
      return stage?.status === 'success';
    }).length;

    dom.statTotal.textContent   = safeProjectList.length;
    dom.statActive.textContent  = activeCount;
    dom.statDomains.textContent = totalDomains;

    // Cards
    dom.projectGrid.innerHTML = safeProjectList.map((project, index) => {
      const status = getDeploymentStatus(project);
      const domains = project.domains || [];
      const framework = project.framework || '';
      const deployedAt = project.latest_deployment?.created_on;
      const primaryUrl = getPrimaryUrl(project);
      const description = project._description || '';
      const cardTag = primaryUrl ? 'a' : 'article';
      const cardAttributes = primaryUrl
        ? `href="${escapeAttribute(primaryUrl)}" target="_blank" rel="noopener noreferrer"`
        : 'aria-disabled="true"';
      const meta = [
        framework ? `<span class="card__tag">${escapeHtml(framework)}</span>` : '',
        domains.length > 0 ? `<span class="card__tag">${domains.length}개 도메인</span>` : '',
      ].filter(Boolean).join('');
      const displayUrl = primaryUrl ? primaryUrl.replace(/^https?:\/\//, '') : '연결된 주소 없음';

      return `
        <${cardTag} class="card" ${cardAttributes} style="animation-delay: ${0.05 * (index + 1)}s">
          <div class="card__header">
            <span class="card__name">${escapeHtml(project.name)}</span>
            <span class="card__status card__status--${status.class}">
              <span class="card__status-dot"></span>
              ${status.label}
            </span>
          </div>
          ${description ? `<p class="card__desc">${escapeHtml(description)}</p>` : ''}
          ${meta ? `<div class="card__meta">${meta}</div>` : ''}
          <div class="card__footer">
            <div class="card__url">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
              <span>${escapeHtml(displayUrl)}</span>
            </div>
            <span class="card__time">${getRelativeTime(deployedAt)}</span>
          </div>
        </${cardTag}>
      `;
    }).join('');

    showState('grid');
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
      renderProjects(cachedProjects);
      return;
    }

    if (!forceRefresh && hasCachedProjects) {
      renderProjects(cachedProjects);
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
        saveCache([]);
        showEmptyState('no-projects');
        showToast('등록된 프로젝트가 없습니다.', 'info');
        return;
      }
      saveCache(projectList);
      renderProjects(projectList);
      showToast(`${projectList.length}개 프로젝트를 불러왔습니다.`, 'success');
    } catch (err) {
      if (err.name === 'AbortError' || requestId !== latestLoadRequestId) return;

      // If refresh failed but we have cache, show cache with error toast
      if (hasCachedProjects) {
        renderProjects(cachedProjects);
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
    const apiToken  = dom.inputApiToken.value.trim();
    const ghToken   = dom.inputGhToken.value.trim();

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

  function bindEvents() {
    // Open modal
    dom.btnSettings.addEventListener('click', openModal);
    dom.btnSetup.addEventListener('click', openModal);

    // Close modal
    dom.btnCancel.addEventListener('click', closeModal);
    dom.btnModalClose.addEventListener('click', closeModal);
    dom.modalOverlay.addEventListener('click', (e) => {
      if (e.target === dom.modalOverlay) closeModal();
    });

    // Save config
    dom.btnSave.addEventListener('click', saveSettings);

    // Refresh (force)
    dom.btnRefresh.addEventListener('click', () => {
      loadProjects(true);
    });

    // Retry (force)
    dom.btnRetry.addEventListener('click', () => {
      loadProjects(true);
    });

    // Keyboard
    document.addEventListener('keydown', handleDocumentKeydown);
    window.addEventListener('beforeunload', () => activeFetchController?.abort());
  }

  // ── Init ──
  function init() {
    bindEvents();
    loadProjects();
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
