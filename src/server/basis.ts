// /basis — 요율표·출처·미확정 항목. 값은 data/rates/2026/rates.json 에서 읽어 와서 문서와 화면이 어긋나지 않게 한다.
import { esc, comma } from "../render/html.ts";
import { pct } from "../core/money.ts";
import { resolveRates } from "../core/rates.ts";

const UNVERIFIED: { id: string; item: string; assumption: string; impact: string }[] = [
  { id: "U1", item: "국민연금 보험료 단수처리", assumption: "10원 미만 절사", impact: "±10원" },
  { id: "U2", item: "건강보험료 근로자 반분 시 단수", assumption: "전체 보험료(상·하한 적용) ÷ 2 후 10원 미만 절사", impact: "±10원" },
  { id: "U3", item: "고용보험료 단수처리", assumption: "10원 미만 절사", impact: "±10원" },
  { id: "U4", item: "산재보험 평균 요율 1.47%", assumption: "업종별 요율을 직접 입력하는 것을 권장", impact: "사업주 부담만" },
  { id: "U5", item: "3.3% 원천징수 단수", assumption: "소득세·지방소득세 각각 원 미만 절사", impact: "±수 원" },
  { id: "U6", item: "단순경비율 기본값 64.1%", assumption: "예시값(940909). 업종별 고시값으로 직접 입력", impact: "프리랜서 세액" },
  { id: "U7", item: "건강보험료 상·하한 (월 20,160원 / 9,183,480원)", assumption: "언론 보도 수치. 보건복지부 고시 원문 대조 전", impact: "극단 소득에서만" },
  { id: "U8", item: "간이세액표 10,000천원 초과 구간 단수", assumption: "별표2 말미 계산식 결과를 10원 미만 절사", impact: "월 급여 1,000만원 초과에서 ±10원" },
];

export function basisBody(history: { year: number; version: string; effective_from: string; created_at: string }[] | null, sourceFiles: { name: string; href: string }[]): string {
  const { set } = resolveRates();
  const r = set.rates;
  const w = set.withholding;
  const lim = r.nps.limits.map((l) => `${l.from} ~ : 하한 ${comma(l.min)}원 · 상한 ${comma(l.max)}원`).join("<br>");
  const stab = r.ei.stabilization.map((s) => `${esc(s.label)} ${pct(s.rate)}`).join(" · ");
  const sources = Object.entries(r.sources)
    .map(([id, s]) => `<li><b>${id}</b> <a href="${esc(s.url)}" rel="noopener noreferrer" target="_blank">${esc(s.title)}</a></li>`)
    .join("");
  const bracket = r.incomeTax.brackets
    .map((b, i, a) => `<tr><td>${i === 0 ? "0" : comma(a[i - 1]!.upTo!)}원 초과</td><td>${b.upTo ? `${comma(b.upTo)}원 이하` : "—"}</td><td class="amt">${pct(b.rate)}</td><td class="amt">${comma(b.deduction)}원</td></tr>`)
    .join("");
  const un = UNVERIFIED.map((u) => `<tr><td>${u.id}</td><td>${esc(u.item)}</td><td>${esc(u.assumption)}</td><td>${esc(u.impact)}</td></tr>`).join("");
  const hist = history
    ? history.length
      ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">연도</th><th scope="col">버전</th><th scope="col">시행</th><th scope="col">기록일</th></tr></thead><tbody>${history
          .map((h) => `<tr><td>${h.year}</td><td><code>${esc(h.version)}</code></td><td>${esc(h.effective_from)}</td><td>${esc(h.created_at.slice(0, 10))}</td></tr>`)
          .join("")}</tbody></table></div>`
      : `<p class="muted">기록이 아직 없어요.</p>`
    : `<p class="muted">이력을 불러오지 못했어요.</p>`;
  const files = sourceFiles.length
    ? `<ul>${sourceFiles.map((f) => `<li><a href="${esc(f.href)}">${esc(f.name)}</a></li>`).join("")}</ul>`
    : `<p class="muted">보관 중인 원문 파일 목록을 불러오지 못했어요.</p>`;
  return `<section class="wrap page-head"><p class="crumb"><a href="/">홈</a> / 계산 기준</p><h1>계산 기준 · 요율표 · 출처</h1>
