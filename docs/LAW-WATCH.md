# 법령 변경 대응 체계

> 목표: **법이 바뀌면 계산도 바뀐다.** 변경을 놓치지 않고(감시), 시행일에 맞춰 자동 전환되고(데이터 구조), 근거를 화면에 공개한다(투명성).

## 1. 전체 구조

```mermaid
flowchart LR
  A[법제처 API<br/>현행·시행예정 법령 · 고시] -->|매일 06:00 KST<br/>law-watch.yml| B{스냅샷과 다름?}
  B -->|예| C[이슈 law-change<br/>신구조문 링크·영향 항목]
  B -->|아니오| Z[종료]
  A -->|별표2 개정 감지| D[원문 PDF 내려받기<br/>→ 표 변환·무결성 검사]
  D -->|통과| E[PR law-sync<br/>+ 테스트]
  D -->|실패| C
  F[매월 1일] --> G[이슈 law-manual<br/>기계 감시 불가 항목 점검]
  C --> H[유지보수: data/rates 수정 + 테스트 + 문서]
  E --> H
  G --> H
  H --> I[main 병합 → 자동 배포]
  I --> J[시행일이 되면 기준일에 맞는 요율 세트로 자동 전환]
```

| 층 | 무엇을 | 어떻게 | 위치 |
|---|---|---|---|
| ① 시행일 기반 데이터 | 요율·한도·세율을 연도(세트)별로 시행일과 함께 보관. 기준일(오늘)에 맞는 세트를 고른다 | `data/rates/<연도>/rates.json` + `src/core/rates.ts` | 코드 수정 없이 데이터만 바꿔도 계산·화면 문구가 함께 바뀜 (UT-H1 가드) |
| ② 변경 감시 | 계산에 쓰는 법령 20개·고시 4종의 **현행·시행예정** 목록을 스냅샷과 비교 | `scripts/law-watch.ts`, `data/watch/` | Actions 매일 |
| ③ 간이세액표 자동 갱신 | 시행령 별표2 개정일이 새로우면 원문 PDF → 표 JSON → PR | `scripts/sync-withholding.ts` | Actions 매일 |
| ④ 수동 점검 알림 | 법제처 DB에 없는 것(장기요양보험료율·경비율 등)을 해당 달에 알림 | `scripts/law-manual.ts` | Actions 매월 1일 |
| ⑤ 화면 공개 | `/basis` 에 확정·미확정·시행예정 개정, 마지막 확인일 | `src/server/basis.ts` | 배포 시 스냅샷 반영 |
| ⑥ 유지보수 루틴 | 이슈를 읽고 데이터·테스트·문서를 고쳐 PR→병합 | Claude 예약 루틴(아래 §5) | 매일 |

## 2. 시행일에 자동 전환되는 원리
- `resolveRates(기준일)` = 시행일(`effectiveFrom`)이 기준일 이전인 세트 중 **가장 늦은 것**.
- 2026 세트(확정) → 2027 세트(일부 잠정, `extends: 2026`)는 확정된 값만 `overrides` 로 바꾸고 나머지는 앞 연도 값을 물려받는다. **2027-01-01 이 되면 코드 변경 없이 2027 세트로 계산**하고, 확정 전 항목은 결과 위에 "잠정" 안내를 붙인다.
- 연중 변경(국민연금 상·하한 7/1)은 `nps.limits[].from` 으로, 간이세액표 시행일은 `withholding.json.effectiveFrom` 으로 관리한다.
- 새 연도 추가: `data/rates/<새 연도>/rates.json`(`extends` + `overrides`, `confirmed`/`pending`) 를 만들고 `npm run build:registry` — 코드 수정 없음.

