// 계산 결과 → HTML 조각. 서버 렌더링과 브라우저 즉시 갱신이 같은 함수를 쓴다.
import type { Line, Notice } from "../core/types.ts";
import type { SalaryResult } from "../core/salary.ts";
import type { PayrollResult } from "../core/payroll.ts";
import type { InsuranceResult } from "../core/insurance.ts";
import { w33Labels, type AnnualTaxResult, type NetResult, type W33Result } from "../core/freelancer.ts";
import { pct } from "../core/money.ts";
import { comma, esc, hangulWon, wonText } from "./html.ts";

export const disclaimer =
  "모의 계산 결과예요. 실제 급여·보험료·세금은 회사와 공단·국세청 기준으로 확정되며 단수처리에 따라 10원 안팎 차이가 날 수 있어요.";

export function badges(year: number, asOf: string, extra: string[] = []): string {
  const items = [`${year}년 기준`, `기준일 ${asOf}`, ...extra];
  return `<div class="badges">${items.map((t, i) => `<span class="badge${i >= 2 ? " badge-warn" : ""}">${esc(t)}</span>`).join("")}</div>`;
}

export function noticeList(ns: Notice[]): string {
  if (!ns.length) return "";
  return `<ul class="notices">${ns.map((n) => `<li class="notice notice-${n.level}">${esc(n.text)}</li>`).join("")}</ul>`;
}

export function adjustedList(items: string[]): string {
  if (!items.length) return "";
  return `<ul class="notices">${items.map((t) => `<li class="notice notice-info">${esc(t)}</li>`).join("")}</ul>`;
}

/** 결과 맨 위 그라데이션 패널 (배지 + 큰 숫자 + 도넛). 뒤의 주석은 잠정·시행일 안내가 들어갈 자리 */
export function panel(badgesHtml: string, heroHtml: string, donutHtml = ""): string {
  return `<div class="r-panel">${badgesHtml}${heroHtml}${donutHtml}</div><!--rate-notices-->`;
}

/** 실수령 비율 도넛 (장식 — 같은 정보가 아래 범례·표에 있다) */
export function donut(total: number, net: number, lines: Line[]): string {
  if (total <= 0) return "";
  const R = 46;
  const C = 2 * Math.PI * R;
  const segs = [{ cls: "arc-net", v: net }, ...lines.filter((l) => l.amount > 0).map((l, i) => ({ cls: `arc-${Math.min(i + 1, 6)}`, v: l.amount }))];
  let off = 0;
  const arcs = segs
    .map((s) => {
      const dash = Math.max((s.v / total) * C, 0);
      const c = `<circle class="${s.cls}" cx="60" cy="60" r="${R}" fill="none" stroke-width="13" stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}"/>`;
      off += dash;
      return c;
    })
    .join("");
  const pctNet = Math.round((net / total) * 100);
  return `<svg class="donut" viewBox="0 0 120 120" aria-hidden="true" focusable="false"><circle class="trk" cx="60" cy="60" r="${R}" fill="none" stroke-width="13"/><g transform="rotate(-90 60 60)">${arcs}</g><text x="60" y="63" text-anchor="middle" font-size="22">${pctNet}%</text><text x="60" y="80" text-anchor="middle" font-size="9">실수령</text></svg>`;
}

export function hero(label: string, value: number, sub: string, negativeLabel?: string): string {
  const neg = value < 0;
  return `<p class="r-label">${esc(neg && negativeLabel ? negativeLabel : label)}</p>
<p class="r-hero"><span class="r-num" data-hero>${comma(Math.abs(value))}</span><span class="r-unit">원</span></p>
<p class="r-sub">${sub}</p>`;
}

