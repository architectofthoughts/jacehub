# jacehub 앱 아이콘 세트 (`icons/apps/`)

2026-08-31 전면 개선(A안 F01 크림 페이퍼 에디토리얼)에서 svgasset 벌크 모드로 제작. `catalog.json`의 `section ∈ {game, life, tool, archive, huchu, unreviewed, retire}` 29종 전부 — 파일명은 `<slug>.svg`, 정문이 `icons/apps/<slug>.svg`를 `<img>`로 로드한다(없으면 이니셜 폴백 타일). 구 `icons/lobby/`(그라데이션 세트)는 같은 날 폐기.

눈검사 컨택트 시트: `docs/redesign-20260831/qa/icons-contact.png`

## 세트 공통 규약 (증산 시 이 스펙을 따를 것)

- **결**: 종이에 찍은 스탬프·라벨. 단색 타일 + 크림 잉크 글리프. 그라데이션·그림자·하이라이트 금지.
- **규격**: viewBox `0 0 64 64`, 타일 `<rect rx="14">`, 글리프는 중앙 **12~52 존** 안.
- **타일 색**: 아래 8색 중 앱 성격에 맞춰 1색. 같은 섹션 안에서 색이 겹치지 않게 분산.

  | 이름 | HEX | 이름 | HEX |
  |---|---|---|---|
  | 테라코타 | `#c46442` | 플럼 | `#7a5470` |
  | 올리브 | `#6f7a4b` | 틸 | `#3f7f7a` |
  | 슬레이트블루 | `#5a6d8c` | 웜그레이 | `#948f80` |
  | 머스터드 | `#c9a03d` | 잉크 | `#201e1a` |

- **라벨 프레임(미세 2톤)**: 모든 타일에 `<rect x="3.5" y="3.5" width="57" height="57" rx="11" fill="none" stroke="#f6f1e6" stroke-opacity=".22"/>` — 라벨 테두리 느낌을 주는 유일한 2톤 요소.
- **글리프**: 크림 `#f6f1e6`. 스트로크 `3.5`, `stroke-linecap="round" stroke-linejoin="round"`(보조선은 3, 아주 가는 장식선은 2~2.5). 면 채움도 크림. 겹침으로 뒤를 가려야 할 때만 타일 색으로 채운다(jacepages 앞장, steam-chronicle 가운데 노드).
- **포인트 색**: 테라코타 `#c46442` 1점 최대, **잉크 타일에서만** (kyou 낙관, maai 간격점). 다른 타일엔 포인트 색 없음.
- **은유**: 앱의 `tag`에서 딴다. 48px(정문 타일)·36px(고정 행)에서 읽혀야 하므로 요소 3개 이하, 가는 디테일 금지.
- id·defs·외부 참조 없음(인라인 삽입 안전). 좌표 소수점 2자리까지.

## 파일 ↔ 앱 매핑

