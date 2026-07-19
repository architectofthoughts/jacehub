# jacehub 퀘스트 시스템 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** jacehub에서 즐겨찾기 앱별 데일리 퀘스트를 정의하고, 각 앱의 행동을 Push로 받아 자동 카운트하며, 오늘 현황·스트릭·잔디를 별도 페이지에서 확인한다.

**Architecture:** Cloudflare Pages Functions(`/api/ingest`·`/api/quests`·`/api/progress`)가 신규 D1(`jacehub-db`)을 읽고 쓴다. 순수 로직(KST 날짜·이벤트 매칭·스트릭)은 `lib/quest-logic.js`로 분리해 `node --test`로 검증한다. 프론트는 `lobby` 패턴을 따른 별도 페이지(`quests.html`). 파일럿으로 rituall의 아침/저녁 의식 저장 Function에서 fire-and-forget으로 이벤트를 쏜다.

**Tech Stack:** Cloudflare Pages + Pages Functions, D1(SQLite), Vanilla JS (ES modules), node 내장 test runner. 인증은 기존 6자리 PIN 원본 재사용(개인용).

**Spec:** `docs/superpowers/specs/2026-05-31-quest-system-design.md`

---

## 파일 구조

생성/수정할 파일과 책임:

| 파일 | 종류 | 책임 |
|---|---|---|
| `wrangler.toml` | 생성 | Pages 빌드 설정 + D1(`jacehub-db`) 바인딩 `DB` |
| `schema.sql` | 생성 | `quests` / `quest_events` / `daily_progress` 스키마 |
| `lib/quest-logic.js` | 생성 | 순수 로직: `kstDateOf` / `questMatches` / `computeStreak` |
| `test/quest-logic.test.js` | 생성 | 위 순수 로직 단위 테스트 (node:test) |
| `functions/api/_quest_shared.js` | 생성 | CORS·`json`·`uuid`·`nowKstIso`·`validatePin`·`requireDb` |
| `functions/api/quests.js` | 생성 | 퀘스트 CRUD (GET/POST/PUT/DELETE) |
| `functions/api/ingest.js` | 생성 | 이벤트 수집 → 원시 적재 + 일별 집계 |
| `functions/api/progress.js` | 생성 | 오늘 현황 + 스트릭 + 기간 통계 |
| `quests.html` / `quests.css` / `quests.js` | 생성 | 별도 퀘스트 페이지 (lobby 패턴) |
| `index.html` | 수정 | 퀘스트 페이지 진입 링크 추가 |
| `scripts/build.mjs` | 수정 | 신규 정적/함수 파일을 빌드 화이트리스트에 등록 |
| `package.json` | 수정 | `test` 스크립트 추가 |
| `rituall/js/jacehub-quest.js` | 생성 | 서버용 fire-and-forget 헬퍼 |
| `rituall/functions/api/rituals/morning.js` | 수정 | 저장 성공 후 `morning_ritual` 보고 |
| `rituall/functions/api/rituals/evening.js` | 수정 | 저장 성공 후 `evening_ritual` 보고 |

규약:
- 날짜 기준 **Asia/Seoul**. 기존 rituall `_shared.js`의 `todayKst` 방식(UTC+9 후 slice)을 그대로 따른다.
- 퀘스트 Functions는 jacehub 기존 `vault.js` 스타일(`onRequest(context)` + CORS + `Response.json`)을 따른다.
- D1 바인딩 이름은 rituall과 동일하게 **`DB`**.

---

## Phase 1 — jacehub 퀘스트 코어

### Task 1: D1·스키마·빌드 설정

**Files:**
- Create: `wrangler.toml`
- Create: `schema.sql`
- Modify: `scripts/build.mjs`
- Modify: `package.json`

- [ ] **Step 1: `wrangler.toml` 생성**

```toml
name = "jacehub"
compatibility_date = "2026-05-25"
pages_build_output_dir = "dist"

[[d1_databases]]
binding = "DB"
database_name = "jacehub-db"
database_id = "PLACEHOLDER_FILL_AFTER_CREATE"
```

> `pages_build_output_dir`은 jacehub의 빌드 산출물 폴더 `dist` 기준(build.mjs가 `dist/`로 복사함). 배포 명령이 `wrangler pages deploy .`이면 루트가 아니라 빌드 결과를 올리도록 추후 `dist`를 배포하거나, 현 배포 방식 유지 시 `pages_build_output_dir`만 메타로 둔다. (Task 8에서 배포 경로 확인)

- [ ] **Step 2: D1 DB 생성**

Run:
```bash
cd /mnt/e/Workspace/Projects/jacehub
npx wrangler d1 create jacehub-db
```
Expected: `database_id = "..."` 출력. 그 값을 `wrangler.toml`의 `PLACEHOLDER_FILL_AFTER_CREATE`에 붙여넣는다.

- [ ] **Step 3: `schema.sql` 생성**

