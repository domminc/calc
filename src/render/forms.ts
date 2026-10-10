// 입력 폼 HTML. 서버가 초기 상태를 그리고, 브라우저가 입력 변화를 감지해 결과만 갱신한다.
import type { SalaryInput } from "../core/salary.ts";
import type { PayrollInput } from "../core/payroll.ts";
import { MAX_ALLOWANCES } from "../core/payroll.ts";
import type { FreelancerInput } from "../core/freelancer.ts";
import type { FieldErrors } from "../core/types.ts";
import type { Rates } from "../core/rates.ts";
import { pct } from "../core/money.ts";
import { w33Labels, w33RatesOf } from "../core/freelancer.ts";
import { comma, esc, hangulWon } from "./html.ts";

/** 폼 문구에 쓰는 요율 (기준일의 요율 세트) — 문구에 숫자를 직접 쓰지 않고 여기서 읽는다 */
export interface FormCtx {
  rates: Rates;
  year: number;
}

type Errors = FieldErrors;

function err(errors: Errors, name: string): string {
  return errors[name] ? `<p class="field-error" id="e-${name}" role="alert">${esc(errors[name])}</p>` : `<p class="field-error" id="e-${name}" role="alert" hidden></p>`;
}

export function money(o: { name: string; label: string; value: number | string; errors: Errors; hint?: string; suffix?: string; chips?: { label: string; value: number }[]; hangul?: boolean; optional?: boolean; slider?: { min: number; max: number; step: number } }): string {
  const v = typeof o.value === "number" ? comma(o.value) : o.value;
  const num = typeof o.value === "number" ? o.value : Number(String(o.value).replaceAll(",", ""));
  const sl = o.slider
    ? `<input type="range" class="range" data-range-for="${esc(o.name)}" min="${o.slider.min}" max="${o.slider.max}" step="${o.slider.step}" value="${Number.isFinite(num) ? Math.min(Math.max(num, o.slider.min), o.slider.max) : o.slider.min}" aria-label="${esc(o.label)} 조절 막대">`
    : "";
  const chips = o.chips
    ? `<div class="chips" role="group" aria-label="${esc(o.label)} 빠른 입력">${o.chips.map((c) => `<button type="button" class="chip" data-fill="${esc(o.name)}" data-value="${c.value}">${esc(c.label)}</button>`).join("")}</div>`
    : "";
  return `<div class="field${o.errors[o.name] ? " has-error" : ""}">
<label for="f-${o.name}">${esc(o.label)}${o.optional ? ' <span class="opt">(선택)</span>' : ""}</label>
<div class="input-wrap"><input id="f-${o.name}" name="${o.name}" class="money" type="text" inputmode="numeric" autocomplete="off" value="${esc(v)}" aria-describedby="e-${o.name}${o.hint ? ` h-${o.name}` : ""}"${o.errors[o.name] ? ' aria-invalid="true"' : ""}><span class="suffix">${esc(o.suffix ?? "원")}</span></div>
${o.hangul !== false && Number.isFinite(num) && num > 0 ? `<p class="hangul" data-hangul="${esc(o.name)}">${esc(hangulWon(num))}</p>` : `<p class="hangul" data-hangul="${esc(o.name)}"></p>`}
${sl}${chips}${o.hint ? `<p class="hint" id="h-${o.name}">${esc(o.hint)}</p>` : ""}${err(o.errors, o.name)}</div>`;
}

export function decimal(o: { name: string; label: string; value: number | string; errors: Errors; suffix: string; hint?: string }): string {
  return `<div class="field${o.errors[o.name] ? " has-error" : ""}">
<label for="f-${o.name}">${esc(o.label)}</label>
<div class="input-wrap"><input id="f-${o.name}" name="${o.name}" type="text" inputmode="decimal" autocomplete="off" value="${esc(o.value)}" aria-describedby="e-${o.name}${o.hint ? ` h-${o.name}` : ""}"${o.errors[o.name] ? ' aria-invalid="true"' : ""}><span class="suffix">${esc(o.suffix)}</span></div>
${o.hint ? `<p class="hint" id="h-${o.name}">${esc(o.hint)}</p>` : ""}${err(o.errors, o.name)}</div>`;
}

