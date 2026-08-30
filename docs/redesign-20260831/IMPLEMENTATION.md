# jacehub 전면 개선 — 구현 브리프 (2026-08-31, A안 F01 크림 페이퍼 확정)

결정 기록: `decision.md` · 비주얼 기준: `/mnt/c/Workspace/Projects/jacegates/gates/jacehub-visual-20260831/a-cream.html` (파트너 채택 목업 — **이 파일의 결·조판·시트를 그대로 프로덕션으로 이식**한다) · 카탈로그 정본: `../../catalog.json`

## 목표 파일 구조 (완료 시)

```
jacehub/
├── index.html            ← 재작성 (한 장 통합 정문)
├── style.css             ← 재작성 (F01 토큰 기반, a-cream.html 이식)
├── app.js                ← 재작성 (런처 + 디테일 시트 + 관제 레이어 + 설정 모달/볼트)
├── catalog.json          ← 정본 (수정 금지, 런타임 fetch)
├── icons/apps/<slug>.svg ← 새 아이콘 세트 29종 (F01 결) — icons/lobby/ 는 삭제
├── shots/<slug>.jpg      ← 디테일 시트 스크린샷 29장 (scripts/shots.mjs 산출)
├── scripts/build.mjs     ← 화이트리스트 갱신
├── scripts/shots.mjs     ← 헤드리스 캡처 (오케스트레이터 담당)
├── functions/api/projects.js ← 유지 (변경 없음)
├── functions/api/vault.js    ← lobby 봉투 제거, favorites·credentials 유지
├── test/                 ← lobby 테스트 제거, vault 테스트 갱신
├── retroarch-hotkeys.html ← 그대로 (무관한 치트시트)
└── CLAUDE.md             ← 새 구조로 갱신
삭제: lobby.html · lobby.css · lobby.js · icons/lobby/ · docs/superpowers/(퀘스트 시절 spec — 유지해도 무방, 건드리지 않음)
```

## 역할 분담 (파일 소유권 — 남의 파일은 건드리지 않는다)

| 담당 | 소유 파일 |
|---|---|
| **아이콘 에이전트** | `icons/apps/*.svg` 신규 29종 + `icons/apps/README.md` · 끝나면 `icons/lobby/` 삭제 |
| **프론트 에이전트** | `index.html` `style.css` `app.js` · `functions/api/vault.js` · `test/**` · `scripts/build.mjs` · `CLAUDE.md` · `lobby.*` 삭제 |
| **오케스트레이터(나비)** | `scripts/shots.mjs` + `shots/*.jpg` · 통합 QA · 커밋·push(=GH Actions 자동 배포)·검증 |

**git push 금지** — main push는 GitHub Actions가 즉시 프로덕션 배포한다. 커밋은 해도 되지만 push는 오케스트레이터만.

## 런타임 동작 명세 (프론트)

### 정문 (토큰 없이도 동작)
1. `fetch('catalog.json')` → `sections[].front` 순서대로 섹션 렌더. 타일 = `icons/apps/<slug>.svg`(`<img>`, onerror 시 이니셜 폴백 타일) + 한글 `name`(세리프) + `slug`(모노) + `tag`.
2. **고정 행**: localStorage `jacehub_favorites`(기존 키 유지, 볼트 `favorites` 필드로 동기) — 비어 있으면 기본 `["jacemaster","weneedstress","jacepages","jacefiles"]`. 고정 앱은 소속 섹션에도 남기고 📌 마크(목업과 동일).
3. **타일 탭 → 디테일 시트** (`<dialog>`, 데스크톱 센터 스프레드 / 모바일 바텀시트): `shots/<slug>.jpg`(onerror → "스크린샷 없음" 플레이스홀더) · name/slug/tag · 배포 정보 한 줄(토큰 없으면 `Cloudflare Pages` 또는 `Workers` 타입만) · **열기 ↗**(`url`, `_blank`, `noopener`) · 주소 복사 · **📌 고정 토글** · PREV/NEXT(←/→, 스와이프) · ESC/배경 클릭 닫힘, 닫히면 타일로 포커스 복귀. `url`이 빈 앱은 열기 비활성.
4. 푸터: `N개 앱 · catalog v{version} · {updatedAt}`.

### 관제 레이어 (토큰 있을 때)
5. 크레덴셜은 **기존 app.js의 저장 방식 그대로**(localStorage 키·볼트 PIN 흐름·`/api/vault` GET/POST — 기존 코드를 읽고 재사용, 새 스키마 발명 금지). 헤더 `관제` 스위치 = 크레덴셜 존재 여부. 스위치가 OFF인데 클릭하면 설정 모달을 연다. ON이면 토글로 레이어를 잠시 끌 수 있다(localStorage 기억).
6. ON이면 `/api/projects`(헤더 `X-CF-Account-Id`·`X-CF-Api-Token`·`X-GH-Token`·`X-Vercel-Api-Token`, 기존 로직)로 라이브 목록을 받아 **이름으로 카탈로그와 매칭**(`cfName`이 있으면 그걸로, 없으면 `slug`):
   - 타일 모서리 **상태점**: success=초록 / failure=빨강 / active(진행)=황토 / 정체(≥30일, 기존 `STALE_PROJECT_DAYS` 상수 계승)=회색. 상태색은 F01 액센트(테라코타)와 구분 — 목업의 `--st-*` 로컬 토큰 계승.
   - 시트 배포 정보가 실제 값으로: `{타입} · {N일 전 배포} · {상태 라벨}` + 상태 배지.
   - 정문 아래 **접힌 섹션**(기본 접힘, `<details>` 또는 동등): 🔍 미검수 · 🪦 퇴역 후보 · 🗄 격납고 · 🔒 내부. 격납고 = 카탈로그 `hangar` ∪ **API에 있는데 카탈로그에 없는 프로젝트**(이름·타입만, "미등록" 배지 + "catalog.json에 추가하세요" 힌트). 내부 = API `_type === 'service'` 항목(`_description`·`_health` 사용). 이 섹션들의 타일도 같은 시트를 쓴다(스크린샷 없으면 플레이스홀더).
   - API 실패 시 토스트 + 레이어는 카탈로그만으로 렌더(정문은 절대 깨지지 않는다).