```sql
-- jacehub 퀘스트 시스템 스키마
-- Run(local):  npx wrangler d1 execute jacehub-db --local  --file schema.sql
-- Run(remote): npx wrangler d1 execute jacehub-db --remote --file schema.sql

CREATE TABLE IF NOT EXISTS quests (
  id           TEXT PRIMARY KEY,
  pin          TEXT NOT NULL,
  app_name     TEXT NOT NULL,
  title        TEXT NOT NULL,
  event_type   TEXT,
  target_count INTEGER NOT NULL DEFAULT 1,
  active       INTEGER NOT NULL DEFAULT 1,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quests_pin   ON quests(pin, active);
CREATE INDEX IF NOT EXISTS idx_quests_match ON quests(pin, app_name, active);

CREATE TABLE IF NOT EXISTS quest_events (
  id          TEXT PRIMARY KEY,
  pin         TEXT NOT NULL,
  app_name    TEXT NOT NULL,
  event_type  TEXT,
  occurred_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_pin_app ON quest_events(pin, app_name, occurred_at);

CREATE TABLE IF NOT EXISTS daily_progress (
  quest_id     TEXT NOT NULL,
  date         TEXT NOT NULL,
  count        INTEGER NOT NULL DEFAULT 0,
  completed    INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  PRIMARY KEY (quest_id, date)
);
CREATE INDEX IF NOT EXISTS idx_progress_date ON daily_progress(date);
```

- [ ] **Step 4: 로컬 스키마 적용**

Run:
```bash
npx wrangler d1 execute jacehub-db --local --file schema.sql
```
Expected: 3개 테이블 생성 성공 메시지.

- [ ] **Step 5: `scripts/build.mjs` 화이트리스트에 신규 파일 등록**

`staticEntries`와 `functionEntries` 배열을 아래로 교체한다.

```js
const staticEntries = ['index.html', 'style.css', 'app.js', 'lobby.html', 'lobby.css', 'lobby.js', 'quests.html', 'quests.css', 'quests.js'];
const functionEntries = ['functions/api/projects.js', 'functions/api/vault.js', 'functions/api/_quest_shared.js', 'functions/api/quests.js', 'functions/api/ingest.js', 'functions/api/progress.js'];
```

`lobbyHtml` 검증 블록 바로 아래에 `quests.html` 검증을 추가한다.

```js
  const questsHtml = await readFile(path.join(rootDir, 'quests.html'), 'utf8');
  if (!questsHtml.includes('quests.css') || !questsHtml.includes('quests.js')) {
    throw new Error('quests.html must reference quests.css and quests.js');
  }
```

> 참고: `assertNodeCheck`는 `['app.js', 'lobby.js', ...functionEntries]`만 검사한다. `quests.js`도 검사 대상에 넣으려면 그 배열에 `'quests.js'`를 추가한다.

- [ ] **Step 6: `package.json`에 test 스크립트 추가**

`scripts`에 추가:
```json
"test": "node --test test/"
```

- [ ] **Step 7: 빌드가 깨지지 않는지 확인 (신규 파일 아직 없어 실패 예상)**

Run: `npm run build`
Expected: `quests.html` 등 미존재 파일로 인해 실패 — Task 7까지 가면 통과. 지금은 wrangler.toml/schema.sql/build.mjs/package.json 변경만 커밋.

- [ ] **Step 8: 커밋**

```bash
git add wrangler.toml schema.sql scripts/build.mjs package.json
git commit -m "chore: add D1 binding, quest schema, build whitelist for quest system"
```

---

### Task 2: 순수 로직 라이브러리 (TDD)

**Files:**
- Create: `test/quest-logic.test.js`
- Create: `lib/quest-logic.js`

- [ ] **Step 1: 실패하는 테스트 작성**

`test/quest-logic.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kstDateOf, questMatches, computeStreak } from '../lib/quest-logic.js';

test('kstDateOf: UTC 15:00은 다음날 서울 0시이므로 +1일', () => {
  // 2026-05-31T15:00:00Z === 2026-06-01 00:00 KST
  assert.equal(kstDateOf('2026-05-31T15:00:00Z'), '2026-06-01');
});

test('kstDateOf: UTC 14:59는 같은날 서울 23:59', () => {
  assert.equal(kstDateOf('2026-05-31T14:59:00Z'), '2026-05-31');
});

test('questMatches: event_type 없는 퀘스트는 같은 앱 아무 이벤트나 매칭', () => {
  const q = { app_name: 'rituall', event_type: null };
  assert.equal(questMatches(q, 'rituall', 'morning_ritual'), true);
  assert.equal(questMatches(q, 'rituall', null), true);
  assert.equal(questMatches(q, 'transparenty', 'x'), false);
});

test('questMatches: event_type 지정 퀘스트는 타입까지 같아야 매칭', () => {
  const q = { app_name: 'rituall', event_type: 'evening_ritual' };
  assert.equal(questMatches(q, 'rituall', 'evening_ritual'), true);
  assert.equal(questMatches(q, 'rituall', 'morning_ritual'), false);
});

test('computeStreak: 오늘부터 연속 클리어 일수', () => {
  const dates = ['2026-05-31', '2026-05-30', '2026-05-29', '2026-05-27'];
  assert.equal(computeStreak(dates, '2026-05-31'), 3);
});

test('computeStreak: 오늘 미클리어여도 어제까지 이어지면 어제 기준 연속 인정', () => {
  const dates = ['2026-05-30', '2026-05-29'];
  assert.equal(computeStreak(dates, '2026-05-31'), 2);
});

test('computeStreak: 어제도 오늘도 없으면 0', () => {
  assert.equal(computeStreak(['2026-05-28'], '2026-05-31'), 0);
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/quest-logic.js'`.

- [ ] **Step 3: `lib/quest-logic.js` 최소 구현**

