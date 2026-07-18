// Cloudflare Pages Function — API Proxy
// Enriches project list with GitHub descriptions
// Route: /api/projects
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-CF-Account-Id, X-CF-Api-Token, X-GH-Token, X-Vercel-Api-Token',
  'Access-Control-Max-Age': '86400',
};

const FETCH_TIMEOUT_MS = 8000;
const PROJECT_DETAIL_CONCURRENCY = 4;

// Self-hosted cockpit services (bani WSL 상주, CF Tunnel + Access 뒤).
// CF/Vercel API에는 안 잡히므로 여기서 직접 합류시킨다.
// 카드가 가리킬 URL을 강제하는 프로젝트별 오버라이드.
// mnemo: 프로덕션 apex는 Access 밖이라 스텁 전용 — 실데이터는 Access(OTP) 뒤 live 브랜치 별칭에만 있다.
const PROJECT_URL_OVERRIDES = {
  mnemo: 'live.mnemo-65c.pages.dev',
};

const SELF_HOSTED_SERVICES = [
  {
    name: 'warren',
    host: 'warren.lumilaboratory.cc',
    description: '3머신 tmux 에이전트 관제 콕핏 PWA (bani 허브 :8793)',
    tunnel: 'bani-cockpit',
  },
  {
    name: 'ccwatch',
    host: 'ccwatch.lumilaboratory.cc',
    description: '다계정 Claude Code usage 모니터 (bani 허브 :8790)',
    tunnel: 'bani-cockpit',
  },
];

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

function getErrorMessage(payload, fallback) {
  return payload?.errors?.[0]?.message || payload?.message || fallback;
}

function createGithubHeaders(ghToken) {
  const headers = { 'User-Agent': 'JaceHub/1.0' };
  if (ghToken) {
    headers.Authorization = `Bearer ${ghToken}`;
  }
  return headers;
}

async function fetchJson(url, init = {}, fallbackMessage = 'Request failed') {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(getErrorMessage(payload, fallbackMessage));
    }

    return { response, payload };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`${fallbackMessage} (timeout)`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker())
  );

  return results;
}

function normalizeWorkerScript(script, workersSubdomain) {
  const modifiedOn = script.modified_on || script.created_on || '';

  return {
    name: script.id,
    subdomain: workersSubdomain ? `${script.id}.${workersSubdomain}.workers.dev` : '',
    domains: [],
    latest_deployment: {
      created_on: modifiedOn,
      latest_stage: { status: 'success', name: 'deploy' },
    },
    source: {},
    framework: '',
    created_on: script.created_on || '',
    _type: 'worker',
  };
}

