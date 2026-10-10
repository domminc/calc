// 급여 계산기 (월급제 / 시급제). 식은 docs/FORMULAS.md §5
import { resolveRates, todayKst, type Resolved } from "./rates.ts";
import { calcInsurance, workerLines } from "./insurance.ts";
import { withholdingTax } from "./withholding.ts";
import { w33Labels, w33RatesOf, withholding33 } from "./freelancer.ts";
import type { CompanySize, FieldErrors, Line, Notice, Parsed } from "./types.ts";
import { pct } from "./money.ts";
import { dateField, fixFamily, intField, parsed, sizeField, toBool, toNumber, type Raw } from "./inputs.ts";

export const MAX_ALLOWANCES = 10;

export interface Allowance {
  name: string;
  amount: number;
  /** 비과세 */
  nonTaxable: boolean;
  /** 통상임금에 포함 (연장·야간·휴일 수당의 통상시급 계산에 쓴다) */
  ordinary: boolean;
}

export type DeductionMode = "insurance" | "tax33" | "none";

export interface PayrollInput {
  kind: "monthly" | "hourly";
  // 월급제
  basePay: number;
  allowances: Allowance[];
  overtimeHours: number;
  nightHours: number;
  holidayHours: number;
  holidayOver8Hours: number;
  bonus: number;
  // 시급제
  hourlyWage: number;
  weeklyHours: number;
  deductionMode: DeductionMode;
  // 공통
  family: number;
  children: number;
  asOf: string;
  size: CompanySize;
}

export function parsePayrollInput(raw: Raw): Parsed<PayrollInput> {
  const errors: FieldErrors = {};
  const adjusted: string[] = [];
  const kind = raw.kind === "hourly" ? "hourly" : "monthly";
  const allowances: Allowance[] = [];
  for (let i = 0; i < MAX_ALLOWANCES; i++) {
    const amountRaw = toNumber(raw[`al${i}_amount`]);
    const name = String(raw[`al${i}_name`] ?? "").trim().slice(0, 20);
    if (amountRaw === undefined && !name) continue;
    if (amountRaw === undefined || Number.isNaN(amountRaw) || amountRaw < 0 || amountRaw > 1_000_000_000 || !Number.isInteger(amountRaw)) {
      errors[`al${i}_amount`] = "수당 금액은 0 이상의 정수로 입력해 주세요.";
      continue;
    }
    allowances.push({ name: name || `수당${i + 1}`, amount: amountRaw, nonTaxable: toBool(raw[`al${i}_nt`]), ordinary: toBool(raw[`al${i}_ord`], true) });
  }
  const basePay = intField(raw, { field: "basePay", label: "기본급", required: true, def: 2_800_000, min: 0, max: 1_000_000_000, errors });
  const overtimeHours = intField(raw, { field: "overtime", label: "연장근로 시간", def: 0, min: 0, max: 200, errors, integer: false });
  const nightHours = intField(raw, { field: "night", label: "야간근로 시간", def: 0, min: 0, max: 200, errors, integer: false });
  const holidayHours = intField(raw, { field: "holiday", label: "휴일근로(8시간 이내)", def: 0, min: 0, max: 200, errors, integer: false });
  const holidayOver8Hours = intField(raw, { field: "holiday8", label: "휴일근로(8시간 초과)", def: 0, min: 0, max: 200, errors, integer: false });
  const bonus = intField(raw, { field: "bonus", label: "상여", def: 0, min: 0, max: 5_000_000_000, errors });
  const asOfDate = dateField(raw, "asOf", todayKst(), errors);
  const hourlyWage = intField(raw, { field: "wage", label: "시급", required: true, def: resolveRates(asOfDate).set.rates.labor.minHourlyWage, min: 1_000, max: 1_000_000, errors });
  const weeklyHours = intField(raw, { field: "weekly", label: "주 소정근로시간", required: true, def: 40, min: 1, max: 52, errors, integer: false });
  const dm = String(raw.deduction ?? "insurance");
  const deductionMode: DeductionMode = dm === "tax33" || dm === "none" ? dm : "insurance";
  let family = intField(raw, { field: "family", label: "부양가족 수", def: 1, min: 1, max: 20, errors });
  let children = intField(raw, { field: "children", label: "자녀 수", def: 0, min: 0, max: 10, errors });
  ({ family, children } = fixFamily(family, children, adjusted));
  return parsed(
    { kind, basePay, allowances, overtimeHours, nightHours, holidayHours, holidayOver8Hours, bonus, hourlyWage, weeklyHours, deductionMode, family, children, asOf: asOfDate, size: sizeField(raw) },
    errors,
    adjusted,
  );
}

