# homesell 계산기

- 기획·계산식·QA 는 docs/ 가 정본이다: PLANNING.md(범위), FORMULAS.md(식·출처·미확정 U1~U13), QA-PLAN.md(시나리오·결함 이력), DESIGN.md(화면·반응형), LAW-WATCH.md(법령 변경 대응), DEPLOY.md(배포·장애). 계산을 바꾸면 **FORMULAS.md → 코드 → 테스트** 순으로 같이 고친다.
- 검사: `npm run typecheck` · `npm run lint` · `npm test` · `npm run test:db`(임시 Postgres) · `npm run test:e2e`(임시 Postgres + 로컬 Worker + Playwright).
- 계산 코어(`src/core`)는 서버·브라우저 공용 순수 함수다. DB·fetch·DOM 을 import 하지 않는다. 금액은 원 단위 정수, 요율은 `ppm()` 정수 비율로 곱한다 (부동소수 금지).
- 요율·표는 `data/rates/<연도>/` 만 고친다. 원문 PDF 는 `data/source/` 에 보관하고, 확인 못 한 값은 `verified:false` + `/basis` 미확정 목록(`src/server/basis.ts`)에 올린다. 블로그 수치를 근거로 쓰지 않는다 (법령·공단·정부 원문만).
- 간이세액표는 `npm run build:data` 로만 만든다 (손으로 고치지 않는다). 구간 연속·가족수 단조성 검사가 들어 있다.
- DB 접근은 `src/server/db.ts` 의 `withSql()` 로만 (요청마다 Hyperdrive 연결, 전역 연결 금지). `fetch_types:false` 라 배열 자료형을 쓰지 않는다. 화면 하나가 DB 를 오가는 횟수를 늘리지 않는다. DB 가 없어도 계산·내려받기는 동작해야 한다.
- 스키마 변경은 `migrations/` 에 새 파일로만 추가한다 (기존 파일 수정 금지).
- CSP 가 `script-src 'self'`, `style-src 'self'` 다. 인라인 `<script>`(JSON-LD 제외)·`style=""` 속성을 쓰지 않는다 (SVG 의 width/x 속성은 가능).
- PDF 폰트는 `scripts/build-pdf-font.py` 로 만든다. pdf-lib 의 `subset:true` 는 글자를 빠뜨리므로 쓰지 않는다.
- 배포는 main 병합으로만 (Actions `배포`). Workers Route·DNS 는 Cloudflare 대시보드에서만 바꾼다. **병합 뒤에는 `/api/health` 의 `버전` 이 새 커밋 앞 8자리인지 확인한다** (배포가 멈추면 사이트는 조용히 옛 화면이다).
- 웹 폰트는 Pretendard 다이나믹 서브셋만 쓴다 (`public/fonts/`). 다른 웹폰트 로드 금지.
- 요율·세율 숫자는 화면 문구에도 직접 쓰지 않는다 (`data/rates` 에서 읽는다, UT-H1). 프리랜서 3.3% 는 프리랜서 계산기에만 둔다 (급여 계산기에는 없다).
- **화면을 바꾸면 눈으로 확인한다**: `bash scripts/dev-up.sh` 로 띄우고 Chromium 으로 375·390·768·1280px(라이트·다크)를 찍어 본다. e2e 의 E20(문서 전체 가로 스크롤)은 칸 안쪽 잘림·삐져나옴을 못 잡으므로 E90~E94 도 통과시킨다. 이 환경에는 WebKit(iOS Safari)이 없으니 Safari 고유 동작은 확인했다고 말하지 말고 사용자에게 실기기 확인을 요청한다.
- 외부 API 응답을 파싱하는 코드는 가짜 데이터 시험만으로 믿지 않는다. 실제 응답으로 한 번 돌려 본다 (법제처 별표2 파서가 이렇게 실패했다, docs/LAW-WATCH.md §5.1).
- 린트(`npm run lint`)까지 돌린 뒤 PR 을 올린다. `scripts/*.mjs` 에서 `setTimeout` 같은 전역은 `node:timers/promises` 등을 import 해서 쓴다.
