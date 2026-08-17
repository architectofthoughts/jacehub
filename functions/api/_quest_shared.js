// 퀘스트 API 공통 유틸 — CORS, JSON 응답, PIN 검증, D1 가드.

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function json(body, init = {}) {
  return Response.json(body, {
    ...init,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

export function bad(message, status = 400) {
  return json({ ok: false, error: message }, { status });
}

export function uuid() {
  return crypto.randomUUID();
}

/** UTC ISO 타임스탬프 (원시 로그 occurred_at 용) */
export function nowIso() {
  return new Date().toISOString();
}

export function validatePin(pin) {
  return typeof pin === 'string' && /^\d{6}$/.test(pin);
}

/** env.DB 바인딩이 없으면 500 응답 반환, 있으면 null */
export function requireDb(env) {
  if (!env || !env.DB) {
    return json({ ok: false, error: 'D1 binding(DB) is not configured' }, { status: 500 });
  }
  return null;
}
