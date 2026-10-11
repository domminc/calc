import { describe, expect, it } from "vitest";
import {
  annualInsurance,
  baseEligible,
  calcMine,
  cardDeduction,
  earnedIncomeCredit,
  earnedIncomeDeduction,
  emptyPerson,
  evaluate,
  prepare,
  tips,
  yearContext,
  type Dep,
  type PersonInput,
} from "../../src/core/yearend.ts";
import { withholdingTax } from "../../src/core/withholding.ts";

// 모든 기대값은 법령 공식(docs/FORMULAS.md §10)으로 손계산한 값이다. 코드 출력을 복사하지 않았다.
const ctx = yearContext(2026);
const y = ctx.rates.yearend;

/** 4대보험·기납부세액을 직접 지정해 손계산이 가능하게 한 사람 */
const person = (o: Partial<PersonInput> = {}): PersonInput => ({
  ...emptyPerson(),
  gross: 50_000_000,
  npsOverride: 2_000_000,
  healthOverride: 1_500_000,
  prepaidOverride: 3_000_000,
  ...o,
});
const dep = (o: Partial<Dep>): Dep => ({ rel: "child", year: 2016, highIncome: false, medical: 0, education: 0, premium: 0, credit: 0, debit: 0, ...o });

describe("근로소득공제·근로소득세액공제 한도", () => {
  it("UT-Y1 근로소득공제 (소득세법 제47조) — 구간 경계와 2천만원 한도", () => {
    const r = ctx.rates;
    expect(earnedIncomeDeduction(r, 5_000_000)).toBe(3_500_000); // 500만 이하 70%
    expect(earnedIncomeDeduction(r, 15_000_000)).toBe(7_500_000); // 350만 + (1500만−500만)×40%
    expect(earnedIncomeDeduction(r, 50_000_000)).toBe(12_250_000); // 1,200만 + (5000만−4500만)×5%
    expect(earnedIncomeDeduction(r, 100_000_000)).toBe(14_750_000); // 1,200만 + (1억−4500만)×5% = 구간 상단
    expect(earnedIncomeDeduction(r, 300_000_000)).toBe(18_750_000); // 1,475만 + (3억−1억)×2%
    expect(earnedIncomeDeduction(r, 400_000_000)).toBe(20_000_000); // 1,475만 + 3억×2% = 2,075만 → 한도 2,000만
  });

  it("UT-Y2 근로소득세액공제 한도 (제59조 제2항) — 총급여 구간별", () => {
    // 산출세액이 충분히 클 때 공제액 = 한도
    expect(earnedIncomeCredit(y, 10_000_000, 30_000_000)).toBe(740_000); // 3,300만 이하 74만
    expect(earnedIncomeCredit(y, 10_000_000, 40_000_000)).toBe(684_000); // 74만 − (4000만−3300만)×8/1000 = 684,000
    expect(earnedIncomeCredit(y, 10_000_000, 50_000_000)).toBe(660_000); // 74만 − 1700만×8/1000 = 604,000 → 하한 66만
    // 7천만 초과: 66만 − (총급여−7천만)×1/2, 하한 50만 (7,032만원을 넘으면 곧바로 하한)
    expect(earnedIncomeCredit(y, 10_000_000, 70_100_000)).toBe(610_000); // 66만 − 10만×1/2
    expect(earnedIncomeCredit(y, 10_000_000, 90_000_000)).toBe(500_000);
    // 1.2억 초과: 50만 − (총급여−1.2억)×1/2, 하한 20만
    expect(earnedIncomeCredit(y, 10_000_000, 120_200_000)).toBe(400_000); // 50만 − 20만×1/2 = 40만
    expect(earnedIncomeCredit(y, 10_000_000, 121_000_000)).toBe(200_000);
  });

  it("UT-Y3 근로소득세액공제 본식 (산출세액 130만 기준 55% / 초과분 30%)", () => {
    expect(earnedIncomeCredit(y, 1_000_000, 30_000_000)).toBe(550_000); // 100만 × 55%
    expect(earnedIncomeCredit(y, 1_300_000, 30_000_000)).toBe(715_000); // 130만 × 55%
    expect(earnedIncomeCredit(y, 2_300_000, 30_000_000)).toBe(740_000); // 71.5만 + 100만×30% = 101.5만 → 한도 74만
    expect(earnedIncomeCredit(y, 1_350_000, 30_000_000)).toBe(715_000 + 15_000); // 71.5만 + 5만×30% = 73만 (한도 74만 이내)
    expect(earnedIncomeCredit(y, 1_600_000, 30_000_000)).toBe(740_000); // 71.5만 + 30만×30% = 80.5만 → 한도 74만
  });
});

