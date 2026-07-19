# jacehub 퀘스트 시스템 — 설계 문서

- 작성일: 2026-05-31
- 상태: 설계 합의 완료 (구현 전 검토 대기)
- 대상 앱: jacehub (코어) + rituall (파일럿) + 즐겨찾기 앱 전반 (확산)

## 1. 목적

jacehub에서 즐겨찾기한 앱별로 **데일리 퀘스트**를 정의하고, 각 앱에서 실제 행동이
일어날 때 그 달성을 자동으로 카운트한다. 매일 "오늘 퀘스트를 잘 클리어했는지"를
한눈에 확인하고, 스트릭·잔디·통계로 동기를 부여하는 것이 목표.

핵심은 "각 앱에 트리거를 심는다" — 앱의 행동이 jacehub로 흘러들어와 카운트되는
구조다.

## 2. 합의된 결정 요약

| 항목 | 결정 |
|---|---|
| 이벤트 전달 방식 | **Push** — 각 앱이 jacehub 수집 엔드포인트로 이벤트를 쏜다 |
| 퀘스트 모양 | **목표 횟수 N 통합 모델** (N=1 → 단순 완료, N≥2 → 횟수 목표) |
| 이벤트 정밀도 | 이벤트에 **타입을 실을 수 있게** 하되, 퀘스트는 앱 단위/타입 지정 모두 가능 |
| 기록 깊이 | **풀 히스토리 + 통계** (오늘 체크 + 스트릭 + 잔디 + 월별 통계) |
| 저장소 | **Cloudflare D1** (신규 DB) — KV vault는 기존 그대로 유지 |
| 인증 | **기존 6자리 PIN 원본 재사용** — 혼자 쓰는 개인용이라 노출 허용 |
| 데이터 흐름 | **원시 로그 + 일별 집계 병행** (`quest_events` + `daily_progress`) |
| 파일럿 앱 | **rituall** |

## 3. 데이터 모델 (Cloudflare D1)

신규 D1 DB `jacehub-db`. 모든 행은 `pin`으로 사용자(=나) 단위 격리.

```sql
-- 퀘스트 정의
CREATE TABLE IF NOT EXISTS quests (
  id          TEXT PRIMARY KEY,        -- uuid
  pin         TEXT NOT NULL,           -- 소유자 식별 (vault PIN)
  app_name    TEXT NOT NULL,           -- 즐겨찾기 프로젝트명과 매칭
  title       TEXT NOT NULL,           -- 퀘스트 이름 (표시용)
  event_type  TEXT,                    -- NULL이면 '앱 단위'(그 앱 아무 이벤트나 카운트)
  target_count INTEGER NOT NULL DEFAULT 1,  -- 1=단순완료, 2↑=횟수목표
  active      INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_quests_pin ON quests(pin, active);
CREATE INDEX IF NOT EXISTS idx_quests_match ON quests(pin, app_name, active);

-- 원시 이벤트 로그 (통계·잔디용 원본)
CREATE TABLE IF NOT EXISTS quest_events (
  id          TEXT PRIMARY KEY,        -- uuid
  pin         TEXT NOT NULL,
  app_name    TEXT NOT NULL,
  event_type  TEXT,                    -- 앱이 보낸 타입 (없을 수 있음)
  occurred_at TEXT NOT NULL            -- ISO8601 (UTC 저장, 표시는 Asia/Seoul)
);
CREATE INDEX IF NOT EXISTS idx_events_pin_app ON quest_events(pin, app_name, occurred_at);

-- 일별 집계 (오늘 체크·스트릭용)
CREATE TABLE IF NOT EXISTS daily_progress (
  quest_id     TEXT NOT NULL,
  date         TEXT NOT NULL,          -- YYYY-MM-DD (Asia/Seoul 기준)
  count        INTEGER NOT NULL DEFAULT 0,
  completed    INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  PRIMARY KEY (quest_id, date)
);
CREATE INDEX IF NOT EXISTS idx_progress_date ON daily_progress(date);
```

날짜 기준: **Asia/Seoul**. `date`는 서울 기준 자정으로 끊는다. `occurred_at`은
UTC 원본을 그대로 저장하고 집계 시 서울로 변환.

## 4. API (Cloudflare Pages Functions 신규 3종)

기존 `functions/api/`에 추가.

### 4.1 `POST /api/ingest` — 이벤트 수집구

