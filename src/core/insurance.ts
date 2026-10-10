// 4대보험 (근로자·사업주 월 부담). 식과 예시는 docs/FORMULAS.md §2
import type { Rates } from "./rates.ts";
import { npsLimitsAt } from "./rates.ts";
import type { CompanySize, Line, Notice } from "./types.ts";
import { clamp, floor10, floor1000, mulPpm, pct, ppm } from "./money.ts";

export interface InsuranceInput {
  /** 월 과세급여 (비과세 제외) */
  taxableMonthly: number;
  asOf: string;
  size?: CompanySize;
  /** 산재보험료율 (0.0147 = 1.47%) */
  wciRate?: number;
}

export interface InsuranceRow {
  key: "nps" | "nhis" | "ltc" | "ei" | "wci";
  label: string;
  /** 보험료 총액 (근로자+사업주) */
  total: number;
  worker: number;
  employer: number;
  workerBasis: string;
  employerBasis: string;
  badge?: string;
}

export interface InsuranceResult {
  rows: InsuranceRow[];
  workerTotal: number;
  employerTotal: number;
  total: number;
  npsBase: number;
  notices: Notice[];
}

export function calcInsurance(rates: Rates, input: InsuranceInput): InsuranceResult {
  const T = Math.max(0, Math.floor(input.taxableMonthly));
  const notices: Notice[] = [];
  const lim = npsLimitsAt(rates, input.asOf);

  // 국민연금
  let npsBase = 0;
  let npsBadge: string | undefined;
  if (T > 0) {
    const raw = floor1000(T);
    npsBase = clamp(raw, lim.min, lim.max);
    if (raw > lim.max) {
      npsBadge = "상한 적용";
      notices.push({ level: "info", code: "nps-max", text: `국민연금 기준소득월액 상한 ${lim.max.toLocaleString("ko-KR")}원이 적용됐어요.` });
    } else if (raw < lim.min) {
      npsBadge = "하한 적용";
      notices.push({ level: "info", code: "nps-min", text: `국민연금 기준소득월액 하한 ${lim.min.toLocaleString("ko-KR")}원이 적용됐어요.` });
    }
  }
  const npsHalf = floor10(mulPpm(npsBase, ppm(rates.nps.rate * rates.nps.workerShare)));

  // 건강보험
  let nhisHalf = 0;
  let nhisBadge: string | undefined;
  if (T > 0) {
    const h = (T * ppm(rates.nhis.rate)) / 1_000_000;
    const H = clamp(h, rates.nhis.premiumMin, rates.nhis.premiumMax);
    if (h > rates.nhis.premiumMax) nhisBadge = "상한 적용";
    else if (h < rates.nhis.premiumMin) nhisBadge = "하한 적용";
    nhisHalf = floor10(H * rates.nhis.workerShare);
  }
  // 장기요양 = 건강보험료 × (장기요양보험료율 ÷ 건강보험료율)
  const ltcHalf = floor10(Math.floor((nhisHalf * ppm(rates.nhis.ltc.rate)) / ppm(rates.nhis.rate)));

  // 고용보험
  const size: CompanySize = input.size ?? "lt150";
  const stab = rates.ei.stabilization.find((s) => s.key === size) ?? rates.ei.stabilization[0]!;
  const eiWorker = floor10(mulPpm(T, ppm(rates.ei.workerRate)));
  const eiEmployer = floor10(mulPpm(T, ppm(rates.ei.employerRate + stab.rate)));

  // 산재 (사업주만)
  const wciRate = input.wciRate ?? rates.wci.defaultRate;
  const wciEmployer = floor10(mulPpm(T, ppm(wciRate)));

  const npsRate = pct(rates.nps.rate * rates.nps.workerShare);
  const nhisRate = pct(rates.nhis.rate * rates.nhis.workerShare);

  const rows: InsuranceRow[] = [
    {
      key: "nps",
      label: "국민연금",
      total: npsHalf * 2,
      worker: npsHalf,
      employer: npsHalf,
      workerBasis: `기준소득월액 ${npsBase.toLocaleString("ko-KR")}원 × ${npsRate}`,
      employerBasis: `기준소득월액 × ${npsRate}`,
      ...(npsBadge ? { badge: npsBadge } : {}),
    },
    {
      key: "nhis",
      label: "건강보험",
      total: nhisHalf * 2,
      worker: nhisHalf,
      employer: nhisHalf,
      workerBasis: `보수월액 × ${nhisRate}`,
      employerBasis: `보수월액 × ${nhisRate}`,
      ...(nhisBadge ? { badge: nhisBadge } : {}),
    },
    {
      key: "ltc",
      label: "장기요양보험",
      total: ltcHalf * 2,
      worker: ltcHalf,
      employer: ltcHalf,
      workerBasis: `건강보험료 × ${(rates.nhis.ltc.rate / rates.nhis.rate * 100).toFixed(2)}%`,
      employerBasis: `건강보험료 × ${(rates.nhis.ltc.rate / rates.nhis.rate * 100).toFixed(2)}%`,
    },
    {
      key: "ei",
      label: "고용보험",
      total: eiWorker + eiEmployer,
      worker: eiWorker,
      employer: eiEmployer,
      workerBasis: `보수월액 × ${pct(rates.ei.workerRate)}`,
      employerBasis: `보수월액 × ${pct(rates.ei.employerRate)} + 고용안정·직능개발 ${pct(stab.rate)}`,
    },
    {
      key: "wci",
      label: "산재보험",
      total: wciEmployer,
      worker: 0,
      employer: wciEmployer,
      workerBasis: "근로자 부담 없음",
      employerBasis: `보수월액 × ${pct(wciRate)} (업종별 요율)`,
    },
  ];

  const workerTotal = rows.reduce((s, r) => s + r.worker, 0);
  const employerTotal = rows.reduce((s, r) => s + r.employer, 0);
  return { rows, workerTotal, employerTotal, total: workerTotal + employerTotal, npsBase, notices };
}

/** 소득세 공제용: 4대보험 근로자 항목을 Line 으로 */
export function workerLines(ins: InsuranceResult): Line[] {
  return ins.rows
    .filter((r) => r.key !== "wci")
    .map((r) => ({ key: r.key, label: r.label, amount: r.worker, basis: r.workerBasis }));
}