describe("신용카드 등 소득공제 (조세특례제한법 제126조의2)", () => {
  const u = (o: Partial<{ credit: number; debit: number; market: number; transit: number; culture: number }>) => ({ credit: 0, debit: 0, market: 0, transit: 0, culture: 0, ...o });

  it("UT-Y4 최저사용금액(총급여 25%)을 넘지 못하면 공제 없음", () => {
    const r = cardDeduction(y, 50_000_000, u({ credit: 12_500_000 }), 0);
    expect(r.minUsage).toBe(12_500_000);
    expect(r.over).toBe(false);
    expect(r.deduction).toBe(0);
  });

  it("UT-Y5 신용카드만 최저사용금액을 넘은 경우: 초과분 × 15%", () => {
    // 신용 1,500만, 최저 1,250만: (1500−1250)만 × 15% = 375,000
    expect(cardDeduction(y, 50_000_000, u({ credit: 15_000_000 }), 0).deduction).toBe(375_000);
  });

  it("UT-Y6 신용 1,000만 + 체크 500만: 최저사용금액은 신용부터 차감 → 250만 × 30% = 750,000", () => {
    // 합 = 1000만×15% + 500만×30% = 300만, 최저분 = 1000만×15% + 250만×30% = 225만, 차 = 75만
    expect(cardDeduction(y, 50_000_000, u({ credit: 10_000_000, debit: 5_000_000 }), 0).deduction).toBe(750_000);
  });

  it("UT-Y7 한도 초과 시 전통시장·대중교통·문화체육 추가 공제 (총급여 7천만 이하 한도 300만 + 추가)", () => {
    // 신용 2,000만 / 체크 1,000만 / 시장 300만 / 대중교통 200만 / 문화 100만, 총급여 5,000만
    // 합 = 120만+80만+30만+300만+300만 = 830만, 최저분 = 1,250만×15% = 187.5만, raw = 642.5만
    // 한도 300만, 추가 = min(642.5−300=342.5만, 시장+대중교통+문화 = 230만) = 230만 → 530만
    const r = cardDeduction(y, 50_000_000, u({ credit: 20_000_000, debit: 10_000_000, market: 3_000_000, transit: 2_000_000, culture: 1_000_000 }), 0);
    expect(r.raw).toBe(6_425_000);
    expect(r.cap).toBe(3_000_000);
    expect(r.extra).toBe(2_300_000);
    expect(r.deduction).toBe(5_300_000);
  });

  it("UT-Y8 자녀 수에 따른 한도 — 총급여 7천만 이하 (300만 / 350만 / 400만)", () => {
    const big = u({ credit: 40_000_000, debit: 20_000_000 }); // raw = 975만 (총급여 6,000만)
    expect(cardDeduction(y, 60_000_000, big, 0).deduction).toBe(3_000_000);
    expect(cardDeduction(y, 60_000_000, big, 1).deduction).toBe(3_500_000);
    expect(cardDeduction(y, 60_000_000, big, 2).deduction).toBe(4_000_000);
    expect(cardDeduction(y, 60_000_000, big, 3).deduction).toBe(4_000_000);
  });

  it("UT-Y9 총급여 7천만 초과 — 한도 250만 / 275만 / 300만, 문화체육 우대 없음", () => {
    const big = u({ credit: 50_000_000 }); // 총급여 8,000만: (5000만−2000만)×15% = 450만
    expect(cardDeduction(y, 80_000_000, big, 0).deduction).toBe(2_500_000);
    expect(cardDeduction(y, 80_000_000, big, 1).deduction).toBe(2_750_000);
    expect(cardDeduction(y, 80_000_000, big, 2).deduction).toBe(3_000_000);
    // 총급여 1억: 문화체육 사용분(200만)은 우대 없이 신용카드 사용분(15%)에 합쳐진다.
    // 최저사용금액 2,500만, 신용 3,000만 + 문화 200만 = 3,200만 → (3,200만 − 2,500만) × 15% = 105만
    expect(cardDeduction(y, 100_000_000, u({ credit: 30_000_000, culture: 2_000_000 }), 0).deduction).toBe(1_050_000);
  });
});