export function stepper(o: { name: string; label: string; value: number; min: number; max: number; unit: string; hint?: string; errors: Errors }): string {
  return `<div class="field${o.errors[o.name] ? " has-error" : ""}">
<label for="f-${o.name}">${esc(o.label)}</label>
<div class="stepper" data-stepper>
<button type="button" class="step" data-step="-1" aria-label="${esc(o.label)} 줄이기"${o.value <= o.min ? " disabled" : ""}>−</button>
<input id="f-${o.name}" name="${o.name}" type="text" inputmode="numeric" value="${o.value}" data-min="${o.min}" data-max="${o.max}" aria-describedby="e-${o.name}${o.hint ? ` h-${o.name}` : ""}"${o.errors[o.name] ? ' aria-invalid="true"' : ""}>
<button type="button" class="step" data-step="1" aria-label="${esc(o.label)} 늘리기"${o.value >= o.max ? " disabled" : ""}>+</button>
<span class="unit">${esc(o.unit)}</span></div>
${o.hint ? `<p class="hint" id="h-${o.name}">${esc(o.hint)}</p>` : ""}${err(o.errors, o.name)}</div>`;
}

export function segmented(o: { name: string; label: string; value: string; options: { value: string; label: string }[] }): string {
  return `<fieldset class="field seg-field"><legend>${esc(o.label)}</legend><div class="segmented" role="radiogroup" data-n="${o.options.length}">${o.options
    .map((p, i) => `<label class="seg-opt"><input type="radio" name="${o.name}" value="${esc(p.value)}"${p.value === o.value ? " checked" : ""}${i === 0 ? "" : ""}><span>${esc(p.label)}</span></label>`)
    .join("")}</div></fieldset>`;
}

export function check(o: { name: string; label: string; checked: boolean; hint?: string }): string {
  return `<div class="field check-field"><label class="check"><input type="hidden" name="${o.name}" value="0"><input type="checkbox" name="${o.name}" value="1"${o.checked ? " checked" : ""}><span>${esc(o.label)}</span></label>${o.hint ? `<p class="hint">${esc(o.hint)}</p>` : ""}</div>`;
}

export function select(o: { name: string; label: string; value: string; options: { value: string; label: string }[]; hint?: string }): string {
  return `<div class="field"><label for="f-${o.name}">${esc(o.label)}</label><select id="f-${o.name}" name="${o.name}">${o.options.map((p) => `<option value="${esc(p.value)}"${p.value === o.value ? " selected" : ""}>${esc(p.label)}</option>`).join("")}</select>${o.hint ? `<p class="hint">${esc(o.hint)}</p>` : ""}</div>`;
}

export function dateInput(o: { name: string; label: string; value: string; errors: Errors; hint?: string; min?: string; max?: string }): string {
  return `<div class="field${o.errors[o.name] ? " has-error" : ""}"><label for="f-${o.name}">${esc(o.label)}</label><input id="f-${o.name}" name="${o.name}" type="date" value="${esc(o.value)}"${o.min ? ` min="${o.min}"` : ""}${o.max ? ` max="${o.max}"` : ""} aria-describedby="e-${o.name}${o.hint ? ` h-${o.name}` : ""}">${o.hint ? `<p class="hint" id="h-${o.name}">${esc(o.hint)}</p>` : ""}${err(o.errors, o.name)}</div>`;
}

export function sizeSelect(value: string, rates: Rates): string {
  const options = rates.ei.stabilization.map((s) => ({ value: s.key, label: `${s.label} (${pct(s.rate)})` }));
  return select({ name: "size", label: "사업장 규모 (고용안정·직능개발 요율)", value, options, hint: "근로자 부담에는 영향이 없고 사업주 부담에만 반영돼요." });
}

const FAMILY_HINT = "본인·배우자 포함 (소득세 공제 기준)";

// ---------------- 연봉 ----------------