/** 실수령 + 공제 구간을 한 줄 막대로 (SVG 속성이라 CSP 인라인 스타일 불필요) */
export function splitBar(total: number, net: number, lines: Line[], label: string): string {
  if (total <= 0) return "";
  const segs = [{ key: "net", label: "실수령", v: net }, ...lines.filter((l) => l.amount > 0).map((l) => ({ key: l.key, label: l.label, v: l.amount }))];
  let x = 0;
  const rects = segs
    .map((s, i) => {
      const w = Math.max((s.v / total) * 100, s.v > 0 ? 0.6 : 0);
      const r = `<rect x="${x.toFixed(3)}%" y="0" width="${w.toFixed(3)}%" height="16" class="seg seg-${i === 0 ? "net" : Math.min(i, 6)}"><title>${esc(s.label)} ${wonText(s.v)}</title></rect>`;
      x += w;
      return r;
    })
    .join("");
  const legend = segs
    .map((s, i) => `<li><span class="dot seg-${i === 0 ? "net" : Math.min(i, 6)}"></span>${esc(s.label)}<b>${wonText(s.v)}</b></li>`)
    .join("");
  return `<svg class="splitbar" role="img" aria-label="${esc(label)}" viewBox="0 0 100 16" preserveAspectRatio="none" width="100%" height="16">${rects}</svg><ul class="legend">${legend}</ul>`;
}

export function breakdown(lines: Line[], totalLabel: string, total: number, head = ["항목", "계산 근거", "금액"]): string {
  const rows = lines
    .map((l) => `<tr><th scope="row">${esc(l.label)}</th><td class="basis">${esc(l.basis)}</td><td class="amt">${wonText(l.amount)}</td></tr>`)
    .join("");
  return `<div class="tbl-wrap" tabindex="0" role="region" aria-label="표 (옆으로 스크롤할 수 있어요)"><table class="tbl"><thead><tr><th scope="col">${head[0]}</th><th scope="col" class="basis">${head[1]}</th><th scope="col" class="amt">${head[2]}</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th scope="row">${esc(totalLabel)}</th><td class="basis"></td><td class="amt">${wonText(total)}</td></tr></tfoot></table></div>`;
}

export function details(summary: string, body: string): string {
  return `<details class="how"><summary>${esc(summary)}</summary><div class="how-body">${body}</div></details>`;
}

// ---------------- 연봉 ----------------

export function renderSalary(r: SalaryResult, opts: { reverse?: { annual: number; reachable: boolean } } = {}): string {
  const rev = opts.reverse;
  const head = rev
    ? `<p class="r-label">필요 연봉 (세전)</p><p class="r-hero"><span class="r-num" data-hero>${comma(rev.annual)}</span><span class="r-unit">원</span></p>
<p class="r-sub">${rev.reachable ? `월 실수령 <b>${wonText(r.netMonthly)}</b> (목표 ${wonText(r.input.targetNet)} 이상)` : "입력 범위 안에서는 목표 실수령액을 만들 수 없어요."} · ${esc(hangulWon(rev.annual))}</p>`
    : hero("월 실수령액", r.netMonthly, `연 환산 <b>${wonText(r.netAnnual)}</b> · 공제율 <b>${(r.deductionRatio * 100).toFixed(1)}%</b> · ${esc(hangulWon(r.netMonthly))}`);
  const extra = r.insurance.rows.some((x) => x.badge) ? r.insurance.rows.filter((x) => x.badge).map((x) => `${x.label} ${x.badge}`) : [];
  const gross = `<dl class="kv"><div><dt>월 총지급액</dt><dd>${wonText(r.monthlyGross)}</dd></div><div><dt>비과세</dt><dd>${wonText(r.nonTaxable)}</dd></div><div><dt>월 과세급여</dt><dd>${wonText(r.taxableMonthly)}</dd></div></dl>`;
  const employer = `<details class="how"><summary>회사가 추가로 내는 4대보험 (사업주 부담)</summary><div class="how-body">
<div class="tbl-wrap" tabindex="0" role="region" aria-label="표 (옆으로 스크롤할 수 있어요)"><table class="tbl"><thead><tr><th scope="col">보험</th><th scope="col" class="basis">계산 근거</th><th scope="col" class="amt">월 부담</th></tr></thead><tbody>${r.insurance.rows
    .map((x) => `<tr><th scope="row">${esc(x.label)}</th><td class="basis">${esc(x.employerBasis)}</td><td class="amt">${wonText(x.employer)}</td></tr>`)
    .join("")}</tbody><tfoot><tr><th scope="row">사업주 부담 합계</th><td class="basis"></td><td class="amt">${wonText(r.employerInsurance)}</td></tr></tfoot></table></div>
<p class="muted">월 인건비 총액(총지급액 + 사업주 4대보험): <b>${wonText(r.employerCost)}</b></p></div></details>`;
  return `<div class="result-inner">${panel(badges(r.ratesYear, r.asOf, extra), head, donut(r.monthlyGross, r.netMonthly, r.lines))}
${splitBar(r.monthlyGross, r.netMonthly, r.lines, `월 총지급액 ${wonText(r.monthlyGross)} 중 실수령 ${wonText(r.netMonthly)}, 공제 ${wonText(r.totalDeduction)}`)}
${gross}
${breakdown(r.lines, "공제 합계", r.totalDeduction)}
${noticeList(r.notices)}
${employer}
${details("어떻게 계산했나요?", howSalary(r))}
<p class="disclaimer">${esc(disclaimer)}</p></div>`;
}

