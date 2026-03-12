// Cloudflare Pages Function — API Proxy
// Proxies requests to the Cloudflare API and enriches with GitHub descriptions
// Route: /api/projects
export async function onRequest(context) {
  // Handle CORS preflight
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-CF-Account-Id, X-CF-Api-Token, X-GH-Token',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  const accountId = context.request.headers.get('X-CF-Account-Id');
  const apiToken = context.request.headers.get('X-CF-Api-Token');
  const ghToken = context.request.headers.get('X-GH-Token') || '';

  if (!accountId || !apiToken) {
    return Response.json(
      { success: false, errors: [{ message: 'Account ID and API Token are required' }] },
      { status: 400 }
    );
  }

  const cfHeaders = {
    'Authorization': `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1. Fetch project list
    const listRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`,
      { headers: cfHeaders }
    );
    const listData = await listRes.json();

    if (!listRes.ok || !listData.result) {
      return Response.json(listData, {
        status: listRes.status,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    }

    // 2. Fetch full details for each project (includes source/GitHub info)
    const enriched = await Promise.all(
      listData.result.map(async (project) => {
        try {
          const detailRes = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project.name}`,
            { headers: cfHeaders }
          );
          const detailData = await detailRes.json();

          if (detailRes.ok && detailData.result) {
            const detail = detailData.result;

            // 3. If GitHub source exists, try to fetch description
            const owner = detail.source?.config?.owner;
            const repoName = detail.source?.config?.repo_name;

            if (owner && repoName) {
              try {
                const ghHeaders = { 'User-Agent': 'JaceHub/1.0' };
                if (ghToken) ghHeaders['Authorization'] = `Bearer ${ghToken}`;

                const ghRes = await fetch(
                  `https://api.github.com/repos/${owner}/${repoName}`,
                  { headers: ghHeaders }
                );
                if (ghRes.ok) {
                  const ghData = await ghRes.json();
                  detail._description = ghData.description || '';
                }
              } catch {
                // GitHub fetch failed, skip
              }
            }

            return detail;
          }
        } catch {
          // Detail fetch failed, return original
        }
        return project;
      })
    );

    return Response.json(
      { ...listData, result: enriched },
      { headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return Response.json(
      { success: false, errors: [{ message: err.message }] },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