| 파일 | 섹션 | 앱 | 글리프 은유 | 타일 색 |
|---|---|---|---|---|
| crazy-dice.svg | game | CRAZY SLOT | 슬롯 창 3릴(심볼 점) + 레버 | 머스터드 |
| yggdrasil-demo.svg | game | 이그드라실 | 세계수 — 구름형 수관·줄기·뿌리 | 올리브 |
| lumi-nightfall.svg | game | 나이트폴 | 초승달 + 체스 폰 | 잉크 |
| youtubewc.svg | game | 유튜브뮤직 월드컵 | 트로피 속 음표 | 테라코타 |
| jacemaster.svg | life | 제이스마스터 | 허브 타일 2×2(하나 채움) | 슬레이트블루 |
| weneedstress.svg | life | 위니드스트레스 | 덤벨 | 테라코타 |
| roommanager.svg | life | 방 매니저 | 침대(베개·이불) | 틸 |
| learneverything.svg | life | 런에브리씽 | 학사모 + 술 | 올리브 |
| jacetunes.svg | life | 제이스튠즈 | 연결된 음표 | 플럼 |
| warren.svg | tool | 워런 | 터미널 창과 프롬프트 | 틸 |
| jacepages.svg | tool | 제이스 페이지 | 겹친 문서 두 장 | 웜그레이 |
| jacewiki.svg | tool | 제이스 위키 | 펼친 책 | 슬레이트블루 |
| jacefiles.svg | tool | 주머니 | 끈 묶은 주머니 | 머스터드 |
| kyou.svg | archive | 響 쿄우 | 수묵 베기 궤적 + 낙관(테라코타 포인트) | 잉크 |
| fateweaver.svg | archive | 페이트위버 | 날실 3가닥 + 운명의 씨실 | 플럼 |
| jaceskills-manual.svg | archive | 스킬 매뉴얼 | 문서 안 프롬프트 `>_` | 틸 |
| akashicrecords.svg | archive | 아카식 레코드 | 별 새긴 고서 | 슬레이트블루 |
| lifesong-timecapsule.svg | archive | 인생곡 타임캡슐 | 레코드판 + 음표 | 머스터드 |
| blurryjourney.svg | archive | 블러리 저니 | 종이비행기 + 점선 궤적 | 올리브 |
| hoochoobothome.svg | huchu | 후추네 가족 | 집 + 하트 | 테라코타 |
| huchu-carelog.svg | huchu | 후추 케어 원장 | 클립보드 + 체크 | 틸 |
| huchu-boardgames.svg | huchu | 후추 보드게임 | 주사위 5눈 | 플럼 |
| maai.svg | unreviewed | 마아이(間合) | 마주 선 두 셰브론 + 간격점(테라코타 포인트) | 잉크 |
| botarena.svg | unreviewed | 봇 콜로세움 | 로봇 머리(안테나·눈·입) | 슬레이트블루 |
| casebook.svg | unreviewed | 한 밤의 사건부 | 돋보기 | 플럼 |
| voiceclimb.svg | unreviewed | 목청 등반 | 상승 음량 막대 + 정상 깃발 | 머스터드 |
| command-dojo.svg | unreviewed | 커맨드 도장 | ↓↘→ 커맨드 화살 + 버튼 | 테라코타 |
| magazine-stand.svg | unreviewed | 잡지 가판대 | 잡지 표지(제호 바·사진 블록·본문 줄) | 웜그레이 |
| steam-chronicle.svg | unreviewed | 스팀 14년 연대기 | 타임라인 3노드 + 눈금 | 올리브 |
| yongin-bezanson-2026.svg | retire | 베잔송 2026 | 여행 가방 | 웜그레이 |
| fighting-combo-archive.svg | retire | 격투 콤보 아카이브 | 연타 셰브론 ×2 + 히트 스파크 | 플럼 |

색 분포: 테라코타 4 · 올리브 4 · 슬레이트블루 4 · 머스터드 4 · 플럼 4 · 틸 3 · 웜그레이 3 · 잉크 3.

## 증산 방법 (앱 추가 시)

1. `catalog.json` `apps[]`에 앱을 추가한 뒤, 이 폴더에 `<slug>.svg`를 만든다. 아래 뼈대를 복사하고 `TILE`·글리프만 바꾼다:

   ```svg
   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
     <rect width="64" height="64" rx="14" fill="TILE"/>
     <rect x="3.5" y="3.5" width="57" height="57" rx="11" fill="none" stroke="#f6f1e6" stroke-opacity=".22"/>
     <g fill="none" stroke="#f6f1e6" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
       <!-- 글리프: 12~52 존 -->
     </g>
   </svg>
   ```

2. 타일 색은 **그 앱이 속한 섹션 안에서 아직 안 쓰인 색** 우선, 그다음 세트 전체에서 수가 적은 색(현재 틸·웜그레이·잉크가 3개).
3. 눈검사 없이 넣지 않는다 — 크림 `#faf9f5` 지면에 48px·36px·128px로 렌더해 확인(`~/tools/shot/shot.mjs`, svgasset 스킬 §검증). 세트 전체 그리드에 같이 놓고 튀지 않는지 본다.
4. 이 표에 한 줄 추가.