function howSalary(r: SalaryResult): string {
  const div = r.input.severanceIncluded ? 13 : 12;
  return `<ol class="how-list"><li>월 총지급액 = 연봉 ${wonText(r.input.mode === "reverse" ? r.monthlyGross * div : r.input.annual)} ÷ ${div} = <b>${wonText(r.monthlyGross)}</b>${r.input.severanceIncluded ? " (퇴직금 포함 연봉)" : ""}</li>
<li>월 과세급여 = 월 총지급액 − 비과세 ${wonText(r.nonTaxable)} = <b>${wonText(r.taxableMonthly)}</b> (4대보험·소득세의 기준)</li>
<li>4대보험은 위 급여에 요율을 곱하고 10원 미만을 버려요. 국민연금은 기준소득월액(1,000원 미만 절사, 상·하한 적용)에 곱해요.</li>
<li>소득세는 국세청 <b>근로소득 간이세액표</b>(소득세법 시행령 별표2, ${esc(r.withholdingRevision)})에서 월 과세급여 구간과 공제대상가족 수 ${r.input.family}명에 해당하는 값을 그대로 가져와요. 8~20세 자녀는 세액을 추가로 줄여요.</li>
<li>지방소득세 = 소득세 × 10%</li>
<li>월 실수령액 = 월 총지급액 − 공제 합계. 연말정산 환급·추가납부는 포함하지 않아요.</li></ol>
<p class="muted"><a href="/basis">요율표·출처·확인 못 한 항목 보기</a></p>`;
}

// ---------------- 급여 ----------------

export function renderPayroll(r: PayrollResult): string {
  const hourly = r.input.kind === "hourly";
  const sub = hourly
    ? `월 ${r.monthlyHours}시간(주휴 ${r.holidayHours}시간 포함) · 시급 ${wonText(r.input.hourlyWage)} · 최저임금 ${r.minWage.ok ? "충족" : "<b>미달</b>"}`
    : `통상시급 ${wonText(r.ordinaryHourly)} · 총 지급액 <b>${wonText(r.gross)}</b> · 공제 ${wonText(r.totalDeduction)}`;
  const earn = breakdown(r.earnings, "지급 합계", r.gross, ["지급 항목", "산출", "금액"]);
  const ded = r.deductions.length ? breakdown(r.deductions, "공제 합계", r.totalDeduction, ["공제 항목", "계산 근거", "금액"]) : `<p class="muted">공제 없이 계산했어요.</p>`;
  return `<div class="result-inner">${panel(badges(r.ratesYear, r.asOf), hero("차인지급액 (실수령)", r.net, sub), donut(r.gross, r.net, r.deductions))}
${splitBar(r.gross, r.net, r.deductions, `총 지급액 ${wonText(r.gross)} 중 실수령 ${wonText(r.net)}, 공제 ${wonText(r.totalDeduction)}`)}
<h3 class="h3">지급 내역</h3>${earn}
<h3 class="h3">공제 내역</h3>${ded}
<dl class="kv"><div><dt>총 지급액</dt><dd>${wonText(r.gross)}</dd></div><div><dt>비과세</dt><dd>${wonText(r.nonTaxable)}</dd></div><div><dt>과세 급여</dt><dd>${wonText(r.taxable)}</dd></div></dl>
${noticeList(r.notices)}
${details("어떻게 계산했나요?", hourly
    ? `<ol class="how-list"><li>주 ${r.input.weeklyHours}시간 근무 → 월 소정근로 ${r.monthlyHours - r.holidayHours}시간, 주휴 ${r.holidayHours}시간 (주 ÷ 40 × 8시간, 15시간 이상, 1주 = 365÷7÷12주)</li><li>월급 = 시급 × (소정근로 + 주휴시간)</li><li>공제 방식이 "4대보험+세금"이면 4대보험과 간이세액표 소득세를 빼요. (프리랜서 원천징수는 프리랜서 계산기에서 계산해요.)</li></ol>`
    : `<ol class="how-list"><li>통상시급 = (기본급 + 통상임금 포함 수당) ÷ ${r.paidHours}시간 (소수점 버림)</li><li>연장근로 = 통상시급 × 1.5, 야간 가산 = × 0.5, 휴일 = × 1.5 (8시간 초과분 × 2.0)</li><li>과세 급여 = 총 지급액 − 비과세. 4대보험은 과세 급여 기준이고 소득세는 간이세액표로 구해요.</li></ol>`)}
<p class="disclaimer">${esc(disclaimer)}</p></div>`;
}

