// 연말정산(근로소득 연간 정산) 예측. 식·근거·가정은 docs/FORMULAS.md §10
// 법령 숫자(공제율·한도·구간)는 모두 data/rates 의 `yearend` 에서 읽는다. 이 파일에는 계산 구조만 있다.
import type { Rates, Resolved, Withholding } from "./rates.ts";
import { resolveRates } from "./rates.ts";
import { calcInsurance } from "./insurance.ts";
import { withholdingTax } from "./withholding.ts";
import { bracketTax } from "./freelancer.ts";
import { floor10, mulPpm, ppm } from "./money.ts";
import type { Notice } from "./types.ts";

type YearendRates = Rates["yearend"];

const pm = (x: number, rate: number): number => mulPpm(Math.max(0, Math.floor(x)), ppm(rate));
const pos = (x: number): number => Math.max(0, Math.floor(x));

// ---------------------------------------------------------------- 입력 모델

export type Relation = "spouse" | "child" | "parent";

/** 새 부양가족 행의 기본값: 10세 자녀 */
export const emptyDep = (year: number): Dep => ({ rel: "child", year: year - 10, highIncome: false, medical: 0, education: 0, premium: 0, credit: 0, debit: 0 });

/** 부양가족 1명. 지출은 그 가족을 위해(또는 그 가족이 쓴) 연간 금액 */
export interface Dep {
  rel: Relation;
  /** 출생연도 (배우자는 쓰지 않음) */
  year: number;
  /** 연 소득금액 100만원 초과(총급여 500만원 초과) → 기본공제 불가 */
  highIncome: boolean;
  medical: number;
  /** 교육비 (자녀만) */
  education: number;
  /** 보장성 보험료 (피보험자가 이 가족) */
  premium: number;
  credit: number;
  debit: number;
}

export interface PersonInput {
  /** 연 총지급액(비과세 포함) */
  gross: number;
  /** 연 비과세 합계 (식대 등) */
  nonTaxable: number;
  /** 연 국민연금 근로자 부담 직접 입력 (없으면 추정) */
  npsOverride: number | undefined;
  /** 연 건강·장기요양·고용보험 근로자 부담 직접 입력 (없으면 추정) */
  healthOverride: number | undefined;
  /** 올해 이미 낸 소득세(연말정산 전 원천징수 합계) 직접 입력 (없으면 간이세액표로 추정) */
  prepaidOverride: number | undefined;
  /** 매달 원천징수 때 신고한 공제대상가족 수(본인 포함) / 그중 8~20세 자녀 수 */
  wFamily: number;
  wChildren: number;
  // 본인이 쓴 카드 등
  credit: number;
  debit: number;
  market: number;
  transit: number;
  culture: number;
  // 본인 지출
  medical: number;
  /** 배우자를 위해 내가 낸 의료비 (부부 비교 탭) */
  medicalSpouse: number;
  education: number;
  premium: number;
  donLegal: number;
  donGeneral: number;
  donReligious: number;
  hometown: number;
  pensionSavings: number;
  irp: number;
  housingSavings: number;
  rent: number;
  /** 무주택 세대주(월세·주택청약 공제 요건) */
  noHome: boolean;
  /** 올해 출산·입양한 자녀 (0=없음, 1=첫째, 2=둘째, 3=셋째 이상) */
  birthChild: 0 | 1 | 2 | 3;
}

export const emptyPerson = (): PersonInput => ({
  gross: 0, nonTaxable: 0, npsOverride: undefined, healthOverride: undefined, prepaidOverride: undefined,
  wFamily: 1, wChildren: 0,
  credit: 0, debit: 0, market: 0, transit: 0, culture: 0,
  medical: 0, medicalSpouse: 0, education: 0, premium: 0,
  donLegal: 0, donGeneral: 0, donReligious: 0, hometown: 0,
  pensionSavings: 0, irp: 0, housingSavings: 0, rent: 0, noHome: false, birthChild: 0,
});

// ---------------------------------------------------------------- 귀속연도 문맥

export interface YearCtx {
  year: number;
  rates: Rates;
  /** 상·하반기 요율(국민연금 상·하한이 7/1 에 바뀐다) */
  h1: Resolved;
  h2: Resolved;
  withholding: Withholding;
  resolved: Resolved;
}

