// 연봉 계산기. 식은 docs/FORMULAS.md §3·§4
import type { Rates, Resolved } from "./rates.ts";
import { resolveRates, todayKst } from "./rates.ts";
import { calcInsurance, workerLines, type InsuranceResult } from "./insurance.ts";
import { withholdingTax } from "./withholding.ts";
import type { CompanySize, FieldErrors, Line, Notice, Parsed } from "./types.ts";
import { dateField, fixFamily, intField, parsed, sizeField, toBool, toNumber, type Raw } from "./inputs.ts";
import { floor10 } from "./money.ts";

export type SalaryMode = "forward" | "reverse";

export interface SalaryInput {
  mode: SalaryMode;
  /** forward: 연봉(세전, 원) */
  annual: number;
  /** reverse: 희망 월 실수령액 */
  targetNet: number;
  severanceIncluded: boolean;
  nonTaxableMonthly: number;
  family: number;
  children: number;
  asOf: string;
  size: CompanySize;
  wciRate: number | undefined;
}

export const SALARY_LIMITS = { annualMin: 10_000_000, annualMax: 2_000_000_000 };

export function parseSalaryInput(raw: Raw): Parsed<SalaryInput> {
  const errors: FieldErrors = {};
  const adjusted: string[] = [];
  const mode: SalaryMode = raw.mode === "reverse" ? "reverse" : "forward";
  const annual = intField(raw, { field: "annual", label: "연봉", required: true, def: 40_000_000, min: SALARY_LIMITS.annualMin, max: SALARY_LIMITS.annualMax, errors });
  const targetNet = intField(raw, { field: "targetNet", label: "희망 월 실수령액", required: true, def: 3_000_000, min: 500_000, max: 120_000_000, errors });
  const nonTaxableMonthly = intField(raw, { field: "nonTaxable", label: "월 비과세액", def: 200_000, min: 0, max: 100_000_000, errors });
  let family = intField(raw, { field: "family", label: "부양가족 수", def: 1, min: 1, max: 20, errors });
  let children = intField(raw, { field: "children", label: "자녀 수", def: 0, min: 0, max: 10, errors });
  ({ family, children } = fixFamily(family, children, adjusted));
  const asOf = dateField(raw, "asOf", todayKst(), errors);
  const wciRaw = toNumber(raw.wciRate);
  let wciRate: number | undefined;
  if (wciRaw !== undefined) {
    if (Number.isNaN(wciRaw) || wciRaw < 0 || wciRaw > 30) errors.wciRate = "산재보험료율은 0~30% 사이로 입력해 주세요.";
    else wciRate = wciRaw / 100;
  }
  return parsed(
    {
      mode,
      annual,
      targetNet,
      severanceIncluded: toBool(raw.severance),
      nonTaxableMonthly,
      family,
      children,
      asOf,
      size: sizeField(raw),
      wciRate,
    },
    errors,
    adjusted,
  );
}

export interface SalaryResult {
  input: SalaryInput;
  ratesYear: number;
  asOf: string;
  /** 월 총지급액 (비과세 포함) */
  monthlyGross: number;
  nonTaxable: number;
  taxableMonthly: number;
  insurance: InsuranceResult;
  incomeTax: number;
  localTax: number;
  childReduction: number;
  /** 근로자 공제 항목 (4대보험 4 + 소득세 + 지방소득세) */
  lines: Line[];
  totalDeduction: number;
  netMonthly: number;
  netAnnual: number;
  deductionRatio: number;
  /** 사업주가 내는 4대보험 */
  employerInsurance: number;
  /** 월 인건비 총액 (총지급 + 사업주 보험) */
  employerCost: number;
  notices: Notice[];
}

/** 순방향 계산. */
export function calcSalary(input: SalaryInput, resolved: Resolved = resolveRates(input.asOf)): SalaryResult {
  const { rates, withholding } = resolved.set;
  const divisor = input.severanceIncluded ? 13 : 12;
  const monthlyGross = Math.floor(input.annual / divisor);
  const nonTaxable = Math.min(input.nonTaxableMonthly, monthlyGross);
  const taxableMonthly = monthlyGross - nonTaxable;
  return build(input, rates, resolved, { monthlyGross, nonTaxable, taxableMonthly });
}