// ---------------- 4대보험 ----------------

export function renderInsurance(r: InsuranceResult, ctx: { year: number; asOf: string; taxableMonthly: number }): string {
  const extra = r.rows.filter((x) => x.badge).map((x) => `${x.label} ${x.badge}`);
  const rows = r.rows
    .map(
      (x) =>
        `<tr><th scope="row">${esc(x.label)}${x.badge ? ` <span class="badge badge-warn">${esc(x.badge)}</span>` : ""}</th><td class="amt">${wonText(x.total)}</td><td class="amt">${wonText(x.worker)}</td><td class="amt">${wonText(x.employer)}</td></tr>`,
    )
    .join("");
  const basis = r.rows.map((x) => `<tr><th scope="row">${esc(x.label)}</th><td>${esc(x.workerBasis)}</td><td>${esc(x.employerBasis)}</td></tr>`).join("");
  return `<div class="result-inner">${panel(badges(ctx.year, ctx.asOf, extra), hero("근로자 부담 4대보험 (월)", r.workerTotal, `사업주 부담 <b>${wonText(r.employerTotal)}</b> · 보험료 총액 ${wonText(r.total)} · 연 환산 근로자 ${wonText(r.workerTotal * 12)}`))}
<div class="tbl-wrap" tabindex="0" role="region" aria-label="표 (옆으로 스크롤할 수 있어요)"><table class="tbl"><thead><tr><th scope="col">보험</th><th scope="col" class="amt">총액</th><th scope="col" class="amt">근로자</th><th scope="col" class="amt">사업주</th></tr></thead><tbody>${rows}</tbody><tfoot><tr><th scope="row">합계</th><td class="amt">${wonText(r.total)}</td><td class="amt">${wonText(r.workerTotal)}</td><td class="amt">${wonText(r.employerTotal)}</td></tr></tfoot></table></div>
${noticeList(r.notices)}
${details("계산 근거 보기", `<div class="tbl-wrap" tabindex="0" role="region" aria-label="표 (옆으로 스크롤할 수 있어요)"><table class="tbl"><thead><tr><th scope="col">보험</th><th scope="col">근로자</th><th scope="col">사업주</th></tr></thead><tbody>${basis}</tbody></table></div><p class="muted">월 보수(과세) ${wonText(ctx.taxableMonthly)} 기준. 두루누리(10인 미만 사업장·월 260만원 미만 신규가입자 80% 지원)는 계산에 반영하지 않았어요. <a href="/basis">요율표·출처</a></p>`)}
<p class="disclaimer">${esc(disclaimer)}</p></div>`;
}

// ---------------- 프리랜서 ----------------

