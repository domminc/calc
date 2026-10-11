// 내려받기(엑셀·PDF)용 보고서 모델. 화면과 같은 계산 결과에서 만든다.
import type { CalcKey } from "../render/calculators.ts";
import type { Raw } from "../core/inputs.ts";
import { resolveRates } from "../core/rates.ts";
import { calcSalary, parseSalaryInput, solveAnnualForNet } from "../core/salary.ts";
import { calcPayroll, parsePayrollInput } from "../core/payroll.ts";
import { calcInsurance } from "../core/insurance.ts";
import { parseInsuranceInput } from "../core/insurance-input.ts";
import { calcNet, calcTab, calcW33, parseFreelancerInput, w33Labels } from "../core/freelancer.ts";
import { CALCS } from "./meta.ts";
import { disclaimer } from "../render/result.ts";

export type Cell = string | number;

export interface Section {
  heading: string;
  columns: string[];
  /** 마지막 열을 금액으로 보고 오른쪽 정렬·콤마 표시 */
  rows: Cell[][];
  total?: Cell[];
}

export interface Report {
  key: CalcKey;
  title: string;
  subtitle: string;
  hero: { label: string; value: number; unit: string };
  inputs: [string, string][];
  sections: Section[];
  notes: string[];
  fileName: string;
}

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

