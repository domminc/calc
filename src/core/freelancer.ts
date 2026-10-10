// 프리랜서 계산기. 식은 docs/FORMULAS.md §6
import { resolveRates, todayKst, type Rates, type Resolved } from "./rates.ts";
import { npsLimitsAt } from "./rates.ts";
import type { FieldErrors, Notice, Parsed } from "./types.ts";
import { dateField, fixFamily, intField, parsed, toBool, toNumber, type Raw } from "./inputs.ts";
import { clamp, floor10, floor1000, mulPpm, ppm } from "./money.ts";

// ---------- 3.3% 원천징수 ----------

export interface Withholding33 {
  gross: number;
  tax: number;
  local: number;
  net: number;
  /** 소액부징수(소득세 1,000원 미만) */
  exempt: boolean;
}

export function withholding33(gross: number): Withholding33 {
  const g = Math.max(0, Math.floor(gross));
  let tax = Math.floor((g * 3) / 100);
  let exempt = false;
  if (tax < 1000) {
    tax = 0;
    exempt = g > 0;
  }
  const local = Math.floor(tax / 10);
  return { gross: g, tax, local, net: g - tax - local, exempt };
}

/**
 * 실수령 → 세전 금액.
 * 같은 실수령을 만드는 세전이 여럿이면(단수처리 때문) net/0.967 에 가장 가까운 값,
 * 정확히 맞는 값이 없으면 실수령 이상이 되는 최소 세전액.
 */
export function grossFromNet33(net: number): number {
  const n = Math.max(0, Math.floor(net));
  const g0 = Math.round(n / 0.967);
  let best: number | undefined;
  for (let d = 0; d <= 6; d++) {
    for (const g of d === 0 ? [g0] : [g0 - d, g0 + d]) {
      if (g >= 0 && withholding33(g).net === n) {
        best = g;
        break;
      }
    }
    if (best !== undefined) break;
  }
  if (best !== undefined) return best;
  let g = Math.ceil(n / 0.967) + 2;
  while (g > 0 && withholding33(g - 1).net >= n) g--;
  return g;
}

// ---------- 5월 종합소득세 ----------

export type ExpenseMode = "rate" | "actual";

export interface AnnualTaxInput {
  revenue: number;
  expenseMode: ExpenseMode;
  /** 단순경비율 (0.641 = 64.1%) */
  expenseRate: number;
  actualExpense: number;
  persons: number;
  children: number;
  /** 연금보험료(국민연금) 납부액 — 소득공제 */
  pensionPaid: number;
  otherDeduction: number;
  /** 기납부세액(소득세) 직접 지정. 없으면 수입×3% */
  prepaidOverride: number | undefined;
}

export interface AnnualTaxResult {
  input: AnnualTaxInput;
  revenue: number;
  expense: number;
  income: number;
  deductions: { basic: number; pension: number; other: number; total: number };
  taxBase: number;
  computedTax: number;
  bracket: { rate: number; upTo: number | null };
  credits: { child: number; standard: number; total: number };
  determinedTax: number;
  localTax: number;
  prepaidTax: number;
  prepaidLocal: number;
  settleIncomeTax: number;
  settleLocalTax: number;
  /** 양수: 추가 납부, 음수: 환급 */
  settleTotal: number;
  /** 결정세액+지방소득세 */
  totalTax: number;
  effectiveRate: number;
  notices: Notice[];
}

export function bracketTax(rates: Rates, taxBase: number): { tax: number; rate: number; upTo: number | null } {
  const b = rates.incomeTax.brackets.find((x) => x.upTo === null || taxBase <= x.upTo)!;
  const ratePct = Math.round(b.rate * 100);
  return { tax: Math.max(0, Math.floor((taxBase * ratePct) / 100) - b.deduction), rate: b.rate, upTo: b.upTo };
}