export function yearContext(year: number): YearCtx {
  const resolved = resolveRates(`${year}-12-31`);
  return {
    year,
    rates: resolved.set.rates,
    h1: resolveRates(`${year}-03-01`),
    h2: resolveRates(`${year}-10-01`),
    withholding: resolveRates(`${year}-10-01`).set.withholding,
    resolved,
  };
}

// ---------------------------------------------------------------- 근로소득공제·세액공제 한도

/** 소득세법 제47조: 근로소득공제 (공제 한도 포함) */
export function earnedIncomeDeduction(rates: Rates, salary: number): number {
  const S = pos(salary);
  const t = rates.incomeTax.earnedIncomeDeduction.find((x) => x.upTo === null || S <= x.upTo)!;
  const d = t.base + pm(S - t.over, t.rate);
  return Math.min(d, rates.incomeTax.earnedIncomeDeductionCap, S);
}

/** 소득세법 제59조: 근로소득세액공제 (산출세액 → 공제액, 총급여별 한도) */
export function earnedIncomeCredit(y: YearendRates, computedTax: number, salary: number): number {
  const e = y.earnedIncomeCredit;
  const T = pos(computedTax);
  const base = T <= e.lowUpTo ? pm(T, e.lowRate) : e.base + pm(T - e.lowUpTo, e.overRate);
  const tier = e.caps.find((c) => c.upTo === null || salary <= c.upTo)!;
  const cap = Math.max(tier.floor, tier.cap - pm(Math.max(0, salary - tier.from), tier.slope));
  return Math.min(base, cap);
}

// ---------------------------------------------------------------- 신용카드 등 소득공제

export interface CardUsage {
  credit: number;
  debit: number;
  market: number;
  transit: number;
  culture: number;
}

export interface CardResult {
  total: number;
  minUsage: number;
  /** 최저사용금액 초과 여부 */
  over: boolean;
  /** 한도 적용 전 공제액 */
  raw: number;
  cap: number;
  extra: number;
  deduction: number;
  /** 총급여 7천만원 이하(문화체육 사용분 우대) */
  low: boolean;
}

/** 조세특례제한법 제126조의2 */
export function cardDeduction(y: YearendRates, salary: number, u: CardUsage, childCount: number): CardResult {
  const c = y.card;
  const low = salary <= c.highSalary;
  // 총급여 7천만원 초과면 문화체육 사용분 우대가 없어 신용카드 사용분으로 본다
  const K = pos(u.credit) + (low ? 0 : pos(u.culture));
  const D = pos(u.debit);
  const C = low ? pos(u.culture) : 0;
  const M = pos(u.market);
  const T = pos(u.transit);
  const total = K + D + C + M + T;
  const minUsage = pm(salary, c.minRatio);
  const cap = childCount >= 2 ? c.cap.withChild[low ? "low" : "high"].twoOrMore : childCount === 1 ? c.cap.withChild[low ? "low" : "high"].one : low ? c.cap.low : c.cap.high;
  if (total <= minUsage) return { total, minUsage, over: false, raw: 0, cap, extra: 0, deduction: 0, low };
  const r = c.rate;
  const sum = pm(M, r.market) + pm(T, r.transit) + pm(C, r.culture) + pm(D, r.debit) + pm(K, r.credit);
  // 최저사용금액은 신용카드 → 직불·현금영수증·문화체육 → 전통시장·대중교통 순으로 먼저 차감한다 (제2항 제6호)
  let floorPart: number;
  if (minUsage <= K) floorPart = pm(minUsage, r.credit);
  else if (minUsage <= K + D + C) floorPart = pm(K, r.credit) + pm(minUsage - K, r.debit);
  else floorPart = pm(K, r.credit) + pm(D + C, r.debit) + pm(minUsage - K - D - C, r.market);
  const raw = Math.max(0, sum - floorPart);
  const extraBase = pm(M, r.market) + pm(T, r.transit) + pm(C, r.culture);
  const extraLimit = low ? c.extraCap.low : c.extraCap.high;
  const extra = raw > cap ? Math.min(raw - cap, Math.min(extraBase, extraLimit)) : 0;
  return { total, minUsage, over: true, raw, cap, extra, deduction: raw > cap ? cap + extra : raw, low };
}

// ---------------------------------------------------------------- 사람 단위 고정값 (가족 배분과 무관)

export interface PersonBase {
  salary: number;
  earnedDeduction: number;
  earnedIncome: number;
  nps: number;
  health: number;
  npsEstimated: boolean;
  healthEstimated: boolean;
  prepaidTax: number;
  prepaidLocal: number;
  prepaidEstimated: boolean;
}

