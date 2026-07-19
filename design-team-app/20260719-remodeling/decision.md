# decision.md — jacehub 리모델링 (2026-07-19 결정)

## 사용자 선택

**`1A 2B 3A 4C 5A 6A` + 퀘스트 시스템은 jacehub에서 제거, jacemaster로 이전**

- 축 1 정문: **1A** — 현행 그리드 대시보드 정문 유지
- 축 2 상태의 집: **2B** — localStorage 스냅샷·즐겨찾기를 KV 볼트 봉투로 승격 (폰↔PC 동기)
- 축 3 데일리 루프 노출: **3A** — 단, 퀘스트 이전으로 jacehub 내 노출 자체가 소멸 (사실상 해당 없음)
- 축 4 퀘스트 발행 주체: **4C** 병행(습관 품질 회수 + 함대 레인) — **적용지는 이전처인 jacemaster** (이식 후 2라운드)
- 축 5 허브의 동사: **5A** — 읽기 전용 유지 (⚡ 발주 도입 안 함)
- 축 6 IA 골격: **6A** — MPA + 공통 탭, 퀘스트 페이지 제거로 **2장(허브·로비) 구성으로 조정**

## 한 줄 근거

jacehub는 "보는 관제탑 + 런처"로 홀쭉하게, 습관·퀘스트 루프는 생활 통합 PWA인 jacemaster로 — 도구별 정체성 분리.

## 파생 작업 범위 (사인 후 착수)

- **jacehub 제거**: quests.html/js/css, `functions/api/{quests,ingest,progress,_quest_shared}.js`, `lib/quest-logic.js`, D1 `DB` 바인딩·schema.sql — 단 **jacemaster 이식·데이터 이전 완료 확인 후** 제거 (그 전까진 공존)
- **jacehub 2B**: 로비 스냅샷·메타를 기존 `syncFavoritesToVault()` 봉투 결로 KV 동기화, 허브·로비 2장 탭 정리
- **jacemaster 이식**: D1 스키마 + quest-logic + ingest/progress API + 퀘스트 UI(5탭 셸 내), 연동 앱(rituall 등) 엔드포인트 전환
- **데이터**: 퀘스트 D1 백업 → 이전, VAULT KV는 유지 (2B에서 계속 사용)

## 집행 로그 (2026-07-19, 커밋 74fb933)

- 정찰 결과 **이식은 이미 6월에 완료돼 있었음**: jacemaster가 자체 퀘스트 시스템(스키마+API+카탈로그 11종)의 정본(6퀘스트·170이벤트), jacehub 잔존분은 첫날 스모크 2행뿐. rituall도 jacemaster 내장이라 엔드포인트 전환 불필요.
- jacehub-db 전체 덤프 → `backup/jacehub-db-20260719.sql` 후 퀘스트 코드·D1 바인딩 전면 제거 (D1 인스턴스 자체는 CF에 휴면 보존).
- 2B 구현: 볼트 봉투에 `lobby{cache,meta}` 동승(서버는 필드 부재 시 이월), 대시보드 디바운스 동기화, 로비 백그라운드 하이드레이션(savedAt 최신 우선)+빈 화면 PIN 버튼. node --test 4/4, 헤드리스 E2E(새 기기 시나리오)·프로덕션 smoke 통과.
- 구 `/quests.html` 경로는 Pages SPA 폴백으로 허브에 안착(무해).

## 리뷰 관찰 포인트 (→ /rteam)

- 2B 승격 후 폰↔PC 즐겨찾기·스냅샷 동기 일관성 — 충돌 시 최신 우선이 체감상 자연스러운지
- 퀘스트 제거 후 허브·로비 2장 구성에서 죽은 링크·빈 동선(FAB·탭)이 없는지
- ingest를 쏘던 연동 앱(rituall 등)의 엔드포인트 전환 누락 — 이전 후 404 조용한 실패 감지
