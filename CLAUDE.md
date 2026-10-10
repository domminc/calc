# homesell 계산기

- 기획·계산식·QA 는 docs/ 가 정본이다: PLANNING.md(범위), FORMULAS.md(식·출처·미확정 U1~U8), QA-PLAN.md(시나리오). 계산을 바꾸면 **FORMULAS.md → 코드 → 테스트** 순으로 같이 고친다.
- 검사: `npm run typecheck` · `npm run lint` · `npm test` · `npm run test:db`(임시 Postgres) · `npm run test:e2e`(임시 Postgres + 로컬 Worker + Playwright).
- 계산 코어(`src/core`)는 서버·브라우저 공용 순수 함수다. DB·fetch·DOM 을 import 하지 않는다. 금액은 원 단위 정수, 요율은 `ppm()` 정수 비율로 곱한다 (부동소수 금지).
- 요율·표는 `data/rates/<연도>/` 만 고친다. 원문 PDF 는 `data/source/` 에 보관하고, 확인 못 한 값은 `verified:false` + `/basis` 미확정 목록(`src/server/basis.ts`)에 올린다. 블로그 수치를 근거로 쓰지 않는다 (법령·공단·정부 원문만).
- 간이세액표는 `npm run build:data` 로만 만든다 (손으로 고치지 않는다). 구간 연속·가족수 단조성 검사가 들어 있다.
- DB 접근은 `src/server/db.ts` 의 `withSql()` 로만 (요청마다 Hyperdrive 연결, 전역 연결 금지). `fetch_types:false` 라 배열 자료형을 쓰지 않는다. 화면 하나가 DB 를 오가는 횟수를 늘리지 않는다. DB 가 없어도 계산·내려받기는 동작해야 한다.
- 스키마 변경은 `migrations/` 에 새 파일로만 추가한다 (기존 파일 수정 금지).
- CSP 가 `script-src 'self'`, `style-src 'self'` 다. 인라인 `<script>`(JSON-LD 제외)·`style=""` 속성을 쓰지 않는다 (SVG 의 width/x 속성은 가능).
- PDF 폰트는 `scripts/build-pdf-font.py` 로 만든다. pdf-lib 의 `subset:true` 는 글자를 빠뜨리므로 쓰지 않는다.
- 배포는 main 병합으로만 (Actions `배포`). Workers Route·DNS 는 Cloudflare 대시보드에서만 바꾼다.
- 웹 폰트는 Pretendard 다이나믹 서브셋만 쓴다 (`public/fonts/`). 다른 웹폰트 로드 금지.