export function calcAnnualTax(rates: Rates, input: AnnualTaxInput): AnnualTaxResult {
  const notices: Notice[] = [];
  const revenue = Math.max(0, Math.floor(input.revenue));
  const expense =
    input.expenseMode === "rate" ? mulPpm(revenue, ppm(input.expenseRate)) : Math.min(Math.max(0, Math.floor(input.actualExpense)), revenue);
  const income = revenue - expense;
  const basic = rates.incomeTax.basicDeductionPerPerson * Math.max(1, input.persons);
  const pension = Math.max(0, Math.floor(input.pensionPaid));
  const other = Math.max(0, Math.floor(input.otherDeduction));
  const dTotal = basic + pension + other;
  const taxBase = Math.max(0, income - dTotal);
  const br = bracketTax(rates, taxBase);
  const childC = childCredit_annual(rates, input.children);
  const standard = rates.incomeTax.standardCredit.noEarnedIncome;
  const credits = { child: childC, standard, total: childC + standard };
  const determinedTax = Math.max(0, br.tax - credits.total);
  const localTax = floor10(determinedTax * rates.incomeTax.localTaxRatio);
  const prepaidTax = input.prepaidOverride ?? Math.floor((revenue * 3) / 100);
  const prepaidLocal = Math.floor(prepaidTax / 10);
  const settleIncomeTax = determinedTax - prepaidTax;
  const settleLocalTax = localTax - prepaidLocal;
  const settleTotal = settleIncomeTax + settleLocalTax;
  if (income <= 0) notices.push({ level: "info", code: "no-income", text: "필요경비가 수입 이상이라 소득금액이 0원이에요." });
  if (taxBase === 0 && prepaidTax > 0) notices.push({ level: "info", code: "all-refund", text: "과세표준이 0원이라 미리 낸 3.3%를 전액 환급받을 수 있어요(신고 필요)." });
  if (input.expenseMode === "rate" && input.expenseRate >= 0.9) notices.push({ level: "warn", code: "rate-high", text: "경비율이 90% 이상이에요. 업종별 단순경비율 고시값이 맞는지 확인해 주세요." });
  return {
    input,
    revenue,
    expense,
    income,
    deductions: { basic, pension, other, total: dTotal },
    taxBase,
    computedTax: br.tax,
    bracket: { rate: br.rate, upTo: br.upTo },
    credits,
    determinedTax,
    localTax,
    prepaidTax,
    prepaidLocal,
    settleIncomeTax,
    settleLocalTax,
    settleTotal,
    totalTax: determinedTax + localTax,
    effectiveRate: revenue > 0 ? (determinedTax + localTax) / revenue : 0,
    notices,
  };
}

/** 종합소득세 자녀세액공제 (연액): 1명 25만 / 2명 55만 / 3명↑ 55만 + 2명 초과 1명당 40만 */
function childCredit_annual(rates: Rates, children: number): number {
  if (children <= 0) return 0;
  const c = rates.incomeTax.childCredit;
  if (children === 1) return c.one;
  if (children === 2) return c.two;
  return c.two + c.perExtra * (children - 2);
}

// ---------- 지역가입자 건강보험·국민연금 ----------

export interface RegionalInput {
  /** 연 소득금액 (수입 − 필요경비) */
  annualIncome: number;
  /** 재산보험료 부과점수 (모르면 0) */
  propertyScore: number;
  asOf: string;
}

export interface RegionalResult {
  monthlyIncome: number;
  nhis: number;
  ltc: number;
  nps: number;
  npsBase: number;
  total: number;
  nhisBadge?: string;
  npsBadge?: string;
}

