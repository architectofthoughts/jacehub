# 앱 안에서 섹션 이동 — 결정·구현 기록 (2026-09-05)

요청: "JaceHub 웹앱 내부에서 카테고리 변경 지원 — 유튜브뮤직 월드컵이 게임에 있는데 생활·생산성으로 앱에서 옮기고 싶다." `/clearfy` 라이트 인터뷰 2문항으로 확정.

## 결정

| 질문 | 선택 | 기각안 |
|---|---|---|
| 바뀐 카테고리는 어디에 사나 | **정본 커밋** — 설정의 GitHub 토큰으로 `catalog.json`을 main에 커밋 → GH Actions 배포. 정본이 계속 진실, 모든 기기·방문자가 같은 걸 봄 | 기기 오버라이드+볼트 동기(정본과 화면이 갈라짐) · 하이브리드(상태 두 겹) |
| 유튜브뮤직 월드컵 첫 이동 | **배포 후 파트너가 앱에서 직접** — 첫 실사용 테스트. 토큰에 jacehub 레포 Contents 쓰기 권한 필요 | 이 커밋에 catalog.json도 같이 고침 |

UI 형태는 묻지 않고 정함 — 디테일 시트의 📌 고정 옆에 **섹션 셀렉트**(모바일 바텀시트에서도 동작, 드래그 없음).

## 구현

- `functions/api/catalog.js` — `PATCH /api/catalog {slug, section}` + `X-GH-Token`. GitHub Contents API로 읽고(sha) → 앱 줄 1개를 목적지 그룹 끝으로 이동 → 자가 검증 → PUT. 관행 깨진 파일은 정규 포맷 재작성. 409 충돌 1회 재시도. 서버 시크릿 없음.
- `app.js` — 시트 `fillSectionControl` / `handleSectionChange`, 낙관 반영 `jacehub_pending_moves`(정본 배포 확인 시 삭제, 24h TTL), 타일·콜로폰 "반영 중" 표시, 셀렉트 위 ←/→ 가로채기 해제.
- `index.html` — `#sh-secmove` 블록, GitHub 토큰 안내 문구.
- `style.css` — `.secmove*` (셀렉트는 `.btn-copy`와 같은 카드 원자, 상태는 `--st-run` 진행색), `.pend`.
- `test/catalog.test.js` 18케이스 · 헤드리스 QA 5시나리오(토큰 無/有·모바일·배포 후 정리·403 복구) 콘솔 에러 0.

## 남긴 것

- 미등록 앱(API에만 있음)은 이 경로로 못 옮긴다 — catalog.json에 먼저 등록해야 함(의도).
- 섹션 외 필드(name·tag·url) 편집은 범위 밖. 필요해지면 같은 API에 필드를 넓히면 된다.
