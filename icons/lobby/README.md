# jacehub 로비 아이콘 세트

2026-07-05 svgasset 스킬로 제작. 서빙 중인 14개 앱(배포표 기준, jacehub 자신 제외)의 즐겨찾기 타일용 아이콘. 같은 날 jacemaster·crazy-dice 추가로 16종. (배포표에 없는 앱도 대시보드에 잡히면 폴백이 나니, 새 앱 서빙 시 여기에 아이콘을 증산할 것.)

## 세트 공통 규약 (증산 시 이 스펙을 따를 것)

- viewBox `0 0 64 64`, 타일 `rx=14`, 배경은 앱별 성격 그라데이션 135°(`x1=0 y1=0 x2=1 y2=1`, 밝은색 → 어두운색)
- 글리프는 흰색(`#fff`, 먹빛 계열 타일만 `#f5f1e6`), 스트로크 3.5 / round cap·join, 중앙 12~52 존 안에
- 포인트 색 최대 1개 (kyou·hoochoobothome의 낙관 레드 `#e0452f`)
- 그라데이션 id는 파일명 접두 2글자 (`ky-g`, `fw-g`, …) — 인라인 삽입 충돌 방지

## 파일 ↔ 앱 매핑 (manifest.json과 동일)

| 파일 | 앱 | 글리프 |
|---|---|---|
| kyou.svg | 響 쿄우 | 먹빛 베기 궤적 + 낙관 |
| fateweaver.svg | Fateweaver | 날실 3가닥 + 운명의 씨실 |
| yggdrasil-demo.svg | Yggdrasil 웹데모 | 세계수 룬 |
| learneverything.svg | LearnEverything | 펼친 책 |
| bestserveddish.svg | bestserveddish | 클로슈(요리 덮개) |
| blurryjourney.svg | BlurryJourney | 종이비행기 + 점선 |
| youtubewc.svg | YouTubeMusicWC | 연결 음표 (manifest에 워커명 `youtubemusicwc` + 레포명 `youtubewc` 별칭 둘 다 등록) |
| jacemaster.svg | jacemaster | 허브 타일 4분할 그리드 + 체크 (petrol #4fa8bd→#1f5e73) |
| crazy-dice.svg | CRAZY DICE | d20 주사위 와이어프레임 (fuchsia #d946ef→#86198f) |
| crossbell.svg | crossbell | 종 |
| akashicrecords.svg | 아카식 레코드 | 별 새긴 고서 |
| jacepages.svg | jacepages | 겹친 문서 |
| roommanager.svg | 방 매니저 | 침대 |
| weneedstress.svg | weneedstress | 번개 |
| hoochoobothome.svg | 후추봇 홈 | 집 + 고추 |
| refboard.svg | refboard | 핀 꽂은 카드 |

`preview.html`을 브라우저로 열면 배경 3종 그리드로 전체 세트를 확인할 수 있다.