export function buildReport(key: CalcKey, raw: Raw): Report | null {
  const title = CALCS[key].name;
  switch (key) {
    case "salary": {
      const p = parseSalaryInput(raw);
      if (Object.keys(p.errors).length) return null;
      const resolved = resolveRates(p.value.asOf);
      const rev = p.value.mode === "reverse" ? solveAnnualForNet(p.value, resolved) : null;
      const r = rev ? rev.result : calcSalary(p.value, resolved);
      const i = r.input;
      return {
        key,
        title: `${title} 결과`,
        subtitle: `${r.ratesYear}년 기준 · 기준일 ${r.asOf}`,
        hero: rev ? { label: "필요 연봉(세전)", value: rev.annual, unit: "원" } : { label: "월 실수령액", value: r.netMonthly, unit: "원" },
        inputs: [
          ...(rev ? ([["희망 월 실수령액", won(i.targetNet)]] as [string, string][]) : []),
          ["연봉(세전)", won(rev ? rev.annual : i.annual)],
          ["퇴직금", i.severanceIncluded ? "연봉에 포함(÷13)" : "별도(÷12)"],
          ["월 비과세", won(r.nonTaxable)],
          ["부양가족", `${i.family}명 (8~20세 자녀 ${i.children}명)`],
        ],
        sections: [
          { heading: "월 급여", columns: ["항목", "금액"], rows: [["월 총지급액", r.monthlyGross], ["비과세", r.nonTaxable], ["월 과세급여", r.taxableMonthly]] },
          { heading: "공제 내역 (근로자)", columns: ["항목", "계산 근거", "금액"], rows: r.lines.map((l) => [l.label, l.basis, l.amount]), total: ["공제 합계", "", r.totalDeduction] },
          { heading: "결과", columns: ["항목", "금액"], rows: [["월 실수령액", r.netMonthly], ["연 환산 실수령액", r.netAnnual]] },
          { heading: "사업주 부담 4대보험", columns: ["보험", "계산 근거", "월 부담"], rows: r.insurance.rows.map((x) => [x.label, x.employerBasis, x.employer]), total: ["사업주 부담 합계", "", r.employerInsurance] },
        ],
        notes: [...r.notices.map((n) => n.text), disclaimer],
        fileName: `연봉계산_${rev ? rev.annual : i.annual}`,
      };
    }
    case "payroll": {
      const p = parsePayrollInput(raw);
      if (Object.keys(p.errors).length) return null;
      const r = calcPayroll(p.value, resolveRates(p.value.asOf));
      return {
        key,
        title: "급여 명세서(모의)",
        subtitle: `${r.ratesYear}년 기준 · 기준일 ${r.asOf} · ${r.input.kind === "monthly" ? "월급제" : "시급제"}`,
        hero: { label: "차인지급액", value: r.net, unit: "원" },
        inputs: [["통상시급", won(r.ordinaryHourly)], ["월 소정+주휴 시간", `${r.monthlyHours}시간`], ["부양가족", `${r.input.family}명 (자녀 ${r.input.children}명)`]],
        sections: [
          { heading: "지급 내역", columns: ["항목", "산출", "금액"], rows: r.earnings.map((l) => [l.label, l.basis, l.amount]), total: ["지급 합계", "", r.gross] },
          { heading: "공제 내역", columns: ["항목", "계산 근거", "금액"], rows: r.deductions.map((l) => [l.label, l.basis, l.amount]), total: ["공제 합계", "", r.totalDeduction] },
        ],
        notes: [...r.notices.map((n) => n.text), disclaimer],
        fileName: `급여명세서_${r.net}`,
      };
    }
    case "insurance": {
      const p = parseInsuranceInput(raw);
      if (Object.keys(p.errors).length) return null;
      const resolved = resolveRates(p.value.asOf);
      const r = calcInsurance(resolved.set.rates, { taxableMonthly: p.value.monthly, asOf: resolved.asOf, size: p.value.size, ...(p.value.wciRate !== undefined ? { wciRate: p.value.wciRate } : {}) });
      return {
        key,
        title: "4대보험 계산 결과",
        subtitle: `${resolved.set.year}년 기준 · 기준일 ${resolved.asOf}`,
        hero: { label: "근로자 부담 합계(월)", value: r.workerTotal, unit: "원" },
        inputs: [["월 보수(비과세 제외)", won(p.value.monthly)], ["국민연금 기준소득월액", won(r.npsBase)]],
        sections: [
          { heading: "보험별 부담", columns: ["보험", "총액", "근로자", "사업주"], rows: r.rows.map((x) => [x.label, x.total, x.worker, x.employer]), total: ["합계", r.total, r.workerTotal, r.employerTotal] },
        ],
        notes: [...r.notices.map((n) => n.text), disclaimer],
        fileName: `4대보험_${p.value.monthly}`,
      };
    }
    case "freelancer": {
      const p = parseFreelancerInput(raw);
      if (Object.keys(p.errors).length) return null;
      const resolved = resolveRates(p.value.asOf);
      const head = `${resolved.set.year}년 기준 · 기준일 ${resolved.asOf}`;
      if (p.value.tab === "w33") {
        const r = calcW33(p.value, resolved.set.rates);
        return {
          key, title: `프리랜서 ${w33Labels(r.rates).total} 계산 결과`, subtitle: head,
          hero: { label: r.fromNet ? "필요한 세전 금액" : "실수령액", value: r.fromNet ? r.w.gross : r.w.net, unit: "원" },
          inputs: [["입력", `${r.fromNet ? "실수령" : "세전"} ${won(p.value.amount)}`]],
          sections: [{ heading: "원천징수", columns: ["항목", "금액"], rows: [["세전 금액", r.w.gross], [`소득세 ${w33Labels(r.rates).income}`, r.w.tax], [`지방소득세 ${w33Labels(r.rates).local}`, r.w.local], ...(r.rates.ei > 0 ? [[`고용보험 ${w33Labels(r.rates).ei}`, r.w.ei] as [string, number]] : []), ["실수령액", r.w.net]] }],
          notes: [...r.notices.map((n) => n.text), disclaimer], fileName: `프리랜서3.3_${r.w.gross}`,
        };
      }
      if (p.value.tab === "tax") {
        const r = calcTab(p.value, resolved);
        return {
          key, title: "5월 종합소득세 정산 예상", subtitle: head,
          hero: { label: r.settleTotal < 0 ? "예상 환급액" : "예상 추가 납부액", value: Math.abs(r.settleTotal), unit: "원" },
          inputs: [["연 수입금액", won(r.revenue)], ["필요경비", won(r.expense)], ["부양가족", `${p.value.persons}명 (자녀 ${p.value.children}명)`]],
          sections: [{ heading: "정산 단계", columns: ["단계", "금액"], rows: [["소득금액", r.income], ["소득공제", r.deductions.total], ["과세표준", r.taxBase], ["산출세액", r.computedTax], ["세액공제", r.credits.total], ["결정세액", r.determinedTax], ["지방소득세", r.localTax], [`이미 낸 ${w33Labels(r.w33).total}`, r.prepaidTax + r.prepaidLocal], ["정산(+추가납부/−환급)", r.settleTotal]] }],
          notes: [...r.notices.map((n) => n.text), disclaimer], fileName: `종합소득세_${r.revenue}`,
        };
      }
      const r = calcNet(p.value, resolved);
      return {
        key, title: "프리랜서 월 실수령 추정", subtitle: head,
        hero: { label: "월 실수령 추정", value: r.netMonthly, unit: "원" },
        inputs: [["연 수입금액", won(p.value.revenue)], ["재산 부과점수", `${p.value.propertyScore}점`]],
        sections: [{ heading: "연 부담 내역", columns: ["항목", "금액"], rows: [["종합소득세+지방소득세", r.tax.totalTax], ["건강보험(12개월)", r.regional.nhis * 12], ["장기요양(12개월)", r.regional.ltc * 12], ["국민연금(12개월)", p.value.useRegionalNps ? r.regional.nps * 12 : 0], ["실제 지출 경비", p.value.cashExpense], ["연 부담 합계", r.annualBurden]] }],
        notes: [...r.notices.map((n) => n.text), disclaimer], fileName: `프리랜서실수령_${r.netMonthly}`,
      };
    }
  }
}