export function calcRegional(rates: Rates, input: RegionalInput): RegionalResult {
  const m = Math.max(0, Math.floor(input.annualIncome / 12));
  const lim = npsLimitsAt(rates, input.asOf);
  const raw = (m * ppm(rates.nhis.rate)) / 1_000_000 + Math.max(0, input.propertyScore) * rates.nhis.regionalScoreUnitPrice;
  const regionalMax = rates.nhis.premiumMax / 2; // 지역가입자 상한 = 직장 본인부담 상한
  const nhis = floor10(clamp(raw, rates.nhis.premiumMin, regionalMax));
  const ltc = floor10(Math.floor((nhis * ppm(rates.nhis.ltc.rate)) / ppm(rates.nhis.rate)));
  const npsRaw = floor1000(m);
  const npsBase = m > 0 ? clamp(npsRaw, lim.min, lim.max) : 0;
  const nps = floor10(mulPpm(npsBase, ppm(rates.nps.rate)));
  const out: RegionalResult = { monthlyIncome: m, nhis, ltc, nps, npsBase, total: nhis + ltc + nps };
  if (raw > regionalMax) out.nhisBadge = "상한 적용";
  else if (raw < rates.nhis.premiumMin) out.nhisBadge = "하한 적용";
  if (m > 0 && npsRaw > lim.max) out.npsBadge = "상한 적용";
  else if (m > 0 && npsRaw < lim.min) out.npsBadge = "하한 적용";
  return out;
}

// ---------- 입력 파싱 ----------

export type FreelancerTab = "w33" | "tax" | "net";

export interface FreelancerInput {
  tab: FreelancerTab;
  // 탭 A
  amountMode: "gross" | "net";
  amount: number;
  months: number;
  // 탭 B·C
  revenue: number;
  expenseMode: ExpenseMode;
  /** % 단위가 아닌 비율 (0.641) */
  expenseRate: number;
  actualExpense: number;
  persons: number;
  children: number;
  pensionPaid: number;
  otherDeduction: number;
  prepaidOverride: number | undefined;
  // 탭 C
  propertyScore: number;
  cashExpense: number;
  useRegionalNps: boolean;
  asOf: string;
}

export function parseFreelancerInput(raw: Raw): Parsed<FreelancerInput> {
  const errors: FieldErrors = {};
  const adjusted: string[] = [];
  const tab: FreelancerTab = raw.tab === "tax" || raw.tab === "net" ? raw.tab : "w33";
  const amountMode = raw.amountMode === "net" ? "net" : "gross";
  const amount = intField(raw, { field: "amount", label: "금액", required: true, def: 3_000_000, min: 0, max: 100_000_000_000, errors });
  const months = intField(raw, { field: "months", label: "개월 수", def: 12, min: 1, max: 12, errors });
  const revenue = intField(raw, { field: "revenue", label: "연 수입금액", required: true, def: 36_000_000, min: 0, max: 100_000_000_000, errors });
  const expenseMode: ExpenseMode = raw.expenseMode === "actual" ? "actual" : "rate";
  const ratePctRaw = toNumber(raw.expenseRate);
  let expenseRate = 0.641;
  if (ratePctRaw !== undefined) {
    if (Number.isNaN(ratePctRaw) || ratePctRaw < 0 || ratePctRaw > 100) errors.expenseRate = "경비율은 0~100% 사이로 입력해 주세요.";
    else expenseRate = ratePctRaw / 100;
  }
  const actualExpense = intField(raw, { field: "actualExpense", label: "실제 경비", def: 0, min: 0, max: 100_000_000_000, errors });
  let persons = intField(raw, { field: "persons", label: "부양가족 수", def: 1, min: 1, max: 20, errors });
  let children = intField(raw, { field: "children", label: "자녀 수", def: 0, min: 0, max: 10, errors });
  ({ family: persons, children } = fixFamily(persons, children, adjusted));
  const pensionPaid = intField(raw, { field: "pension", label: "국민연금 납부액", def: 0, min: 0, max: 1_000_000_000, errors });
  const otherDeduction = intField(raw, { field: "otherDeduction", label: "기타 소득공제", def: 0, min: 0, max: 100_000_000_000, errors });
  const prepaidRaw = toNumber(raw.prepaid);
  let prepaidOverride: number | undefined;
  if (prepaidRaw !== undefined) {
    if (Number.isNaN(prepaidRaw) || prepaidRaw < 0 || !Number.isInteger(prepaidRaw)) errors.prepaid = "기납부세액은 0 이상의 정수로 입력해 주세요.";
    else prepaidOverride = prepaidRaw;
  }
  const propertyScore = intField(raw, { field: "propertyScore", label: "재산 부과점수", def: 0, min: 0, max: 100_000_000, errors, integer: false });
  const cashExpense = intField(raw, { field: "cashExpense", label: "실제 지출 경비", def: 0, min: 0, max: 100_000_000_000, errors });
  return parsed(
    { tab, amountMode, amount, months, revenue, expenseMode, expenseRate, actualExpense, persons, children, pensionPaid, otherDeduction, prepaidOverride, propertyScore, cashExpense, useRegionalNps: toBool(raw.regionalNps, true), asOf: dateField(raw, "asOf", todayKst(), errors) },
    errors,
    adjusted,
  );
}