export function renderW33(r: W33Result, year: number, asOf: string): string {
  const w = r.w;
  const lb = w33Labels(r.rates);
  const lines: Line[] = [
    { key: "tax", label: `소득세 (${lb.income})`, amount: w.tax, basis: `세전 금액 × ${lb.income} (원 미만 절사)` },
    { key: "local", label: `지방소득세 (${lb.local})`, amount: w.local, basis: `소득세 × ${pct(r.rates.local)}` },
  ];
  if (r.rates.ei > 0) lines.push({ key: "ei", label: `고용보험 (${lb.ei})`, amount: w.ei, basis: `세전 금액 × ${lb.ei} (원 미만 절사)` });
  const cut = w.tax + w.local + w.ei;
  const cutLabel = r.rates.ei > 0 ? "원천징수·고용보험" : "원천징수";
  return `<div class="result-inner">${panel(badges(year, asOf), hero(r.fromNet ? "필요한 세전 금액" : "실수령액", r.fromNet ? w.gross : w.net, r.fromNet ? `세전 <b>${wonText(w.gross)}</b> → 실수령 <b>${wonText(w.net)}</b>` : `세전 ${wonText(w.gross)} − ${cutLabel} ${wonText(cut)} (${r.rates.ei > 0 ? `${lb.total} + ${lb.ei}` : lb.total})`), donut(w.gross, w.net, lines))}
${splitBar(w.gross, w.net, lines, `세전 ${wonText(w.gross)} 중 실수령 ${wonText(w.net)}, ${cutLabel} ${wonText(cut)}`)}
${breakdown(lines, `${cutLabel} 합계`, cut)}
${r.months > 1 ? `<dl class="kv"><div><dt>${r.months}개월 세전</dt><dd>${wonText(r.annualGross)}</dd></div><div><dt>${r.months}개월 실수령</dt><dd>${wonText(r.annualNet)}</dd></div></dl>` : ""}
${noticeList(r.notices)}
<p class="muted">${lb.total}는 미리 내는 세금이에요. 다음 해 5월 종합소득세 신고에서 실제 세액과 비교해 돌려받거나 더 내요. <a href="/freelancer?tab=tax">5월 정산 계산하기</a></p>
<p class="disclaimer">${esc(disclaimer)}</p></div>`;
}

export function renderAnnualTax(r: AnnualTaxResult, year: number, asOf: string): string {
  const refund = r.settleTotal < 0;
  const lb = w33Labels(r.w33);
  const steps: Line[] = [
    { key: "rev", label: "연 수입금액", amount: r.revenue, basis: `${lb.total} 떼기 전 총수입` },
    { key: "exp", label: "− 필요경비", amount: r.expense, basis: r.input.expenseMode === "rate" ? `수입 × 단순경비율 ${(r.input.expenseRate * 100).toFixed(1)}%` : "실제 경비 입력값(수입 한도)" },
    { key: "inc", label: "= 소득금액", amount: r.income, basis: "수입 − 필요경비" },
    { key: "ded", label: "− 소득공제", amount: r.deductions.total, basis: `기본공제 ${wonText(r.deductions.basic)}${r.deductions.pension ? ` + 국민연금 ${wonText(r.deductions.pension)}` : ""}${r.deductions.other ? ` + 기타 ${wonText(r.deductions.other)}` : ""}` },
    { key: "tb", label: "= 과세표준", amount: r.taxBase, basis: "소득금액 − 소득공제 (0 미만이면 0)" },
    { key: "cal", label: "산출세액", amount: r.computedTax, basis: `기본세율 ${(r.bracket.rate * 100).toFixed(0)}% 구간 (소득세법 제55조)` },
    { key: "cr", label: "− 세액공제", amount: r.credits.total, basis: `표준세액공제 ${wonText(r.credits.standard)}${r.credits.child ? ` + 자녀 ${wonText(r.credits.child)}` : ""}` },
    { key: "det", label: "= 결정세액", amount: r.determinedTax, basis: "산출세액 − 세액공제" },
    { key: "loc", label: "+ 지방소득세", amount: r.localTax, basis: "결정세액 × 10%" },
    { key: "tot", label: "= 총 부담 세금", amount: r.totalTax, basis: `수입 대비 ${(r.effectiveRate * 100).toFixed(1)}%` },
    { key: "pre", label: `− 이미 낸 ${lb.total}`, amount: r.prepaidTax + r.prepaidLocal, basis: `소득세 ${wonText(r.prepaidTax)} + 지방소득세 ${wonText(r.prepaidLocal)}` },
  ];
  return `<div class="result-inner">${panel(badges(year, asOf), hero(refund ? "예상 환급액" : "예상 추가 납부액", Math.abs(r.settleTotal), `총 부담 세금 <b>${wonText(r.totalTax)}</b> (수입의 ${(r.effectiveRate * 100).toFixed(1)}%) − 이미 낸 ${wonText(r.prepaidTax + r.prepaidLocal)}`))}
${breakdown(steps, refund ? "환급 예상 (소득세+지방소득세)" : "추가 납부 예상", Math.abs(r.settleTotal), ["단계", "근거", "금액"])}
${noticeList(r.notices)}
${details("이 계산에 포함하지 않은 것", `<ul class="how-list"><li>기준경비율 방식(주요경비 증빙), 복식부기, 노란우산공제·연금계좌 등 개별 공제·감면</li><li>다른 소득(근로소득 등)과의 합산</li><li>단순경비율은 업종별로 달라요. 홈택스 &gt; 세금신고 &gt; 종합소득세 &gt; 경비율 조회 값으로 바꿔 보세요.</li></ul>`)}
<p class="disclaimer">${esc(disclaimer)}</p></div>`;
}