export function annualInsurance(ctx: YearCtx, taxableAnnual: number): { nps: number; health: number } {
  const monthly = Math.floor(taxableAnnual / 12);
  const half = (res: Resolved) => {
    const r = calcInsurance(res.set.rates, { taxableMonthly: monthly, asOf: res.asOf });
    const w = (k: string) => r.rows.find((x) => x.key === k)?.worker ?? 0;
    return { nps: w("nps"), health: w("nhis") + w("ltc") + w("ei") };
  };
  const a = half(ctx.h1);
  const b = half(ctx.h2);
  return { nps: 6 * (a.nps + b.nps), health: 6 * (a.health + b.health) };
}

export function prepare(ctx: YearCtx, p: PersonInput): PersonBase {
  const salary = pos(p.gross - p.nonTaxable);
  const earnedDeduction = earnedIncomeDeduction(ctx.rates, salary);
  const est = annualInsurance(ctx, salary);
  const nps = p.npsOverride ?? est.nps;
  const health = p.healthOverride ?? est.health;
  let prepaidTax: number;
  let prepaidLocal: number;
  if (p.prepaidOverride !== undefined) {
    prepaidTax = p.prepaidOverride;
    prepaidLocal = floor10(pm(prepaidTax, ctx.rates.incomeTax.localTaxRatio));
  } else {
    const wh = withholdingTax(ctx.withholding, Math.floor(salary / 12), p.wFamily, p.wChildren);
    prepaidTax = wh.tax * 12;
    prepaidLocal = wh.localTax * 12;
  }
  return {
    salary, earnedDeduction, earnedIncome: salary - earnedDeduction, nps, health,
    npsEstimated: p.npsOverride === undefined, healthEstimated: p.healthOverride === undefined,
    prepaidTax, prepaidLocal, prepaidEstimated: p.prepaidOverride === undefined,
  };
}

// ---------------------------------------------------------------- 가족 판정

/** 기본공제 대상 여부 (나이·소득 요건) — 소득세법 제50조 */
export function baseEligible(y: YearendRates, year: number, d: Dep): boolean {
  if (d.highIncome) return false;
  if (d.rel === "spouse") return true;
  const age = year - d.year;
  if (d.rel === "child") return age >= 0 && age <= y.person.childMaxAge;
  return age >= y.person.parentMinAge;
}

// ---------------------------------------------------------------- 사람 단위 계산

export interface Credits {
  earned: number;
  child: number;
  birth: number;
  pension: number;
  insurance: number;
  medical: number;
  education: number;
  donation: number;
  rent: number;
  standard: number;
  hometown: number;
  /** 특별세액공제(보험·의료·교육·기부·월세)를 택했나, 표준세액공제를 택했나 */
  usedSpecial: boolean;
  /** 특별세액공제 후보 합계(표준세액공제와 비교한 값) */
  specialSum: number;
  /** 한도 적용 전 합계 */
  rawTotal: number;
  total: number;
  /** 산출세액을 넘어 줄어들었나 */
  capped: boolean;
}

export interface PersonResult {
  base: PersonBase;
  salary: number;
  earnedDeduction: number;
  earnedIncome: number;
  headcount: number;
  basic: number;
  senior: number;
  nps: number;
  health: number;
  housing: number;
  card: CardResult;
  /** 종합한도(주택청약+신용카드 등) 적용 후 */
  limited: number;
  limitedCapped: boolean;
  deductionTotal: number;
  taxBase: number;
  computedTax: number;
  marginalRate: number;
  credits: Credits;
  determinedTax: number;
  localTax: number;
  prepaidTax: number;
  prepaidLocal: number;
  settleTax: number;
  settleLocal: number;
  /** 양수: 추가 납부, 음수: 환급 (지방소득세 포함) */
  settleTotal: number;
  /** 의료비 공제 대상 금액(문턱 적용 후) */
  medicalBase: number;
  medicalThreshold: number;
  medicalSum: number;
  notices: Notice[];
}

export interface Extra {
  credit: number;
  debit: number;
}

/**
 * 한 사람의 연말정산 계산.
 * @param deps 이 사람이 공제받는 부양가족
 * @param extra 부부가 나눠 쓰는 공동 카드 지출 중 이 사람 몫
 */
