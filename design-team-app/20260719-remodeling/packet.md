# 컨텍스트 패킷 — jacehub 리모델링 (2026-07-19)

## 주제

**jacehub 리모델링 계획.** 무엇을 어떻게 뜯어고칠지는 열려 있음(사용자가 "리모델링"이라고만 지정 — 구체 불만 지점 미확정). 팀은 IA·화면·기능 구성 전반에서 리모델링 방향을 제안할 것.

## 앱 개요

- **정체**: 개인용(사용자 1인) 프로젝트 대시보드 + 앱 런처 + 데일리 퀘스트 시스템. https://jacehub.pages.dev
- **코어 가치**: 흩어진 배포물(CF Pages/Workers·Vercel·GitHub·셀프호스트 서비스)을 한 화면에서 보고, 자주 쓰는 앱을 바로 열고, 앱 사용을 데일리 퀘스트로 습관화.
- **화면 3장 (별도 HTML, 상호 링크)**:
  1. `index.html` + `app.js`(1,924줄) — 관리 대시보드: 프로젝트 카드(CF/Vercel/GitHub 상태), 셀프호스트 서비스 카드(warren·ccwatch, CF Tunnel 헬스 배지), 설정 모달(API 토큰), PIN 볼트(AES-GCM 크레덴셜·즐겨찾기), 우하단 quick popup lobby FAB
  2. `lobby.html` + `lobby.js`(462줄) — iOS 앱스토어풍 런처: 토큰리스(대시보드가 저장한 스냅샷 캐시 사용), 즐겨찾기 그리드, SVG 타일 아이콘 manifest, NEW/UPDATED 배지
  3. `quests.html` + `quests.js`(218줄) — 데일리 퀘스트: 앱별 퀘스트 CRUD, 각 앱이 `POST /api/ingest`로 행동 보고 → 자동 카운트, 스트릭+기간 잔디. 첫 파일럿 연동 = rituall
- **백엔드**: CF Pages Functions (`functions/api/`: projects·vault·quests·ingest·progress) + KV `VAULT` + D1 `DB`. 순수 로직 `lib/quest-logic.js`(node --test).
- **스택**: 바닐라 JS/CSS (프레임워크 없음), 총 ~5,300줄. 빌드는 dist 복사 수준.

## 제약

- 플랫폼: CF Pages + Functions + KV + D1 유지가 기본 전제 (배포 규약: `--branch=main`, dist 배포, 바인딩 VAULT·DB 절대 유지)
- 타깃 사용자: 본인 1인 (PIN 6자리 인증, 폰+PC 겸용)
- 수익모델: 없음 (개인 도구)
- 개발 여력: 솔로+AI, 리모델링에 큰 리라이트도 가능하나 데이터(볼트 KV·퀘스트 D1)는 보존 필요
- 생태계: 이 대시보드는 사용자의 앱 함대(jacemaster·warren·ccwatch·rituall·crossbell 등)의 관제탑 격 — 다른 앱들과의 연동(퀘스트 ingest, 셀프호스트 카드)이 확장 중

## 관련 파일

- `/mnt/e/Workspace/Projects/jacehub/CLAUDE.md` — 배포·바인딩·퀘스트 시스템 요약
- `/mnt/e/Workspace/Projects/jacehub/{index,lobby,quests}.html`, `{app,lobby,quests}.js`
- `/mnt/e/Workspace/Projects/jacehub/functions/api/*.js`, `lib/quest-logic.js`, `schema.sql`
- `/mnt/e/Workspace/Projects/jacehub/docs/superpowers/specs/2026-05-31-quest-system-design.md`

## 미확정

- 사용자의 구체 불만 지점 (성능? 시각? IA 3분할? 기능 과소/과다?)
- 리모델링 후 3페이지 유지 여부 — 팀 제안 대상