export interface W33Result {
  w: Withholding33;
  /** 입력 방식이 실수령 → 세전이었는지 */
  fromNet: boolean;
  months: number;
  annualGross: number;
  annualNet: number;
  notices: Notice[];
}

export function calcW33(input: FreelancerInput): W33Result {
  const fromNet = input.amountMode === "net";
  const gross = fromNet ? grossFromNet33(input.amount) : input.amount;
  const w = withholding33(gross);
  const notices: Notice[] = [];
  if (w.exempt) notices.push({ level: "info", code: "exempt", text: "소득세가 1,000원 미만이라 원천징수하지 않아요(소액부징수)." });
  return { w, fromNet, months: input.months, annualGross: w.gross * input.months, annualNet: w.net * input.months, notices };
}

export interface NetResult {
  regional: RegionalResult;
  tax: AnnualTaxResult;
  /** 연 부담 합계 */
  annualBurden: number;
  netMonthly: number;
  notices: Notice[];
}

export function annualTaxInputOf(i: FreelancerInput, pension: number): AnnualTaxInput {
  return {
    revenue: i.revenue,
    expenseMode: i.expenseMode,
    expenseRate: i.expenseRate,
    actualExpense: i.actualExpense,
    persons: i.persons,
    children: i.children,
    pensionPaid: pension,
    otherDeduction: i.otherDeduction,
    prepaidOverride: i.prepaidOverride,
  };
}

export function calcTab(input: FreelancerInput, resolved: Resolved = resolveRates(input.asOf)) {
  return calcAnnualTax(resolved.set.rates, annualTaxInputOf(input, input.pensionPaid));
}

export function calcNet(input: FreelancerInput, resolved: Resolved = resolveRates(input.asOf)): NetResult {
  const rates = resolved.set.rates;
  const noPension = calcAnnualTax(rates, annualTaxInputOf(input, 0));
  const regional = calcRegional(rates, { annualIncome: noPension.income, propertyScore: input.propertyScore, asOf: resolved.asOf });
  const npsAnnual = input.useRegionalNps ? regional.nps * 12 : 0;
  const tax = calcAnnualTax(rates, annualTaxInputOf(input, input.pensionPaid + npsAnnual));
  const insuranceAnnual = (regional.nhis + regional.ltc) * 12 + npsAnnual;
  const annualBurden = tax.totalTax + insuranceAnnual + input.cashExpense;
  const notices: Notice[] = [
    { level: "info", code: "regional-timing", text: "지역 건강보험료는 5월 소득 신고 후 11월부터 바뀐 소득으로 부과돼요." },
  ];
  if (!input.useRegionalNps) notices.push({ level: "info", code: "nps-excluded", text: "국민연금을 제외하고 계산했어요(납부예외 또는 가입 대상이 아닌 경우)." });
  return {
    regional,
    tax,
    annualBurden,
    netMonthly: Math.floor((input.revenue - annualBurden) / 12),
    notices,
  };
}
