// /basis — 요율표·출처·확정/미확정·시행예정 개정·법령 감시 현황. 값은 data/rates/ 와 data/watch/ 에서 읽는다.
import { esc, comma } from "../render/html.ts";
import { pct } from "../core/money.ts";
import { nextSet, resolveRates, todayKst } from "../core/rates.ts";
import { w33Labels, w33RatesOf } from "../core/freelancer.ts";
import { upcoming, type Snapshot, type Targets } from "../watch/law-api.ts";
import snapshotJson from "../../data/watch/snapshot.json";
import targetsJson from "../../data/watch/targets.json";

const snapshot = snapshotJson as unknown as Snapshot;
const targets = targetsJson as unknown as Targets;

/** 공식 원문으로 확인하지 못한 항목 — 현재 요율 세트의 값을 문구에 넣는다 */
function unverified(rates: ReturnType<typeof resolveRates>["set"]["rates"]): { id: string; item: string; assumption: string; impact: string }[] {
  const w3 = w33Labels(w33RatesOf(rates));
  return [
    { id: "U1", item: "국민연금 보험료 단수처리", assumption: `${rates.nps.premiumUnit}원 미만 절사`, impact: "±10원" },
    { id: "U2", item: "건강보험료 근로자 반분 시 단수", assumption: "전체 보험료(상·하한 적용) ÷ 2 후 10원 미만 절사", impact: "±10원" },
    { id: "U3", item: "고용보험료 단수처리", assumption: `${rates.ei.premiumUnit}원 미만 절사`, impact: "±10원" },
    { id: "U4", item: `산재보험 평균 요율 ${pct(rates.wci.defaultRate)}`, assumption: "업종별 요율을 직접 입력하는 것을 권장", impact: "사업주 부담만" },
    { id: "U5", item: `${w3.total} 원천징수 단수`, assumption: "소득세·지방소득세 각각 원 미만 절사", impact: "±수 원" },
    { id: "U6", item: `단순경비율 기본값 ${pct(rates.freelancer.defaultSimpleExpenseRate)}`, assumption: "예시값. 업종별 고시값으로 직접 입력", impact: "프리랜서 세액" },
    { id: "U7", item: `건강보험료 상·하한 (월 ${comma(rates.nhis.premiumMin)}원 / ${comma(rates.nhis.premiumMax)}원)`, assumption: "언론 보도 수치. 보건복지부 고시 원문 대조 전", impact: "극단 소득에서만" },
    { id: "U8", item: "간이세액표 10,000천원 초과 구간 단수", assumption: "별표2 말미 계산식 결과를 10원 미만 절사", impact: "월 과세급여 1,000만원 초과에서 ±10원" },
  ];
}

const d8 = (d: string): string => (d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d);