export function evaluate(ctx: YearCtx, base: PersonBase, p: PersonInput, deps: readonly Dep[], extra: Extra = { credit: 0, debit: 0 }): PersonResult {
  const R = ctx.rates;
  const y = R.yearend;
  const Y = ctx.year;
  const S = base.salary;
  const L = base.earnedIncome;
  const notices: Notice[] = [];

  // --- 인적공제
  const eligible = deps.filter((d) => baseEligible(y, Y, d));
  const headcount = 1 + eligible.length;
  const basic = headcount * R.incomeTax.basicDeductionPerPerson;
  const seniors = eligible.filter((d) => d.rel !== "spouse" && Y - d.year >= y.person.seniorAge).length;
  const senior = seniors * y.person.seniorExtra;

  // --- 신용카드 등 (본인 + 공동분 + 소득요건을 충족하는 가족의 사용액)
  const cardDeps = deps.filter((d) => !d.highIncome);
  const usage: CardUsage = {
    credit: p.credit + extra.credit + cardDeps.reduce((s, d) => s + d.credit, 0),
    debit: p.debit + extra.debit + cardDeps.reduce((s, d) => s + d.debit, 0),
    market: p.market,
    transit: p.transit,
    culture: p.culture,
  };
  // 자녀 추가 한도: 소득요건 충족 + 20세 이하 직계비속 (공제받는 쪽에 한함)
  const cardChildren = deps.filter((d) => d.rel === "child" && !d.highIncome && Y - d.year >= 0 && Y - d.year <= y.person.childMaxAge).length;
  const card = cardDeduction(y, S, usage, cardChildren);

  // --- 주택청약저축
  const housing = p.noHome && S <= y.housingSavings.salaryLimit ? pm(Math.min(p.housingSavings, y.housingSavings.payCap), y.housingSavings.rate) : 0;
  const limitedRaw = card.deduction + housing;
  const limited = Math.min(limitedRaw, y.comprehensiveCap);

  const deductionTotal = basic + senior + base.nps + base.health + limited;
  const taxBase = pos(L - deductionTotal);
  const br = bracketTax(R, taxBase);
  const computedTax = br.tax;

  // --- 세액공제
  const earned = earnedIncomeCredit(y, computedTax, S);

  const kids = eligible.filter((d) => d.rel === "child" && Y - d.year >= y.child.creditMinAge).length;
  const cc = R.incomeTax.childCredit;
  const child = kids === 0 ? 0 : kids === 1 ? cc.one : kids === 2 ? cc.two : cc.two + cc.perExtra * (kids - 2);
  const birth = p.birthChild === 1 ? y.child.birth.first : p.birthChild === 2 ? y.child.birth.second : p.birthChild === 3 ? y.child.birth.third : 0;

  const pn = y.pension;
  const pensionBase = Math.min(Math.min(p.pensionSavings, pn.savingsCap) + p.irp, pn.totalCap);
  const pension = pm(pensionBase, S <= pn.lowSalary ? pn.rateLow : pn.rate);

  // 보장성 보험료: 본인 + 기본공제 대상 가족
  const premiumBase = Math.min(p.premium + eligible.reduce((s, d) => s + d.premium, 0), y.insurance.cap);
  const insurance = pm(premiumBase, y.insurance.rate);

  // 의료비: 총급여 3% 문턱. 본인·6세 이하·65세 이상은 한도 없음(특례), 나머지는 700만원 한도
  const md = y.medical;
  const threshold = pm(S, md.thresholdRatio);
  const isSpecialMedical = (d: Dep) => (d.rel === "child" && Y - d.year <= md.youngMaxAge) || (d.rel === "parent" && Y - d.year >= md.seniorMinAge);
  const general = p.medicalSpouse + deps.filter((d) => !isSpecialMedical(d)).reduce((s, d) => s + d.medical, 0);
  const special = p.medical + deps.filter(isSpecialMedical).reduce((s, d) => s + d.medical, 0);
  let medicalBase: number;
  if (general >= threshold) medicalBase = Math.min(general - threshold, md.generalCap) + special;
  else medicalBase = pos(special - (threshold - general));
  const medical = pm(medicalBase, md.rate);

  // 교육비: 본인은 한도 없음, 자녀는 1명당 한도(취학 전·초중고 / 대학)
  const ed = y.education;
  const childEdu = deps
    .filter((d) => d.rel === "child")
    .reduce((s, d) => s + Math.min(d.education, Y - d.year >= ed.universityMinAge ? ed.universityCap : ed.childCap), 0);
  const education = pm(p.education + childEdu, ed.rate);

  // 기부금: 특례(법정) → 일반(종교 외·종교) 순으로 한도 적용 후 15%(1천만원 초과분 30%)
  const dn = y.donation;
  const legal = Math.min(p.donLegal, L);
  const remain = pos(L - legal);
  const generalLimit = p.donReligious > 0 ? pm(remain, dn.religiousLimit) + Math.min(pm(remain, dn.religiousExtraLimit), p.donGeneral) : pm(remain, dn.generalLimit);
  const generalElig = Math.min(p.donGeneral + p.donReligious, generalLimit);
  const donBase = legal + generalElig;
  const donation = pm(Math.min(donBase, dn.overAmount), dn.rate) + pm(donBase - dn.overAmount, dn.rateOver);

  // 월세 (무주택 세대주, 총급여·소득금액 한도)
  const rn = y.rent;
  const rentOk = p.noHome && S <= rn.salaryLimit && L <= rn.incomeLimit;
  const rent = rentOk ? pm(Math.min(p.rent, rn.cap), S <= rn.lowSalary && L <= rn.lowIncome ? rn.rateLow : rn.rate) : 0;

  // 표준세액공제 vs 특별세액공제(+월세): 둘 중 큰 쪽 (월세를 받으면 표준세액공제는 받을 수 없다)
  const specialSum = insurance + medical + education + donation + rent;
  const usedSpecial = specialSum > y.standardCredit;
  const standard = usedSpecial ? 0 : y.standardCredit;

  // 고향사랑 기부금
  const hm = y.hometown;
  const h = Math.min(p.hometown, hm.max);
  const hometown =
    h <= hm.tier1
      ? Math.floor((h * hm.ratio1Num) / hm.ratio1Den)
      : h <= hm.tier2
        ? Math.floor((hm.tier1 * hm.ratio1Num) / hm.ratio1Den) + pm(h - hm.tier1, hm.rate2)
        : Math.floor((hm.tier1 * hm.ratio1Num) / hm.ratio1Den) + pm(hm.tier2 - hm.tier1, hm.rate2) + pm(h - hm.tier2, hm.rate3);

  const used = usedSpecial ? { insurance, medical, education, donation, rent } : { insurance: 0, medical: 0, education: 0, donation: 0, rent: 0 };
  const rawTotal = earned + child + birth + pension + used.insurance + used.medical + used.education + used.donation + used.rent + standard + hometown;
  const total = Math.min(rawTotal, computedTax);
  const capped = rawTotal > computedTax;
  const credits: Credits = {
    earned, child, birth, pension, ...used, standard, hometown, usedSpecial, specialSum, rawTotal, total, capped,
  };

  const determinedTax = computedTax - total;
  const localTax = floor10(pm(determinedTax, R.incomeTax.localTaxRatio));
  const settleTax = determinedTax - base.prepaidTax;
  const settleLocal = localTax - base.prepaidLocal;

  if (card.total > 0 && !card.over) {
    notices.push({ level: "info", code: "card-under", text: `카드 등 사용액 ${card.total.toLocaleString("ko-KR")}원이 최저사용금액(총급여의 ${pm(100, y.card.minRatio)}%, ${card.minUsage.toLocaleString("ko-KR")}원)을 넘지 못해 신용카드 공제가 없어요.` });
  }
  if (limitedRaw > y.comprehensiveCap) notices.push({ level: "info", code: "cap", text: `신용카드·주택청약 공제가 종합한도 ${y.comprehensiveCap.toLocaleString("ko-KR")}원을 넘어 한도까지만 반영했어요.` });
  if (capped) notices.push({ level: "info", code: "credit-cap", text: "세액공제가 산출세액보다 커서 결정세액이 0원이에요. 남는 공제는 이월되지 않아요(기부금 제외)." });
  if (specialSum > 0 && !usedSpecial) notices.push({ level: "info", code: "standard", text: `보험료·의료비·교육비·기부금·월세 공제 합계(${specialSum.toLocaleString("ko-KR")}원)가 표준세액공제(${y.standardCredit.toLocaleString("ko-KR")}원)보다 작아 표준세액공제를 적용했어요.` });
  if (p.rent > 0 && !rentOk) notices.push({ level: "info", code: "rent-no", text: `월세 세액공제는 무주택 세대주이고 총급여 ${rn.salaryLimit.toLocaleString("ko-KR")}원 이하(종합소득금액 ${rn.incomeLimit.toLocaleString("ko-KR")}원 이하)여야 해요. 요건을 확인해 주세요.` });

  return {
    base, salary: S, earnedDeduction: base.earnedDeduction, earnedIncome: L, headcount, basic, senior,
    nps: base.nps, health: base.health, housing, card, limited, limitedCapped: limitedRaw > y.comprehensiveCap, deductionTotal,
    taxBase, computedTax, marginalRate: br.rate, credits, determinedTax, localTax,
    prepaidTax: base.prepaidTax, prepaidLocal: base.prepaidLocal, settleTax, settleLocal, settleTotal: settleTax + settleLocal,
    medicalBase, medicalThreshold: threshold, medicalSum: general + special, notices,
  };
}