<p class="lead">${set.year}년 기준(작성 ${esc(r.asOf)}). 아래 값이 계산기에 그대로 쓰여요. 법령·공단 원문으로 확인하지 못한 항목은 맨 아래에 모두 적었어요.</p></section>
<section class="wrap prose">
<h2>4대보험 요율 (${set.year})</h2>
<div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">보험</th><th scope="col">요율</th><th scope="col">근로자</th><th scope="col">사업주</th></tr></thead><tbody>
<tr><th scope="row">국민연금</th><td>${pct(r.nps.rate)}</td><td>${pct(r.nps.rate * r.nps.workerShare)}</td><td>${pct(r.nps.rate * (1 - r.nps.workerShare))}</td></tr>
<tr><th scope="row">건강보험</th><td>${pct(r.nhis.rate)}</td><td>${pct(r.nhis.rate * r.nhis.workerShare)}</td><td>${pct(r.nhis.rate * (1 - r.nhis.workerShare))}</td></tr>
<tr><th scope="row">장기요양</th><td>${pct(r.nhis.ltc.rate)} (건강보험료의 ${(r.nhis.ltc.rate / r.nhis.rate * 100).toFixed(2)}%)</td><td>건강보험료 × ${(r.nhis.ltc.rate / r.nhis.rate * 100).toFixed(2)}% ÷ 2</td><td>동일</td></tr>
<tr><th scope="row">고용보험</th><td>실업급여 ${pct(r.ei.workerRate + r.ei.employerRate)}</td><td>${pct(r.ei.workerRate)}</td><td>${pct(r.ei.employerRate)} + 고용안정·직능개발</td></tr>
<tr><th scope="row">산재보험</th><td>업종별</td><td>없음</td><td>전액 (기본 ${pct(r.wci.defaultRate)})</td></tr>
</tbody></table></div>
<p class="muted">고용안정·직능개발(사업주): ${stab}</p>
<p>국민연금 기준소득월액 상·하한<br>${lim}</p>
<p>건강보험료 월 상·하한(전체): 하한 ${comma(r.nhis.premiumMin)}원 / 상한 ${comma(r.nhis.premiumMax)}원 · 지역가입자 재산 부과점수당 ${r.nhis.regionalScoreUnitPrice}원</p>

<h2>소득세</h2>
<p>월 원천징수 소득세는 <b>근로소득 간이세액표</b>(소득세법 시행령 별표2, ${esc(w.revision)})를 원문 그대로 사용해요. 월급여 770천원~10,000천원 ${w.bands.length}개 구간 × 공제대상가족 1~11명, 10,000천원 초과는 별표 말미 계산식을 적용해요. 8~20세 자녀 세액공제는 1명 ${comma(w.childCredit.one)}원, 2명 ${comma(w.childCredit.two)}원, 3명부터 1명당 ${comma(w.childCredit.perExtraChild)}원을 더해 빼요.</p>
<h3>종합소득세 기본세율 (소득세법 제55조)</h3>
<div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">과세표준 초과</th><th scope="col">과세표준 이하</th><th scope="col" class="amt">세율</th><th scope="col" class="amt">누진공제</th></tr></thead><tbody>${bracket}</tbody></table></div>
<p class="muted">기본공제 1인 150만원, 표준세액공제 7만원(근로소득 없는 종합소득자), 8세 이상 자녀세액공제 1명 25만원·2명 55만원·3명부터 1명당 40만원.</p>

<h2>최저임금</h2>
<p>${set.year}년 시간급 ${comma(r.labor.minHourlyWage)}원(월 209시간 ${comma(r.labor.minHourlyWage * 209)}원). ${r.labor.nextYear.year}년은 ${comma(r.labor.nextYear.minHourlyWage)}원으로 확정되어 ${r.labor.nextYear.effectiveFrom}부터 적용돼요.</p>

<h2>공식 원문으로 확인하지 못한 항목</h2>
<p>아래는 법령·공단 원문을 직접 확인하지 못해 가정을 둔 부분이에요. 금액 차이가 생기면 <a href="/feedback">알려 주세요</a>.</p>
<div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col">번호</th><th scope="col">항목</th><th scope="col">현재 가정</th><th scope="col">영향</th></tr></thead><tbody>${un}</tbody></table></div>

<h2>출처</h2>
<ul class="src">${sources}</ul>
<h3>보관 중인 원문</h3>${files}
<h2>요율 개정 이력</h2>${hist}
</section>`;
}
