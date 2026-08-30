# CLAUDE.md — jacehub

제이스의 웹앱들이 모이는 **정문(런처)** + 토큰 있을 때만 켜지는 **관제 레이어**. 2026-08-31 전면 개선(F01 크림 페이퍼 에디토리얼, 결정 기록 `docs/redesign-20260831/decision.md`, 구현 명세 `docs/redesign-20260831/IMPLEMENTATION.md`).

> 데일리 퀘스트는 2026-07-19에 jacemaster로 이관, 로비(`lobby.html`)·퀵로비·레이더·CSV/리포트는 2026-08-31 리디자인에서 폐기.

## 화면 1장 구조

`index.html` 한 장. 렌더러는 `app.js` 하나 — 카드 렌더러 1개(타일)로 정문·고정 행·관제 섹션 전부 그린다.

- **정문** (토큰 없이 동작): `catalog.json`을 fetch → `sections[].front === true` 순서로 섹션 5개(게임 / 생활·생산성 / 도구·작업장 / 기록·아카이브 / 후추네). 타일 = `icons/apps/<slug>.svg` + 한글 `name`(세리프) + `slug`(모노) + `tag`.
- **고정 행**: localStorage `jacehub_favorites`(slug 배열). 비어 있으면 기본 `jacemaster · weneedstress · jacepages · jacefiles`. 볼트 연결 시 `favorites` 필드로 동기.
- **디테일 시트** (`<dialog id="sheet">`, 데스크톱 센터 스프레드 / ≤640px 바텀시트): `shots/<slug>.jpg`(없으면 "스크린샷 없음" 플레이스홀더) · 배포 정보 · 열기 ↗ · 주소 복사 · 📌 고정 토글 · PREV/NEXT(←/→, 스와이프) · ESC/배경 클릭 닫힘 → 타일로 포커스 복귀.
- **관제 레이어** (`body.ops`): 헤더 `관제` 스위치. 토큰 없으면 클릭 시 설정 모달. 토큰 있으면 기본 ON, `jacehub_ops_enabled='0'`으로 잠시 끌 수 있음.
  - `/api/projects` 라이브 목록을 카탈로그와 **이름으로 매칭**: `cfName` → `slug` → URL 호스트 순.
  - 타일 상태점: 초록(success) / 빨강(failure) / 황토(진행) / 회색(정체 ≥ `STALE_PROJECT_DAYS`=30일). 시트엔 `{타입} · {N일 전 배포} · {상태}` + 배지.
  - 접힌 섹션 4개(기본 접힘): 🔍 미검수 · 🪦 퇴역 후보 · 🗄 격납고 · 🔒 내부. 격납고 = 카탈로그 `hangar` ∪ **API에 있는데 카탈로그에 없는 프로젝트**("미등록" 배지). 내부 = API `_type === 'service'`(`SELF_HOSTED_SERVICES`).
  - API 실패 → 토스트 + 카탈로그만 렌더. 정문은 절대 깨지지 않는다.
- **⚙ 설정 모달** (`<dialog id="settings">`): Account ID · API Token · GH Token · Vercel Token + 클라우드 보관소(PIN 불러오기/저장/덮어쓰기/삭제) + "이 기기에서 지우기".

## catalog.json 규약 (정본 — git)

```json
{ "slug": "jacewiki", "name": "제이스 위키", "tag": "앱·게임 문서 위키", "section": "tool", "url": "https://jacewiki.pages.dev" }
```

- `slug` 유일 · `name` 한글 표시명 · `tag` 한 줄 역할 · `section` = sections[].key · `url` 없으면 열기 비활성.
- 선택: `type: "worker"`(배포 타입 라벨), `cfName`(CF 프로젝트명이 slug와 다를 때 — 예: youtubewc → youtubemusicwc).
- **앱 추가 = ① apps[]에 한 줄 + ② `icons/apps/<slug>.svg`(F01 스탬프 결, `icons/apps/README.md`) + ③ `node scripts/shots.mjs --only <slug>`로 `shots/<slug>.jpg` 재캡처.** 아이콘/스크린샷이 없어도 이니셜 타일·플레이스홀더로 폴백되니 정문은 뜬다.
- 내부 서비스(CF Access 뒤)는 여기 넣지 않는다 — `functions/api/projects.js`의 `SELF_HOSTED_SERVICES`로만 합류.
- `npm run build`가 JSON 유효성·slug 중복·section 키를 검사한다.