describe("연말정산 한 사람 계산 (총급여 5,000만원 기본)", () => {
  it("UT-Y10 기본: 공제 없이 본인만 — 결정세액·환급 손계산", () => {
    // 근로소득금액 = 5000만 − 1225만 = 3,775만
    // 소득공제 = 기본 150만 + 국민연금 200만 + 건강 등 150만 = 500만 → 과세표준 3,275만
    // 산출세액 = 3,275만 × 15% − 126만 = 3,652,500
    // 근로소득세액공제 = min(71.5만 + (3,652,500−130만)×30% = 1,420,750, 한도 66만) = 660,000
    // 표준세액공제 13만 → 공제 합계 790,000 → 결정세액 2,862,500, 지방소득세 286,250
    // 기납부 300만(지방 30만) → 소득세 −137,500, 지방 −13,750, 합 −151,250 (환급)
    const r = calcMine(ctx, person(), []);
    expect(r.salary).toBe(50_000_000);
    expect(r.earnedIncome).toBe(37_750_000);
    expect(r.deductionTotal).toBe(5_000_000);
    expect(r.taxBase).toBe(32_750_000);
    expect(r.computedTax).toBe(3_652_500);
    expect(r.credits.earned).toBe(660_000);
    expect(r.credits.standard).toBe(130_000);
    expect(r.credits.total).toBe(790_000);
    expect(r.determinedTax).toBe(2_862_500);
    expect(r.localTax).toBe(286_250);
    expect(r.settleTax).toBe(-137_500);
    expect(r.settleLocal).toBe(-13_750);
    expect(r.settleTotal).toBe(-151_250);
  });

  it("UT-Y11 비과세는 총급여에서 빠진다 (연 360만 식대)", () => {
    const base = prepare(ctx, person({ gross: 53_600_000, nonTaxable: 3_600_000 }));
    expect(base.salary).toBe(50_000_000);
  });

  it("UT-Y12 인적공제·자녀세액공제: 배우자(소득 없음) + 자녀 2명(10세·5세) + 70세 부모", () => {
    // 인원 = 본인 + 배우자 + 자녀 2 + 부모 1 = 5명 → 기본공제 750만, 경로우대 100만
    // 자녀세액공제는 8세 이상만: 10세 1명 → 25만
    const deps = [dep({ rel: "spouse", year: 0 }), dep({ year: 2016 }), dep({ year: 2021 }), dep({ rel: "parent", year: 1956 })];
    const r = calcMine(ctx, person(), deps);
    expect(r.headcount).toBe(5);
    expect(r.basic).toBe(7_500_000);
    expect(r.senior).toBe(1_000_000);
    expect(r.credits.child).toBe(250_000);
  });

  it("UT-Y13 자녀세액공제 금액 — 2명 55만, 3명 95만 (8세 이상, 20세 이하만)", () => {
    const kids = (n: number) => Array.from({ length: n }, () => dep({ year: 2014 }));
    expect(calcMine(ctx, person(), kids(1)).credits.child).toBe(250_000);
    expect(calcMine(ctx, person(), kids(2)).credits.child).toBe(550_000);
    expect(calcMine(ctx, person(), kids(3)).credits.child).toBe(950_000);
    // 2005년생(21세) 자녀는 기본공제 불가 → 공제 없음
    expect(calcMine(ctx, person(), [dep({ year: 2005 })]).credits.child).toBe(0);
  });

  it("UT-Y14 기본공제 요건 — 소득 100만원 초과·나이 미달 부모는 제외, 출생연도 기준", () => {
    expect(baseEligible(y, 2026, dep({ rel: "parent", year: 1966 }))).toBe(true); // 만 60세
    expect(baseEligible(y, 2026, dep({ rel: "parent", year: 1967 }))).toBe(false);
    expect(baseEligible(y, 2026, dep({ rel: "child", year: 2006 }))).toBe(true); // 20세
    expect(baseEligible(y, 2026, dep({ rel: "child", year: 2005 }))).toBe(false);
    expect(baseEligible(y, 2026, dep({ rel: "spouse", highIncome: true }))).toBe(false);
  });

  it("UT-Y15 연금계좌 — 연금저축 600만·합산 900만 한도, 총급여 5,500만 이하 15% / 초과 12%", () => {
    // 저축 700만(→600만) + IRP 400만 = 1,000만 → 900만
    const p = { pensionSavings: 7_000_000, irp: 4_000_000 };
    expect(calcMine(ctx, person(p), []).credits.pension).toBe(1_350_000); // 900만 × 15%
    expect(calcMine(ctx, person({ ...p, gross: 60_000_000 }), []).credits.pension).toBe(1_080_000); // 900만 × 12%
  });

  it("UT-Y16 의료비 — 총급여 3% 문턱, 일반 700만원 한도, 본인분은 한도 없음", () => {
    // 총급여 5,000만 → 문턱 150만
    const general = (m: number) => calcMine(ctx, person({ medicalSpouse: m }), []);
    expect(general(4_000_000).medicalBase).toBe(2_500_000); // (400만−150만)
    expect(general(10_000_000).medicalBase).toBe(7_000_000); // 한도
    // 본인 의료비 400만은 문턱만 차감(250만), 한도 없음
    expect(calcMine(ctx, person({ medical: 4_000_000 }), []).medicalBase).toBe(2_500_000);
    // 일반 100만(문턱 미달) + 본인 200만: 미달분 50만을 본인분에서 차감 → 150만
    expect(calcMine(ctx, person({ medical: 2_000_000, medicalSpouse: 1_000_000 }), []).medicalBase).toBe(1_500_000);
    // 일반 1,000만 + 본인 300만: 700만(한도) + 300만
    expect(calcMine(ctx, person({ medical: 3_000_000, medicalSpouse: 10_000_000 }), []).medicalBase).toBe(10_000_000);
  });

  it("UT-Y17 의료비 — 6세 이하·65세 이상 가족은 한도 없는 특례 대상", () => {
    // 5세 자녀 의료비 900만: 일반이 아니라 특례 → (900만 − 문턱 150만) = 750만 (700만 한도 적용 안 됨)
    const r = calcMine(ctx, person(), [dep({ year: 2021, medical: 9_000_000 })]);
    expect(r.medicalBase).toBe(7_500_000);
    // 10세 자녀 의료비 900만: 일반 → 700만 한도
    expect(calcMine(ctx, person(), [dep({ year: 2016, medical: 9_000_000 })]).medicalBase).toBe(7_000_000);
    // 66세 부모(2026−1960) 의료비 900만: 특례
    expect(calcMine(ctx, person(), [dep({ rel: "parent", year: 1960, medical: 9_000_000 })]).medicalBase).toBe(7_500_000);
  });

  it("UT-Y18 교육비 — 본인 한도 없음, 자녀 1명당 300만(취학 전·초중고)/900만(대학)", () => {
    // 자녀 10세 500만→300만, 자녀 20세(대학) 1,200만→900만, 본인 400만 → 합 1,600만 × 15% = 240만
    const r = calcMine(ctx, person({ education: 4_000_000, gross: 90_000_000 }), [dep({ year: 2016, education: 5_000_000 }), dep({ year: 2006, education: 12_000_000 })]);
    expect(r.credits.education).toBe(2_400_000);
  });

  it("UT-Y19 기부금 — 특례·일반 한도와 15%/30%", () => {
    // 근로소득금액 3,775만. 특례 100만 + 일반 200만 → 300만 × 15% = 45만
    const a = calcMine(ctx, person({ donLegal: 1_000_000, donGeneral: 2_000_000, gross: 50_000_000 }), []);
    expect(a.credits.donation).toBe(450_000);
    // 종교 500만 + 일반 200만, 특례 0: 한도 = 3,775만×10% + min(3,775만×20%, 일반 200만) = 377.5만 + 200만 = 577.5만 → 15% = 866,250
    const b = calcMine(ctx, person({ donGeneral: 2_000_000, donReligious: 5_000_000 }), []);
    expect(b.credits.donation).toBe(866_250);
    // 일반 1,500만(종교 없음): 한도 3,775만×30% = 1,132.5만 → 1,000만×15% + 132.5만×30% = 150만 + 39.75만
    const c = calcMine(ctx, person({ donGeneral: 15_000_000 }), []);
    expect(c.credits.donation).toBe(1_897_500);
  });

  it("UT-Y20 월세 — 총급여 5,500만 이하(소득금액 4,500만 이하) 17%, 아니면 15%, 연 1,000만 한도", () => {
    expect(calcMine(ctx, person({ noHome: true, rent: 7_000_000 }), []).credits.rent).toBe(1_190_000);
    expect(calcMine(ctx, person({ noHome: true, rent: 12_000_000, gross: 60_000_000 }), []).credits.rent).toBe(1_500_000);
    // 총급여 8천만 초과 또는 무주택 세대주 아님 → 없음
    expect(calcMine(ctx, person({ noHome: true, rent: 7_000_000, gross: 90_000_000 }), []).credits.rent).toBe(0);
    expect(calcMine(ctx, person({ noHome: false, rent: 7_000_000 }), []).credits.rent).toBe(0);
  });

  it("UT-Y21 표준세액공제 vs 특별세액공제 — 큰 쪽, 월세를 받으면 표준세액공제를 받지 못한다", () => {
    // 보험료 100만(12만원)만 있으면 표준(13만) 선택
    const small = calcMine(ctx, person({ premium: 1_000_000 }), []);
    expect(small.credits.insurance).toBe(0);
    expect(small.credits.standard).toBe(130_000);
    // 교육비 200만 → 30만 > 13만 → 특별세액공제 선택, 표준 0
    const big = calcMine(ctx, person({ education: 2_000_000 }), []);
    expect(big.credits.usedSpecial).toBe(true);
    expect(big.credits.education).toBe(300_000);
    expect(big.credits.standard).toBe(0);
  });

  it("UT-Y22 보장성 보험료 — 연 100만원 한도 × 12%", () => {
    // 보험료 300만 + 의료 등으로 특별세액공제를 택하게 만든 뒤 확인
    const r = calcMine(ctx, person({ premium: 3_000_000, education: 2_000_000 }), []);
    expect(r.credits.insurance).toBe(120_000);
  });

  it("UT-Y23 고향사랑 — 10만원 이하 100/110, 10~20만 40%, 초과 15%", () => {
    expect(calcMine(ctx, person({ hometown: 100_000 }), []).credits.hometown).toBe(90_909);
    expect(calcMine(ctx, person({ hometown: 200_000 }), []).credits.hometown).toBe(90_909 + 40_000);
    expect(calcMine(ctx, person({ hometown: 500_000 }), []).credits.hometown).toBe(90_909 + 40_000 + 45_000);
  });

  it("UT-Y24 주택청약 — 총급여 7천만 이하 무주택 세대주, 납입 300만 × 40% = 120만 소득공제", () => {
    expect(calcMine(ctx, person({ noHome: true, housingSavings: 4_000_000 }), []).housing).toBe(1_200_000);
    expect(calcMine(ctx, person({ noHome: false, housingSavings: 4_000_000 }), []).housing).toBe(0);
    expect(calcMine(ctx, person({ noHome: true, housingSavings: 4_000_000, gross: 80_000_000 }), []).housing).toBe(0);
  });

  it("UT-Y25 세액공제가 산출세액을 넘으면 결정세액은 0 (음수가 되지 않는다)", () => {
    // 총급여 1,500만: 근로소득공제 750만 → 근로소득금액 750만, 소득공제 500만 → 과세표준 250만
    // 산출세액 250만 × 6% = 15만, 근로소득세액공제 15만 × 55% = 82,500 + 표준 13만 = 212,500 > 15만 → 결정세액 0
    const r = calcMine(ctx, person({ gross: 15_000_000, nonTaxable: 0, prepaidOverride: 0 }), []);
    expect(r.computedTax).toBe(150_000);
    expect(r.credits.rawTotal).toBe(212_500);
    expect(r.determinedTax).toBe(0);
    expect(r.localTax).toBe(0);
    expect(r.credits.capped).toBe(true);
  });

  it("UT-Y26 카드 한도·종합한도 — 신용카드+주택청약 공제는 합쳐서 2,500만원까지", () => {
    // 카드 공제가 한도(300만)에 걸리므로 종합한도(2,500만)는 닿지 않는다 — 한도 안쪽 합산 확인
    const r = calcMine(ctx, person({ credit: 40_000_000, debit: 10_000_000, noHome: true, housingSavings: 3_000_000 }), []);
    expect(r.housing).toBe(1_200_000);
    expect(r.limited).toBe(r.card.deduction + 1_200_000);
  });

  it("UT-Y27 가족 사용액은 소득요건을 충족해야 카드 공제에 합산된다", () => {
    const withCard = [dep({ rel: "parent", year: 1950, credit: 20_000_000 })];
    const incl = calcMine(ctx, person(), withCard);
    expect(incl.card.total).toBe(20_000_000);
    const excl = calcMine(ctx, person(), [dep({ rel: "parent", year: 1950, credit: 20_000_000, highIncome: true })]);
    expect(excl.card.total).toBe(0);
  });
});

