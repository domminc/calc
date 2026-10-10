import type { CalcKey } from "../render/calculators.ts";
import type { Resolved } from "../core/rates.ts";
import { npsLimitsAt } from "../core/rates.ts";
import { w33Labels, w33RatesOf } from "../core/freelancer.ts";
import { pct } from "../core/money.ts";
import { comma } from "../render/html.ts";

export interface Faq {
  q: string;
  a: string;
}

export interface CalcMeta {
  key: CalcKey;
  path: string;
  name: string;
  short: string;
  h1: string;
  intro: string;
}

export interface CalcSeo {
  title: string;
  description: string;
  faq: Faq[];
}

export const SITE_NAME = "homesell 계산기";

export const CALCS: Record<CalcKey, CalcMeta> = {
  salary: { key: "salary", path: "/salary", name: "연봉 계산기", short: "연봉", h1: "연봉 실수령액 계산기", intro: "연봉을 넣으면 4대보험과 소득세를 뺀 월 실수령액이 바로 나와요. 소득세는 국세청 근로소득 간이세액표 원문을 그대로 조회해 월급명세서와 같은 값이에요." },
  payroll: { key: "payroll", path: "/payroll", name: "급여 계산기", short: "급여", h1: "급여 계산기 (월급·시급)", intro: "월급제는 수당과 연장·야간·휴일근로까지, 시급제는 주휴수당까지 반영해 지급 내역과 공제 내역, 차인지급액을 보여줘요." },
  insurance: { key: "insurance", path: "/insurance", name: "4대보험 계산기", short: "4대보험", h1: "4대보험 계산기 (근로자·사업주)", intro: "월 보수를 넣으면 보험별 근로자 부담, 사업주 부담, 총액을 한눈에 보여줘요. 기준일에 따라 국민연금 상·하한과 요율이 자동으로 바뀌어요." },
  freelancer: { key: "freelancer", path: "/freelancer", name: "프리랜서 계산기", short: "프리랜서", h1: "프리랜서 계산기 (원천징수·종합소득세·건보료)", intro: "원천징수를 뗀 실수령(또는 필요한 세전 금액), 다음 해 5월 종합소득세 정산, 지역가입자 건강보험료까지 이어서 계산해요." },
};