## Self-hosted 서비스

CF/Vercel API에 안 잡히는 셀프호스트(warren·ccwatch, bani WSL + CF Tunnel/Access)는 `functions/api/projects.js`의 `SELF_HOSTED_SERVICES` 상수로 합류. 헬스는 CF Tunnel API(`cfd_tunnel`) — 토큰에 **Account > Cloudflare Tunnel:Read**가 있어야 라이브, 없으면 "상태 미확인". 클라이언트는 `_type: 'service'` → 관제 레이어 "내부" 섹션.

## 볼트 (`functions/api/vault.js`)

6자리 PIN 키 KV(`VAULT`) + AES-GCM. 봉투 = `{ accountId, apiToken, ghToken, vercelToken, favorites[] }`. **2026-08-31부터 `lobby{cache,meta}` 봉투는 폐기** — 클라이언트가 보내도 서버가 무시한다(테스트 `test/vault.test.js`). 클라이언트 키: `jacehub_vault_linked` · `jacehub_vault_pin`.

## 스타일

`style.css` — F01 토큰(`/mnt/c/Workspace/Projects/jacedesign/system/tokens/css/F01.css`)을 `:root`에 인라인, 값은 `var(--jd-*)`. 카드 원자 4값(`--atom-*`) 1세트. 폰트 3역할(세리프 제목 / JetBrains Mono 슬러그·수치 / Pretendard 본문). 상태색 `--st-*`는 액센트(테라코타)와 분리. 반응형 390~1440, `prefers-reduced-motion` 존중.

## Cloudflare Deployment

- **Platform**: Cloudflare Pages · **Project**: `jacehub` · **Production branch**: `main` · **URL**: https://jacehub.pages.dev
- **자동 배포**: `main` push → GitHub Actions(`.github/workflows/deploy.yml`)가 `npm run build` → `wrangler pages deploy dist --branch=main`. **push = 즉시 프로덕션**이니 로컬 QA 후 push.
- **수동**: `npm run build && wrangler pages deploy dist --project-name=jacehub --branch=main` (`--branch=main` 필수, 루트 말고 `dist`).
- `scripts/build.mjs` 화이트리스트: `index.html style.css app.js catalog.json retroarch-hotkeys.html` + 디렉토리 `functions`(필수) `icons` `shots`(없으면 건너뜀).

## Bindings (`wrangler.toml`이 source of truth)

- **VAULT** (KV, `jacehub-vault`): PIN 기반 크레덴셜·고정 앱 보관소.

> 새 바인딩을 추가할 때 VAULT를 빠뜨리면 deploy 때 떨어져 나간다. 반드시 전부 유지.

## Local Dev / Test

```bash
npm test                  # vault.js 단위 테스트 (node --test)
npm run build             # dist 생성 (+ catalog.json 검증, node --check)
npx wrangler pages dev dist   # 로컬 미리보기 (toml 바인딩 자동 인식)
node scripts/shots.mjs [--only <slug>]   # 디테일 시트 스크린샷 재캡처 (shots/manual.json 제외 목록)
```

헤드리스 QA는 `~/tools/shot/`의 playwright-core 패턴 — `/api/projects`는 `page.route`로 가짜 응답 주입. 훅: `window.__READY`, `__setOps(bool)`, `__openSheet(key)`, `__openSettings()`, `__jacehub.{model,catalog,live}`.

## 문서

- 리디자인 결정·명세·QA 캡처: `docs/redesign-20260831/`
- 구 리모델링(7/19) 기록: `design-team-app/20260719-remodeling/decision.md` · 구 spec: `docs/superpowers/specs/`