export function salaryForm(i: SalaryInput, errors: Errors, ctx: FormCtx): string {
  const rev = i.mode === "reverse";
  return `<div class="grp">${segmented({ name: "mode", label: "계산 방향", value: i.mode, options: [{ value: "forward", label: "연봉 → 월 실수령" }, { value: "reverse", label: "월 실수령 → 필요 연봉" }] })}</div>
<div data-when="mode=forward"${rev ? " hidden" : ""}>${money({ name: "annual", label: "연봉 (세전)", value: i.annual, errors, slider: { min: 10_000_000, max: 200_000_000, step: 1_000_000 }, chips: [{ label: "3,000만", value: 30_000_000 }, { label: "4,000만", value: 40_000_000 }, { label: "5,000만", value: 50_000_000 }, { label: "6,000만", value: 60_000_000 }, { label: "8,000만", value: 80_000_000 }, { label: "1억", value: 100_000_000 }] })}</div>
<div data-when="mode=reverse"${rev ? "" : " hidden"}>${money({ name: "targetNet", label: "희망 월 실수령액", value: i.targetNet, errors, slider: { min: 1_000_000, max: 10_000_000, step: 100_000 }, hint: "이 금액 이상을 받으려면 필요한 최소 연봉(1만원 단위)을 찾아요.", chips: [{ label: "200만", value: 2_000_000 }, { label: "300만", value: 3_000_000 }, { label: "400만", value: 4_000_000 }, { label: "500만", value: 5_000_000 }] })}</div>
${segmented({ name: "severance", label: "퇴직금", value: i.severanceIncluded ? "1" : "0", options: [{ value: "0", label: "별도 (연봉÷12)" }, { value: "1", label: "연봉에 포함 (연봉÷13)" }] })}
${money({ name: "nonTaxable", label: "월 비과세액", value: i.nonTaxableMonthly, errors, hint: "식대 월 20만원 등. 비과세는 소득세·4대보험 계산에서 빠져요." })}
<div class="two">${stepper({ name: "family", label: "부양가족 수", value: i.family, min: 1, max: 20, unit: "명", hint: FAMILY_HINT, errors })}${stepper({ name: "children", label: "8~20세 자녀 수", value: i.children, min: 0, max: 10, unit: "명", hint: "부양가족에 포함된 자녀", errors })}</div>
<details class="more"><summary>고급 설정 (기준일·사업주 부담)</summary>
${dateInput({ name: "asOf", label: "기준일", value: i.asOf, errors, hint: "국민연금 상·하한은 7월 1일에 바뀌어요." })}
${sizeSelect(i.size, ctx.rates)}
${decimal({ name: "wciRate", label: "산재보험료율 (사업주)", value: i.wciRate !== undefined ? String(+(i.wciRate * 100).toFixed(4)) : "", suffix: "%", hint: `비워 두면 전 업종 평균 ${pct(ctx.rates.wci.defaultRate)}`, errors })}
</details>`;
}

// ---------------- 급여 ----------------

export function payrollForm(i: PayrollInput, errors: Errors, ctx: FormCtx): string {
  const rt = ctx.rates;
  const w3 = w33Labels(w33RatesOf(rt));
  const monthly = i.kind === "monthly";
  const rows = (i.allowances.length ? i.allowances : []).map((a, n) => allowanceRow(n, a.name, a.amount, a.nonTaxable, a.ordinary, errors)).join("");
  return `${segmented({ name: "kind", label: "급여 방식", value: i.kind, options: [{ value: "monthly", label: "월급제" }, { value: "hourly", label: "시급제 (아르바이트·계약직)" }] })}
<div data-when="kind=monthly"${monthly ? "" : " hidden"}>
${money({ name: "basePay", label: "기본급 (월)", value: i.basePay, errors, slider: { min: 0, max: 10_000_000, step: 100_000 } })}
<div class="allow" data-allow data-max="${MAX_ALLOWANCES}"><div class="allow-head"><b>수당</b><span class="hint">통상임금 포함 여부를 체크하면 연장·야간·휴일수당의 통상시급에 반영돼요.</span></div><div data-allow-rows>${rows}</div>
<div class="allow-actions"><button type="button" class="btn btn-ghost" data-add-allow>+ 수당 추가</button><button type="button" class="btn btn-ghost" data-add-meal>식대 20만원(비과세) 추가</button></div></div>
<div class="two">${hours("overtime", "연장근로", i.overtimeHours, errors)}${hours("night", "야간근로 (22~06시)", i.nightHours, errors)}</div>
<div class="two">${hours("holiday", "휴일근로 (8시간 이내)", i.holidayHours, errors)}${hours("holiday8", "휴일근로 (8시간 초과)", i.holidayOver8Hours, errors)}</div>
${money({ name: "bonus", label: "이번 달 상여 (과세)", value: i.bonus, errors })}
</div>
<div data-when="kind=hourly"${monthly ? " hidden" : ""}>
${money({ name: "wage", label: "시급", value: i.hourlyWage, errors, hint: `${ctx.year}년 최저시급 ${comma(rt.labor.minHourlyWage)}원`, chips: [{ label: "최저시급", value: rt.labor.minHourlyWage }, { label: "11,000", value: 11_000 }, { label: "12,000", value: 12_000 }, { label: "15,000", value: 15_000 }] })}
${decimal({ name: "weekly", label: "주 소정근로시간", value: String(i.weeklyHours), suffix: "시간", hint: "주 15시간 이상이면 주휴수당이 있어요. 주 40시간 = 월 ${rt.labor.monthlyPaidHours}시간.", errors })}
</div>
${segmented({ name: "deduction", label: "공제 방식", value: i.deductionMode, options: [{ value: "insurance", label: "4대보험+세금" }, { value: "tax33", label: `${w3.total} 원천징수` }, { value: "none", label: "공제 없음" }] })}
<div class="two">${stepper({ name: "family", label: "부양가족 수", value: i.family, min: 1, max: 20, unit: "명", hint: FAMILY_HINT, errors })}${stepper({ name: "children", label: "8~20세 자녀 수", value: i.children, min: 0, max: 10, unit: "명", errors })}</div>
<details class="more"><summary>고급 설정 (기준일·사업장 규모)</summary>${dateInput({ name: "asOf", label: "기준일", value: i.asOf, errors })}${sizeSelect(i.size, ctx.rates)}</details>`;
}

