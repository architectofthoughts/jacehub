// Cloudflare Pages Function — Credential Vault
// Stores encrypted credentials in KV, protected by a 6-digit PIN
// Route: /api/vault
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

const PBKDF2_ITERATIONS = 100_000;
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 10 * 60 * 1000;
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

function generateUUID() {
  return crypto.randomUUID();
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

async function hashPin(pin, salt) {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin + ':' + bufferToBase64(salt));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return bufferToBase64(hash);
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

  const pinHash = await hashPin(pin, salt);

  return {
    pinHash,
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

function isLockedOut(vault) {
  if (!vault.lockoutUntil) return false;
  return Date.now() < vault.lockoutUntil;
}

function validatePin(pin) {
  return typeof pin === 'string' && /^\d{6}$/.test(pin);
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

  // ── POST: Create or update vault ──
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

    const { pin, accountId, apiToken, ghToken, vaultId: existingVaultId, existingPin } = body;

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

    // If updating existing vault, verify old PIN first
    if (existingVaultId) {
      const kvKey = `vault:${existingVaultId}`;
      const raw = await VAULT.get(kvKey, 'json');

      if (!raw) {
        return jsonResponse(
          { success: false, errors: [{ message: '보관소를 찾을 수 없습니다' }] },
          { status: 404 }
        );
      }

      if (isLockedOut(raw)) {
        const remainMs = raw.lockoutUntil - Date.now();
        const remainMin = Math.ceil(remainMs / 60_000);
        return jsonResponse(
          { success: false, errors: [{ message: `너무 많은 시도로 잠겼습니다. ${remainMin}분 후 다시 시도하세요.` }] },
          { status: 429 }
        );
      }

      if (!validatePin(existingPin)) {
        return jsonResponse(
          { success: false, errors: [{ message: '기존 PIN을 입력해주세요' }] },
          { status: 400 }
        );
      }

      const existingSalt = base64ToBuffer(raw.salt);
      const existingPinHash = await hashPin(existingPin, new Uint8Array(existingSalt));

      if (existingPinHash !== raw.pinHash) {
        const attempts = (raw.failedAttempts || 0) + 1;
        const update = { ...raw, failedAttempts: attempts };

        if (attempts >= MAX_PIN_ATTEMPTS) {
          update.lockoutUntil = Date.now() + LOCKOUT_DURATION_MS;
          update.failedAttempts = 0;
        }

        await VAULT.put(kvKey, JSON.stringify(update), { expirationTtl: VAULT_TTL_SECONDS });

        const remaining = MAX_PIN_ATTEMPTS - attempts;
        return jsonResponse(
          { success: false, errors: [{ message: remaining > 0 ? `PIN이 일치하지 않습니다. 남은 시도: ${remaining}회` : '너무 많은 시도로 잠겼습니다. 10분 후 다시 시도하세요.' }] },
          { status: 401 }
        );
      }
    }

    const credentials = { accountId, apiToken, ghToken: ghToken || '' };
    const encrypted = await encryptCredentials(pin, credentials);

    const vaultId = existingVaultId || generateUUID();
    const kvKey = `vault:${vaultId}`;

    const vaultEntry = {
      ...encrypted,
      failedAttempts: 0,
      lockoutUntil: null,
      createdAt: existingVaultId ? undefined : new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await VAULT.put(kvKey, JSON.stringify(vaultEntry), { expirationTtl: VAULT_TTL_SECONDS });

    return jsonResponse({
      success: true,
      vaultId,
      message: existingVaultId ? '보관소가 업데이트되었습니다' : '보관소가 생성되었습니다',
    });
  }

  // ── GET: Load credentials from vault ──
  if (method === 'GET') {
    const url = new URL(context.request.url);
    const vaultId = url.searchParams.get('id');
    const pin = url.searchParams.get('pin');

    if (!vaultId) {
      return jsonResponse(
        { success: false, errors: [{ message: '보관소 ID가 필요합니다' }] },
        { status: 400 }
      );
    }

    if (!validatePin(pin)) {
      return jsonResponse(
        { success: false, errors: [{ message: 'PIN은 6자리 숫자여야 합니다' }] },
        { status: 400 }
      );
    }

    const kvKey = `vault:${vaultId}`;
    const raw = await VAULT.get(kvKey, 'json');

    if (!raw) {
      return jsonResponse(
        { success: false, errors: [{ message: '보관소를 찾을 수 없습니다' }] },
        { status: 404 }
      );
    }

    if (isLockedOut(raw)) {
      const remainMs = raw.lockoutUntil - Date.now();
      const remainMin = Math.ceil(remainMs / 60_000);
      return jsonResponse(
        { success: false, errors: [{ message: `너무 많은 시도로 잠겼습니다. ${remainMin}분 후 다시 시도하세요.` }] },
        { status: 429 }
      );
    }

    const salt = base64ToBuffer(raw.salt);
    const pinHash = await hashPin(pin, new Uint8Array(salt));

    if (pinHash !== raw.pinHash) {
      const attempts = (raw.failedAttempts || 0) + 1;
      const update = { ...raw, failedAttempts: attempts };

      if (attempts >= MAX_PIN_ATTEMPTS) {
        update.lockoutUntil = Date.now() + LOCKOUT_DURATION_MS;
        update.failedAttempts = 0;
      }

      await VAULT.put(kvKey, JSON.stringify(update), { expirationTtl: VAULT_TTL_SECONDS });

      const remaining = MAX_PIN_ATTEMPTS - attempts;
      return jsonResponse(
        { success: false, errors: [{ message: remaining > 0 ? `PIN이 일치하지 않습니다. 남은 시도: ${remaining}회` : '너무 많은 시도로 잠겼습니다. 10분 후 다시 시도하세요.' }] },
        { status: 401 }
      );
    }

    try {
      const credentials = await decryptCredentials(pin, raw);

      // Reset failed attempts on success
      if (raw.failedAttempts > 0) {
        const updated = { ...raw, failedAttempts: 0, lockoutUntil: null };
        await VAULT.put(kvKey, JSON.stringify(updated), { expirationTtl: VAULT_TTL_SECONDS });
      }

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
    const vaultId = url.searchParams.get('id');
    const pin = url.searchParams.get('pin');

    if (!vaultId) {
      return jsonResponse(
        { success: false, errors: [{ message: '보관소 ID가 필요합니다' }] },
        { status: 400 }
      );
    }

    if (!validatePin(pin)) {
      return jsonResponse(
        { success: false, errors: [{ message: 'PIN은 6자리 숫자여야 합니다' }] },
        { status: 400 }
      );
    }

    const kvKey = `vault:${vaultId}`;
    const raw = await VAULT.get(kvKey, 'json');

    if (!raw) {
      return jsonResponse(
        { success: false, errors: [{ message: '보관소를 찾을 수 없습니다' }] },
        { status: 404 }
      );
    }

    if (isLockedOut(raw)) {
      const remainMs = raw.lockoutUntil - Date.now();
      const remainMin = Math.ceil(remainMs / 60_000);
      return jsonResponse(
        { success: false, errors: [{ message: `너무 많은 시도로 잠겼습니다. ${remainMin}분 후 다시 시도하세요.` }] },
        { status: 429 }
      );
    }

    const salt = base64ToBuffer(raw.salt);
    const pinHash = await hashPin(pin, new Uint8Array(salt));

    if (pinHash !== raw.pinHash) {
      const attempts = (raw.failedAttempts || 0) + 1;
      const update = { ...raw, failedAttempts: attempts };

      if (attempts >= MAX_PIN_ATTEMPTS) {
        update.lockoutUntil = Date.now() + LOCKOUT_DURATION_MS;
        update.failedAttempts = 0;
      }

      await VAULT.put(kvKey, JSON.stringify(update), { expirationTtl: VAULT_TTL_SECONDS });

      const remaining = MAX_PIN_ATTEMPTS - attempts;
      return jsonResponse(
        { success: false, errors: [{ message: remaining > 0 ? `PIN이 일치하지 않습니다. 남은 시도: ${remaining}회` : '너무 많은 시도로 잠겼습니다. 10분 후 다시 시도하세요.' }] },
        { status: 401 }
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