function build(
  input: SalaryInput,
  rates: Rates,
  resolved: Resolved,
  m: { monthlyGross: number; nonTaxable: number; taxableMonthly: number },
): SalaryResult {
  const ins = calcInsurance(rates, {
    taxableMonthly: m.taxableMonthly,
    asOf: resolved.asOf,
    size: input.size,
    ...(input.wciRate !== undefined ? { wciRate: input.wciRate } : {}),
  });
  const wh = withholdingTax(resolved.set.withholding, m.taxableMonthly, input.family, input.children);
  const notices: Notice[] = [...ins.notices];
  if (resolved.fallback) {
    notices.push({ level: "warn", code: "rates-fallback", text: `${resolved.fallback.requestedYear}년 요율은 아직 없어 ${resolved.fallback.usedYear}년 기준으로 계산했어요.` });
  }
  if (wh.zeroBand) notices.push({ level: "info", code: "tax-zero", text: "월 과세급여가 770천원 미만이라 간이세액표상 소득세가 0원이에요." });
  if (input.nonTaxableMonthly > m.monthlyGross) notices.push({ level: "warn", code: "nontax-capped", text: "비과세액이 월 급여보다 커서 월 급여까지만 반영했어요." });
  if (input.nonTaxableMonthly > rates.taxFree.mealMonthly) notices.push({ level: "info", code: "nontax-meal", text: `비과세 식대 한도는 월 ${rates.taxFree.mealMonthly.toLocaleString("ko-KR")}원이에요. 식대 외 비과세(차량보조·육아수당 등)가 있다면 그대로 두세요.` });
  if (wh.childReduction > 0) notices.push({ level: "info", code: "child", text: `8~20세 자녀 세액공제 ${wh.childReduction.toLocaleString("ko-KR")}원이 소득세에서 빠졌어요.` });

  const insLines = workerLines(ins);
  const lines: Line[] = [
    ...insLines,
    { key: "tax", label: "소득세", amount: wh.tax, basis: `근로소득 간이세액표 (월 과세급여 ${m.taxableMonthly.toLocaleString("ko-KR")}원, 가족 ${input.family}명${input.children ? `, 자녀 ${input.children}명` : ""})` },
    { key: "local", label: "지방소득세", amount: wh.localTax, basis: "소득세의 10%" },
  ];
  const totalDeduction = lines.reduce((s, l) => s + l.amount, 0);
  const netMonthly = m.monthlyGross - totalDeduction;
  return {
    input,
    ratesYear: resolved.set.year,
    asOf: resolved.asOf,
    monthlyGross: m.monthlyGross,
    nonTaxable: m.nonTaxable,
    taxableMonthly: m.taxableMonthly,
    insurance: ins,
    incomeTax: wh.tax,
    localTax: wh.localTax,
    childReduction: wh.childReduction,
    lines,
    totalDeduction,
    netMonthly,
    netAnnual: netMonthly * 12,
    deductionRatio: m.monthlyGross > 0 ? totalDeduction / m.monthlyGross : 0,
    employerInsurance: ins.employerTotal,
    employerCost: m.monthlyGross + ins.employerTotal,
    notices,
  };
}

/** 역산: 월 실수령액이 목표 이상이 되는 최소 연봉(1만원 단위). */
export function solveAnnualForNet(input: SalaryInput, resolved: Resolved = resolveRates(input.asOf)): { annual: number; result: SalaryResult; reachable: boolean } {
  const STEP = 10_000;
  const net = (annual: number) => calcSalary({ ...input, annual, mode: "forward" }, resolved).netMonthly;
  let lo = Math.ceil(SALARY_LIMITS.annualMin / STEP);
  let hi = Math.floor(SALARY_LIMITS.annualMax / STEP);
  if (net(hi * STEP) < input.targetNet) {
    return { annual: hi * STEP, result: calcSalary({ ...input, annual: hi * STEP, mode: "forward" }, resolved), reachable: false };
  }
  if (net(lo * STEP) >= input.targetNet) {
    return { annual: lo * STEP, result: calcSalary({ ...input, annual: lo * STEP, mode: "forward" }, resolved), reachable: true };
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (net(mid * STEP) >= input.targetNet) hi = mid;
    else lo = mid;
  }
  const annual = hi * STEP;
  return { annual, result: calcSalary({ ...input, annual, mode: "forward" }, resolved), reachable: true };
}

export { floor10 };