export interface PayrollResult {
  input: PayrollInput;
  ratesYear: number;
  asOf: string;
  earnings: Line[];
  gross: number;
  nonTaxable: number;
  taxable: number;
  deductions: Line[];
  totalDeduction: number;
  net: number;
  /** 통상시급(월급제) 또는 입력 시급(시급제) */
  ordinaryHourly: number;
  monthlyHours: number;
  /** 월급제 통상시급 기준 시간 (209) */
  paidHours: number;
  holidayHours: number;
  minWage: { hourly: number; ok: boolean };
  employerInsurance: number;
  notices: Notice[];
}

function line(key: string, label: string, amount: number, basis: string): Line {
  return { key, label, amount, basis };
}

export function calcPayroll(input: PayrollInput, resolved: Resolved = resolveRates(input.asOf)): PayrollResult {
  const rates = resolved.set.rates;
  const notices: Notice[] = [];
  const earnings: Line[] = [];
  let nonTaxable = 0;
  let ordinaryHourly: number;
  let monthlyHours = rates.labor.monthlyPaidHours;
  let holidayHours = 0;

  if (input.kind === "monthly") {
    const ordinaryMonthly = input.basePay + input.allowances.filter((a) => a.ordinary).reduce((s, a) => s + a.amount, 0);
    ordinaryHourly = Math.floor(ordinaryMonthly / rates.labor.monthlyPaidHours);
    earnings.push(line("base", "기본급", input.basePay, "월 고정 기본급"));
    for (const a of input.allowances) {
      earnings.push(line(`al-${a.name}`, a.name, a.amount, a.nonTaxable ? "비과세" : "과세"));
      if (a.nonTaxable) nonTaxable += a.amount;
    }
    const ot = Math.floor(ordinaryHourly * (1 + rates.labor.overtimePremium) * input.overtimeHours);
    const night = Math.floor(ordinaryHourly * rates.labor.nightPremium * input.nightHours);
    const hol = Math.floor(ordinaryHourly * (1 + rates.labor.holidayPremium) * input.holidayHours);
    const hol8 = Math.floor(ordinaryHourly * (1 + rates.labor.holidayOver8Premium) * input.holidayOver8Hours);
    if (ot > 0) earnings.push(line("ot", "연장근로수당", ot, `통상시급 ${ordinaryHourly.toLocaleString("ko-KR")}원 × 1.5 × ${input.overtimeHours}시간`));
    if (night > 0) earnings.push(line("night", "야간근로수당(가산분)", night, `통상시급 × 0.5 × ${input.nightHours}시간`));
    if (hol > 0) earnings.push(line("holiday", "휴일근로수당", hol, `통상시급 × 1.5 × ${input.holidayHours}시간`));
    if (hol8 > 0) earnings.push(line("holiday8", "휴일근로수당(8시간 초과)", hol8, `통상시급 × 2.0 × ${input.holidayOver8Hours}시간`));
    if (input.bonus > 0) earnings.push(line("bonus", "상여", input.bonus, "이번 달 과세 상여"));
    if (input.nightHours > 0 || input.overtimeHours > 0) {
      notices.push({ level: "info", code: "ot-note", text: "연장·야간·휴일 시간은 서로 겹칠 수 있어요. 겹치는 시간은 각 칸에 모두 넣으면 가산이 중복 반영돼요(예: 야간 연장 = 연장 1.5배 + 야간 0.5배)." });
    }
  } else {
    ordinaryHourly = input.hourlyWage;
    const weekly = input.weeklyHours;
    const jhHoursWeek = weekly >= 15 ? (Math.min(weekly, 40) / 40) * 8 : 0;
    const WEEKS = 365 / 7 / 12;
    const workHours = Math.round(weekly * WEEKS);
    holidayHours = Math.round(jhHoursWeek * WEEKS);
    monthlyHours = workHours + holidayHours;
    earnings.push(line("base", "기본급", input.hourlyWage * workHours, `시급 ${input.hourlyWage.toLocaleString("ko-KR")}원 × 월 ${workHours}시간`));
    if (holidayHours > 0) earnings.push(line("weekly-holiday", "주휴수당", input.hourlyWage * holidayHours, `시급 × 월 주휴 ${holidayHours}시간 (주 15시간 이상)`));
    else notices.push({ level: "info", code: "no-juhyu", text: "주 소정근로시간이 15시간 미만이면 주휴수당이 없어요." });
  }

  const gross = earnings.reduce((s, l) => s + l.amount, 0);
  const taxable = gross - nonTaxable;
  const deductions: Line[] = [];
  let employerInsurance = 0;

  if (input.deductionMode === "insurance") {
    const ins = calcInsurance(rates, { taxableMonthly: taxable, asOf: resolved.asOf, size: input.size });
    employerInsurance = ins.employerTotal;
    deductions.push(...workerLines(ins));
    const wh = withholdingTax(resolved.set.withholding, taxable, input.family, input.children);
    deductions.push(line("tax", "소득세", wh.tax, `근로소득 간이세액표 (월 과세급여 ${taxable.toLocaleString("ko-KR")}원)`));
    deductions.push(line("local", "지방소득세", wh.localTax, "소득세의 10%"));
    notices.push(...ins.notices);
    if (input.kind === "hourly" && input.weeklyHours < 15) {
      notices.push({ level: "warn", code: "short-hours", text: "주 15시간 미만(초단시간) 근로자는 고용보험·국민연금·건강보험 가입 대상이 아닐 수 있어요. 가입 여부를 확인해 주세요." });
    }
  } else if (input.deductionMode === "tax33") {
    const w33 = w33RatesOf(rates);
    const lb = w33Labels(w33);
    const r = withholding33(taxable, w33);
    deductions.push(line("tax", `소득세(${lb.income})`, r.tax, `사업소득 원천징수 ${lb.income}`));
    deductions.push(line("local", `지방소득세(${lb.local})`, r.local, `소득세의 ${pct(w33.local)}`));
  }
  const totalDeduction = deductions.reduce((s, l) => s + l.amount, 0);

  const wageForMin = input.kind === "monthly" ? ordinaryHourly : input.hourlyWage;
  const minOk = wageForMin >= rates.labor.minHourlyWage;
  if (!minOk) {
    notices.push({ level: "warn", code: "min-wage", text: `시급 ${wageForMin.toLocaleString("ko-KR")}원은 ${resolved.set.year}년 최저임금 ${rates.labor.minHourlyWage.toLocaleString("ko-KR")}원보다 낮아요.` });
  }

  return {
    input,
    ratesYear: resolved.set.year,
    asOf: resolved.asOf,
    earnings,
    gross,
    nonTaxable,
    taxable,
    deductions,
    totalDeduction,
    net: gross - totalDeduction,
    ordinaryHourly,
    monthlyHours,
    paidHours: rates.labor.monthlyPaidHours,
    holidayHours,
    minWage: { hourly: rates.labor.minHourlyWage, ok: minOk },
    employerInsurance,
    notices,
  };
}