describe("연간 추정값 (4대보험·기납부세액)", () => {
  it("UT-Y28 4대보험 연간 추정 = 월 보험료 × 12 (총급여 5,000만)", () => {
    // 월 과세 4,166,666: 국민연금 ⌊4,166,000×4.75%⌋ 10원 절사 = 197,880 → 연 2,374,560
    const est = annualInsurance(ctx, 50_000_000);
    expect(est.nps).toBe(2_374_560);
    // 건강 149,790 + 장기요양 19,680 + 고용 37,490 = 206,960 → 연 2,483,520
    expect(est.health).toBe(2_483_520);
  });

  it("UT-Y29 기납부 소득세 추정 = 간이세액표(월 과세급여, 신고 가족 수) × 12", () => {
    const p = person({ prepaidOverride: undefined, wFamily: 3, wChildren: 1 });
    const base = prepare(ctx, p);
    const w = withholdingTax(ctx.withholding, Math.floor(50_000_000 / 12), 3, 1);
    expect(base.prepaidTax).toBe(w.tax * 12);
    expect(base.prepaidLocal).toBe(w.localTax * 12);
    expect(base.prepaidEstimated).toBe(true);
  });

  it("UT-Y30 직접 입력한 4대보험·기납부세액이 우선한다", () => {
    const base = prepare(ctx, person({ prepaidOverride: 1_000_000 }));
    expect(base.prepaidTax).toBe(1_000_000);
    expect(base.prepaidLocal).toBe(100_000);
    expect(base.npsEstimated).toBe(false);
  });
});

describe("절세 팁", () => {
  it("UT-Y31 연금저축·IRP를 한도까지 채우면 늘어나는 환급은 실제 재계산 값이다", () => {
    const p = person();
    const now = calcMine(ctx, p, []);
    const t = tips(ctx, p, [], now).find((x) => x.key === "pension");
    // 900만원 × 15% = 135만원 세액공제 → 소득세 135만 + 지방소득세 13.5만 = 148.5만원 환급 증가
    // (결정세액 2,862,500 → 1,512,500, 지방소득세 286,250 → 151,250)
    expect(t?.gain).toBe(1_485_000);
    const after = evaluate(ctx, now.base, { ...p, pensionSavings: 6_000_000, irp: 3_000_000 }, []);
    expect(now.settleTotal - after.settleTotal).toBe(1_485_000);
  });

  it("UT-Y32 최저사용금액에 못 미치면 안내만 하고 절세액은 말하지 않는다", () => {
    const p = person({ credit: 5_000_000 });
    const now = calcMine(ctx, p, []);
    const t = tips(ctx, p, [], now).find((x) => x.key === "cardMin");
    expect(t?.gain).toBe(0);
    expect(t?.text).toContain("7,500,000원");
  });
});