// 터널 상태 조회 (healthy|degraded|down|inactive). 토큰에 Cloudflare Tunnel:Read가
// 없으면 'unknown'으로 폴백 — 카드 자체는 항상 뜬다.
async function fetchTunnelStatuses(accountId, cfHeaders) {
  const statuses = new Map();
  const tunnelNames = [...new Set(SELF_HOSTED_SERVICES.map((service) => service.tunnel))];

  await Promise.all(tunnelNames.map(async (tunnelName) => {
    try {
      const { payload } = await fetchJson(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/cfd_tunnel?name=${encodeURIComponent(tunnelName)}&is_deleted=false`,
        { headers: cfHeaders },
        `터널 ${tunnelName} 상태를 불러오지 못했습니다`
      );
      const tunnel = Array.isArray(payload?.result) ? payload.result[0] : null;
      statuses.set(tunnelName, tunnel?.status || 'unknown');
    } catch {
      statuses.set(tunnelName, 'unknown');
    }
  }));

  return statuses;
}

function healthToStageStatus(health) {
  switch (health) {
    case 'healthy':
      return 'success';
    case 'down':
    case 'inactive':
      return 'failure';
    default:
      return 'active';
  }
}

function normalizeSelfHostedService(service, health) {
  return {
    name: service.name,
    subdomain: '',
    domains: [service.host],
    latest_deployment: health === 'unknown'
      ? { created_on: '', latest_stage: null }
      : { created_on: '', latest_stage: { status: healthToStageStatus(health), name: 'health' } },
    source: {},
    framework: '',
    created_on: '',
    _type: 'service',
    _description: service.description,
    _health: health,
  };
}

function epochMsToIso(value) {
  if (!value && value !== 0) return '';
  const ms = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return '';
  try {
    return new Date(ms).toISOString();
  } catch {
    return '';
  }
}

function vercelReadyStateToStageStatus(readyState) {
  switch (String(readyState || '').toUpperCase()) {
    case 'READY':
      return 'success';
    case 'ERROR':
    case 'CANCELED':
      return 'failure';
    case 'BUILDING':
    case 'INITIALIZING':
    case 'QUEUED':
      return 'active';
    default:
      return 'success';
  }
}

function normalizeVercelProject(project) {
  const production = project.targets?.production || project.latestDeployments?.[0] || {};
  const aliasList = Array.isArray(production.alias) ? production.alias : [];
  const productionHost = aliasList[0] || production.url || '';
  const customDomains = aliasList.filter((host) => host && !host.endsWith('.vercel.app'));

  const link = project.link || {};
  const sourceConfig =
    link.type === 'github' && link.org && link.repo
      ? { owner: link.org, repo_name: link.repo }
      : {};

  return {
    name: project.name,
    subdomain: productionHost,
    domains: customDomains,
    latest_deployment: {
      created_on: epochMsToIso(production.createdAt || production.created || project.updatedAt),
      latest_stage: {
        status: vercelReadyStateToStageStatus(production.readyState),
        name: 'deploy',
      },
    },
    source: { type: link.type === 'github' ? 'github' : '', config: sourceConfig },
    framework: project.framework || '',
    created_on: epochMsToIso(project.createdAt),
    _type: 'vercel',
  };
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (context.request.method !== 'GET') {
    return jsonResponse(
      { success: false, errors: [{ message: 'Method not allowed' }] },
      { status: 405, headers: { Allow: 'GET, OPTIONS' } }
    );
  }

  const accountId = context.request.headers.get('X-CF-Account-Id');
  const apiToken = context.request.headers.get('X-CF-Api-Token');
  const ghToken = context.request.headers.get('X-GH-Token') || '';
  const vercelToken = context.request.headers.get('X-Vercel-Api-Token') || '';

  if (!accountId || !apiToken) {
    return jsonResponse(
      { success: false, errors: [{ message: 'Account ID and API Token are required' }] },
      { status: 400 }
    );
  }

  const cfHeaders = {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
  };

  const vercelHeaders = vercelToken
    ? { Authorization: `Bearer ${vercelToken}`, 'Content-Type': 'application/json' }
    : null;

  try {
    // Fetch Pages projects, Workers scripts, Workers subdomain, and Vercel projects in parallel
    const vercelPromise = vercelHeaders
      ? fetchJson(
          'https://api.vercel.com/v9/projects?limit=100',
          { headers: vercelHeaders },
          'Vercel 프로젝트 목록을 불러오지 못했습니다'
        )
      : Promise.resolve({ payload: { projects: [] } });

    const tunnelStatusesPromise = fetchTunnelStatuses(accountId, cfHeaders);

    const [pagesResult, workersResult, subdomainResult, vercelResult] = await Promise.allSettled([
      fetchJson(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`,
        { headers: cfHeaders },
        'Cloudflare Pages 프로젝트 목록을 불러오지 못했습니다'
      ),
      fetchJson(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`,
        { headers: cfHeaders },
        'Workers 스크립트 목록을 불러오지 못했습니다'
      ),
      fetchJson(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
        { headers: cfHeaders },
        'Workers 서브도메인을 불러오지 못했습니다'
      ),
      vercelPromise,
    ]);

    const pagesError = pagesResult.status === 'rejected'
      ? (pagesResult.reason?.message || 'Pages 조회 실패')
      : '';

    const pagesList = pagesResult.status === 'fulfilled'
      ? (Array.isArray(pagesResult.value.payload?.result) ? pagesResult.value.payload.result : [])
      : [];

    const workersError = workersResult.status === 'rejected'
      ? (workersResult.reason?.message || 'Workers 조회 실패')
      : '';

    const rawWorkersList = workersResult.status === 'fulfilled'
      ? (Array.isArray(workersResult.value.payload?.result) ? workersResult.value.payload.result : [])
      : [];

    const workersSubdomain = subdomainResult.status === 'fulfilled'
      ? (subdomainResult.value.payload?.result?.subdomain || '')
      : '';

    const vercelError = vercelToken && vercelResult.status === 'rejected'
      ? (vercelResult.reason?.message || 'Vercel 조회 실패')
      : '';

    const rawVercelList = vercelResult.status === 'fulfilled'
      ? (Array.isArray(vercelResult.value.payload?.projects) ? vercelResult.value.payload.projects : [])
      : [];

    if (pagesError && workersError) {
      throw new Error(pagesError);
    }

    // Exclude Workers that share a name with a Pages project (same project, different view)
    const pagesNames = new Set(pagesList.map((p) => p.name));
    const workersList = rawWorkersList
      .filter((script) => !pagesNames.has(script.id))
      .map((script) => normalizeWorkerScript(script, workersSubdomain));

    const vercelList = rawVercelList.map((project) => normalizeVercelProject(project));

    // Enrich Pages projects with detail data
    const enrichedPages = await mapWithConcurrency(pagesList, PROJECT_DETAIL_CONCURRENCY, async (project) => {
      let detail = project;

      try {
        const { payload: detailData } = await fetchJson(
          `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${encodeURIComponent(project.name)}`,
          { headers: cfHeaders },
          `프로젝트 ${project.name} 상세 정보를 불러오지 못했습니다`
        );
        if (detailData?.result) {
          detail = detailData.result;
        }
      } catch {
        // Fall back to the list payload when detail lookup fails.
      }

      detail._type = 'pages';
      const overrideHost = PROJECT_URL_OVERRIDES[detail.name];
      if (overrideHost) {
        detail.domains = [overrideHost, ...(detail.domains || []).filter((d) => d !== overrideHost)];
      }
      return detail;
    });

    // Self-hosted 서비스 합류 (터널 헬스 배지 포함)
    const tunnelStatuses = await tunnelStatusesPromise;
    const serviceList = SELF_HOSTED_SERVICES.map((service) =>
      normalizeSelfHostedService(service, tunnelStatuses.get(service.tunnel) || 'unknown')
    );

    // Merge Pages + Workers + Vercel + Self-hosted, then enrich with GitHub descriptions
    const allProjects = [...enrichedPages, ...workersList, ...vercelList, ...serviceList];
    const repoDescriptionCache = new Map();
    let ghUsernamePromise = null;

    async function getGithubUsername() {
      if (!ghToken) return '';
      if (!ghUsernamePromise) {
        ghUsernamePromise = fetchJson(
          'https://api.github.com/user',
          { headers: createGithubHeaders(ghToken) },
          'GitHub 사용자 정보를 불러오지 못했습니다'
        )
          .then(({ payload }) => payload?.login || '')
          .catch(() => '');
      }
      return ghUsernamePromise;
    }

    const enriched = await mapWithConcurrency(allProjects, PROJECT_DETAIL_CONCURRENCY, async (project) => {
      if (project._type === 'service') {
        return project;
      }

      let owner = project.source?.config?.owner || '';
      let repoName = project.source?.config?.repo_name || '';

      if ((!owner || !repoName) && ghToken) {
        owner = await getGithubUsername();
        repoName = project.name;
      }

      if (!owner || !repoName) {
        return project;
      }

      const repoKey = `${owner}/${repoName}`.toLowerCase();
      if (!repoDescriptionCache.has(repoKey)) {
        repoDescriptionCache.set(
          repoKey,
          fetchJson(
            `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`,
            { headers: createGithubHeaders(ghToken) },
            `GitHub 저장소 ${owner}/${repoName}를 불러오지 못했습니다`
          )
            .then(({ payload }) => payload?.description || '')
            .catch(() => '')
        );
      }

      project._description = await repoDescriptionCache.get(repoKey);
      return project;
    });

    const meta = {
      pagesCount: enrichedPages.length,
      workersCount: workersList.length,
      vercelCount: vercelList.length,
      servicesCount: serviceList.length,
    };
    if (pagesError) {
      meta.pagesError = pagesError;
    }
    if (workersError) {
      meta.workersError = workersError;
    }
    if (vercelError) {
      meta.vercelError = vercelError;
    }

    return jsonResponse({ success: true, result: enriched, _meta: meta });
  } catch (error) {
    return jsonResponse(
      { success: false, errors: [{ message: error.message || 'Unexpected error' }] },
      { status: 500 }
    );
  }
}