## 3. 변경 이슈 처리 절차 (law-change)
1. 이슈의 **영향 항목**과 신구조문대비 링크로 무엇이 바뀌었는지 읽는다. 시행일이 **미래**인지 **이미 시행**인지 구분한다.
2. 영향 매핑으로 바꿀 값을 찾는다.

   | 법령·고시 | 바뀔 수 있는 값 (`rates.json`) |
   |---|---|
   | 소득세법·시행령 | `incomeTax.*`(세율·공제·자녀공제), `freelancer.withholdingIncome/Local`(원천징수세율), `taxFree.*`, 간이세액표(별표2) |
   | 지방세법 | `incomeTax.localTaxRatio`, `freelancer.withholdingLocal` |
   | 국민연금법·시행령·고시 | `nps.rate`(매년 +0.5%p), `nps.limits`(7/1 상·하한) |
   | 국민건강보험법·시행령·고시 | `nhis.rate`, `nhis.premiumMin/Max`, `nhis.regionalScoreUnitPrice` |
   | 노인장기요양보험법·시행령 | `nhis.ltc.rate` |
   | 고용보험법·시행령 | `ei.workerRate/employerRate`, `ei.stabilization` |
   | 산재보험 법령·고시 | `wci.defaultRate` |
   | 최저임금법·고시 | `labor.minHourlyWage`, `labor.monthlyPaidHours` |
   | 근로기준법·시행령 | `labor.*Premium` |
3. 값은 **법령·정부 원문**(법제처 API/PDF, 공단·부처 공고)에서만 가져온다. 블로그·언론은 "무엇이 바뀌는지" 찾는 용도로만 쓰고 값은 원문으로 확인한다. 확인하지 못하면 `verified:false` + `/basis` 미확정 목록에 올린다.
4. 해당 세트의 `rates.json` 에 반영한다. 미래 시행이면 그 연도 세트의 `overrides` 로, 이미 시행이면 현재 세트를 고친다. 확정되면 `pending` 에서 `confirmed` 로 옮긴다.
5. `docs/FORMULAS.md` 의 표·예시와 테스트 기대값(공식 벡터, `UT-R*`)을 새 값으로 고치고 `npm test`, `npm run test:db`, `npm run test:e2e` 를 통과시킨다.
6. `npm run law:update` 로 스냅샷을 갱신해 함께 커밋한다 (이후 같은 변경은 다시 알리지 않는다).
7. PR → 병합 → 자동 배포 → `/basis` 개정 이력과 `/api/health` 확인 → 이슈 닫기.

## 4. 알려진 시행 예정 (2026-10-11 기준, 스냅샷에서 자동 추출)
- 소득세법: 2027-01-01(여러 건), 2027-09-09, 2028-01-01 시행 예정 개정 — 2027 세제 관련. **내용 확인 후 반영 필요**
- 소득세법 시행령: 2026-10-01 시행(현행), 2027-01-01(여러 건), 2028-01-01
- 국민연금법: 2027-01-01 · 2027-03-16 · 2028-01-01 / 건강보험법·시행령: 2026-12-24 · 2027-01-01 / 고용보험법: 2026-11-27 · 2027-01-01 · 2028-01-01 / 최저임금법 2026-12-08
- 2027 확정: 국민연금 보험료율 10.0%, 건강보험료율 7.19% 동결, 최저임금 10,700원 → `data/rates/2027/rates.json`
- **미확정(추적 중)**: 프리랜서 원천징수 3%→2%(2026 세제개편안, 현행 법조문은 100분의 3), 장기요양보험료율, 고용보험료율 인상, 2027 간이세액표, 건보료 상·하한

## 5. 유지보수 루틴 (자동)
Claude 예약 루틴이 매일 `law-change`·`law-sync`·`law-manual` 이슈/PR 을 확인한다.
- 이슈가 있으면 §3 의 절차대로 데이터·테스트·문서를 수정해 PR 을 만들고, CI 가 통과하면 병합한다.
- 값을 원문으로 확정할 수 없으면(예: 공고 전) 반영하지 않고 이슈에 이유를 남긴다.
- 루틴이 처리하지 못한 이슈는 열린 채로 남아 사람이 볼 수 있다.

## 6. 운영 설정
- 저장소 Settings → Actions → General → **"Allow GitHub Actions to create and approve pull requests"** 켜기 (간이세액표 자동 PR 용; 없으면 이슈로 대체 알림)
- (선택) Secrets `LAW_OC`: 법제처 OPEN API 인증키 발급(<https://open.law.go.kr>) — 없으면 공용 키로 동작하며, 차단되면 조회 실패 경고가 뜬다.
- 감시 대상 추가/삭제: `data/watch/targets.json` → `npm run law:update`.
