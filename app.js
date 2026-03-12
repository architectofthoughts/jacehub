/* ═══════════════════════════════════════════════
   JaceHub — Application Logic
   Cloudflare Pages Dashboard Client
   ═══════════════════════════════════════════════ */

(() => {
  'use strict';

  // ── Constants ──
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
    stateEmpty:   $('#state-empty'),
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
  let projects = [];

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

  // ── UI State Management ──
  function showState(state) {
    dom.stateEmpty.style.display   = state === 'empty'   ? 'flex' : 'none';
    dom.stateLoading.style.display = state === 'loading' ? 'flex' : 'none';
    dom.stateError.style.display   = state === 'error'   ? 'flex' : 'none';
    dom.projectGrid.style.display  = state === 'grid'    ? 'grid' : 'none';
    dom.stats.style.display        = state === 'grid'    ? 'flex' : 'none';
  }

  // ── Modal ──
  function openModal() {
    const { accountId, apiToken, ghToken } = getConfig();
    dom.inputAccountId.value = accountId;
    dom.inputApiToken.value  = apiToken;
    dom.inputGhToken.value   = ghToken;
    dom.modalOverlay.classList.add('is-open');
    setTimeout(() => dom.inputAccountId.focus(), 200);
  }

  function closeModal() {
    dom.modalOverlay.classList.remove('is-open');
  }

  // ── Toast ──
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;
    dom.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('is-leaving');
      toast.addEventListener('animationend', () => toast.remove());
    }, 3000);
  }

  // ── API ──
  async function fetchProjects() {
    const { accountId, apiToken, ghToken } = getConfig();

    const headers = {
      'X-CF-Account-Id': accountId,
      'X-CF-Api-Token': apiToken,
    };
    if (ghToken) headers['X-GH-Token'] = ghToken;

    const response = await fetch('/api/projects', { headers });

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
      case 'idle':     return { label: '진행 중', class: 'active' };
      default:         return { label: stage.status, class: 'active' };
    }
  }

  function getRelativeTime(dateStr) {
    if (!dateStr) return '배포 기록 없음';
    const now = new Date();
    const date = new Date(dateStr);
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

  function renderProjects(projectList) {
    projects = projectList;

    // Stats
    const totalDomains = projectList.reduce((sum, p) => sum + (p.domains?.length || 0), 0);
    const activeCount = projectList.filter(p => {
      const stage = p.latest_deployment?.latest_stage;
      return stage?.status === 'success';
    }).length;

    dom.statTotal.textContent   = projectList.length;
    dom.statActive.textContent  = activeCount;
    dom.statDomains.textContent = totalDomains;

    // Cards
    dom.projectGrid.innerHTML = projectList.map((project, index) => {
      const status = getDeploymentStatus(project);
      const subdomain = project.subdomain ? `${project.subdomain}` : null;
      const domains = project.domains || [];
      const framework = project.framework || null;
      const deployedAt = project.latest_deployment?.created_on;

      const primaryUrl = domains.length > 0
        ? `https://${domains[0]}`
        : subdomain
          ? `https://${subdomain}`
          : '#';

      const description = project._description || '';

      return `
        <a class="card" href="${primaryUrl}" target="_blank" rel="noopener noreferrer"
           style="animation-delay: ${0.05 * (index + 1)}s">
          <div class="card__header">
            <span class="card__name">${escapeHtml(project.name)}</span>
            <span class="card__status card__status--${status.class}">
              <span class="card__status-dot"></span>
              ${status.label}
            </span>
          </div>
          ${description ? `<p class="card__desc">${escapeHtml(description)}</p>` : ''}
          <div class="card__footer">
            <div class="card__url">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
              <span>${escapeHtml(primaryUrl.replace(/^https?:\/\//, ''))}</span>
            </div>
            <span class="card__time">${getRelativeTime(deployedAt)}</span>
          </div>
        </a>
      `;
    }).join('');

    showState('grid');
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ── Cache ──
  function saveCache(projectList) {
    localStorage.setItem(STORAGE_KEYS.cache, JSON.stringify(projectList));
  }

  function loadCache() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.cache);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  // ── Load ──
  async function loadProjects(forceRefresh = false) {
    if (!hasConfig()) {
      showState('empty');
      return;
    }

    // Use cache if available and not forcing refresh
    if (!forceRefresh) {
      const cached = loadCache();
      if (cached && cached.length > 0) {
        renderProjects(cached);
        return;
      }
    }

    showState('loading');

    try {
      const projectList = await fetchProjects();
      if (projectList.length === 0) {
        showState('empty');
        showToast('등록된 프로젝트가 없습니다.', 'info');
        return;
      }
      saveCache(projectList);
      renderProjects(projectList);
      showToast(`${projectList.length}개 프로젝트를 불러왔습니다.`, 'success');
    } catch (err) {
      // If refresh failed but we have cache, show cache with error toast
      const cached = loadCache();
      if (cached && cached.length > 0) {
        renderProjects(cached);
        showToast('갱신 실패 — 캐시된 데이터를 표시 중입니다.', 'error');
      } else {
        dom.errorMessage.textContent = err.message;
        showState('error');
        showToast('프로젝트 로딩에 실패했습니다.', 'error');
      }
    }
  }

  // ── Events ──
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
    dom.btnSave.addEventListener('click', () => {
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
      loadProjects(true);  // Force refresh on config change
    });

    // Refresh (force)
    dom.btnRefresh.addEventListener('click', () => {
      loadProjects(true);
    });

    // Retry (force)
    dom.btnRetry.addEventListener('click', () => {
      loadProjects(true);
    });

    // Keyboard
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
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