function hours(name: string, label: string, value: number, errors: Errors): string {
  return decimal({ name, label, value: String(value), suffix: "시간", errors });
}

export function allowanceRow(n: number, name: string, amount: number | string, nonTaxable: boolean, ordinary: boolean, errors: Errors): string {
  return `<div class="allow-row" data-allow-row><div class="allow-name"><label class="sr" for="f-al${n}_name">수당 이름</label><input id="f-al${n}_name" name="al${n}_name" type="text" maxlength="20" placeholder="수당 이름" value="${esc(name)}"></div>
<div class="allow-amt${errors[`al${n}_amount`] ? " has-error" : ""}"><label class="sr" for="f-al${n}_amount">수당 금액</label><div class="input-wrap"><input id="f-al${n}_amount" name="al${n}_amount" class="money" type="text" inputmode="numeric" autocomplete="off" value="${esc(typeof amount === "number" ? comma(amount) : amount)}"><span class="suffix">원</span></div>${err(errors, `al${n}_amount`)}</div>
<label class="check small"><input type="hidden" name="al${n}_nt" value="0"><input type="checkbox" name="al${n}_nt" value="1"${nonTaxable ? " checked" : ""}><span>비과세</span></label>
<label class="check small"><input type="hidden" name="al${n}_ord" value="0"><input type="checkbox" name="al${n}_ord" value="1"${ordinary ? " checked" : ""}><span>통상임금</span></label>
<button type="button" class="btn btn-ghost icon-btn" data-remove-allow aria-label="수당 삭제">삭제</button></div>`;
}

// ---------------- 4대보험 ----------------

export function insuranceForm(v: { monthly: number; asOf: string; size: string; wci: string }, errors: Errors, ctx: FormCtx): string {
  return `${money({ name: "monthly", label: "월 보수 (비과세 제외)", value: v.monthly, errors, slider: { min: 0, max: 10_000_000, step: 100_000 }, hint: "세전 월급에서 식대 등 비과세를 뺀 금액이에요.", chips: [{ label: "200만", value: 2_000_000 }, { label: "300만", value: 3_000_000 }, { label: "400만", value: 4_000_000 }, { label: "500만", value: 5_000_000 }, { label: "700만", value: 7_000_000 }] })}
${dateInput({ name: "asOf", label: "기준일", value: v.asOf, errors, hint: "국민연금 기준소득월액 상·하한이 7월 1일에 바뀌어요." })}
${sizeSelect(v.size, ctx.rates)}
${decimal({ name: "wciRate", label: "산재보험료율 (사업주)", value: v.wci, suffix: "%", hint: `업종별로 달라요(근로복지공단 고시). 비워 두면 전 업종 평균 ${pct(ctx.rates.wci.defaultRate)}.`, errors })}`;
}

// ---------------- 프리랜서 ----------------