/** 한 사람이 모든 부양가족을 공제받는 기본 계산 */
export function calcMine(ctx: YearCtx, p: PersonInput, deps: readonly Dep[]): PersonResult {
  return evaluate(ctx, prepare(ctx, p), p, deps);
}

// ---------------------------------------------------------------- 절세 팁

export interface Tip {
  key: "pension" | "cardShift" | "hometown" | "cardMin";
  text: string;
  /** 예상 환급 증가액(지방소득세 포함). 정보성 팁은 0 */
  gain: number;
}

const won = (n: number): string => `${Math.round(n).toLocaleString("ko-KR")}원`;

/** "이렇게 하면 더 받아요" — 실제로 다시 계산해 본 값만 알려 준다 */
export function tips(ctx: YearCtx, p: PersonInput, deps: readonly Dep[], now: PersonResult): Tip[] {
  const y = ctx.rates.yearend;
  const out: Tip[] = [];
  const settle = (q: PersonInput): number => evaluate(ctx, now.base, q, deps).settleTotal;
  const cur = now.settleTotal;

  // 1) 연금저축·IRP
  const eligibleNow = Math.min(Math.min(p.pensionSavings, y.pension.savingsCap) + p.irp, y.pension.totalCap);
  const room = y.pension.totalCap - eligibleNow;
  if (room > 0 && now.salary > 0) {
    const roomSavings = Math.max(0, y.pension.savingsCap - Math.min(p.pensionSavings, y.pension.savingsCap));
    const addSavings = Math.min(room, roomSavings);
    const q = { ...p, pensionSavings: p.pensionSavings + addSavings, irp: p.irp + (room - addSavings) };
    const gain = cur - settle(q);
    if (gain > 0) out.push({ key: "pension", text: `연금저축·IRP를 ${won(room)} 더 넣으면(연 합산 한도 ${won(y.pension.totalCap)}까지) 환급이 ${won(gain)} 늘어요.`, gain });
  }

  // 2) 신용카드 → 체크카드·현금영수증 (최저사용금액을 넘은 신용카드 사용분만 효과가 있다)
  const shift = Math.min(p.credit, Math.max(0, now.card.total - now.card.minUsage));
  if (now.card.over && shift > 0 && now.card.raw < now.card.cap) {
    const q = { ...p, credit: p.credit - shift, debit: p.debit + shift };
    const gain = cur - settle(q);
    if (gain > 0) out.push({ key: "cardShift", text: `최저사용금액을 넘은 신용카드 사용분 ${won(shift)}을 체크카드·현금영수증으로 쓰면(공제율 ${(y.card.rate.credit * 100).toFixed(0)}% → ${(y.card.rate.debit * 100).toFixed(0)}%) 환급이 ${won(gain)} 늘어요.`, gain });
  }
  if (!now.card.over && now.card.total > 0) {
    out.push({ key: "cardMin", text: `카드 등 사용액이 최저사용금액보다 ${won(now.card.minUsage - now.card.total)} 적어요. 이 금액을 넘은 부분부터 공제돼요.`, gain: 0 });
  }

  // 3) 고향사랑 기부 (10만원까지 전액 세액공제)
  if (p.hometown < y.hometown.tier1 && now.determinedTax > 0) {
    const q = { ...p, hometown: y.hometown.tier1 };
    const gain = cur - settle(q);
    if (gain > 0) out.push({ key: "hometown", text: `고향사랑 기부금을 ${won(y.hometown.tier1)}까지 내면 전액 세액공제돼요(+답례품). 환급이 ${won(gain)} 늘어요.`, gain });
  }
  return out.sort((a, b) => b.gain - a.gain);
}