7. ⚙ 설정 모달: 기존 모달(계정 ID·API 토큰·GH 토큰·Vercel 토큰 + 볼트 PIN 연결/저장/불러오기/삭제) 이식. 볼트 봉투에서 `lobby` 필드는 더 이상 보내지 않는다(서버는 무시).
8. **제거**: 레이더 히어로, 검색/정렬/필터 툴바, CSV·리포트 복사, 퀵로비 FAB, 로비 메타 모달, 프로젝트 카드 그리드(구), `jacehub_lobby_*` localStorage(읽지 않음, 있으면 삭제).

### 품질
- F01 토큰(`/mnt/c/Workspace/Projects/jacedesign/system/tokens/css/F01.css`)을 `:root`에 인라인, 값은 `var(--jd-*)`. 원자 4값 1세트. 폰트 3역할(세리프 제목 / 모노 슬러그·수치 / Pretendard 본문). 폰트는 a-cream.html과 같은 링크.
- 반응형 390~1440, 가로 스크롤 금지(고정 행 캐러셀 제외). `prefers-reduced-motion` 존중. 터치 타깃 ≥44px.
- `npm test` 통과(갱신된 테스트), `npm run build` 통과(새 화이트리스트: `index.html style.css app.js catalog.json retroarch-hotkeys.html` + 디렉토리 `functions icons shots`), `node --check`.
- **헤드리스 QA 필수**: `~/tools/shot/`에 임시 mjs(playwright-core, 기존 패턴)로 `npx wrangler pages dev dist`(또는 `dist`를 정적 서빙)에서 (1) 정문 데스크톱/모바일 (2) 시트 (3) 관제 ON — 관제는 `page.route('**/api/projects', …)`로 가짜 응답(성공/실패/진행/정체/미등록/service 섞어서)을 주입해 검증. 콘솔 에러 0. 캡처는 `docs/redesign-20260831/qa/*.png`. 임시 mjs 삭제.
- `CLAUDE.md`: 화면 1장 구조·catalog.json 규약(앱 추가 = apps[]에 한 줄 + icons/apps/<slug>.svg + shots/<slug>.jpg 재캡처)·관제 레이어·볼트 변경·배포(GH Actions 자동 + 수동 wrangler dist) 반영.

## 아이콘 세트 명세 (아이콘 에이전트)

- 대상 29종 = catalog.json의 `section ∈ {game,life,tool,archive,huchu,unreviewed,retire}` 전부. 파일명 `icons/apps/<slug>.svg`.
- 결: **F01 크림 페이퍼 에디토리얼 — "종이에 찍은 스탬프·라벨"**. viewBox `0 0 64 64`, 타일 `rx=14`. 배경은 **차분한 에디토리얼 팔레트 8색 중 앱 성격에 맞춰 1색**(무채 단색 또는 아주 미세한 2톤): 테라코타 `#c46442` · 올리브 `#6f7a4b` · 슬레이트블루 `#5a6d8c` · 머스터드 `#c9a03d` · 플럼 `#7a5470` · 틸 `#3f7f7a` · 웜그레이 `#948f80` · 잉크 `#201e1a`. 글리프는 크림 `#f6f1e6`, 스트로크 3.5 round cap/join, 중앙 12~52 존, 포인트 색 최대 1개(테라코타, 잉크 타일에서만). 그라데이션 화려함 금지 — 종이 위 잉크 스탬프처럼 단정하게.
- 글리프는 앱의 `tag`에서 은유를 딴다(예: 나이트폴=달+체스말, 주머니=주머니, 방 매니저=침대, 유튜브뮤직 월드컵=음표+트로피 …). 같은 섹션끼리 색이 몰리지 않게 분산.
- 스킬 `/home/jacey/.claude/skills/svgasset/SKILL.md`의 **벌크 모드** 절차를 따른다(헤드리스 렌더 눈검사 통과분만 납품). `icons/apps/README.md`에 매핑표·규약 기록. 끝나면 `icons/lobby/` 삭제(`git rm -r`).

## 스크린샷 (오케스트레이터)

`scripts/shots.mjs` — catalog.json의 `url`이 있는 29종을 1280×800에서 캡처 → `shots/<slug>.jpg`(jpeg q60). 로그인 뒤 앱(jacemaster·jacefiles·weneedstress)·roommanager는 파트너 제공 스크린샷으로 교체 예정(수동 덮어쓰기, 스크립트가 덮지 않도록 `--only <slug>` 옵션·`shots/manual.json` 제외 목록).