각 앱이 호출하는 진입점.

요청:
```json
{ "pin": "123456", "app": "rituall", "event_type": "evening_ritual", "count": 1 }
```
- `event_type`, `count` 생략 가능 (`count` 기본 1).

처리:
1. PIN 형식 검증 (`^\d{6}$`).
2. `quest_events`에 원시 1건 적재.
3. 해당 `pin` + `app` 의 active 퀘스트 중 매칭되는 것들을 찾는다.
   - 퀘스트 `event_type`이 NULL → 그 앱 모든 이벤트 매칭 (앱 단위)
   - 퀘스트 `event_type`이 지정 → 같은 타입일 때만 매칭
4. 매칭된 각 퀘스트의 오늘자 `daily_progress.count += count` (upsert).
   - `count >= target_count`이고 아직 미완료면 `completed=1`, `completed_at` 기록.
5. fire-and-forget 친화적으로, 항상 빠르게 `200 { ok: true }` 응답.

응답 예: `{ "ok": true, "matched": 1 }`

> 멱등성은 1차 범위 밖. 동일 행동이 두 번 쏘이면 두 번 카운트된다(개인용 허용).
> 추후 `event_id` 기반 중복 제거를 옵션으로 둘 수 있음(YAGNI).

### 4.2 `/api/quests` — 퀘스트 CRUD (PIN 필요)

- `GET  /api/quests?pin=` → 내 퀘스트 목록
- `POST /api/quests` → 생성 `{ pin, app_name, title, event_type?, target_count? }`
- `PUT  /api/quests` → 수정 `{ pin, id, ...patch }` (title/target_count/active/sort_order)
- `DELETE /api/quests?pin=&id=` → 삭제 (연관 `daily_progress`도 정리)

### 4.3 `/api/progress` — 현황·통계 조회 (PIN 필요)

- `GET /api/progress?pin=&date=YYYY-MM-DD` (기본: 오늘)
  → 각 퀘스트의 오늘 count/target/completed + **현재 스트릭(연속 클리어 일수)**
- `GET /api/progress?pin=&from=&to=`
  → 기간별 일자 × 퀘스트 매트릭스 (잔디 히트맵·월별 통계용, `quest_events`/`daily_progress` 기반)

## 5. jacehub 프론트엔드 — "퀘스트" 뷰 신설

기존 cozy flat 닌텐도 톤을 유지하며 **별도 페이지**로 추가(`lobby.html`/`lobby.js`
패턴과 동일하게 `quests.html` + `quests.js` + `quests.css`). 상세 화면 디자인은
구현 단계에서 ariadne(프론트 디자인 에이전트)에게 맡긴다.

구성 요소:
- **즐겨찾기 앱별 그룹**: 앱마다 그 앱에 걸린 퀘스트 카드들을 묶어 표시.
- **퀘스트 카드**: 제목 + 오늘 진행 바(`2/3`) + 완료 체크 + **연속일(스트릭)** +
  작은 **잔디 히트맵**(최근 3주).
- **퀘스트 추가 UI**: 즐겨찾기 앱 선택 → 제목 입력 → (옵션) 이벤트 타입 →
  목표 횟수(기본 1). 이벤트 타입은 자유 입력(앱이 보내는 타입과 문자열 일치).
- **상단 요약**: 오늘 전체 퀘스트 중 클리어 수(`5/8`), 오늘 전부 클리어 시 작은 축하.

데이터는 기존 PIN 흐름을 재사용 — vault 연결 시 알고 있는 PIN으로
`/api/quests`·`/api/progress` 조회.

## 6. 범용 push 스니펫 (재사용 SDK)

각 앱에 심을 작은 헬퍼. **서버사이드 호출을 1순위로 권장**(앱에 Functions가 있을 때).
PIN을 wrangler secret으로 두면 프론트 노출 없이 안전. 프론트 전용 앱이면
클라이언트 헬퍼로 대체.

서버사이드 (Pages Functions 환경):
```js
// jacehub-quest.js (서버용)
export function reportQuest(env, app, eventType, ctx) {
  const body = JSON.stringify({ pin: env.JACEHUB_PIN, app, event_type: eventType });
  const p = fetch('https://jacehub.pages.dev/api/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }).catch(() => {}); // 실패해도 앱 동작 막지 않음
  if (ctx?.waitUntil) ctx.waitUntil(p); // 응답 지연 없이 백그라운드 전송
}
```

