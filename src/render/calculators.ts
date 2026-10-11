// 계산기 레지스트리: 입력(raw) → 결과 HTML. 서버(SSR)와 브라우저(즉시 갱신)가 같은 함수를 쓴다.
import type { Raw } from "../core/inputs.ts";
import type { FieldErrors } from "../core/types.ts";
import { rateNotices, resolveRates, type Resolved } from "../core/rates.ts";
import { calcSalary, parseSalaryInput, solveAnnualForNet } from "../core/salary.ts";
import { calcPayroll, parsePayrollInput, MAX_ALLOWANCES } from "../core/payroll.ts";
import { calcInsurance } from "../core/insurance.ts";
import { parseInsuranceInput } from "../core/insurance-input.ts";
import { calcNet, calcTab, calcW33, parseFreelancerInput } from "../core/freelancer.ts";
import { calcMine, tips, yearContext } from "../core/yearend.ts";
import { optimizeCouple } from "../core/yearend-couple.ts";
import { MAX_DEPS, parseYearendInput } from "../core/yearend-input.ts";
import { esc, wonText } from "./html.ts";
import { adjustedList, noticeList, renderAnnualTax, renderInsurance, renderNet, renderPayroll, renderSalary, renderW33 } from "./result.ts";
import { renderYearendCouple, renderYearendMe } from "./yearend-result.ts";

export type CalcKey = "salary" | "payroll" | "insurance" | "freelancer" | "yearend";
export const CALC_KEYS: readonly CalcKey[] = ["salary", "payroll", "insurance", "freelancer", "yearend"];
export const isCalcKey = (k: string): k is CalcKey => (CALC_KEYS as readonly string[]).includes(k);

export interface ComputeOutput {
  html: string;
  errors: FieldErrors;
  adjusted: string[];
  /** 모바일 하단 고정바용 요약 */
  summary: { label: string; value: string } | null;
  ok: boolean;
}

const PLAIN = ["asOf", "size", "wciRate", "family", "children"];
/** 연말정산: 사람별 입력(a_·b_ 접두사)과 부양가족 행(d0_~) */
const YE_PERSON = ["gross", "nt", "nps", "hi", "tax", "wf", "wc", "cc", "dc", "mk", "tr", "cu", "med", "medsp", "edu", "prem", "dl", "dg", "dr", "hs", "ps", "irp", "hsv", "rent", "nh", "birth"];
const YE_DEP = ["rel", "year", "hi", "med", "edu", "prem", "cc", "dc"];
const ALLOWED: Record<CalcKey, string[]> = {
  salary: ["mode", "annual", "targetNet", "severance", "nonTaxable", ...PLAIN],
  payroll: [
    "kind", "basePay", "overtime", "night", "holiday", "holiday8", "bonus", "wage", "weekly", "deduction", ...PLAIN,
    ...Array.from({ length: MAX_ALLOWANCES }, (_, i) => [`al${i}_name`, `al${i}_amount`, `al${i}_nt`, `al${i}_ord`]).flat(),
  ],
  insurance: ["monthly", "asOf", "size", "wciRate"],
  freelancer: [
    "tab", "amountMode", "amount", "months", "revenue", "expenseMode", "expenseRate", "actualExpense", "persons", "children",
    "pension", "otherDeduction", "prepaid", "propertyScore", "cashExpense", "regionalNps", "eiRate", "asOf",
  ],
  yearend: [
    "tab", "year", "asOf", "sc", "sd",
    ...YE_PERSON.map((k) => `a_${k}`),
    ...YE_PERSON.map((k) => `b_${k}`),
    ...Array.from({ length: MAX_DEPS }, (_, n) => YE_DEP.map((k) => `d${n}_${k}`)).flat(),
  ],
};

/** 허용된 키만, 길이 제한을 둔 문자열로. 공유·내보내기·URL 에 쓴다. */
export function sanitizeInputs(key: CalcKey, raw: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ALLOWED[key]) {
    const v = raw[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") continue;
    const s = String(v).trim().slice(0, k.endsWith("_name") ? 20 : 40);
    out[k] = k.endsWith("_name") || k === "asOf" || k === "size" ? s : s.replaceAll(",", "");
  }
  return out;
}

function errorPanel(errors: FieldErrors): string {
  const items = Object.values(errors).map((m) => `<li>${esc(m)}</li>`).join("");
  return `<div class="result-inner"><div class="result-error" role="alert"><p><b>입력값을 확인해 주세요.</b></p><ul>${items}</ul></div></div>`;
}

/** 요율 세트 안내(잠정 요율·간이세액표 시행 전·대체 연도)를 결과 맨 위에 붙인다 */
function withRateNotices(out: ComputeOutput, resolved: Resolved): ComputeOutput {
  const ns = rateNotices(resolved);
  if (!ns.length || !out.ok) return out;
  const list = noticeList(ns);
  return { ...out, html: out.html.includes("<!--rate-notices-->") ? out.html.replace("<!--rate-notices-->", list) : out.html.replace('<div class="result-inner">', `<div class="result-inner">${list}`) };
}

