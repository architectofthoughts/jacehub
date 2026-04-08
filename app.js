/* ═══════════════════════════════════════════════
   JaceHub — Application Logic
   Cloudflare Pages Dashboard Client
   ═══════════════════════════════════════════════ */

(() => {
  'use strict';

  // ── Constants ──
  const CACHE_TTL_MS = 10 * 60 * 1000;
  const TOAST_DURATION_MS = 3000;
  const DAY_MS = 24 * 60 * 60 * 1000;
  const FRESH_PROJECT_DAYS = 7;
  const STALE_PROJECT_DAYS = 21;
  const CRITICAL_PROJECT_DAYS = 45;
  const STORAGE_KEYS = {
    accountId: 'jacehub_account_id',
    apiToken:  'jacehub_api_token',
    ghToken:   'jacehub_gh_token',
    cache:     'jacehub_cache',
    favorites: 'jacehub_favorites',
    vaultId:   'jacehub_vault_id',
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
    statAttention:    $('#stat-attention'),
    statActive:       $('#stat-active'),
    statDomains:      $('#stat-domains'),
    radar:            $('#radar'),
    radarSummary:     $('#radar-summary'),
    radarMetricAttention: $('#radar-metric-attention'),
    radarMetricStale: $('#radar-metric-stale'),
    radarMetricFresh: $('#radar-metric-fresh'),
    radarHighlights:  $('#radar-highlights'),
    radarChips:       $('#radar-chips'),
    toolbar:          $('#toolbar'),
    inputSearch:      $('#input-search'),
    filterStatus:     $('#filter-status'),
    sortProjects:     $('#sort-projects'),
    toolbarSummary:   $('#toolbar-summary'),
    btnCopyReport:    $('#btn-copy-report'),
    btnExportCsv:     $('#btn-export-csv'),
    // Modal
    modalOverlay:     $('#modal-overlay'),
    modal:            $('#modal'),
    inputAccountId:   $('#input-account-id'),
    inputApiToken:    $('#input-api-token'),
    inputGhToken:     $('#input-gh-token'),
    // Vault
    vaultSection:     $('#vault-section'),
    vaultStatus:      $('#vault-status'),
    vaultForm:        $('#vault-form'),
    vaultIdText:      $('#vault-id-text'),
    btnVaultCopy:     $('#btn-vault-copy'),
    btnVaultUpdate:   $('#btn-vault-update'),
    btnVaultDelete:   $('#btn-vault-delete'),
    vaultTabLoad:     $('#vault-tab-load'),
    vaultTabSave:     $('#vault-tab-save'),
    vaultPanelLoad:   $('#vault-panel-load'),
    vaultPanelSave:   $('#vault-panel-save'),
    inputVaultId:     $('#input-vault-id'),
    inputVaultPinLoad:    $('#input-vault-pin-load'),
    inputVaultPinSave:    $('#input-vault-pin-save'),
    inputVaultPinConfirm: $('#input-vault-pin-confirm'),
    btnVaultLoad:     $('#btn-vault-load'),
    btnVaultSave:     $('#btn-vault-save'),
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
  let activeRadarFilter = 'all';

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

  function getSavedVaultId() {
    return localStorage.getItem(STORAGE_KEYS.vaultId) || '';
  }

  function saveVaultId(vaultId) {
    if (vaultId) {
      localStorage.setItem(STORAGE_KEYS.vaultId, vaultId);
    } else {
      localStorage.removeItem(STORAGE_KEYS.vaultId);
    }
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
    dom.radar.style.display = state === 'grid' ? 'grid' : 'none';
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

  function setToolbarActionsEnabled(isEnabled) {
    [dom.btnCopyReport, dom.btnExportCsv].forEach((button) => {
      button.disabled = !isEnabled;
      button.setAttribute('aria-disabled', String(!isEnabled));
    });
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
    updateVaultUI();
    dom.modalOverlay.classList.add('is-open');
    dom.modalOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(() => dom.inputAccountId.focus(), 200);
  }

  function closeModal() {
    dom.modalOverlay.classList.remove('is-open');
    dom.modalOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.removeProperty('overflow');
    clearVaultPinInputs();
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

  // ── Vault API ──
  function clearVaultPinInputs() {
    dom.inputVaultPinLoad.value = '';
    dom.inputVaultPinSave.value = '';
    dom.inputVaultPinConfirm.value = '';
  }

  function updateVaultUI() {
    const savedVaultId = getSavedVaultId();

    if (savedVaultId) {
      dom.vaultStatus.style.display = 'flex';
      dom.vaultForm.style.display = 'none';
      dom.vaultIdText.textContent = savedVaultId;
    } else {
      dom.vaultStatus.style.display = 'none';
      dom.vaultForm.style.display = 'block';
      dom.inputVaultId.value = '';
    }
  }

  function switchVaultTab(tab) {
    const isLoad = tab === 'load';
    dom.vaultTabLoad.classList.toggle('is-active', isLoad);
    dom.vaultTabSave.classList.toggle('is-active', !isLoad);
    dom.vaultTabLoad.setAttribute('aria-selected', String(isLoad));
    dom.vaultTabSave.setAttribute('aria-selected', String(!isLoad));
    dom.vaultPanelLoad.style.display = isLoad ? 'flex' : 'none';
    dom.vaultPanelSave.style.display = isLoad ? 'none' : 'flex';
    clearVaultPinInputs();
  }

  async function handleVaultLoad() {
    const vaultId = dom.inputVaultId.value.trim();
    const pin = dom.inputVaultPinLoad.value.trim();

    if (!vaultId) {
      showToast('보관소 ID를 입력해주세요.', 'error');
      dom.inputVaultId.focus();
      return;
    }

    if (!/^\d{6}$/.test(pin)) {
      showToast('PIN은 6자리 숫자여야 합니다.', 'error');
      dom.inputVaultPinLoad.focus();
      return;
    }

    dom.btnVaultLoad.disabled = true;

    try {
      const response = await fetch(`/api/vault?id=${encodeURIComponent(vaultId)}&pin=${encodeURIComponent(pin)}`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        const msg = data?.errors?.[0]?.message || '불러오기에 실패했습니다.';
        showToast(msg, 'error');
        return;
      }

      const { credentials } = data;
      dom.inputAccountId.value = credentials.accountId || '';
      dom.inputApiToken.value = credentials.apiToken || '';
      dom.inputGhToken.value = credentials.ghToken || '';

      saveConfig(credentials.accountId, credentials.apiToken, credentials.ghToken);
      saveVaultId(vaultId);
      updateVaultUI();
      clearVaultPinInputs();

      showToast('클라우드에서 인증 정보를 불러왔습니다.', 'success');
      loadProjects(true);
    } catch (err) {
      showToast(err.message || '네트워크 오류가 발생했습니다.', 'error');
    } finally {
      dom.btnVaultLoad.disabled = false;
    }
  }

  async function handleVaultSave() {
    const accountId = dom.inputAccountId.value.trim();
    const apiToken = dom.inputApiToken.value.trim();
    const ghToken = dom.inputGhToken.value.trim();
    const pin = dom.inputVaultPinSave.value.trim();
    const pinConfirm = dom.inputVaultPinConfirm.value.trim();

    if (!accountId || !apiToken) {
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
      const response = await fetch('/api/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, accountId, apiToken, ghToken }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        const msg = data?.errors?.[0]?.message || '저장에 실패했습니다.';
        showToast(msg, 'error');
        return;
      }

      saveVaultId(data.vaultId);
      updateVaultUI();
      clearVaultPinInputs();

      showToast('클라우드 보관소에 저장되었습니다. ID를 기억해주세요!', 'success');
    } catch (err) {
      showToast(err.message || '네트워크 오류가 발생했습니다.', 'error');
    } finally {
      dom.btnVaultSave.disabled = false;
    }
  }

  async function handleVaultUpdate() {
    const vaultId = getSavedVaultId();
    if (!vaultId) return;

    const pin = prompt('현재 보관소의 PIN을 입력하세요 (6자리 숫자):');
    if (!pin || !/^\d{6}$/.test(pin.trim())) {
      if (pin !== null) showToast('PIN은 6자리 숫자여야 합니다.', 'error');
      return;
    }

    const accountId = dom.inputAccountId.value.trim();
    const apiToken = dom.inputApiToken.value.trim();
    const ghToken = dom.inputGhToken.value.trim();

    if (!accountId || !apiToken) {
      showToast('Account ID와 API Token을 먼저 입력해주세요.', 'error');
      return;
    }

    dom.btnVaultUpdate.disabled = true;

    try {
      const response = await fetch('/api/vault', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pin: pin.trim(),
          accountId,
          apiToken,
          ghToken,
          vaultId,
          existingPin: pin.trim(),
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        const msg = data?.errors?.[0]?.message || '업데이트에 실패했습니다.';
        showToast(msg, 'error');
        return;
      }

      showToast('보관소가 업데이트되었습니다.', 'success');
    } catch (err) {
      showToast(err.message || '네트워크 오류가 발생했습니다.', 'error');
    } finally {
      dom.btnVaultUpdate.disabled = false;
    }
  }

  async function handleVaultDelete() {
    const vaultId = getSavedVaultId();
    if (!vaultId) return;

    const pin = prompt('보관소 삭제를 확인하려면 PIN을 입력하세요 (6자리 숫자):');
    if (!pin || !/^\d{6}$/.test(pin.trim())) {
      if (pin !== null) showToast('PIN은 6자리 숫자여야 합니다.', 'error');
      return;
    }

    if (!confirm('정말로 클라우드 보관소를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
      return;
    }

    dom.btnVaultDelete.disabled = true;

    try {
      const response = await fetch(`/api/vault?id=${encodeURIComponent(vaultId)}&pin=${encodeURIComponent(pin.trim())}`, {
        method: 'DELETE',
      });
      const data = await response.json();

      if (!response.ok || !data.success) {
        const msg = data?.errors?.[0]?.message || '삭제에 실패했습니다.';
        showToast(msg, 'error');
        return;
      }

      saveVaultId('');
      updateVaultUI();
      showToast('클라우드 보관소가 삭제되었습니다.', 'success');
    } catch (err) {
      showToast(err.message || '네트워크 오류가 발생했습니다.', 'error');
    } finally {
      dom.btnVaultDelete.disabled = false;
    }
  }

  async function handleVaultCopy() {
    const vaultId = getSavedVaultId();
    if (!vaultId) return;

    try {
      await copyText(vaultId);
      showToast('보관소 ID가 복사되었습니다.', 'success');
    } catch {
      showToast('복사에 실패했습니다.', 'error');
    }
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

  function formatAbsoluteDate(dateStr) {
    if (!dateStr) return '기록 없음';

    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '기록 없음';

    return new Intl.DateTimeFormat('ko-KR', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
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

  function getProjectRadar(project) {
    const statusKey = getProjectStatusKey(project);
    const ageDays = getProjectAgeDays(project);
    const hasCustomDomain = (project.domains?.length || 0) > 0;
    const signals = [];
    let score = 0;

    if (statusKey === 'failure') {
      score += 5;
      signals.push('최근 배포가 실패했습니다');
    } else if (statusKey === 'active') {
      score += 2;
      signals.push('배포가 아직 진행 중입니다');
    }

    if (ageDays === null) {
      score += 4;
      signals.push('배포 기록이 없습니다');
    } else if (ageDays >= CRITICAL_PROJECT_DAYS) {
      score += 4;
      signals.push(`${ageDays}일째 새 배포가 없습니다`);
    } else if (ageDays >= STALE_PROJECT_DAYS) {
      score += 2;
      signals.push(`${ageDays}일째 업데이트가 없습니다`);
    } else if (ageDays <= FRESH_PROJECT_DAYS && statusKey === 'success') {
      signals.push(`${formatDeploymentAge(ageDays)}로 최신 상태입니다`);
    }

    if (!hasCustomDomain) {
      score += 2;
      signals.push('커스텀 도메인이 연결되지 않았습니다');
    }

    if (!project._description) {
      score += 1;
      signals.push('저장소 설명이 비어 있습니다');
    }

    if (isFavoriteProject(project.name)) {
      signals.push('즐겨찾기 프로젝트입니다');
    }

    const severity = score >= 5 ? 'attention' : score >= 3 ? 'watch' : 'healthy';
    const label = severity === 'attention'
      ? '즉시 확인'
      : severity === 'watch'
        ? '관찰 필요'
        : '정상';

    return {
      score,
      severity,
      label,
      ageDays,
      hasCustomDomain,
      isFresh: ageDays !== null && ageDays <= FRESH_PROJECT_DAYS && statusKey === 'success',
      isStale: ageDays === null || ageDays >= STALE_PROJECT_DAYS,
      signals,
      summary: signals[0] || '최근 상태가 안정적입니다',
    };
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
      project._type,
      ...(project.domains || []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return haystack.includes(query);
  }

  function matchesRadarFilter(project) {
    const radar = getProjectRadar(project);

    switch (activeRadarFilter) {
      case 'attention':
        return radar.severity === 'attention';
      case 'stale':
        return radar.isStale;
      case 'fresh':
        return radar.isFresh;
      case 'domainless':
        return !radar.hasCustomDomain;
      case 'favorites':
        return isFavoriteProject(project.name);
      default:
        return true;
    }
  }

  function getStatusFilterLabel(statusFilter) {
    switch (statusFilter) {
      case 'favorites':
        return '즐겨찾기';
      case 'success':
        return '활성';
      case 'active':
        return '진행 중';
      case 'failure':
        return '실패';
      default:
        return '전체 상태';
    }
  }

  function getRadarFilterLabel(filterKey) {
    switch (filterKey) {
      case 'attention':
        return '주의';
      case 'stale':
        return '정체';
      case 'fresh':
        return '최근 배포';
      case 'domainless':
        return '도메인 없음';
      case 'favorites':
        return '즐겨찾기';
      default:
        return '전체';
    }
  }

  function getFrameworkSummary(projectList) {
    const counts = new Map();

    projectList.forEach((project) => {
      const framework = String(project.framework || '').trim();
      if (!framework) return;
      counts.set(framework, (counts.get(framework) || 0) + 1);
    });

    const summary = [...counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, 3)
      .map(([framework, count]) => `${framework} ${count}개`)
      .join(' · ');

    return summary || '프레임워크 정보가 충분하지 않습니다';
  }

  function getRadarOverview(projectList) {
    const projectRadarList = projectList.map((project) => ({
      project,
      radar: getProjectRadar(project),
    }));

    const sortedByAttention = [...projectRadarList].sort((left, right) => {
      const scoreDelta = right.radar.score - left.radar.score;
      if (scoreDelta !== 0) {
        return scoreDelta;
      }

      const ageDelta = (right.radar.ageDays ?? Number.MAX_SAFE_INTEGER) - (left.radar.ageDays ?? Number.MAX_SAFE_INTEGER);
      if (ageDelta !== 0) {
        return ageDelta;
      }

      return getDeploymentTimestamp(left.project) - getDeploymentTimestamp(right.project);
    });

    const projectsNeedingAttention = sortedByAttention.filter(({ radar }) => radar.score > 0);
    const highlightProjects = (projectsNeedingAttention.length > 0 ? projectsNeedingAttention : sortedByAttention).slice(0, 3);

    return {
      attentionCount: projectRadarList.filter(({ radar }) => radar.severity === 'attention').length,
      staleCount: projectRadarList.filter(({ radar }) => radar.isStale).length,
      freshCount: projectRadarList.filter(({ radar }) => radar.isFresh).length,
      domainlessCount: projectRadarList.filter(({ radar }) => !radar.hasCustomDomain).length,
      favoriteCount: projectList.filter((project) => isFavoriteProject(project.name)).length,
      frameworkSummary: getFrameworkSummary(projectList),
      highlightProjects,
    };
  }

  function renderRadar(projectList) {
    const overview = getRadarOverview(projectList);
    const leadHighlight = overview.highlightProjects[0];
    const leadSentence = leadHighlight
      ? `${leadHighlight.project.name}부터 확인하는 편이 좋습니다.`
      : '아직 표시할 프로젝트가 없습니다.';
    const balanceSentence = overview.attentionCount > 0
      ? `즉시 확인 ${overview.attentionCount}개, ${STALE_PROJECT_DAYS}일 이상 정체 ${overview.staleCount}개입니다.`
      : `현재 치명적 경고는 없고 최근 ${FRESH_PROJECT_DAYS}일 내 배포가 ${overview.freshCount}개입니다.`;

    dom.radarSummary.textContent = `${leadSentence} ${balanceSentence} 프레임워크 분포: ${overview.frameworkSummary}.`;
    dom.radarMetricAttention.textContent = overview.attentionCount;
    dom.radarMetricStale.textContent = overview.staleCount;
    dom.radarMetricFresh.textContent = overview.freshCount;

    dom.radarHighlights.innerHTML = overview.highlightProjects.map(({ project, radar }) => {
      const deployedAt = formatDeploymentAge(radar.ageDays);
      const primarySignal = radar.summary;
      return `
        <article class="radar-highlight radar-highlight--${radar.severity}">
          <div class="radar-highlight__header">
            <span class="radar-highlight__pill">${escapeHtml(radar.label)}</span>
            <span class="radar-highlight__meta">${escapeHtml(deployedAt)}</span>
          </div>
          <strong class="radar-highlight__name">${escapeHtml(project.name)}</strong>
          <p class="radar-highlight__desc">${escapeHtml(primarySignal)}</p>
        </article>
      `;
    }).join('');

    const filters = [
      { key: 'all', label: '전체', count: projectList.length },
      { key: 'attention', label: '주의', count: overview.attentionCount },
      { key: 'stale', label: '정체', count: overview.staleCount },
      { key: 'fresh', label: '최근 배포', count: overview.freshCount },
      { key: 'domainless', label: '도메인 없음', count: overview.domainlessCount },
      { key: 'favorites', label: '즐겨찾기', count: overview.favoriteCount },
    ];

    dom.radarChips.innerHTML = filters.map((filter) => `
      <button
        class="radar-chip${activeRadarFilter === filter.key ? ' is-active' : ''}"
        type="button"
        data-radar-filter="${filter.key}"
        aria-pressed="${String(activeRadarFilter === filter.key)}"
      >
        <span>${escapeHtml(filter.label)}</span>
        <strong class="radar-chip__count">${filter.count}</strong>
      </button>
    `).join('');
  }

  function filterProjects(projectList) {
    const query = dom.inputSearch.value.trim().toLowerCase();
    const statusFilter = dom.filterStatus.value;

    return projectList.filter((project) => {
      if (!matchesRadarFilter(project)) {
        return false;
      }

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

  function getVisibleProjects() {
    return sortProjects(filterProjects(currentProjects));
  }

  function formatCsvValue(value) {
    const normalized = String(value ?? '').replace(/\r?\n/g, ' ').trim();
    return `"${normalized.replace(/"/g, '""')}"`;
  }

  function createExportTimestamp() {
    return new Date().toISOString().replace(/[:.]/g, '-');
  }

  function downloadTextFile(filename, contents, type) {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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

    if (!copied) {
      throw new Error('클립보드에 복사하지 못했습니다.');
    }
  }

  function buildProjectsCsv(projectList) {
    const header = [
      'project_name',
      'status',
      'radar_label',
      'radar_score',
      'framework',
      'primary_url',
      'domain_count',
      'last_deployed_at',
      'last_deployed_relative',
      'favorite',
      'summary',
      'description',
    ];

    const rows = projectList.map((project) => {
      const radar = getProjectRadar(project);
      const status = getDeploymentStatus(project);
      const deployedAt = project.latest_deployment?.created_on || '';

      return [
        project.name || '',
        status.label,
        radar.label,
        radar.score,
        project.framework || '',
        getPrimaryUrl(project),
        project.domains?.length || 0,
        deployedAt,
        getRelativeTime(deployedAt),
        isFavoriteProject(project.name) ? 'yes' : 'no',
        radar.summary,
        project._description || '',
      ].map(formatCsvValue).join(',');
    });

    return [header.join(','), ...rows].join('\n');
  }

  function buildStatusReport(projectList) {
    const overview = getRadarOverview(projectList);
    const searchQuery = dom.inputSearch.value.trim();
    const statusFilterLabel = getStatusFilterLabel(dom.filterStatus.value);
    const radarFilterLabel = getRadarFilterLabel(activeRadarFilter);
    const sortLabel = dom.sortProjects.options[dom.sortProjects.selectedIndex]?.textContent || '최근 배포순';
    const generatedAt = formatAbsoluteDate(new Date().toISOString());
    const projectLines = projectList.slice(0, 10).map((project) => {
      const radar = getProjectRadar(project);
      const status = getDeploymentStatus(project);
      const deployedAt = formatDeploymentAge(radar.ageDays);
      return `- ${project.name}: ${status.label} / ${radar.label} / ${deployedAt} / ${radar.summary}`;
    });

    return [
      '# JaceHub 배포 상태 보고서',
      '',
      `생성 시각: ${generatedAt}`,
      `표시 프로젝트: ${projectList.length}개`,
      `레이더 필터: ${radarFilterLabel}`,
      `상태 필터: ${statusFilterLabel}`,
      `정렬: ${sortLabel}`,
      `검색어: ${searchQuery || '없음'}`,
      '',
      '## 요약',
      `- 즉시 확인: ${overview.attentionCount}개`,
      `- 정체 프로젝트: ${overview.staleCount}개`,
      `- 최근 ${FRESH_PROJECT_DAYS}일 배포: ${overview.freshCount}개`,
      `- 도메인 미연결: ${overview.domainlessCount}개`,
      `- 즐겨찾기 포함: ${overview.favoriteCount}개`,
      '',
      '## 우선 확인 프로젝트',
      ...(projectLines.length > 0 ? projectLines : ['- 표시할 프로젝트가 없습니다.']),
    ].join('\n');
  }

  function sortProjects(projectList) {
    const sortValue = dom.sortProjects.value;
    const sortedProjects = [...projectList];

    sortedProjects.sort((left, right) => {
      if (sortValue === 'attention') {
        const radarDelta = getProjectRadar(right).score - getProjectRadar(left).score;
        if (radarDelta !== 0) {
          return radarDelta;
        }

        const ageDelta = (getProjectRadar(right).ageDays ?? Number.MAX_SAFE_INTEGER) - (getProjectRadar(left).ageDays ?? Number.MAX_SAFE_INTEGER);
        if (ageDelta !== 0) {
          return ageDelta;
        }
      }

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
    const attentionCount = currentProjects.filter((project) => getProjectRadar(project).severity === 'attention').length;

    dom.statTotal.textContent = currentProjects.length;
    dom.statAttention.textContent = attentionCount;
    dom.statActive.textContent = activeCount;
    dom.statDomains.textContent = totalDomains;
    updateToolbarSummary(currentProjects.length, safeProjectList.length);
    setToolbarActionsEnabled(safeProjectList.length > 0);

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
      const radar = getProjectRadar(project);
      const domains = project.domains || [];
      const framework = project.framework || '';
      const deployedAt = project.latest_deployment?.created_on;
      const primaryUrl = getPrimaryUrl(project);
      const description = project._description || '';
      const displayUrl = primaryUrl ? primaryUrl.replace(/^https?:\/\//, '') : '연결된 주소 없음';
      const isFavorite = isFavoriteProject(project.name);
      const isWorker = project._type === 'worker';
      const meta = [
        `<span class="card__tag card__tag--${radar.severity}">${escapeHtml(radar.label)}</span>`,
        isWorker ? '<span class="card__tag card__tag--worker">Worker</span>' : '',
        framework ? `<span class="card__tag">${escapeHtml(framework)}</span>` : '',
        domains.length > 0 ? `<span class="card__tag">${domains.length}개 도메인</span>` : '<span class="card__tag card__tag--muted">도메인 미연결</span>',
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
          <p class="card__signal">${escapeHtml(radar.summary)}</p>
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

    renderRadar(currentProjects);

    renderProjects(getVisibleProjects());
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

  async function handleCopyReport() {
    const visibleProjects = getVisibleProjects();
    if (visibleProjects.length === 0) {
      showToast('복사할 프로젝트가 없습니다.', 'error');
      return;
    }

    try {
      await copyText(buildStatusReport(visibleProjects));
      showToast(`현재 목록 ${visibleProjects.length}개를 보고서로 복사했습니다.`, 'success');
    } catch (error) {
      showToast(error.message || '보고서 복사에 실패했습니다.', 'error');
    }
  }

  function handleExportCsv() {
    const visibleProjects = getVisibleProjects();
    if (visibleProjects.length === 0) {
      showToast('내보낼 프로젝트가 없습니다.', 'error');
      return;
    }

    const filename = `jacehub-projects-${createExportTimestamp()}.csv`;
    const csvContent = buildProjectsCsv(visibleProjects);
    downloadTextFile(filename, csvContent, 'text/csv;charset=utf-8');
    showToast(`현재 목록 ${visibleProjects.length}개를 CSV로 내보냈습니다.`, 'success');
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

  function handleRadarClick(event) {
    const filterButton = event.target.closest('[data-radar-filter]');
    if (!filterButton) return;

    const nextFilter = filterButton.getAttribute('data-radar-filter') || 'all';
    activeRadarFilter = activeRadarFilter === nextFilter && nextFilter !== 'all'
      ? 'all'
      : nextFilter;
    renderDashboard();
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
    dom.btnCopyReport.addEventListener('click', handleCopyReport);
    dom.btnExportCsv.addEventListener('click', handleExportCsv);
    dom.projectGrid.addEventListener('click', handleGridClick);
    dom.radarChips.addEventListener('click', handleRadarClick);
    dom.inputSearch.addEventListener('input', renderDashboard);
    dom.filterStatus.addEventListener('change', renderDashboard);

    // Vault events
    dom.vaultTabLoad.addEventListener('click', () => switchVaultTab('load'));
    dom.vaultTabSave.addEventListener('click', () => switchVaultTab('save'));
    dom.btnVaultLoad.addEventListener('click', handleVaultLoad);
    dom.btnVaultSave.addEventListener('click', handleVaultSave);
    dom.btnVaultUpdate.addEventListener('click', handleVaultUpdate);
    dom.btnVaultDelete.addEventListener('click', handleVaultDelete);
    dom.btnVaultCopy.addEventListener('click', handleVaultCopy);
    dom.sortProjects.addEventListener('change', renderDashboard);

    document.addEventListener('keydown', handleDocumentKeydown);
    window.addEventListener('beforeunload', () => activeFetchController?.abort());
  }

  // ── Init ──
  function init() {
    bindEvents();
    setToolbarActionsEnabled(false);
    loadProjects();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
