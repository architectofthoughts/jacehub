// Cloudflare Pages Function — API Proxy
// Proxies requests to the Cloudflare API to avoid CORS restrictions
// Route: /api/projects
export async function onRequest(context) {
  // Handle CORS preflight
  if (context.request.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-CF-Account-Id, X-CF-Api-Token',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  // Extract credentials from custom headers
  const accountId = context.request.headers.get('X-CF-Account-Id');
  const apiToken = context.request.headers.get('X-CF-Api-Token');

  if (!accountId || !apiToken) {
    return Response.json(
      { success: false, errors: [{ message: 'Account ID and API Token are required' }] },
      { status: 400 }
    );
  }

  try {
    const cfResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/pages/projects`,
      {
        headers: {
          'Authorization': `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const data = await cfResponse.json();

    return Response.json(data, {
      status: cfResponse.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
    });
  } catch (err) {
    return Response.json(
      { success: false, errors: [{ message: err.message }] },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } }
    );
  }
}
