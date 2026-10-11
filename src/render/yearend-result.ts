// 연말정산 결과 → HTML. 서버 렌더링과 브라우저 즉시 갱신이 같은 함수를 쓴다.
import type { Notice } from "../core/types.ts";
import { pct } from "../core/money.ts";
import type { Dep, PersonInput, PersonResult, Tip, YearCtx } from "../core/yearend.ts";
import type { CoupleResult } from "../core/yearend-couple.ts";
import { SPLIT_STEPS } from "../core/yearend-couple.ts";
import type { YearendInput } from "../core/yearend-input.ts";
import { comma, esc, wonText } from "./html.ts";
import { badges, details, disclaimer, hero, noticeList, panel } from "./result.ts";

const signed = (n: number): string => (n < 0 ? `−${wonText(-n)}` : wonText(n));
const REL: Record<string, string> = { child: "자녀", parent: "부모·조부모", spouse: "배우자" };

interface Step {
  label: string;
  basis: string;
  amount: number;
  /** 소계(굵게) */
  sum?: boolean;
  /** 0원이어도 보여 줄 줄 */
  always?: boolean;
}

function stepTable(rows: Step[], head = ["단계", "계산 근거", "금액"]): string {
  const body = rows
    .filter((s) => s.always || s.amount !== 0)
    .map((s) => `<tr${s.sum ? ' class="sum"' : ""}><th scope="row">${esc(s.label)}</th><td class="basis">${esc(s.basis)}</td><td class="amt">${s.amount < 0 ? signed(s.amount) : wonText(s.amount)}</td></tr>`)
    .join("");
  return `<div class="tbl-wrap" tabindex="0" role="region" aria-label="표 (옆으로 스크롤할 수 있어요)"><table class="tbl"><thead><tr><th scope="col">${head[0]}</th><th scope="col" class="basis">${head[1]}</th><th scope="col" class="amt">${head[2]}</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

/** 한 사람의 계산 과정 (총급여 → 환급·추가납부) */
export function personSteps(ctx: YearCtx, p: PersonInput, r: PersonResult): Step[] {
  const y = ctx.rates.yearend;
  const c = r.credits;
  const b = r.base;
  const card = r.card;
  const cardBasis = card.over
    ? `카드 등 사용 ${wonText(card.total)} − 최저사용금액 ${wonText(card.minUsage)}(총급여의 ${pct(y.card.minRatio)}) 초과분 기준${card.raw > card.cap ? `, 한도 ${wonText(card.cap)}${card.extra ? ` + 추가 ${wonText(card.extra)}` : ""}` : ""}${r.housing ? ` · 주택청약 ${wonText(r.housing)}` : ""}${r.limitedCapped ? ` · 종합한도 ${wonText(y.comprehensiveCap)}` : ""}`
    : card.total > 0
      ? `카드 등 사용 ${wonText(card.total)}이 최저사용금액 ${wonText(card.minUsage)}을 넘지 못함${r.housing ? ` · 주택청약 ${wonText(r.housing)}` : ""}`
      : r.housing
        ? `주택청약저축 ${wonText(r.housing)}`
        : "카드 등 사용액 없음";
  const est = (flag: boolean) => (flag ? "총급여로 추정" : "직접 입력한 값");
  const steps: Step[] = [
    { label: "총급여", basis: `연 총지급 ${wonText(p.gross)} − 비과세 ${wonText(p.nonTaxable)}`, amount: r.salary, always: true },
    { label: "− 근로소득공제", basis: "총급여 구간별 공제, 한도 있음 (소득세법 제47조)", amount: r.earnedDeduction, always: true },
    { label: "= 근로소득금액", basis: "총급여 − 근로소득공제", amount: r.earnedIncome, sum: true, always: true },
    { label: "− 인적공제", basis: `${r.headcount}명 × ${wonText(ctxBasic(ctx))}${r.senior ? ` + 경로우대 ${wonText(r.senior)}` : ""}`, amount: r.basic + r.senior, always: true },
    { label: "− 국민연금", basis: est(b.npsEstimated), amount: r.nps },
    { label: "− 건강·장기요양·고용보험료", basis: est(b.healthEstimated), amount: r.health },
    { label: "− 신용카드 등·주택청약", basis: cardBasis, amount: r.limited },
    { label: "= 과세표준", basis: "근로소득금액 − 소득공제 합계", amount: r.taxBase, sum: true, always: true },
    { label: "산출세액", basis: `기본세율 ${pct(r.marginalRate)} 구간 (소득세법 제55조)`, amount: r.computedTax, sum: true, always: true },
    { label: "− 근로소득세액공제", basis: "산출세액 구간별 공제, 총급여별 한도 (제59조)", amount: c.earned, always: true },
    { label: "− 자녀세액공제", basis: `8세 이상 자녀${c.birth ? " + 출산·입양" : ""} (제59조의2)`, amount: c.child + c.birth },
    { label: "− 연금계좌세액공제", basis: "연금저축·IRP 납입액 기준 (제59조의3)", amount: c.pension },
    { label: "− 보장성 보험료", basis: "특별세액공제", amount: c.insurance },
    { label: "− 의료비", basis: `총급여의 ${pct(y.medical.thresholdRatio)} 초과분${r.medicalBase ? ` (공제 대상 ${wonText(r.medicalBase)})` : ""}`, amount: c.medical },
    { label: "− 교육비", basis: "특별세액공제", amount: c.education },
    { label: "− 기부금", basis: "특별세액공제", amount: c.donation },
    { label: "− 월세", basis: "월세 세액공제 (조세특례제한법 제95조의2)", amount: c.rent },
    { label: "− 표준세액공제", basis: "특별세액공제·월세를 받지 않을 때 (제59조의4)", amount: c.standard },
    { label: "− 고향사랑 기부금", basis: "세액공제 (조세특례제한법 제58조)", amount: c.hometown },
    { label: "= 결정세액", basis: c.capped ? "세액공제가 산출세액을 넘어 0원까지만" : "산출세액 − 세액공제", amount: r.determinedTax, sum: true, always: true },
    { label: "+ 지방소득세", basis: "결정세액의 10%", amount: r.localTax, always: true },
    { label: "− 이미 낸 세금", basis: `소득세 ${wonText(r.prepaidTax)} + 지방소득세 ${wonText(r.prepaidLocal)} (${b.prepaidEstimated ? "간이세액표로 추정" : "직접 입력한 값"})`, amount: r.prepaidTax + r.prepaidLocal, always: true },
    { label: r.settleTotal < 0 ? "= 예상 환급액" : "= 예상 추가 납부액", basis: "결정세액 + 지방소득세 − 이미 낸 세금", amount: Math.abs(r.settleTotal), sum: true, always: true },
  ];
  return steps;
}

const ctxBasic = (ctx: YearCtx): number => ctx.rates.incomeTax.basicDeductionPerPerson;

const NOT_COVERED = [
  "장기주택저당차입금 이자·주택임차차입금 원리금상환액 소득공제",
  "장애인 추가공제·장애인전용 보장성보험·특수교육비·난임·미숙아 의료비",
  "부녀자·한부모 추가공제, 70세 이상 외 배우자 경로우대",
  "정치자금 기부금, 소기업·소상공인 공제부금, 장기집합투자증권저축, 우리사주 출자",
  "전년도 이월 기부금, 퇴직·중도 입사 연도, 두 곳 이상에서 받은 근로소득, 외국납부세액",
];

function coverage(): string {
  return details("이 계산기가 반영하지 않는 항목", `<ul>${NOT_COVERED.map((t) => `<li>${esc(t)}</li>`).join("")}</ul><p class="muted">해당하면 홈택스 '연말정산 미리보기'나 회사 담당자에게 확인하세요.</p>`);
}

function estimateNotices(r: PersonResult, who = ""): Notice[] {
  const out: Notice[] = [];
  if (r.base.npsEstimated || r.base.healthEstimated) out.push({ level: "info", code: "ins-est", text: `${who}4대보험료는 총급여로 추정한 값이에요. 급여명세서의 합계를 '직접 입력'하면 더 정확해요.` });
  if (r.base.prepaidEstimated) out.push({ level: "info", code: "prepaid-est", text: `${who}이미 낸 소득세는 간이세액표로 추정한 값이에요. 급여명세서의 소득세 합계를 '직접 입력'하면 환급액이 더 정확해요.` });
  return out;
}

// ------------------------------------------------------------ 내 연말정산

export function renderYearendMe(inp: YearendInput, ctx: YearCtx, r: PersonResult, tipList: Tip[], adjusted: string[]): string {
  const extra: string[] = [];
  if (r.base.npsEstimated || r.base.healthEstimated) extra.push("4대보험 추정");
  if (r.base.prepaidEstimated) extra.push("기납부세액 추정");
  const sub = `결정세액 <b>${wonText(r.determinedTax)}</b> + 지방소득세 <b>${wonText(r.localTax)}</b> − 이미 낸 세금 <b>${wonText(r.prepaidTax + r.prepaidLocal)}</b>`;
  const tipsHtml = tipList.length
    ? `<section class="tips"><h3>이렇게 하면 더 받아요</h3><ul class="tip-list">${tipList.map((t) => `<li>${esc(t.text)}</li>`).join("")}</ul></section>`
    : "";
  const notices = [...estimateNotices(r), ...r.notices];
  return `<div class="result-inner">${panel(badges(inp.year, inp.asOf, extra).replace("년 기준", "년 귀속"), hero("예상 추가 납부액", r.settleTotal, sub, "예상 환급액"))}
${adjusted.length ? `<ul class="notices">${adjusted.map((t) => `<li class="notice notice-info">${esc(t)}</li>`).join("")}</ul>` : ""}${noticeList(notices)}
<dl class="kv"><div><dt>총급여</dt><dd>${wonText(r.salary)}</dd></div><div><dt>과세표준</dt><dd>${wonText(r.taxBase)}</dd></div><div><dt>세액공제 합계</dt><dd>${wonText(r.credits.total)}</dd></div></dl>
${tipsHtml}
<section><h3>계산 과정</h3>${stepTable(personSteps(ctx, inp.a, r))}</section>
${coverage()}
<p class="muted">${esc(inp.year)}년 소득의 연말정산은 ${esc(inp.year + 1)}년 2월 급여에서 정산돼요. 추가 납부가 많으면 2~4월에 나눠 낼 수 있어요.</p>
<p class="disclaimer">${esc(disclaimer)} 공제 대상 여부와 증빙은 국세청 연말정산 간소화 자료가 기준이에요.</p></div>`;
}

// ------------------------------------------------------------ 부부 비교

export function depLabel(d: Dep, year: number): string {
  const age = d.rel === "spouse" ? "" : ` (${d.year}년생, ${year - d.year}세)`;
  return `${REL[d.rel]}${age}`;
}

export function renderYearendCouple(inp: YearendInput, ctx: YearCtx, c: CoupleResult, adjusted: string[]): string {
  const best = c.best;
  const sumSettle = best.a.settleTotal + best.b.settleTotal;
  const money = (n: number) => wonText(n);
  const who = (mask: number, i: number) => ((mask >> i) & 1 ? "배우자" : "나");
  const diff = (total: number) => (total === best.total ? "추천안" : `+${money(total - best.total)}`);
  const scenarios = `<p class="swipe-hint">↔ 옆으로 밀어서 전체를 볼 수 있어요</p><div class="tbl-wrap" tabindex="0" role="region" aria-label="표 (옆으로 스크롤할 수 있어요)"><table class="tbl"><thead><tr><th scope="col">배분</th><th scope="col" class="amt">나</th><th scope="col" class="amt">배우자</th><th scope="col" class="amt">부부 합계</th><th scope="col" class="amt">추천안 대비</th></tr></thead><tbody>
<tr class="sum"><th scope="row">추천 배분</th><td class="amt">${money(best.a.determinedTax + best.a.localTax)}</td><td class="amt">${money(best.b.determinedTax + best.b.localTax)}</td><td class="amt">${money(best.total)}</td><td class="amt">${diff(best.total)}</td></tr>
<tr><th scope="row">모두 나에게</th><td class="amt">${money(c.allA.a.determinedTax + c.allA.a.localTax)}</td><td class="amt">${money(c.allA.b.determinedTax + c.allA.b.localTax)}</td><td class="amt">${money(c.allA.total)}</td><td class="amt">${diff(c.allA.total)}</td></tr>
<tr><th scope="row">모두 배우자에게</th><td class="amt">${money(c.allB.a.determinedTax + c.allB.a.localTax)}</td><td class="amt">${money(c.allB.b.determinedTax + c.allB.b.localTax)}</td><td class="amt">${money(c.allB.total)}</td><td class="amt">${diff(c.allB.total)}</td></tr>
</tbody></table></div><p class="muted">숫자는 결정세액 + 지방소득세예요(적을수록 유리). '모두 ○○에게'는 부양가족과 공동 카드 지출을 한 사람에게 몰았을 때예요.</p>`;

  const depsHtml = c.moves.length
    ? `<section><h3>부양가족은 누가 공제받을까</h3><ul class="move-list">${c.moves
        .map((m) => {
          const tag = m.eligible ? "" : ' <span class="muted">(나이·소득 요건 미충족 — 의료비 등 지출만 반영)</span>';
          return `<li><b>${esc(depLabel(m.dep, inp.year))}</b>${tag} → <b>${m.owner === "A" ? "나" : "배우자"}</b>가 공제받기 ${m.costIfMoved > 0 ? `<span class="move-cost">반대로 하면 세금 +${money(m.costIfMoved)}</span>` : '<span class="muted">(어느 쪽이든 차이 없음)</span>'}</li>`;
        })
        .join("")}</ul></section>`
    : "";
  const hasShared = inp.sharedCredit > 0 || inp.sharedDebit > 0;
  const bPct = best.shareB * (100 / SPLIT_STEPS);
  const cardHtml = hasShared
    ? `<section><h3>공동 카드 지출은 누구 카드로 쓸까</h3><p>${
        bPct === 0 ? "<b>나</b>의 카드로 모두 쓰는 게 유리해요." : bPct === 100 ? "<b>배우자</b>의 카드로 모두 쓰는 게 유리해요." : `<b>나 ${100 - bPct}% · 배우자 ${bPct}%</b>로 나눠 쓰는 게 유리해요.`
      } ${c.cardIfAllA > 0 ? `모두 나에게 몰면 세금 +${money(c.cardIfAllA)}, ` : ""}${c.cardIfAllB > 0 ? `모두 배우자에게 몰면 +${money(c.cardIfAllB)}` : ""}</p><p class="muted">카드 공제는 총급여의 ${pct(ctx.rates.yearend.card.minRatio)}(최저사용금액)를 넘는 부분부터 시작하므로, 보통 한쪽에 몰아야 유리해요.</p></section>`
    : "";
  const tip = `<p class="muted">한계세율 — 나 <b>${pct(c.marginalA)}</b> · 배우자 <b>${pct(c.marginalB)}</b>. 인적공제·자녀 공제는 세율이 높은 쪽이, 의료비(총급여의 ${pct(ctx.rates.yearend.medical.thresholdRatio)} 초과분)와 카드(최저사용금액)는 총급여가 낮은 쪽이 유리한 경우가 많아요. 이 계산기는 모든 배분을 직접 계산해 가장 유리한 안을 골랐어요(${comma(c.evaluated)}가지).</p>`;
  const extra: string[] = [];
  if (c.baseA.prepaidEstimated || c.baseB.prepaidEstimated) extra.push("기납부세액 추정");
  if (c.baseA.npsEstimated || c.baseB.npsEstimated) extra.push("4대보험 추정");
  const headline =
    best.maskB === 0 && best.shareB === 0 && c.moves.length
      ? "부양가족 모두 <b>나</b>에게 공제받는 게 가장 유리해요."
      : best.maskB === (1 << c.moves.length) - 1 && best.shareB === SPLIT_STEPS && c.moves.length
        ? "부양가족 모두 <b>배우자</b>에게 공제받는 게 가장 유리해요."
        : c.moves.length
          ? `부양가족: ${c.moves.map((m, i) => `${esc(REL[m.dep.rel])}${i + 1} → ${who(best.maskB, i)}`).join(" · ")}`
          : "나눌 부양가족이 없어요.";
  const sub = `${headline} · 나 ${signed(best.a.settleTotal)} · 배우자 ${signed(best.b.settleTotal)}`;
  const notices = [...estimateNotices(best.a, "나의 "), ...estimateNotices(best.b, "배우자의 ")];
  const steps = (label: string, p: PersonInput, r: PersonResult) => details(`${label} 계산 과정 (추천 배분 기준)`, stepTable(personSteps(ctx, p, r)));
  return `<div class="result-inner">${panel(badges(inp.year, inp.asOf, extra).replace("년 기준", "년 귀속"), hero("부부 합계 예상 추가 납부액", sumSettle, sub, "부부 합계 예상 환급액"))}
${adjusted.length ? `<ul class="notices">${adjusted.map((t) => `<li class="notice notice-info">${esc(t)}</li>`).join("")}</ul>` : ""}${noticeList(notices)}
<section><h3>배분별 세금 비교</h3>${scenarios}</section>
${depsHtml}${cardHtml}${tip}
${steps("나의", inp.a, best.a)}${steps("배우자의", inp.b, best.b)}
${coverage()}
<p class="disclaimer">${esc(disclaimer)} 실제로는 가족 한 명을 부부가 동시에 공제받을 수 없고, 의료비·교육비는 실제로 낸 사람만 공제받아요. 카드 사용액은 본인 명의 카드만 공제돼요.</p></div>`;
}
