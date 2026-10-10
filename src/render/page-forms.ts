// 서버 전용: 계산기별 입력 폼 (브라우저 번들에는 넣지 않는다)
import type { Raw } from "../core/inputs.ts";
import { parseSalaryInput } from "../core/salary.ts";
import { parsePayrollInput } from "../core/payroll.ts";
import { parseInsuranceInput } from "../core/insurance-input.ts";
import { parseFreelancerInput } from "../core/freelancer.ts";
import type { CalcKey } from "./calculators.ts";
import { freelancerForm, insuranceForm, payrollForm, salaryForm } from "./forms.ts";

export function renderForm(key: CalcKey, raw: Raw): string {
  switch (key) {
    case "salary": {
      const p = parseSalaryInput(raw);
      return salaryForm(p.value, p.errors);
    }
    case "payroll": {
      const p = parsePayrollInput(raw);
      return payrollForm(p.value, p.errors);
    }
    case "insurance": {
      const p = parseInsuranceInput(raw);
      return insuranceForm({ monthly: p.value.monthly, asOf: p.value.asOf, size: p.value.size, wci: p.value.wciRate !== undefined ? String(+(p.value.wciRate * 100).toFixed(4)) : "" }, p.errors);
    }
    case "freelancer": {
      const p = parseFreelancerInput(raw);
      return freelancerForm(p.value, p.errors);
    }
  }
}
