import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, normalizeLobby } from '../functions/api/vault.js';

function fakeKV() {
  const store = new Map();
  return {
    async get(key, type) {
      const value = store.get(key);
      if (value === undefined) return null;
      return type === 'json' ? JSON.parse(value) : value;
    },
    async put(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

function postContext(env, body) {
  return {
    env,
    request: new Request('http://local/api/vault', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  };
}

function getContext(env, pin) {
  return {
    env,
    request: new Request(`http://local/api/vault?pin=${pin}`, { method: 'GET' }),
  };
}

const BASE_BODY = {
  pin: '123456',
  accountId: 'acct',
  apiToken: 'token',
  favorites: ['jacehub'],
};

const LOBBY = {
  cache: { savedAt: 1000, apps: [{ name: 'jacehub', type: 'pages' }] },
  meta: { jacehub: { icon: '🏠', category: 'tool' } },
};

test('normalizeLobby: 유효한 cache/meta만 남긴다', () => {
  assert.equal(normalizeLobby(undefined), null);
  assert.equal(normalizeLobby(null), null);
  assert.equal(normalizeLobby([]), null);
  assert.equal(normalizeLobby({ cache: { apps: 'oops' } }), null);
  assert.deepEqual(normalizeLobby(LOBBY), LOBBY);
  assert.deepEqual(
    normalizeLobby({ cache: { savedAt: 'NaN값', apps: [] }, junk: 1 }),
    { cache: { savedAt: 0, apps: [] } }
  );
});

test('POST에 lobby를 실으면 GET으로 돌아온다', async () => {
  const VAULT = fakeKV();
  const saved = await onRequest(postContext({ VAULT }, { ...BASE_BODY, lobby: LOBBY }));
  assert.equal((await saved.json()).success, true);

  const loaded = await onRequest(getContext({ VAULT }, BASE_BODY.pin));
  const data = await loaded.json();
  assert.equal(data.success, true);
  assert.deepEqual(data.credentials.lobby, LOBBY);
  assert.deepEqual(data.credentials.favorites, ['jacehub']);
});

test('lobby 없는 POST는 기존 스냅샷을 이월한다', async () => {
  const VAULT = fakeKV();
  await onRequest(postContext({ VAULT }, { ...BASE_BODY, lobby: LOBBY }));
  await onRequest(postContext({ VAULT }, { ...BASE_BODY, favorites: ['warren'] }));

  const loaded = await onRequest(getContext({ VAULT }, BASE_BODY.pin));
  const data = await loaded.json();
  assert.deepEqual(data.credentials.favorites, ['warren']);
  assert.deepEqual(data.credentials.lobby, LOBBY, 'lobby 필드 부재 시 이전 봉투에서 이월돼야 한다');
});

test('새 lobby를 실은 POST는 기존 스냅샷을 교체한다', async () => {
  const VAULT = fakeKV();
  await onRequest(postContext({ VAULT }, { ...BASE_BODY, lobby: LOBBY }));
  const newer = { cache: { savedAt: 2000, apps: [{ name: 'warren', type: 'service' }] } };
  await onRequest(postContext({ VAULT }, { ...BASE_BODY, lobby: newer }));

  const loaded = await onRequest(getContext({ VAULT }, BASE_BODY.pin));
  const data = await loaded.json();
  assert.deepEqual(data.credentials.lobby, newer);
});