```js
// 순수 로직 — Cloudflare 런타임 API 비의존. node:test로 검증 가능.

const KST_OFFSET_MS = 9 * 3600 * 1000;

/** ISO 문자열/ms를 Asia/Seoul 기준 'YYYY-MM-DD'로 변환 */
export function kstDateOf(input) {
  const ms = typeof input === 'number' ? input : Date.parse(input);
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 퀘스트가 (앱, 이벤트타입) 이벤트와 매칭되는지.
 *  event_type이 falsy면 같은 앱의 모든 이벤트와 매칭(앱 단위). */
export function questMatches(quest, app, eventType) {
  if (quest.app_name !== app) return false;
  if (!quest.event_type) return true;
  return quest.event_type === eventType;
}

/** completed=1인 날짜 배열(순서 무관)에서, today 또는 어제부터 이어지는 연속 일수.
 *  오늘이 비어 있어도 어제까지 이어지면 그 길이를 인정(아직 오늘 안 한 것일 뿐). */
export function computeStreak(completedDates, today) {
  const set = new Set(completedDates);
  const dayMs = 24 * 3600 * 1000;
  const todayMs = Date.parse(`${today}T00:00:00Z`);

  // 시작점: 오늘이 있으면 오늘, 없고 어제가 있으면 어제, 둘 다 없으면 0
  let cursor;
  if (set.has(today)) {
    cursor = todayMs;
  } else if (set.has(new Date(todayMs - dayMs).toISOString().slice(0, 10))) {
    cursor = todayMs - dayMs;
  } else {
    return 0;
  }

  let streak = 0;
  while (set.has(new Date(cursor).toISOString().slice(0, 10))) {
    streak += 1;
    cursor -= dayMs;
  }
  return streak;
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

Run: `npm test`
Expected: PASS — 7개 테스트 통과.

- [ ] **Step 5: 커밋**

```bash
git add lib/quest-logic.js test/quest-logic.test.js
git commit -m "feat: add pure quest logic (kst date, event matching, streak) with tests"
```

---

### Task 3: 공유 헬퍼

**Files:**
- Create: `functions/api/_quest_shared.js`

- [ ] **Step 1: `_quest_shared.js` 작성**

```js
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
```

- [ ] **Step 2: 구문 검사**

Run: `node --check functions/api/_quest_shared.js`
Expected: 출력 없음(성공).

- [ ] **Step 3: 커밋**

```bash
git add functions/api/_quest_shared.js
git commit -m "feat: add shared helpers for quest API"
```

---

### Task 4: 퀘스트 CRUD API

**Files:**
- Create: `functions/api/quests.js`

- [ ] **Step 1: `quests.js` 작성**

```js
// Cloudflare Pages Function — 퀘스트 CRUD
// Route: /api/quests
import { CORS_HEADERS, json, bad, uuid, nowIso, validatePin, requireDb } from './_quest_shared.js';

