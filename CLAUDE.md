# CLAUDE.md — jacehub

Cloudflare/Vercel/GitHub 프로젝트 대시보드 + 즐겨찾기 보관소.

> 데일리 퀘스트 시스템은 2026-07-19 리모델링에서 **jacemaster로 완전 이관** (원래 6월에 jacemaster가 자체 구현으로 흡수했고, 여기 남아 있던 화석을 제거). 마지막 D1 덤프: `design-team-app/20260719-remodeling/backup/`.

## Self-hosted 서비스 카드

CF/Vercel API에 안 잡히는 셀프호스트 서비스(warren·ccwatch, bani WSL + CF Tunnel/Access)는 `functions/api/projects.js`의 `SELF_HOSTED_SERVICES` 상수로 직접 합류시킨다. 항목 추가/제거는 그 상수만 고치면 된다. 헬스 배지는 CF Tunnel API(`cfd_tunnel`)로 조회 — 사용자 API 토큰에 **Account > Cloudflare Tunnel:Read** 권한이 있어야 라이브(온라인/오프라인)로 뜨고, 없으면 "상태 미확인"으로 폴백된다. 클라이언트는 `_type: 'service'` 분기(app.js: 상태 키·레이더·정렬 고정·카드 태그)로 처리.

## Cloudflare Deployment

- **Platform**: Cloudflare Pages
- **Project name**: `jacehub`
- **Production branch**: `main`
- **Build**: `npm run build` → `dist/` (정적 + `functions/` 복사)
- **Deploy command**: `wrangler pages deploy --project-name=jacehub --branch=main`
- **URL**: https://jacehub.pages.dev

> 배포 시 반드시 `--branch=main`을 명시하세요.
>
> ⚠️ **`.`(루트) 말고 `dist`를 배포한다.** `wrangler.toml`에 `pages_build_output_dir = "dist"`가 있어 디렉토리 인자를 생략하면 `dist`가 올라간다.

## Bindings (`wrangler.toml`이 source of truth)

- **VAULT** (KV, `jacehub-vault`): 6자리 PIN 기반 크레덴셜·즐겨찾기·로비 스냅샷 보관소 (AES-GCM 암호화)

> ⚠️ 바인딩 기준은 `wrangler.toml`이다. 새 바인딩을 추가할 때 기존 것(VAULT)을 빠뜨리면 deploy 때 떨어져 나가 기능이 깨진다. 반드시 전부 유지할 것.

## 화면 2장

- `index.html` — 관리 대시보드 (토큰 설정·볼트·프로젝트 카드)
- `lobby.html` — 토큰리스 런처 (대시보드가 저장한 스냅샷으로 렌더, KV 스냅샷 폴백으로 폰↔PC 동기)

## Local Dev / Test

```bash
npm test                  # 순수 로직 단위 테스트
npm run build             # dist 생성
npx wrangler pages dev .  # 로컬 미리보기 (toml 바인딩 자동 인식)
```

## 문서

- 설계 spec: `docs/superpowers/specs/`
- 리모델링 결정 기록: `design-team-app/20260719-remodeling/decision.md`
