// Cloudflare Pages Function — Credential Vault
// Stores encrypted credentials in KV, keyed directly by a 6-digit PIN.
// Route: /api/vault
//
// NOTE: A 6-digit PIN provides only ~1M combinations of entropy and there is
// no per-identifier isolation, so a determined attacker can brute-force the
// entire key space. This is acceptable for a non-public personal dashboard
// but must be revisited before any wider shipping.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const PBKDF2_ITERATIONS = 100_000;
const VAULT_TTL_SECONDS = 365 * 24 * 60 * 60; // 1 year

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

function bufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

async function deriveKey(pin, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptCredentials(pin, credentials) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pin, salt);

  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(credentials));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  return {
    salt: bufferToBase64(salt),
    iv: bufferToBase64(iv),
    data: bufferToBase64(ciphertext),
  };
}

async function decryptCredentials(pin, vault) {
  const salt = base64ToBuffer(vault.salt);
  const iv = base64ToBuffer(vault.iv);
  const ciphertext = base64ToBuffer(vault.data);
  const key = await deriveKey(pin, new Uint8Array(salt));

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    ciphertext
  );

  const decoder = new TextDecoder();
  return JSON.parse(decoder.decode(plaintext));
}

function validatePin(pin) {
  return typeof pin === 'string' && /^\d{6}$/.test(pin);
}

// 로비 스냅샷 봉투 정규화 — 유효한 cache/meta만 남기고, 둘 다 없으면 null.
export function normalizeLobby(lobby) {
  if (!lobby || typeof lobby !== 'object' || Array.isArray(lobby)) return null;
  const out = {};
  const { cache, meta } = lobby;
  if (cache && typeof cache === 'object' && !Array.isArray(cache) && Array.isArray(cache.apps)) {
    out.cache = { savedAt: Number(cache.savedAt) || 0, apps: cache.apps };
  }
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    out.meta = meta;
  }
  return out.cache || out.meta ? out : null;
}

function kvKeyForPin(pin) {
  return `vault:pin:${pin}`;
}

export async function onRequest(context) {
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const { VAULT } = context.env;
  if (!VAULT) {
    return jsonResponse(
      { success: false, errors: [{ message: 'Vault KV binding is not configured' }] },
      { status: 500 }
    );
  }

  const method = context.request.method;

  // ── POST: Create or overwrite vault (keyed by PIN) ──
  if (method === 'POST') {
    let body;
    try {
      body = await context.request.json();
    } catch {
      return jsonResponse(
        { success: false, errors: [{ message: '요청 본문을 파싱할 수 없습니다' }] },
        { status: 400 }
      );
    }

    const { pin, accountId, apiToken, ghToken, vercelToken, favorites, lobby } = body;

    if (!validatePin(pin)) {
      return jsonResponse(
        { success: false, errors: [{ message: 'PIN은 6자리 숫자여야 합니다' }] },
        { status: 400 }
      );
    }

    if (!accountId || !apiToken) {
      return jsonResponse(
        { success: false, errors: [{ message: 'Account ID와 API Token은 필수입니다' }] },
        { status: 400 }
      );
    }

    const kvKey = kvKeyForPin(pin);
    const existing = await VAULT.get(kvKey, 'json');

    const normalizedFavorites = Array.isArray(favorites)
      ? [...new Set(
          favorites
            .map((name) => (typeof name === 'string' ? name.trim() : ''))
            .filter(Boolean)
        )]
      : [];

    // 봉투는 통째로 덮어쓰기 방식 — lobby를 안 보낸 호출이 기존 스냅샷을
    // 지우지 않도록, 필드 부재 시 이전 봉투에서 이월한다.
    let lobbyEntry = normalizeLobby(lobby);
    if (lobby === undefined && existing) {
      try {
        const previous = await decryptCredentials(pin, existing);
        lobbyEntry = normalizeLobby(previous.lobby);
      } catch {
        lobbyEntry = null;
      }
    }

    const credentials = {
      accountId,
      apiToken,
      ghToken: ghToken || '',
      vercelToken: vercelToken || '',
      favorites: normalizedFavorites,
      ...(lobbyEntry ? { lobby: lobbyEntry } : {}),
    };
    const encrypted = await encryptCredentials(pin, credentials);

    const now = new Date().toISOString();
    const vaultEntry = {
      ...encrypted,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    await VAULT.put(kvKey, JSON.stringify(vaultEntry), { expirationTtl: VAULT_TTL_SECONDS });

    return jsonResponse({
      success: true,
      message: existing ? '보관소가 업데이트되었습니다' : '보관소가 생성되었습니다',
    });
  }

  // ── GET: Load credentials from vault ──
  if (method === 'GET') {
    const url = new URL(context.request.url);
    const pin = url.searchParams.get('pin');

    if (!validatePin(pin)) {
      return jsonResponse(
        { success: false, errors: [{ message: 'PIN은 6자리 숫자여야 합니다' }] },
        { status: 400 }
      );
    }

    const kvKey = kvKeyForPin(pin);
    const raw = await VAULT.get(kvKey, 'json');

    if (!raw) {
      return jsonResponse(
        { success: false, errors: [{ message: 'PIN과 일치하는 보관소가 없습니다' }] },
        { status: 404 }
      );
    }

    try {
      const credentials = await decryptCredentials(pin, raw);
      return jsonResponse({ success: true, credentials });
    } catch {
      return jsonResponse(
        { success: false, errors: [{ message: '크레덴셜 복호화에 실패했습니다' }] },
        { status: 500 }
      );
    }
  }

  // ── DELETE: Remove vault ──
  if (method === 'DELETE') {
    const url = new URL(context.request.url);
    const pin = url.searchParams.get('pin');

    if (!validatePin(pin)) {
      return jsonResponse(
        { success: false, errors: [{ message: 'PIN은 6자리 숫자여야 합니다' }] },
        { status: 400 }
      );
    }

    const kvKey = kvKeyForPin(pin);
    const raw = await VAULT.get(kvKey, 'json');

    if (!raw) {
      return jsonResponse(
        { success: false, errors: [{ message: 'PIN과 일치하는 보관소가 없습니다' }] },
        { status: 404 }
      );
    }

    // Verify the PIN can actually decrypt the vault before deleting.
    try {
      await decryptCredentials(pin, raw);
    } catch {
      return jsonResponse(
        { success: false, errors: [{ message: '크레덴셜 복호화에 실패했습니다' }] },
        { status: 500 }
      );
    }

    await VAULT.delete(kvKey);

    return jsonResponse({
      success: true,
      message: '보관소가 삭제되었습니다',
    });
  }

  return jsonResponse(
    { success: false, errors: [{ message: 'Method not allowed' }] },
    { status: 405, headers: { Allow: 'GET, POST, DELETE, OPTIONS' } }
  );
}
