# CLAUDE.md — jacehub

Cloudflare/Vercel/GitHub 프로젝트 대시보드 + 즐겨찾기 보관소 + 데일리 퀘스트 시스템.

## Cloudflare Deployment

- **Platform**: Cloudflare Pages
- **Project name**: `jacehub`
- **Production branch**: `main`
- **Build**: `npm run build` → `dist/` (정적 + `functions/` + `lib/` 복사)
- **Deploy command**: `wrangler pages deploy --project-name=jacehub --branch=main`
- **URL**: https://jacehub.pages.dev

> 배포 시 반드시 `--branch=main`을 명시하세요.
>
> ⚠️ **`.`(루트) 말고 `dist`를 배포한다.** `wrangler.toml`에 `pages_build_output_dir = "dist"`가 있어 디렉토리 인자를 생략하면 `dist`가 올라간다. Functions가 `../../lib/quest-logic.js`를 import하므로 `lib`가 포함된 `dist`를 올려야 import가 안 깨진다.

## Bindings (`wrangler.toml`이 source of truth)

- **VAULT** (KV, `jacehub-vault`): 6자리 PIN 기반 크레덴셜·즐겨찾기 보관소 (AES-GCM 암호화)
- **DB** (D1, `jacehub-db`): 퀘스트 시스템

> ⚠️ 바인딩 기준은 `wrangler.toml`이다. 새 바인딩을 추가할 때 기존 것(VAULT·DB)을 빠뜨리면 deploy 때 떨어져 나가 기능이 깨진다. 반드시 전부 유지할 것.

## 퀘스트 시스템

즐겨찾기 앱별 데일리 퀘스트를 정의하고, 각 앱이 행동을 **Push**로 보고하면 자동 카운트한다.

- **페이지**: `/quests.html` (별도 페이지, lobby 패턴)
- **API**:
  - `POST /api/ingest` `{pin, app, event_type?, count?=1}` — 각 앱이 호출하는 수집구
  - `/api/quests` (GET/POST/PUT/DELETE) — 퀘스트 CRUD (PIN 필요)
  - `GET /api/progress?pin=` `[&date=]` 오늘 현황+스트릭 / `[&from=&to=]` 기간 잔디·통계
- **순수 로직**: `lib/quest-logic.js` (KST 날짜·이벤트 매칭·스트릭) — `npm test` (`node --test`)
- **D1 스키마**: `schema.sql` (`quests` / `quest_events` / `daily_progress`)
- **인증**: vault와 동일한 6자리 PIN 원본 재사용 (개인용)
- **앱 연동**: 각 앱에 `reportQuest` 헬퍼를 심고 `JACEHUB_PIN` secret 설정. 첫 파일럿 = **rituall** (아침/저녁 의식 → `morning_ritual`/`evening_ritual`).

## Local Dev / Test

```bash
npm test                                              # 순수 로직 단위 테스트
npm run build                                         # dist 생성
npx wrangler d1 execute jacehub-db --local --file schema.sql   # 로컬 D1 스키마
npx wrangler pages dev .                              # 로컬 미리보기 (toml 바인딩 자동 인식)
```

원격 D1 스키마 적용: `npx wrangler d1 execute jacehub-db --remote --file schema.sql`

## 문서

- 설계 spec: `docs/superpowers/specs/`
- 구현 계획: `docs/superpowers/plans/`