export function compute(key: CalcKey, raw: Raw): ComputeOutput {
  const out = computeInner(key, raw);
  return out.resolved ? withRateNotices(out, out.resolved) : out;
}

function computeInner(key: CalcKey, raw: Raw): ComputeOutput & { resolved?: Resolved } {
  switch (key) {
    case "salary": {
      const p = parseSalaryInput(raw);
      if (Object.keys(p.errors).length) return { html: errorPanel(p.errors), errors: p.errors, adjusted: p.adjusted, summary: null, ok: false };
      const resolved = resolveRates(p.value.asOf);
      if (p.value.mode === "reverse") {
        const s = solveAnnualForNet(p.value, resolved);
        return {
          html: adjustedList(p.adjusted) + renderSalary(s.result, { reverse: { annual: s.annual, reachable: s.reachable } }),
          errors: {}, adjusted: p.adjusted, summary: { label: "필요 연봉", value: wonText(s.annual) }, ok: true, resolved,
        };
      }
      const r = calcSalary(p.value, resolved);
      return { html: adjustedList(p.adjusted) + renderSalary(r), errors: {}, adjusted: p.adjusted, summary: { label: "월 실수령", value: wonText(r.netMonthly) }, ok: true, resolved };
    }
    case "payroll": {
      const p = parsePayrollInput(raw);
      if (Object.keys(p.errors).length) return { html: errorPanel(p.errors), errors: p.errors, adjusted: p.adjusted, summary: null, ok: false };
      const resolved = resolveRates(p.value.asOf);
      const r = calcPayroll(p.value, resolved);
      return { html: adjustedList(p.adjusted) + renderPayroll(r), errors: {}, adjusted: p.adjusted, summary: { label: "차인지급액", value: wonText(r.net) }, ok: true, resolved };
    }
    case "insurance": {
      const p = parseInsuranceInput(raw);
      if (Object.keys(p.errors).length) return { html: errorPanel(p.errors), errors: p.errors, adjusted: [], summary: null, ok: false };
      const resolved = resolveRates(p.value.asOf);
      const r = calcInsurance(resolved.set.rates, { taxableMonthly: p.value.monthly, asOf: resolved.asOf, size: p.value.size, ...(p.value.wciRate !== undefined ? { wciRate: p.value.wciRate } : {}) });
      return {
        html: renderInsurance(r, { year: resolved.set.year, asOf: resolved.asOf, taxableMonthly: p.value.monthly }),
        errors: {}, adjusted: [], summary: { label: "근로자 부담", value: wonText(r.workerTotal) }, ok: true, resolved,
      };
    }
    case "freelancer": {
      const p = parseFreelancerInput(raw);
      if (Object.keys(p.errors).length) return { html: errorPanel(p.errors), errors: p.errors, adjusted: p.adjusted, summary: null, ok: false };
      const resolved = resolveRates(p.value.asOf);
      const year = resolved.set.year;
      if (p.value.tab === "w33") {
        const r = calcW33(p.value, resolved.set.rates);
        return { html: renderW33(r, year, resolved.asOf), errors: {}, adjusted: [], summary: { label: r.fromNet ? "필요 세전" : "실수령", value: wonText(r.fromNet ? r.w.gross : r.w.net) }, ok: true, resolved };
      }
      if (p.value.tab === "tax") {
        const r = calcTab(p.value, resolved);
        return { html: adjustedList(p.adjusted) + renderAnnualTax(r, year, resolved.asOf), errors: {}, adjusted: p.adjusted, summary: { label: r.settleTotal < 0 ? "예상 환급" : "추가 납부", value: wonText(Math.abs(r.settleTotal)) }, ok: true, resolved };
      }
      const r = calcNet(p.value, resolved);
      return { html: adjustedList(p.adjusted) + renderNet(r, year, resolved.asOf), errors: {}, adjusted: p.adjusted, summary: { label: "월 실수령", value: wonText(r.netMonthly) }, ok: true, resolved };
    }
    case "yearend": {
      const p = parseYearendInput(raw);
      if (Object.keys(p.errors).length) return { html: errorPanel(p.errors), errors: p.errors, adjusted: p.adjusted, summary: null, ok: false };
      const ctx = yearContext(p.value.year);
      if (p.value.tab === "couple") {
        const c = optimizeCouple(ctx, p.value.a, p.value.b, p.value.deps, p.value.sharedCredit, p.value.sharedDebit);
        const total = c.best.a.settleTotal + c.best.b.settleTotal;
        return { html: renderYearendCouple(p.value, ctx, c, p.adjusted), errors: {}, adjusted: p.adjusted, summary: { label: total < 0 ? "부부 예상 환급" : "부부 추가 납부", value: wonText(Math.abs(total)) }, ok: true, resolved: ctx.resolved };
      }
      const r = calcMine(ctx, p.value.a, p.value.deps);
      return { html: renderYearendMe(p.value, ctx, r, tips(ctx, p.value.a, p.value.deps, r), p.adjusted), errors: {}, adjusted: p.adjusted, summary: { label: r.settleTotal < 0 ? "예상 환급" : "추가 납부", value: wonText(Math.abs(r.settleTotal)) }, ok: true, resolved: ctx.resolved };
    }
  }
}
