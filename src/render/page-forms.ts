// 서버 전용: 계산기별 입력 폼 (브라우저 번들에는 넣지 않는다)
import type { Raw } from "../core/inputs.ts";
import { parseSalaryInput } from "../core/salary.ts";
import { parsePayrollInput } from "../core/payroll.ts";
import { parseInsuranceInput } from "../core/insurance-input.ts";
import { parseFreelancerInput } from "../core/freelancer.ts";
import { parseYearendInput } from "../core/yearend-input.ts";
import type { CalcKey } from "./calculators.ts";
import { resolveRates } from "../core/rates.ts";
import { freelancerForm, insuranceForm, payrollForm, salaryForm, type FormCtx } from "./forms.ts";
import { yearendForm } from "./yearend-form.ts";

const ctxOf = (asOf: string): FormCtx => {
  const r = resolveRates(asOf);
  return { rates: r.set.rates, year: r.set.year };
};

export function renderForm(key: CalcKey, raw: Raw): string {
  switch (key) {
    case "salary": {
      const p = parseSalaryInput(raw);
      return salaryForm(p.value, p.errors, ctxOf(p.value.asOf));
    }
    case "payroll": {
      const p = parsePayrollInput(raw);
      return payrollForm(p.value, p.errors, ctxOf(p.value.asOf));
    }
    case "insurance": {
      const p = parseInsuranceInput(raw);
      return insuranceForm({ monthly: p.value.monthly, asOf: p.value.asOf, size: p.value.size, wci: p.value.wciRate !== undefined ? String(+(p.value.wciRate * 100).toFixed(4)) : "" }, p.errors, ctxOf(p.value.asOf));
    }
    case "freelancer": {
      const p = parseFreelancerInput(raw);
      return freelancerForm(p.value, p.errors, ctxOf(p.value.asOf));
    }
    case "yearend": {
      const p = parseYearendInput(raw);
      return yearendForm(p.value, p.errors);
    }
  }
}
