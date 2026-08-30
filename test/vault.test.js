import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/vault.js';

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
    size() {
      return store.size;
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

function deleteContext(env, pin) {
  return {
    env,
    request: new Request(`http://local/api/vault?pin=${pin}`, { method: 'DELETE' }),
  };
}

const BASE_BODY = {
  pin: '123456',
  accountId: 'acct',
  apiToken: 'token',
  favorites: ['jacemaster', 'jacefiles'],
};

test('POST → GET: 크레덴셜과 favorites가 왕복한다 (lobby 필드 없음)', async () => {
  const VAULT = fakeKV();
  const saved = await onRequest(postContext({ VAULT }, { ...BASE_BODY, ghToken: 'gh', vercelToken: 'vc' }));
  assert.equal((await saved.json()).success, true);

  const loaded = await onRequest(getContext({ VAULT }, BASE_BODY.pin));
  const data = await loaded.json();
  assert.equal(data.success, true);
  assert.deepEqual(data.credentials, {
    accountId: 'acct',
    apiToken: 'token',
    ghToken: 'gh',
    vercelToken: 'vc',
    favorites: ['jacemaster', 'jacefiles'],
  });
  assert.equal('lobby' in data.credentials, false, '봉투에 lobby 필드가 있으면 안 된다');
});

test('favorites는 trim·중복 제거·비문자 필터를 거친다', async () => {
  const VAULT = fakeKV();
  await onRequest(postContext({ VAULT }, { ...BASE_BODY, favorites: [' jacemaster ', 'jacemaster', '', 42, null, 'jacefiles'] }));
  const data = await (await onRequest(getContext({ VAULT }, BASE_BODY.pin))).json();
  assert.deepEqual(data.credentials.favorites, ['jacemaster', 'jacefiles']);
});

test('favorites를 안 보내면 빈 배열로 저장된다', async () => {
  const VAULT = fakeKV();
  const { favorites, ...withoutFavorites } = BASE_BODY;
  await onRequest(postContext({ VAULT }, withoutFavorites));
  const data = await (await onRequest(getContext({ VAULT }, BASE_BODY.pin))).json();
  assert.deepEqual(data.credentials.favorites, []);
});

test('구 클라이언트가 lobby 봉투를 실어 보내도 무시된다', async () => {
  const VAULT = fakeKV();
  const legacyLobby = {
    cache: { savedAt: 1000, apps: [{ name: 'jacehub', type: 'pages' }] },
    meta: { jacehub: { icon: '🏠', category: 'tool' } },
  };
  await onRequest(postContext({ VAULT }, { ...BASE_BODY, lobby: legacyLobby }));
  const data = await (await onRequest(getContext({ VAULT }, BASE_BODY.pin))).json();
  assert.equal(data.success, true);
  assert.equal(data.credentials.lobby, undefined);
  assert.deepEqual(data.credentials.favorites, BASE_BODY.favorites);
});

test('같은 PIN으로 다시 POST하면 통째로 덮어쓴다', async () => {
  const VAULT = fakeKV();
  const first = await (await onRequest(postContext({ VAULT }, BASE_BODY))).json();
  assert.equal(first.message, '보관소가 생성되었습니다');

  const second = await (await onRequest(postContext({ VAULT }, { ...BASE_BODY, favorites: ['weneedstress'] }))).json();
  assert.equal(second.message, '보관소가 업데이트되었습니다');

  const data = await (await onRequest(getContext({ VAULT }, BASE_BODY.pin))).json();
  assert.deepEqual(data.credentials.favorites, ['weneedstress']);
});

test('PIN 검증: 6자리 숫자가 아니면 400', async () => {
  const VAULT = fakeKV();
  const bad = await onRequest(postContext({ VAULT }, { ...BASE_BODY, pin: '12ab' }));
  assert.equal(bad.status, 400);
  const badGet = await onRequest(getContext({ VAULT }, '1234567'));
  assert.equal(badGet.status, 400);
});

test('Account ID / API Token 누락이면 400', async () => {
  const VAULT = fakeKV();
  const res = await onRequest(postContext({ VAULT }, { pin: '123456', accountId: 'acct' }));
  assert.equal(res.status, 400);
});

test('없는 PIN으로 GET하면 404', async () => {
  const VAULT = fakeKV();
  const res = await onRequest(getContext({ VAULT }, '999999'));
  assert.equal(res.status, 404);
});

test('DELETE: 올바른 PIN이면 보관소를 지우고, 이후 GET은 404', async () => {
  const VAULT = fakeKV();
  await onRequest(postContext({ VAULT }, BASE_BODY));
  const deleted = await (await onRequest(deleteContext({ VAULT }, BASE_BODY.pin))).json();
  assert.equal(deleted.success, true);
  assert.equal(VAULT.size(), 0);
  const after = await onRequest(getContext({ VAULT }, BASE_BODY.pin));
  assert.equal(after.status, 404);
});

test('VAULT 바인딩이 없으면 500', async () => {
  const res = await onRequest(postContext({}, BASE_BODY));
  assert.equal(res.status, 500);
});