/** 요율 세트에서 읽은 제목·설명·FAQ — 법이 바뀌어 데이터가 바뀌면 문구도 함께 바뀐다 */
export function seoFor(key: CalcKey, rs: Resolved): CalcSeo {
  const { set } = rs;
  const y = set.year;
  const r = set.rates;
  const w3 = w33Labels(w33RatesOf(r));
  const nps = r.nps.rate;
  const lim = npsLimitsAt(r, rs.asOf);
  const limits = [...r.nps.limits].sort((a, b) => a.from.localeCompare(b.from));
  const prevLim = limits.length > 1 ? limits[limits.indexOf(limits.find((l) => l.from === lim.from)!) - 1] : undefined;
  const monthlyMin = r.labor.minHourlyWage * r.labor.monthlyPaidHours;
  const ltcRatio = ((r.nhis.ltc.rate / r.nhis.rate) * 100).toFixed(2);
  const prov = set.status === "provisional" ? " (일부 잠정)" : "";
  switch (key) {
    case "salary":
      return {
        title: `연봉 실수령액 계산기 ${y} — 월급·4대보험·소득세 | homesell 계산기`,
        description: `연봉에서 4대보험과 소득세를 뺀 월 실수령액을 계산해요. 국세청 간이세액표 원문과 ${y}년 공단 요율${prov}을 그대로 적용하고, 희망 실수령액으로 필요 연봉도 거꾸로 구할 수 있어요.`,
        faq: [
          { q: "소득세는 어떻게 계산하나요?", a: `추정식이 아니라 국세청 근로소득 간이세액표(소득세법 시행령 별표2, ${set.withholding.revision})에서 월 과세급여 구간과 공제대상가족 수에 해당하는 금액을 그대로 가져와요. 지방소득세는 소득세의 ${pct(r.incomeTax.localTaxRatio)}예요.` },
          { q: "퇴직금 포함 연봉이면 월급이 얼마인가요?", a: "퇴직금이 연봉에 포함된 계약은 연봉을 13으로 나눈 금액이 월 지급액이고, 나머지 1/13이 퇴직금이에요. '퇴직금 연봉에 포함'을 고르면 ÷13으로 계산해요." },
          { q: "비과세액은 얼마를 넣어야 하나요?", a: `대부분의 회사는 식대 월 ${comma(r.taxFree.mealMonthly)}원을 비과세로 처리해요. 월급명세서의 비과세 항목 합계를 넣으면 가장 정확해요. 비과세 금액은 4대보험과 소득세 계산에서 빠져요.` },
          { q: "법이 바뀌면 계산도 바뀌나요?", a: "네. 요율과 간이세액표는 시행일 기준으로 관리돼서, 법령이 바뀌어 시행일이 오면 기준일에 맞는 값으로 자동 계산돼요. 확정 전인 항목은 앞 연도 값을 잠정 적용하고 결과 위에 안내해요." },
          { q: "연말정산 결과와 같은가요?", a: "아니에요. 이 계산기는 매달 급여에서 떼는 금액(원천징수)이에요. 연말정산에서 공제를 더 받으면 환급되고, 덜 받으면 추가 납부해요." },
        ],
      };
    case "payroll":
      return {
        title: `급여 계산기 ${y} — 월급명세서·시급·주휴수당·최저임금 | homesell 계산기`,
        description: "기본급과 수당, 연장·야간·휴일근로, 상여를 넣어 월급명세서를 만들어요. 시급제는 주휴수당과 최저임금 충족 여부까지 계산하고 엑셀·PDF로 내려받을 수 있어요.",
        faq: [
          { q: "통상시급은 어떻게 구하나요?", a: `(기본급 + 통상임금에 포함되는 수당) ÷ ${r.labor.monthlyPaidHours}시간이에요. ${r.labor.monthlyPaidHours}시간은 주 40시간 근무자의 월 소정근로 174시간에 주휴 35시간을 더한 값이에요.` },
          { q: "연장·야간·휴일근로 수당은 몇 배인가요?", a: `연장근로는 통상시급의 ${1 + r.labor.overtimePremium}배, 야간근로(밤 10시~오전 6시)는 가산분 ${r.labor.nightPremium}배, 휴일근로는 8시간 이내 ${1 + r.labor.holidayPremium}배, 8시간 초과 ${1 + r.labor.holidayOver8Premium}배예요. 5인 미만 사업장은 가산 규정이 적용되지 않을 수 있어요.` },
          { q: "주휴수당은 누가 받나요?", a: "1주 소정근로시간이 15시간 이상이고 그 주를 개근한 근로자가 받아요. 주 40시간이면 하루 8시간치(시급 × 8)가 주휴수당이에요." },
          { q: `${y}년 최저시급은 얼마인가요?`, a: `${y}년 최저시급은 ${comma(r.labor.minHourlyWage)}원(월 ${r.labor.monthlyPaidHours}시간 기준 ${comma(monthlyMin)}원)이에요.${r.labor.nextYear.minHourlyWage > 0 ? ` ${r.labor.nextYear.year}년은 ${comma(r.labor.nextYear.minHourlyWage)}원으로 ${r.labor.nextYear.effectiveFrom}부터 적용돼요.` : ""}` },
        ],
      };
    case "insurance":
      return {
        title: `4대보험 계산기 ${y} — 국민연금·건강보험·고용보험 요율 | homesell 계산기`,
        description: `월 보수로 국민연금·건강보험·장기요양·고용보험·산재보험의 근로자와 사업주 부담액을 계산해요. 국민연금 상·하한과 요율도 기준일에 맞춰 반영해요.`,
        faq: [
          { q: `${y}년 4대보험 요율은 얼마인가요?`, a: `국민연금 ${pct(nps)}(근로자 ${pct(nps * r.nps.workerShare)}), 건강보험 ${pct(r.nhis.rate)}(근로자 ${pct(r.nhis.rate * r.nhis.workerShare)}), 장기요양은 건강보험료의 ${ltcRatio}%, 고용보험 실업급여 ${pct(r.ei.workerRate + r.ei.employerRate)}(근로자 ${pct(r.ei.workerRate)})예요. 산재보험은 사업주가 업종별 요율로 전액 부담해요.${set.status === "provisional" ? " (일부 항목은 확정 전이라 앞 연도 값을 잠정 적용해요.)" : ""}` },
          { q: "국민연금 상한액은 얼마인가요?", a: `기준일(${rs.asOf}) 현재 기준소득월액 상한은 ${comma(lim.max)}원, 하한은 ${comma(lim.min)}원이에요. ${prevLim ? `${prevLim.from} 이전에는 상한 ${comma(prevLim.max)}원, 하한 ${comma(prevLim.min)}원이었어요.` : "매년 7월 1일에 조정돼요."}` },
          { q: "월 보수는 비과세를 뺀 금액인가요?", a: `네. 4대보험은 비과세(식대 월 ${comma(r.taxFree.mealMonthly)}원 등)를 뺀 보수를 기준으로 해요. 세전 월급이 300만원이고 식대 ${comma(r.taxFree.mealMonthly)}원이 비과세라면 ${comma(3_000_000 - r.taxFree.mealMonthly)}원을 넣으세요.` },
          { q: "사업주 부담은 왜 근로자보다 큰가요?", a: `고용보험의 고용안정·직업능력개발 요율(${r.ei.stabilization.map((s) => pct(s.rate)).join("~")})과 산재보험은 사업주만 부담하기 때문이에요.` },
        ],
      };
    case "freelancer":
      return {
        title: `프리랜서 ${w3.total} 계산기 ${y} — 종합소득세 환급·지역 건강보험료 | homesell 계산기`,
        description: `프리랜서 ${w3.total} 원천징수 실수령액, 5월 종합소득세 환급·추가납부 예상액, 지역가입자 건강보험료와 국민연금을 반영한 월 실수령을 계산해요.`,
        faq: [
          { q: `${w3.total}는 무엇인가요?`, a: `사업소득 원천징수 소득세 ${w3.income}와 그 ${pct(r.freelancer.withholdingLocal)}인 지방소득세 ${w3.local}를 합친 값이에요. 최종 세금이 아니라 미리 내는 세금이고, 다음 해 5월 종합소득세 신고로 정산해요.` },
          { q: `${w3.total}를 뗐는데 환급받을 수 있나요?`, a: `수입에서 필요경비와 소득공제를 뺀 과세표준에 기본세율(6~45%)을 적용한 세금이 미리 낸 ${w3.total}보다 적으면 환급받아요. '5월 종합소득세' 탭에서 예상액을 확인할 수 있어요.` },
          { q: "프리랜서도 건강보험료를 내나요?", a: "직장가입자가 아니면 지역가입자로 소득과 재산을 기준으로 건강보험료를 내요. 5월 소득 신고 결과가 그해 11월부터 반영돼요. 이 계산기는 소득분과 입력한 재산 점수를 반영해요." },
          { q: "원천징수 세율이 바뀐다는데 반영되나요?", a: "세율은 시행일 기준으로 관리돼요. 2026 세제개편안의 인하안(3%→2%)은 확정되기 전이라 현재는 반영하지 않았고, 확정되면 시행일부터 자동으로 바뀌어요. '계산 기준' 페이지에서 확정·미확정 항목을 볼 수 있어요." },
          { q: "단순경비율은 어디서 확인하나요?", a: `업종코드(예: 940909)에 따라 달라요. 홈택스 > 세금신고 > 종합소득세 > 경비율 조회에서 확인할 수 있어요. 이 계산기의 기본값 ${pct(r.freelancer.defaultSimpleExpenseRate)}는 예시이니 꼭 바꿔서 사용하세요.` },
        ],
      };
  }
}

export const NAV: { href: string; label: string }[] = [
  { href: "/salary", label: "연봉" },
  { href: "/payroll", label: "급여" },
  { href: "/insurance", label: "4대보험" },
  { href: "/freelancer", label: "프리랜서" },
  { href: "/basis", label: "계산 기준" },
];