export function renderNet(r: NetResult, year: number, asOf: string): string {
  const g = r.regional;
  const rt = r.rates;
  const lb = w33Labels(r.tax.w33);
  const lines: Line[] = [
    { key: "nhis", label: "건강보험 (지역, 월)", amount: g.nhis, basis: `월 소득 ${wonText(g.monthlyIncome)} × ${pct(rt.nhis.rate)}${g.nhisBadge ? ` · ${g.nhisBadge}` : ""}` },
    { key: "ltc", label: "장기요양보험 (월)", amount: g.ltc, basis: `건강보험료 × ${(rt.nhis.ltc.rate / rt.nhis.rate * 100).toFixed(2)}%` },
    { key: "nps", label: "국민연금 (지역, 월)", amount: r.regional.nps, basis: `기준소득월액 ${wonText(g.npsBase)} × ${pct(rt.nps.rate)}${g.npsBadge ? ` · ${g.npsBadge}` : ""}` },
    { key: "tax", label: "종합소득세+지방소득세 (월 환산)", amount: Math.floor(r.tax.totalTax / 12), basis: `연 ${wonText(r.tax.totalTax)} ÷ 12` },
  ];
  const monthlyRevenue = Math.floor(r.tax.revenue / 12);
  const burdenMonthly = lines.reduce((s, l) => s + l.amount, 0);
  return `<div class="result-inner">${panel(badges(year, asOf), hero("월 실수령 추정", r.netMonthly, `월 수입 ${wonText(monthlyRevenue)} − 세금·보험 ${wonText(burdenMonthly)}${r.annualBurden - r.tax.totalTax - (g.nhis + g.ltc + g.nps) * 12 > 0 ? " − 실제 지출 경비" : ""}`), donut(monthlyRevenue, Math.max(0, r.netMonthly), lines))}
${splitBar(monthlyRevenue, Math.max(0, r.netMonthly), lines, `월 수입 ${wonText(monthlyRevenue)} 중 실수령 ${wonText(r.netMonthly)}`)}
${breakdown(lines, "세금·보험 합계(월)", burdenMonthly)}
${noticeList([...r.notices, ...r.tax.notices])}
<dl class="kv"><div><dt>연 세금 (결정세액+지방세)</dt><dd>${wonText(r.tax.totalTax)}</dd></div><div><dt>이미 낸 ${lb.total}</dt><dd>${wonText(r.tax.prepaidTax + r.tax.prepaidLocal)}</dd></div><div><dt>5월 정산</dt><dd>${r.tax.settleTotal < 0 ? "환급 " : "추가납부 "}${wonText(Math.abs(r.tax.settleTotal))}</dd></div></dl>
<p class="muted">건강보험료는 소득 외에 재산(전월세·주택·자동차)에도 부과돼요. 재산 점수를 모르면 0으로 두고 공단 모의계산으로 확인하세요.</p>
<p class="disclaimer">${esc(disclaimer)}</p></div>`;
}