export function basisBody(history: { year: number; version: string; effective_from: string; created_at: string }[] | null, sourceFiles: { name: string; href: string }[]): string {
  const rs = resolveRates();
  const { set } = rs;
  const r = set.rates;
  const w = set.withholding;
  const ns = nextSet(rs.asOf);
  const lim = r.nps.limits.map((l) => `${l.from} ~ : 하한 ${comma(l.min)}원 · 상한 ${comma(l.max)}원`).join("<br>");
  const stab = r.ei.stabilization.map((s) => `${esc(s.label)} ${pct(s.rate)}`).join(" · ");
  const sources = Object.entries(r.sources)
    .map(([id, s]) => `<li><b>${id}</b> <a href="${esc(s.url)}" rel="noopener noreferrer" target="_blank">${esc(s.title)}</a></li>`)
    .join("");
  const bracket = r.incomeTax.brackets
    .map((b, i, a) => `<tr><td>${i === 0 ? "0" : comma(a[i - 1]!.upTo!)}원 초과</td><td>${b.upTo ? `${comma(b.upTo)}원 이하` : "—"}</td><td class="amt">${pct(b.rate)}</td><td class="amt">${comma(b.deduction)}원</td></tr>`)
    .join("");
  const un = unverified(r).map((u) => `<tr><td>${u.id}</td><td>${esc(u.item)}</td><td>${esc(u.assumption)}</td><td>${esc(u.impact)}</td></tr>`).join("");
  const wrap = (inner: string) => `<div class="tbl-wrap" tabindex="0" role="region" aria-label="표 (옆으로 스크롤할 수 있어요)">${inner}</div>`;
  const hist = history
    ? history.length
      ? wrap(`<table class="tbl"><thead><tr><th scope="col">연도</th><th scope="col">버전</th><th scope="col">시행</th><th scope="col">기록일</th></tr></thead><tbody>${history.map((h) => `<tr><td>${h.year}</td><td><code>${esc(h.version)}</code></td><td>${esc(h.effective_from)}</td><td>${esc(h.created_at.slice(0, 10))}</td></tr>`).join("")}</tbody></table>`)
      : `<p class="muted">기록이 아직 없어요.</p>`
    : `<p class="muted">이력을 불러오지 못했어요.</p>`;
  const files = sourceFiles.length
    ? `<ul>${sourceFiles.map((f) => `<li><a href="${esc(f.href)}">${esc(f.name)}</a></li>`).join("")}</ul>`
    : `<p class="muted">보관 중인 원문 파일 목록을 불러오지 못했어요.</p>`;

  // 다음 연도(시행 예정) 확정·미확정
  const next = ns
    ? `<h2 id="next">${ns.year}년 변경 (${esc(ns.effectiveFrom)} 시행 — 확정된 것만 반영)</h2>
<p>시행일이 되면 별도 배포 없이 ${ns.year}년 요율로 자동 계산해요. 확정 전 항목은 앞 연도 값을 잠정 적용하고 결과 위에 안내해요.</p>
${wrap(`<table class="tbl"><thead><tr><th scope="col">구분</th><th scope="col">항목</th><th scope="col">근거 / 지금 적용 중인 값</th></tr></thead><tbody>${ns.meta.confirmed.map((c) => `<tr><td><span class="badge">확정</span></td><td>${esc(c.item)}</td><td>${esc(c.basis)}</td></tr>`).join("")}${ns.meta.pending.map((c) => `<tr><td><span class="badge badge-warn">확정 전</span></td><td>${esc(c.item)}</td><td>${esc(c.now)}</td></tr>`).join("")}</tbody></table>`)}`
    : "";

  // 법령 감시 현황
  const up = upcoming(snapshot, todayKst());
  const upRows = up.map((u) => `<tr><td>${esc(u.name)}</td><td>${d8(u.effective)}</td><td>${d8(u.promulgated)}</td><td>${esc(u.kind)}</td></tr>`).join("");
  const watch = `<h2 id="watch">법령 변경 감시</h2>
<p>계산에 쓰는 법령 ${targets.laws.length}개와 고시 ${targets.rules.length}종을 <b>매일</b> 법제처 자료와 비교해요. 변경이나 시행 예정 개정이 생기면 알림이 만들어지고, 확인해서 요율·계산식을 갱신해요. 근로소득 간이세액표(시행령 별표2)는 새 개정이 나오면 원문을 받아 자동으로 표를 만들어요. 마지막 확인: <b>${esc(snapshot.checkedAt)}</b></p>
${up.length ? `<h3>앞으로 시행될 개정 (법제처 기준, 내용 확인 후 반영)</h3>${wrap(`<table class="tbl"><thead><tr><th scope="col">법령</th><th scope="col">시행일</th><th scope="col">공포일</th><th scope="col">구분</th></tr></thead><tbody>${upRows}</tbody></table>`)}<p class="muted">시행 예정이어도 계산에 쓰는 값과 무관한 개정이 대부분이에요. 계산에 영향이 있는 것만 위 '변경' 표에 확정으로 올라가요.</p>` : ""}
<p class="muted">법제처 고시 자료에 없는 항목(장기요양보험료율, 경비율 등)은 해당 시기에 사람이 직접 확인해요: ${(targets.manual ?? []).map((m) => esc(m.item)).join(" · ")}</p>`;

  return `<section class="wrap page-head"><p class="crumb"><a href="/">홈</a> / 계산 기준</p><h1>계산 기준 · 요율표 · 출처</h1>
<p class="lead">${set.year}년 기준${set.status === "provisional" ? "(일부 잠정)" : ""} · 작성 ${esc(r.asOf)}. 아래 값이 계산기에 그대로 쓰여요. 법령·공단 원문으로 확인하지 못한 항목은 아래에 모두 적었어요.</p></section>
<section class="wrap prose">
<h2>4대보험 요율 (${set.year})</h2>
${wrap(`<table class="tbl"><thead><tr><th scope="col">보험</th><th scope="col">요율</th><th scope="col">근로자</th><th scope="col">사업주</th></tr></thead><tbody>
<tr><th scope="row">국민연금</th><td>${pct(r.nps.rate)}</td><td>${pct(r.nps.rate * r.nps.workerShare)}</td><td>${pct(r.nps.rate * (1 - r.nps.workerShare))}</td></tr>
<tr><th scope="row">건강보험</th><td>${pct(r.nhis.rate)}</td><td>${pct(r.nhis.rate * r.nhis.workerShare)}</td><td>${pct(r.nhis.rate * (1 - r.nhis.workerShare))}</td></tr>
<tr><th scope="row">장기요양</th><td>${pct(r.nhis.ltc.rate)} (건강보험료의 ${(r.nhis.ltc.rate / r.nhis.rate * 100).toFixed(2)}%)</td><td>건강보험료 × ${(r.nhis.ltc.rate / r.nhis.rate * 100).toFixed(2)}% ÷ 2</td><td>동일</td></tr>
<tr><th scope="row">고용보험</th><td>실업급여 ${pct(r.ei.workerRate + r.ei.employerRate)}</td><td>${pct(r.ei.workerRate)}</td><td>${pct(r.ei.employerRate)} + 고용안정·직능개발</td></tr>
<tr><th scope="row">산재보험</th><td>업종별</td><td>없음</td><td>전액 (기본 ${pct(r.wci.defaultRate)})</td></tr>
</tbody></table>`)}
<p class="muted">고용안정·직능개발(사업주): ${stab}</p>
<p>국민연금 기준소득월액 상·하한<br>${lim}</p>
<p>건강보험료 월 상·하한(전체): 하한 ${comma(r.nhis.premiumMin)}원 / 상한 ${comma(r.nhis.premiumMax)}원 · 지역가입자 재산 부과점수당 ${r.nhis.regionalScoreUnitPrice}원</p>

<h2>소득세</h2>
<p>월 원천징수 소득세는 <b>근로소득 간이세액표</b>(소득세법 시행령 별표2, ${esc(w.revision)})를 원문 그대로 사용해요. 월급여 770천원~10,000천원 ${w.bands.length}개 구간 × 공제대상가족 1~11명, 10,000천원 초과는 별표 말미 계산식을 적용해요. 8~20세 자녀 세액공제는 1명 ${comma(w.childCredit.one)}원, 2명 ${comma(w.childCredit.two)}원, 3명부터 1명당 ${comma(w.childCredit.perExtraChild)}원을 더해 빼요. 이 표는 ${esc(set.withholdingFrom)} 시행분이에요.</p>
<h3>종합소득세 기본세율 (소득세법 제55조)</h3>
${wrap(`<table class="tbl"><thead><tr><th scope="col">과세표준 초과</th><th scope="col">과세표준 이하</th><th scope="col" class="amt">세율</th><th scope="col" class="amt">누진공제</th></tr></thead><tbody>${bracket}</tbody></table>`)}
<p class="muted">기본공제 1인 ${comma(r.incomeTax.basicDeductionPerPerson)}원, 표준세액공제 ${comma(r.incomeTax.standardCredit.noEarnedIncome)}원(근로소득 없는 종합소득자), 8세 이상 자녀세액공제 1명 ${comma(r.incomeTax.childCredit.one)}원·2명 ${comma(r.incomeTax.childCredit.two)}원·3명부터 1명당 ${comma(r.incomeTax.childCredit.perExtra)}원. 사업소득 원천징수 ${w33Labels(w33RatesOf(r)).total}(소득세 ${w33Labels(w33RatesOf(r)).income} + 지방소득세 ${w33Labels(w33RatesOf(r)).local}).</p>

<h2>최저임금</h2>
<p>${set.year}년 시간급 ${comma(r.labor.minHourlyWage)}원(월 ${r.labor.monthlyPaidHours}시간 ${comma(r.labor.minHourlyWage * r.labor.monthlyPaidHours)}원).${r.labor.nextYear.minHourlyWage > 0 ? ` ${r.labor.nextYear.year}년은 ${comma(r.labor.nextYear.minHourlyWage)}원으로 확정되어 ${r.labor.nextYear.effectiveFrom}부터 적용돼요.` : ""}</p>

${next}
${watch}

<h2>공식 원문으로 확인하지 못한 항목</h2>
<p>아래는 법령·공단 원문을 직접 확인하지 못해 가정을 둔 부분이에요. 금액 차이가 생기면 <a href="/feedback">알려 주세요</a>.</p>
${wrap(`<table class="tbl"><thead><tr><th scope="col">번호</th><th scope="col">항목</th><th scope="col">현재 가정</th><th scope="col">영향</th></tr></thead><tbody>${un}</tbody></table>`)}

<h2>출처</h2>
<ul class="src">${sources}</ul>
<h3>보관 중인 원문</h3>${files}
<h2>요율 개정 이력</h2>${hist}
</section>`;
}