export function freelancerForm(i: FreelancerInput, errors: Errors, ctx: FormCtx): string {
  const t = i.tab;
  const rt = ctx.rates;
  const w3 = w33Labels(w33RatesOf(rt));
  return `${segmented({ name: "tab", label: "무엇을 계산할까요?", value: t, options: [{ value: "w33", label: `${w3.total} 원천징수` }, { value: "tax", label: "5월 종합소득세" }, { value: "net", label: "월 실수령 종합" }] })}
<div data-when="tab=w33"${t === "w33" ? "" : " hidden"}>
${segmented({ name: "amountMode", label: "입력할 금액", value: i.amountMode, options: [{ value: "gross", label: "세전 금액 → 실수령" }, { value: "net", label: "받고 싶은 실수령 → 세전" }] })}
${money({ name: "amount", label: i.amountMode === "net" ? "받고 싶은 실수령 금액" : "세전 금액 (계약 금액)", value: i.amount, errors, slider: { min: 0, max: 20_000_000, step: 100_000 }, chips: [{ label: "100만", value: 1_000_000 }, { label: "300만", value: 3_000_000 }, { label: "500만", value: 5_000_000 }, { label: "1,000만", value: 10_000_000 }] })}
${stepper({ name: "months", label: "연 환산 개월 수", value: i.months, min: 1, max: 12, unit: "개월", errors })}
</div>
<div data-when="tab=tax|net"${t === "w33" ? " hidden" : ""}>
${money({ name: "revenue", label: `연 수입금액 (${w3.total} 떼기 전)`, value: i.revenue, errors, slider: { min: 0, max: 200_000_000, step: 1_000_000 }, chips: [{ label: "2,400만", value: 24_000_000 }, { label: "3,600만", value: 36_000_000 }, { label: "5,000만", value: 50_000_000 }, { label: "7,000만", value: 70_000_000 }, { label: "1억", value: 100_000_000 }] })}
${segmented({ name: "expenseMode", label: "필요경비 방식", value: i.expenseMode, options: [{ value: "rate", label: "단순경비율" }, { value: "actual", label: "실제 경비" }] })}
<div data-when="expenseMode=rate"${i.expenseMode === "rate" ? "" : " hidden"}>${decimal({ name: "expenseRate", label: "단순경비율", value: String(+(i.expenseRate * 100).toFixed(2)), suffix: "%", hint: `업종코드별로 달라요. 기본값 ${pct(rt.freelancer.defaultSimpleExpenseRate)}는 예시예요(${rt.freelancer.defaultSimpleExpenseNote.split(".")[0]}). 홈택스 경비율 조회 값으로 바꿔 주세요.`, errors })}</div>
<div data-when="expenseMode=actual"${i.expenseMode === "actual" ? "" : " hidden"}>${money({ name: "actualExpense", label: "실제 경비 (증빙 가능한 금액)", value: i.actualExpense, errors })}</div>
<div class="two">${stepper({ name: "persons", label: "부양가족 수", value: i.persons, min: 1, max: 20, unit: "명", hint: "본인 포함 (1인당 기본공제 150만원)", errors })}${stepper({ name: "children", label: "8세 이상 자녀 수", value: i.children, min: 0, max: 10, unit: "명", errors })}</div>
<div data-when="tab=tax"${t === "tax" ? "" : " hidden"}>${money({ name: "pension", label: "납부한 국민연금 (연)", value: i.pensionPaid, errors, optional: true, hint: "연금보험료공제로 소득에서 전액 빠져요." })}</div>
<div data-when="tab=net"${t === "net" ? "" : " hidden"}>
${money({ name: "cashExpense", label: "실제로 쓴 사업 경비 (연)", value: i.cashExpense, errors, optional: true, hint: "단순경비율은 세법상 경비일 뿐이라, 실제 지출만 따로 적어요." })}
${decimal({ name: "propertyScore", label: "재산 보험료 부과점수", value: String(i.propertyScore), suffix: "점", hint: "모르면 0. 공단 모의계산에서 확인할 수 있어요. 1점 = ${rt.nhis.regionalScoreUnitPrice}원.", errors })}
${check({ name: "regionalNps", label: "지역가입자 국민연금 포함", checked: i.useRegionalNps, hint: "납부예외이거나 가입 대상이 아니면 해제하세요." })}
</div>
<details class="more"><summary>고급 설정 (기납부세액·기타 공제·기준일)</summary>
${money({ name: "otherDeduction", label: "기타 소득공제", value: i.otherDeduction, errors, optional: true })}
${money({ name: "prepaid", label: "기납부 소득세 직접 입력", value: i.prepaidOverride ?? "", errors, optional: true, hint: "비워 두면 연 수입 × 3%" })}
${dateInput({ name: "asOf", label: "기준일", value: i.asOf, errors })}
</details>
</div>`;
}
