# homesell 계산기

연봉·급여·4대보험·프리랜서(3.3%·종합소득세·지역 건강보험) 계산기. 소득세는 **국세청 근로소득 간이세액표 원문**(소득세법 시행령 별표2, 2026.2.27 개정)을 그대로 조회하고, 4대보험은 공단 요율을 기준일별로 적용한다.

- 운영: <https://calc.homesell.co.kr> — Cloudflare Workers + Neon(Hyperdrive) + R2
- 문서: [기획서](docs/PLANNING.md) · [계산식](docs/FORMULAS.md) · [플로우차트](docs/FLOWS.md) · [디자인](docs/DESIGN.md) · [QA 계획](docs/QA-PLAN.md) · [배포·운영](docs/DEPLOY.md)

## 구조

```
src/core/      계산 코어 (순수 TS, 서버·브라우저 공용)  ← 모든 계산식은 docs/FORMULAS.md 와 1:1
src/render/    결과·폼 HTML 문자열 (서버·브라우저 공용)
src/server/    Hono Worker: 페이지·API·DB·R2·엑셀/PDF·예약 작업
src/client/    브라우저 보강 스크립트(즉시 재계산) → public/js/app.js
data/rates/    연도별 요율·간이세액표 JSON (근거·검증 여부 포함)
data/source/   공식 원문 보관 (PDF/텍스트)
migrations/    Neon 스키마
tests/         core(단위·골든) · server(스모크) · db(통합) · e2e(Playwright)
```

## 원칙
- 계산은 DB 없이 동작한다 (요율은 번들). DB 는 공유 링크·통계·신고·이력용.
- 값이 공식 원문으로 확인되지 않았다면 `rates.json` 에 `verified:false` 로 두고 `/basis` 에 공개한다.
- 금액은 정수(원), 요율은 정수 비율로 곱해 부동소수 오차를 피한다.

시작하기·배포는 [docs/DEPLOY.md](docs/DEPLOY.md).
