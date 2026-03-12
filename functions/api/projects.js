// Cloudflare Pages Function — API Proxy
// Enriches project list with GitHub descriptions
// Route: /api/projects
export async function onRequest(context) {
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

    // 2. Get GitHub username if token provided
    let ghUsername = '';
    if (ghToken) {
      try {
        const userRes = await fetch('https://api.github.com/user', {
          headers: { 'Authorization': `Bearer ${ghToken}`, 'User-Agent': 'JaceHub/1.0' },
        });
        if (userRes.ok) {
          const userData = await userRes.json();
          ghUsername = userData.login || '';
        }
      } catch { /* ignore */ }
    }

    // 3. Enrich projects with descriptions
    const ghHeaders = { 'User-Agent': 'JaceHub/1.0' };
    if (ghToken) ghHeaders['Authorization'] = `Bearer ${ghToken}`;

    const enriched = await Promise.all(
      listData.result.map(async (project) => {
        try {
          // First, try to get source info from project details
          const detailRes = await fetch(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects/${project.name}`,
            { headers: cfHeaders }
          );
          const detailData = await detailRes.json();
          const detail = (detailRes.ok && detailData.result) ? detailData.result : project;

          // Determine GitHub owner/repo
          let owner = detail.source?.config?.owner;
          let repoName = detail.source?.config?.repo_name;

          // Fallback: use ghUsername + project name
          if ((!owner || !repoName) && ghUsername) {
            owner = ghUsername;
            repoName = project.name;
          }

          // Fetch GitHub description
          if (owner && repoName) {
            try {
              const ghRes = await fetch(
                `https://api.github.com/repos/${owner}/${repoName}`,
                { headers: ghHeaders }
              );
              if (ghRes.ok) {
                const ghData = await ghRes.json();
                detail._description = ghData.description || '';
              }
            } catch { /* ignore */ }
          }

          return detail;
        } catch {
          return project;
        }
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