function serializeQuest(row) {
  return {
    id: row.id,
    app_name: row.app_name,
    title: row.title,
    event_type: row.event_type || null,
    target_count: row.target_count,
    active: !!row.active,
    sort_order: row.sort_order,
    created_at: row.created_at,
  };
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });

  const dbErr = requireDb(env);
  if (dbErr) return dbErr;

  const url = new URL(request.url);
  const method = request.method;

  // ── GET: 목록 ──
  if (method === 'GET') {
    const pin = url.searchParams.get('pin');
    if (!validatePin(pin)) return bad('PIN은 6자리 숫자여야 합니다');
    const { results } = await env.DB.prepare(
      'SELECT * FROM quests WHERE pin = ? AND active = 1 ORDER BY app_name, sort_order, created_at'
    ).bind(pin).all();
    return json({ ok: true, quests: (results || []).map(serializeQuest) });
  }

  // ── POST: 생성 ──
  if (method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return bad('invalid JSON'); }
    const { pin, app_name, title } = body;
    if (!validatePin(pin)) return bad('PIN은 6자리 숫자여야 합니다');
    if (!app_name || !title) return bad('app_name과 title은 필수입니다');

    const event_type = body.event_type ? String(body.event_type).trim().slice(0, 60) : null;
    const target_count = Math.max(1, parseInt(body.target_count, 10) || 1);
    const id = uuid();
    await env.DB.prepare(
      `INSERT INTO quests (id, pin, app_name, title, event_type, target_count, active, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?)`
    ).bind(id, pin, String(app_name).trim(), String(title).trim().slice(0, 120), event_type, target_count, nowIso()).run();

    const row = await env.DB.prepare('SELECT * FROM quests WHERE id = ?').bind(id).first();
    return json({ ok: true, quest: serializeQuest(row) }, { status: 201 });
  }

  // ── PUT: 수정 (title / target_count / active / sort_order) ──
  if (method === 'PUT') {
    let body;
    try { body = await request.json(); } catch { return bad('invalid JSON'); }
    const { pin, id } = body;
    if (!validatePin(pin)) return bad('PIN은 6자리 숫자여야 합니다');
    if (!id) return bad('id는 필수입니다');

    const existing = await env.DB.prepare('SELECT * FROM quests WHERE id = ? AND pin = ?').bind(id, pin).first();
    if (!existing) return bad('해당 퀘스트를 찾을 수 없습니다', 404);

    const title = body.title != null ? String(body.title).trim().slice(0, 120) : existing.title;
    const target_count = body.target_count != null ? Math.max(1, parseInt(body.target_count, 10) || 1) : existing.target_count;
    const active = body.active != null ? (body.active ? 1 : 0) : existing.active;
    const sort_order = body.sort_order != null ? (parseInt(body.sort_order, 10) || 0) : existing.sort_order;

    await env.DB.prepare(
      'UPDATE quests SET title = ?, target_count = ?, active = ?, sort_order = ? WHERE id = ?'
    ).bind(title, target_count, active, sort_order, id).run();

    const row = await env.DB.prepare('SELECT * FROM quests WHERE id = ?').bind(id).first();
    return json({ ok: true, quest: serializeQuest(row) });
  }

  // ── DELETE: 삭제 (연관 daily_progress 정리) ──
  if (method === 'DELETE') {
    const pin = url.searchParams.get('pin');
    const id = url.searchParams.get('id');
    if (!validatePin(pin)) return bad('PIN은 6자리 숫자여야 합니다');
    if (!id) return bad('id는 필수입니다');

    const existing = await env.DB.prepare('SELECT id FROM quests WHERE id = ? AND pin = ?').bind(id, pin).first();
    if (!existing) return bad('해당 퀘스트를 찾을 수 없습니다', 404);

    await env.DB.prepare('DELETE FROM daily_progress WHERE quest_id = ?').bind(id).run();
    await env.DB.prepare('DELETE FROM quests WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, POST, PUT, DELETE, OPTIONS' } });
}
```

- [ ] **Step 2: 구문 검사**

Run: `node --check functions/api/quests.js`
Expected: 출력 없음.

- [ ] **Step 3: 커밋**

```bash
git add functions/api/quests.js
git commit -m "feat: add quest CRUD API"
```

---

### Task 5: 이벤트 수집 API

**Files:**
- Create: `functions/api/ingest.js`

- [ ] **Step 1: `ingest.js` 작성**

매칭된 퀘스트마다 오늘자 `daily_progress`를 upsert하고, target 도달 시 completed 마킹한다. KST 날짜·매칭은 `lib/quest-logic.js`를 재사용한다.

```js
// Cloudflare Pages Function — 이벤트 수집구
// Route: /api/ingest
import { CORS_HEADERS, json, bad, uuid, nowIso, validatePin, requireDb } from './_quest_shared.js';
import { kstDateOf, questMatches } from '../../lib/quest-logic.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST, OPTIONS' } });
  }

  const dbErr = requireDb(env);
  if (dbErr) return dbErr;

  let body;
  try { body = await request.json(); } catch { return bad('invalid JSON'); }

  const { pin, app } = body;
  if (!validatePin(pin)) return bad('PIN은 6자리 숫자여야 합니다');
  if (!app) return bad('app은 필수입니다');

  const eventType = body.event_type ? String(body.event_type).trim().slice(0, 60) : null;
  const count = Math.max(1, parseInt(body.count, 10) || 1);
  const occurredAt = nowIso();
  const date = kstDateOf(occurredAt);

  // 1) 원시 로그 적재
  await env.DB.prepare(
    'INSERT INTO quest_events (id, pin, app_name, event_type, occurred_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(uuid(), pin, String(app).trim(), eventType, occurredAt).run();

  // 2) 매칭 퀘스트 집계
  const { results } = await env.DB.prepare(
    'SELECT * FROM quests WHERE pin = ? AND app_name = ? AND active = 1'
  ).bind(pin, String(app).trim()).all();

  let matched = 0;
  for (const quest of results || []) {
    if (!questMatches(quest, String(app).trim(), eventType)) continue;
    matched += 1;

    // 오늘자 진행 upsert (+count)
    await env.DB.prepare(
      `INSERT INTO daily_progress (quest_id, date, count, completed, completed_at)
       VALUES (?, ?, ?, 0, NULL)
       ON CONFLICT(quest_id, date) DO UPDATE SET count = count + excluded.count`
    ).bind(quest.id, date, count).run();

    // target 도달 & 미완료면 completed 마킹
    await env.DB.prepare(
      `UPDATE daily_progress
         SET completed = 1, completed_at = ?
       WHERE quest_id = ? AND date = ? AND completed = 0 AND count >= ?`
    ).bind(occurredAt, quest.id, date, quest.target_count).run();
  }

  return json({ ok: true, matched });
}
```

- [ ] **Step 2: 구문 검사**

Run: `node --check functions/api/ingest.js`
Expected: 출력 없음.

- [ ] **Step 3: 커밋**

```bash
git add functions/api/ingest.js
git commit -m "feat: add event ingest API with daily aggregation"
```

---

### Task 6: 현황·통계 API

**Files:**
- Create: `functions/api/progress.js`

- [ ] **Step 1: `progress.js` 작성**

`date` 단일 조회는 오늘 현황 + 퀘스트별 스트릭, `from`/`to`는 잔디·통계용 일별 매트릭스를 돌려준다.

```js
// Cloudflare Pages Function — 현황·통계
// Route: /api/progress
import { CORS_HEADERS, json, bad, validatePin, requireDb } from './_quest_shared.js';
import { kstDateOf, computeStreak } from '../../lib/quest-logic.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (request.method !== 'GET') {
    return json({ ok: false, error: 'Method not allowed' }, { status: 405, headers: { Allow: 'GET, OPTIONS' } });
  }

  const dbErr = requireDb(env);
  if (dbErr) return dbErr;

  const url = new URL(request.url);
  const pin = url.searchParams.get('pin');
  if (!validatePin(pin)) return bad('PIN은 6자리 숫자여야 합니다');

  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  // 내 active 퀘스트
  const { results: quests } = await env.DB.prepare(
    'SELECT * FROM quests WHERE pin = ? AND active = 1 ORDER BY app_name, sort_order, created_at'
  ).bind(pin).all();
  const questIds = (quests || []).map((q) => q.id);

  // ── 기간 모드: 잔디·통계용 일별 매트릭스 ──
  if (from && to) {
    if (questIds.length === 0) return json({ ok: true, quests: [], days: [] });
    const placeholders = questIds.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT quest_id, date, count, completed FROM daily_progress
        WHERE quest_id IN (${placeholders}) AND date >= ? AND date <= ?
        ORDER BY date`
    ).bind(...questIds, from, to).all();
    return json({
      ok: true,
      quests: (quests || []).map((q) => ({ id: q.id, app_name: q.app_name, title: q.title, target_count: q.target_count, event_type: q.event_type || null })),
      days: results || [],
    });
  }

  // ── 단일 날짜 모드: 오늘 현황 + 스트릭 ──
  const date = url.searchParams.get('date') || kstDateOf(new Date().toISOString());
  const out = [];
  for (const q of quests || []) {
    const todayRow = await env.DB.prepare(
      'SELECT count, completed FROM daily_progress WHERE quest_id = ? AND date = ?'
    ).bind(q.id, date).first();

    // 스트릭: 이 퀘스트의 completed=1 날짜 전부
    const { results: doneRows } = await env.DB.prepare(
      'SELECT date FROM daily_progress WHERE quest_id = ? AND completed = 1'
    ).bind(q.id).all();
    const streak = computeStreak((doneRows || []).map((r) => r.date), date);

    out.push({
      id: q.id,
      app_name: q.app_name,
      title: q.title,
      event_type: q.event_type || null,
      target_count: q.target_count,
      count: todayRow ? todayRow.count : 0,
      completed: todayRow ? !!todayRow.completed : false,
      streak,
    });
  }

  return json({ ok: true, date, quests: out });
}
```

- [ ] **Step 2: 구문 검사**

Run: `node --check functions/api/progress.js`
Expected: 출력 없음.

- [ ] **Step 3: 커밋**

```bash
git add functions/api/progress.js
git commit -m "feat: add progress API (today status, streak, range matrix)"
```

---

### Task 7: 퀘스트 페이지 (프론트)

**Files:**
- Create: `quests.html`
- Create: `quests.css`
- Create: `quests.js`
- Modify: `index.html`

> 디자인 톤은 jacehub의 cozy flat 닌텐도 스타일. 아래 CSS는 동작 가능한 최소 골격이며, 시각 완성은 실행 후 ariadne에게 맡긴다. PIN은 `localStorage['jacehub_vault_pin']`에서 읽는다(앱과 동일 키).

- [ ] **Step 1: `quests.html` 작성**

```html
<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>jacehub · 퀘스트</title>
  <link rel="stylesheet" href="quests.css" />
</head>
<body>
  <header class="q-header">
    <a class="q-back" href="index.html">← 허브</a>
    <h1>오늘의 퀘스트</h1>
    <div class="q-summary" id="summary">–</div>
  </header>

  <main class="q-main">
    <section id="needPin" class="q-card hidden">
      <p>PIN이 필요해요. 허브에서 보관소를 먼저 연결하세요.</p>
    </section>

    <section class="q-card">
      <h2>새 퀘스트</h2>
      <form id="addForm" class="q-form">
        <input id="f_app" list="appList" placeholder="앱 이름 (예: rituall)" required />
        <datalist id="appList"></datalist>
        <input id="f_title" placeholder="퀘스트 제목" required />
        <input id="f_event" placeholder="이벤트 타입 (선택, 비우면 앱 단위)" />
        <input id="f_target" type="number" min="1" value="1" />
        <button type="submit">추가</button>
      </form>
    </section>

    <div id="groups"></div>
  </main>

  <script src="quests.js"></script>
</body>
</html>
```

- [ ] **Step 2: `quests.css` 작성 (최소 골격)**

```css
:root { --bg:#f6f1e7; --card:#fffdf8; --ink:#4a3f35; --accent:#c98a3b; --line:#e6ddcd; }
* { box-sizing: border-box; }
body { margin:0; font-family: system-ui, sans-serif; background:var(--bg); color:var(--ink); }
.hidden { display:none !important; }
.q-header { display:flex; align-items:center; gap:16px; padding:16px 20px; border-bottom:2px solid var(--line); }
.q-header h1 { font-size:20px; margin:0; flex:1; }
.q-back { text-decoration:none; color:var(--accent); font-weight:700; }
.q-summary { font-weight:700; }
.q-main { padding:20px; max-width:760px; margin:0 auto; }
.q-card { background:var(--card); border:2px solid var(--line); border-radius:14px; padding:16px; margin-bottom:16px; }
.q-form { display:flex; flex-wrap:wrap; gap:8px; }
.q-form input { padding:8px 10px; border:2px solid var(--line); border-radius:10px; font-size:14px; }
.q-form input#f_title { flex:1; min-width:160px; }
.q-form button { padding:8px 16px; border:none; border-radius:10px; background:var(--accent); color:#fff; font-weight:700; cursor:pointer; }
.q-group h3 { margin:18px 0 8px; text-transform:capitalize; }
.q-quest { display:flex; align-items:center; gap:12px; background:var(--card); border:2px solid var(--line); border-radius:12px; padding:12px 14px; margin-bottom:8px; }
.q-quest.done { border-color:var(--accent); }
.q-quest .title { flex:1; font-weight:600; }
.q-bar { width:120px; height:8px; background:var(--line); border-radius:4px; overflow:hidden; }
.q-bar > i { display:block; height:100%; background:var(--accent); }
.q-streak { font-size:13px; opacity:.8; }
.q-heat { display:flex; gap:3px; margin-top:6px; }
.q-heat span { width:12px; height:12px; border-radius:3px; background:var(--line); }
.q-heat span.on { background:var(--accent); }
.q-del { border:none; background:none; color:#b55; cursor:pointer; font-size:13px; }
```

- [ ] **Step 3: `quests.js` 작성**

```js
// 퀘스트 페이지 로직 — PIN으로 /api/quests·/api/progress 호출.
const PIN = localStorage.getItem('jacehub_vault_pin') || '';
const FAVORITES = JSON.parse(localStorage.getItem('jacehub_favorites') || '[]');

const $ = (sel) => document.querySelector(sel);

function kstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
function daysAgo(n) {
  return new Date(Date.now() + 9 * 3600 * 1000 - n * 86400000).toISOString().slice(0, 10);
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  return res.json();
}

async function loadAll() {
  if (!PIN || !/^\d{6}$/.test(PIN)) {
    $('#needPin').classList.remove('hidden');
    return;
  }
  // 앱 자동완성: 즐겨찾기
  $('#appList').innerHTML = FAVORITES.map((a) => `<option value="${a}">`).join('');

  const today = kstToday();
  const from = daysAgo(20); // 최근 3주(21일)
  const [progress, range] = await Promise.all([
    api(`/api/progress?pin=${PIN}`),
    api(`/api/progress?pin=${PIN}&from=${from}&to=${today}`),
  ]);

  const quests = progress.quests || [];
  const cleared = quests.filter((q) => q.completed).length;
  $('#summary').textContent = `${cleared}/${quests.length}`;

  // 잔디용: quest_id+date → completed
  const heat = {};
  for (const d of range.days || []) {
    heat[`${d.quest_id}|${d.date}`] = d.completed ? 1 : (d.count > 0 ? 0.5 : 0);
  }

  // 앱별 그룹
  const byApp = {};
  for (const q of quests) (byApp[q.app_name] ||= []).push(q);

  const groups = $('#groups');
  groups.innerHTML = '';
  for (const [app, list] of Object.entries(byApp)) {
    const g = document.createElement('div');
    g.className = 'q-group';
    g.innerHTML = `<h3>${app}</h3>`;
    for (const q of list) {
      const pct = Math.min(100, Math.round((q.count / q.target_count) * 100));
      const cells = [];
      for (let i = 20; i >= 0; i--) {
        const v = heat[`${q.id}|${daysAgo(i)}`] || 0;
        cells.push(`<span class="${v >= 1 ? 'on' : ''}"></span>`);
      }
      const el = document.createElement('div');
      el.className = 'q-quest' + (q.completed ? ' done' : '');
      el.innerHTML = `
        <div style="flex:1">
          <div class="title">${q.title} ${q.event_type ? `<small>· ${q.event_type}</small>` : ''}</div>
          <div class="q-heat">${cells.join('')}</div>
        </div>
        <div class="q-bar"><i style="width:${pct}%"></i></div>
        <span>${q.count}/${q.target_count}</span>
        <span class="q-streak">🔥${q.streak}</span>
        <button class="q-del" data-id="${q.id}">삭제</button>`;
      g.appendChild(el);
    }
    groups.appendChild(g);
  }

  groups.querySelectorAll('.q-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('이 퀘스트를 삭제할까요?')) return;
      await api(`/api/quests?pin=${PIN}&id=${btn.dataset.id}`, { method: 'DELETE' });
      loadAll();
    });
  });
}

$('#addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!PIN) return alert('PIN이 필요합니다');
  const payload = {
    pin: PIN,
    app_name: $('#f_app').value.trim(),
    title: $('#f_title').value.trim(),
    event_type: $('#f_event').value.trim() || undefined,
    target_count: parseInt($('#f_target').value, 10) || 1,
  };
  const r = await api('/api/quests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) return alert(r.error || '추가 실패');
  e.target.reset();
  $('#f_target').value = '1';
  loadAll();
});

loadAll();
```

- [ ] **Step 4: `index.html`에 퀘스트 페이지 링크 추가**

`index.html`에서 `lobby.html`로 가는 링크(또는 헤더 내비) 근처에 퀘스트 진입 링크를 추가한다. lobby 링크가 없으면 헤더 영역에 아래 한 줄을 넣는다.

```html
<a class="nav-link" href="quests.html">🗡️ 퀘스트</a>
```
> 실행 시 `index.html`의 실제 내비 구조를 먼저 확인하고 같은 클래스/위치 규약을 따른다.

- [ ] **Step 5: 빌드 통과 확인**

Run: `npm run build`
Expected: PASS — `Built N source files into dist`. (Task 1에서 화이트리스트에 등록했으므로 이제 통과)

- [ ] **Step 6: 커밋**

```bash
git add quests.html quests.css quests.js index.html
git commit -m "feat: add quest page (list, add, progress, streak, heatmap)"
```

---

### Task 8: Phase 1 통합 스모크 테스트

**Files:** (없음 — 로컬 실행 검증)

- [ ] **Step 1: 로컬 dev 기동**

Run:
```bash
npx wrangler pages dev dist --d1 DB=jacehub-db --port 3040
```
> `npm run build`로 dist를 먼저 만든 뒤 실행. `--d1 DB=jacehub-db`로 로컬 D1을 바인딩한다. 포트는 비어 있는 것으로.

- [ ] **Step 2: 퀘스트 생성 (단순 완료형)**

Run:
```bash
curl -s -X POST localhost:3040/api/quests -H 'Content-Type: application/json' \
  -d '{"pin":"123456","app_name":"rituall","title":"아침 의식","event_type":"morning_ritual","target_count":1}'
```
Expected: `{"ok":true,"quest":{...}}` — `id` 기록해 둔다.

- [ ] **Step 3: 횟수형 퀘스트 생성**

Run:
```bash
curl -s -X POST localhost:3040/api/quests -H 'Content-Type: application/json' \
  -d '{"pin":"123456","app_name":"transparenty","title":"태스크 3개","event_type":"task_completed","target_count":3}'
```
Expected: `{"ok":true,...}`

- [ ] **Step 4: 이벤트 쏘기 (매칭 확인)**

Run:
```bash
curl -s -X POST localhost:3040/api/ingest -H 'Content-Type: application/json' \
  -d '{"pin":"123456","app":"rituall","event_type":"morning_ritual"}'
```
Expected: `{"ok":true,"matched":1}`

- [ ] **Step 5: 오늘 현황 확인 (완료 마킹·count)**

Run: `curl -s "localhost:3040/api/progress?pin=123456" | head`
Expected: rituall 퀘스트가 `count:1, completed:true, streak:1`. transparenty 퀘스트는 `count:0, completed:false`.

- [ ] **Step 6: 횟수형 부분 진행 확인**

Run:
```bash
curl -s -X POST localhost:3040/api/ingest -H 'Content-Type: application/json' -d '{"pin":"123456","app":"transparenty","event_type":"task_completed"}'
curl -s "localhost:3040/api/progress?pin=123456"
```
Expected: transparenty 퀘스트 `count:1, completed:false`. (3회 채우면 completed:true 되는지 2회 더 쏴서 확인)

- [ ] **Step 7: 앱 단위(event_type 없는) 퀘스트 매칭 확인**

event_type 없는 퀘스트를 만들고, 아무 타입 이벤트나 보내 매칭되는지 확인.
```bash
curl -s -X POST localhost:3040/api/quests -H 'Content-Type: application/json' -d '{"pin":"123456","app_name":"rituall","title":"하루 한 번 rituall","target_count":1}'
curl -s -X POST localhost:3040/api/ingest -H 'Content-Type: application/json' -d '{"pin":"123456","app":"rituall","event_type":"evening_ritual"}'
curl -s "localhost:3040/api/progress?pin=123456"
```
Expected: 새 앱단위 퀘스트도 매칭되어 `matched`가 2 이상, 해당 퀘스트 completed:true.

- [ ] **Step 8: 브라우저로 페이지 확인**

`localhost:3040/quests.html`을 연다. (PIN 없으면 콘솔에서 `localStorage.setItem('jacehub_vault_pin','123456'); localStorage.setItem('jacehub_favorites','["rituall","transparenty"]')` 후 새로고침)
Expected: 앱별 그룹, 진행 바, 🔥스트릭, 잔디 칸, 삭제 버튼이 보이고 동작.

- [ ] **Step 9: 검증 노트 기록 + 커밋(필요 시)**

문제 없으면 다음 단계로. 발견된 버그는 해당 Task로 돌아가 수정 후 재검증.

---

## Phase 2 — rituall 파일럿 연동

### Task 9: rituall 서버 헬퍼

**Files:**
- Create: `/mnt/e/Workspace/Projects/rituall/js/jacehub-quest.js`

- [ ] **Step 1: 헬퍼 작성**

```js
// jacehub 퀘스트 수집구로 fire-and-forget 보고. 실패해도 호스트 앱 동작을 막지 않는다.
export function reportQuest(env, app, eventType, ctx) {
  if (!env || !env.JACEHUB_PIN) return; // PIN 미설정 시 조용히 패스
  const p = fetch('https://jacehub.pages.dev/api/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: env.JACEHUB_PIN, app, event_type: eventType }),
  }).catch(() => {});
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
}
```

- [ ] **Step 2: 구문 검사**

Run: `node --check /mnt/e/Workspace/Projects/rituall/js/jacehub-quest.js`
Expected: 출력 없음.

- [ ] **Step 3: 커밋 (rituall 레포)**

```bash
cd /mnt/e/Workspace/Projects/rituall
git add js/jacehub-quest.js
git commit -m "feat: add jacehub quest report helper"
```

---

### Task 10: rituall morning/evening 연동

**Files:**
- Modify: `/mnt/e/Workspace/Projects/rituall/functions/api/rituals/morning.js`
- Modify: `/mnt/e/Workspace/Projects/rituall/functions/api/rituals/evening.js`

> `functions/api/rituals/`에서 헬퍼까지 상대경로는 `../../../js/jacehub-quest.js`. evening.js는 morning.js와 동일 구조(`onRequestPost`)이며, 저장 성공 응답 직전에 보고를 넣는다.

- [ ] **Step 1: morning.js import 추가**

`morning.js` 최상단 import 줄 다음에 추가:
```js
import { reportQuest } from '../../../js/jacehub-quest.js';
```
그리고 핸들러 시그니처를 `context` 전체를 받도록 바꾼다. 기존:
```js
export async function onRequestPost({ request, env }) {
```
변경:
```js
export async function onRequestPost(context) {
  const { request, env } = context;
```

- [ ] **Step 2: morning.js 저장 성공 직후 보고 추가**

`insert`/`update` 후 `return json(...)` 직전 두 군데(존재/신규) 모두에서, return 직전에 한 줄을 넣는다. 가장 간단하게는 두 분기를 합치지 말고 각 `return json({ ritual: ... })` 바로 위에:
```js
  reportQuest(env, 'rituall', 'morning_ritual', context);
```
> 두 return 경로(update 분기 / insert 분기)가 있으므로 양쪽 모두에 넣는다.

- [ ] **Step 3: evening.js 동일 적용**

`evening.js`를 열어 동일하게:
1. `import { reportQuest } from '../../../js/jacehub-quest.js';` 추가
2. `onRequestPost(context)` + `const { request, env } = context;` 로 변경
3. 저장 성공 `return json(...)` 직전마다 `reportQuest(env, 'rituall', 'evening_ritual', context);` 추가

- [ ] **Step 4: 구문 검사**

Run:
```bash
node --check /mnt/e/Workspace/Projects/rituall/functions/api/rituals/morning.js
node --check /mnt/e/Workspace/Projects/rituall/functions/api/rituals/evening.js
```
Expected: 둘 다 출력 없음.

- [ ] **Step 5: 커밋**

```bash
cd /mnt/e/Workspace/Projects/rituall
git add functions/api/rituals/morning.js functions/api/rituals/evening.js
git commit -m "feat: report morning/evening rituals to jacehub quest ingest"
```

---

### Task 11: 배포 + Phase 2 통합 검증

**Files:** (없음 — 배포·검증)

- [ ] **Step 1: jacehub 원격 D1 스키마 적용**

Run:
```bash
cd /mnt/e/Workspace/Projects/jacehub
npx wrangler d1 execute jacehub-db --remote --file schema.sql
```
Expected: 3개 테이블 생성.

- [ ] **Step 2: jacehub 배포**

Run:
```bash
npm run build
npx wrangler pages deploy dist --project-name=jacehub --branch=main
```
> CLAUDE.md의 배포 규약(`--branch=main` 필수) 준수. 산출물은 `dist`. 기존 배포가 루트(`.`) 기준이었다면 `dist` 기준으로 바뀌는지 한 번 확인(빌드 산출물 배포 권장).

- [ ] **Step 3: jacehub 프로덕션에 D1 바인딩 연결 확인**

Cloudflare 대시보드 또는 `wrangler.toml`의 `[[d1_databases]]`가 프로덕션 Pages에 적용됐는지 확인. 미적용 시 대시보드에서 `DB` → `jacehub-db` 바인딩 추가.
Run(스모크): `curl -s -X POST https://jacehub.pages.dev/api/quests -H 'Content-Type: application/json' -d '{"pin":"<진짜PIN>","app_name":"rituall","title":"아침 의식","event_type":"morning_ritual","target_count":1}'`
Expected: `{"ok":true,...}` (500이면 바인딩 미설정)

- [ ] **Step 4: rituall에 JACEHUB_PIN secret 설정**

Run:
```bash
cd /mnt/e/Workspace/Projects/rituall
npx wrangler pages secret put JACEHUB_PIN --project-name=rituall
```
프롬프트에 진짜 6자리 PIN 입력.
> rituall이 아직 Pages 프로젝트로 생성 안 됐으면(CLAUDE.md 체크리스트), 먼저 `wrangler pages project create rituall --production-branch=main` + D1 셋업 후 진행.

- [ ] **Step 5: rituall 배포**

Run:
```bash
cd /mnt/e/Workspace/Projects/rituall
npm run deploy
```
Expected: 배포 성공 URL 출력.

- [ ] **Step 6: 엔드투엔드 검증**

1. jacehub 프로덕션 `quests.html`에서 rituall "아침 의식"/"저녁 의식" 퀘스트가 보이는지 확인(PIN 연결 상태).
2. rituall 프로덕션에서 실제로 아침 의식을 저장한다.
3. jacehub `quests.html` 새로고침 → 아침 의식 퀘스트 `completed:true`, 🔥1 표시 확인.
4. 저녁 의식도 동일 확인.

Expected: rituall에서의 실제 저장이 jacehub 퀘스트 카운트·완료·스트릭에 반영된다.

- [ ] **Step 7: 검증 결과 기록**

엔드투엔드가 통과하면 Phase 2 완료. rituall 외 즐겨찾기 앱 확산(Phase 3)은 Task 9~10의 동일 패턴 반복(앱별 import 경로·event_type만 다름).

---

## Phase 3 — 확산 (반복 패턴, 본 계획 범위 밖 상세)

각 즐겨찾기 앱에 대해:
1. 앱 레포에 `jacehub-quest.js` 헬퍼 복사(서버 Function 있으면 서버용, 없으면 클라이언트용).
2. 의미 있는 행동 지점에서 `reportQuest(env, '<app>', '<event_type>', context)` 호출.
3. `JACEHUB_PIN` secret(서버) 또는 상수(클라이언트) 설정 후 배포.
4. jacehub `quests.html`에서 해당 앱·event_type 퀘스트 생성.

앱별로 event_type 1~2개만 골라 가볍게 시작하고, 필요해지면 세분화한다.

---

## Self-Review 결과

- **Spec 커버리지:** Push 수집(Task 5) / 통합 모델 target_count(Task 4·5) / event_type 매칭·앱단위(Task 2·5) / 풀 히스토리·통계(Task 6 range 모드·잔디) / D1(Task 1) / PIN 원본 인증(Task 3 validatePin) / 원시+집계 병행(Task 5) / 별도 페이지(Task 7) / 잔디 최근 3주(Task 7 quests.js `daysAgo(20)`) / rituall 파일럿(Task 9~11) — 모두 대응 Task 존재.
- **Placeholder 스캔:** `wrangler.toml`의 `database_id`만 의도된 런타임 채움(Task 1 Step 2에서 실값 입력). 그 외 TBD/TODO 없음.
- **타입 일관성:** `kstDateOf`·`questMatches`·`computeStreak` 시그니처가 lib 정의(Task 2)와 사용처(Task 5·6)에서 일치. `serializeQuest` 필드명이 quests.js·progress.js·quests.js(프론트) 간 일치(`count`/`target_count`/`completed`/`streak`).