클라이언트 (프론트 전용 앱 대비):
```js
// jacehub-quest.js (클라이언트용)
window.jacehubQuest = {
  report(app, eventType) {
    fetch('https://jacehub.pages.dev/api/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: JACEHUB_PIN, app, event_type: eventType }),
      keepalive: true,
    }).catch(() => {});
  },
};
```

설계 원칙: **fire-and-forget**, 실패가 호스트 앱 동작을 절대 막지 않는다.

## 7. 파일럿 연동 — rituall

rituall: 아침/저녁 데일리 의식 앱. Cloudflare Pages + Functions + D1, Vanilla JS.

연동 지점 (서버사이드, 1순위 권장):
- `functions/api/rituals/morning.js` 저장 성공 직후 → `reportQuest(env, 'rituall', 'morning_ritual', ctx)`
- `functions/api/rituals/evening.js` 저장 성공 직후 → `reportQuest(env, 'rituall', 'evening_ritual', ctx)`

설정:
- rituall에 `JACEHUB_PIN` 환경변수(wrangler secret) 추가.
- `js/jacehub-quest.js`(서버 헬퍼) 1파일 추가 후 두 Function에서 import.

대응 퀘스트 예시 (jacehub에서 생성):
- "아침 의식" — app=`rituall`, event_type=`morning_ritual`, target=1
- "저녁 의식" — app=`rituall`, event_type=`evening_ritual`, target=1

검증: rituall에서 실제로 아침/저녁 의식을 저장 → jacehub 퀘스트 뷰에서
오늘 카운트가 오르고 완료 마킹 + 스트릭 증가 확인.

## 8. 보안 노트

- PIN 원본을 그대로 ingest 키로 사용한다(사용자 결정 — 혼자 쓰는 개인용).
- `/api/ingest`는 PIN만 맞으면 카운트되므로, PIN을 아는 주체만 쓰기를 전제.
- rituall처럼 자체 Functions가 있는 앱은 PIN을 **서버 secret**에 두어 프론트 노출을
  피한다(클라이언트 직접 호출보다 안전). 프론트 전용 앱만 불가피하게 노출.
- vault.js의 6자리 PIN 한계(브루트포스 가능) 주석은 그대로 유효 — 공개 확장 전
  재검토 대상이나, 현 범위(개인용)에서는 허용.

## 9. 단계화

### Phase 1 — jacehub 퀘스트 코어
- D1 DB 생성 + 스키마 적용, `wrangler.toml`(또는 jsonc)에 D1 바인딩 추가.
- `/api/ingest`, `/api/quests`, `/api/progress` 구현.
- 프론트 "퀘스트" 뷰 + 퀘스트 추가 UI.
- jacehub 안에서 수동/시뮬레이션 이벤트(`/api/ingest` 직접 호출)로 끝까지 검증.

### Phase 2 — rituall 파일럿 연동
- 범용 push 스니펫(`jacehub-quest.js` 서버 헬퍼) 확정.
- rituall `morning.js`/`evening.js`에 삽입 + `JACEHUB_PIN` secret 설정.
- 실데이터로 카운트·완료·스트릭 검증, 양쪽 배포.

### Phase 3 — 확산
- 나머지 즐겨찾기 앱들에 스니펫을 순차 삽입·배포 (앱당 반복 패턴).
- 앱별로 의미 있는 event_type 1~2개 선정 → jacehub에서 대응 퀘스트 생성.

spec 상세는 **Phase 1 + 2** 기준. Phase 3는 동일 패턴 반복.

## 10. 비범위 (YAGNI)

- 멀티 유저/계정 시스템 (PIN = 단일 사용자 전제).
- 이벤트 멱등성/중복 제거 (1차 제외, 추후 옵션).
- 퀘스트 보상/포인트/레벨 등 게이미피케이션 확장 요소.
- 주간/월간 퀘스트 (현재는 데일리 리셋만).
- 푸시 알림/리마인더.

## 11. 확정 사항 (검토 시 결정)

- D1 DB 이름: **`jacehub-db`** 확정.
- 퀘스트 뷰: **별도 페이지** (`quests.html`/`quests.js`/`quests.css`, `lobby` 패턴).
- 잔디 히트맵 기간: **최근 3주**.
