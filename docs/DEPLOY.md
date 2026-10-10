# 배포·운영 안내

운영 구성: **Cloudflare Workers(`homesell-calc`) + Neon Postgres(Hyperdrive) + R2**. 주소는 `https://calc.homesell.co.kr`.
가계부(`account.homesell.co.kr`)와 DB·R2·계정을 공유하지 않는다. (가계부 쪽 배경: accountbook 저장소 `docs/CLOUDFLARE.md`, `docs/DEPLOY.md`)

## 구성 요약

| 부분 | 이름 | 비고 |
|---|---|---|
| Worker | `homesell-calc` | `wrangler.jsonc`, 매일 03:00 KST 예약 작업(만료 데이터 삭제) |
| DB | Neon 프로젝트 `homesell-calc` (AWS 싱가포르 권장) | Hyperdrive `homesell-calc-db` (쿼리 캐시 끔) |
| 파일 | R2 버킷 `homesell-calc-files` | `exports/` 7일 캐시, `sources/` 근거 원문(`/sources/…` 로 공개) |
| 주소 | `calc.homesell.co.kr` | Workers Route + DNS(대시보드에서만) |
| 비밀값 | (선택) Worker secret `IP_SALT` | 제한 계산용 해시 솔트. 없으면 고정 문자열 |

## 처음 한 번 (순서대로)

1. **GitHub 저장소** — `domminc/calc` (이 코드를 `main` 으로 병합).
2. **Neon 프로젝트** `homesell-calc` — *Connect → Direct connection*(풀러 아님) 주소.
3. **Cloudflare API 토큰** — 권한(계정 범위): Workers Scripts: Edit · Workers R2 Storage: Edit · Hyperdrive: Edit · Account Settings: Read. 계정 ID 는 Workers & Pages 개요에 있다.
4. **저장소 Secrets** (Settings → Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL`(2번 주소).
5. **Actions → "배포" → Run workflow** (이후엔 main 에 병합할 때마다 자동). 배포 단계가 **R2 버킷 `homesell-calc-files`(7일 캐시 규칙 포함)와 Hyperdrive `homesell-calc-db` 를 없으면 만들고** id 를 찾아 쓴다 → 마이그레이션 → 근거 원문 R2 업로드 → 배포 → `/api/health` 확인.
6. **도메인** (Cloudflare 대시보드에서만 — DNS·Route 는 코드로 관리하지 않는다)
   1. DNS: `calc` AAAA `100::` **프록시 켬** (자리표시, 실제 응답은 Cloudflare 가 한다)
   2. Workers & Pages → `homesell-calc` → Settings → Domains & Routes → Route `calc.homesell.co.kr/*`
7. 확인: `https://calc.homesell.co.kr/api/health` 가 `"상태":"정상"`, `"DB_연결":"Hyperdrive"`, `"파일_저장":"R2"`, `"DB_응답":"정상"`.
8. **법령 감시 설정** — Settings → Actions → General → **"Allow GitHub Actions to create and approve pull requests"** 켜기 (간이세액표 자동 갱신 PR 용). (선택) Secrets `LAW_OC` — 법제처 OPEN API 인증키. 자세한 운영은 [LAW-WATCH.md](LAW-WATCH.md).
9. **대문 카드 연결** — accountbook 저장소의 `landing/public/index.html` 카드 변경(브랜치 `claude/salary-calculator-site-q7sp7u`)을 **6·7 확인 뒤** 병합한다. 먼저 병합하면 대문 카드가 아직 없는 주소로 연결된다.

## 평소 배포
- main 에 병합 → Actions **배포** 가 자동 실행. 검사나 마이그레이션이 실패하면 배포하지 않아 옛 버전이 그대로 돈다.
- 마이그레이션: `migrations/` 에 새 `.sql` 추가(이름 순서 적용, 적용 기록 `calc_meta.migrations`). 기존 파일은 고치지 않는다.
- 롤백: Actions 에서 이전 커밋으로 **배포 → Run workflow**(Branch/태그 선택) 또는 `wrangler rollback`.

## 요율·법령 변경 반영
법령 변경은 **매일 자동 감시**되고(`법령 변경 감시` 워크플로), 시행일에 맞춰 요율 세트가 자동 전환된다. 이슈(`law-change`)나 간이세액표 PR 이 생기면 [LAW-WATCH.md §3](LAW-WATCH.md) 절차로 반영한다.
새 연도 세트는 `data/rates/<연도>/rates.json`(`extends` + `overrides`)을 만들고 `npm run build:registry` 한 번이면 되고, 코드 수정은 필요 없다.

## 로컬 개발

```bash
npm install
npm run build:client              # public/js/app.js
npm test                          # 단위·골든 테스트 (DB 불필요)
npm run test:db                   # 임시 Postgres 로 마이그레이션·DB 통합 테스트
npm run test:e2e                  # 임시 Postgres + 로컬 Worker + Playwright
# 수동 확인: 임시 Postgres 를 띄운 뒤 (source scripts/pg-temp.sh && pg_start && node scripts/migrate.mjs)
npm run dev                       # wrangler dev --local (http://127.0.0.1:8787)
```
필요: Node 22, Postgres 15+ 바이너리(`pg_ctl`·`initdb`), 크로미움(`CHROMIUM_PATH` 또는 `npx playwright install chromium`).

## 장애 대응
| 증상 | 확인 |
|---|---|
| 공유 링크·신고 실패 | `/api/health` 의 `DB_응답`. Neon 일시 중지(무료 플랜 자동 정지) 후 첫 요청은 느릴 수 있음. 계산·내려받기는 DB 없이 동작 |
| 내려받기 실패 | Worker 로그(Observability)에서 `export failed`. 입력값 오류는 400 |
| 결과가 공단 값과 다름 | `/feedback` 신고 → `/basis` 미확정 항목(U1~U8) 확인 → 확정되면 `rates.json` 의 `verified` 갱신 |
| 법령 감시 이슈/알림 | Actions `법령 변경 감시` 로그, 이슈 라벨 `law-change`·`law-manual`·`law-sync` |
| 배포 후 화면이 옛 버전 | 정적 자산은 `?v=<커밋>` 으로 갱신. HTML 은 최대 5분 캐시 |

## 개인정보
계정·쿠키 없음. 저장하는 것: 사용자가 "링크 만들기"를 눌렀을 때의 입력값(90일), 신고 내용(90일), 계산기별 일일 조회 수, 속도 제한용 IP 해시(1일). IP 원문은 저장하지 않는다.
