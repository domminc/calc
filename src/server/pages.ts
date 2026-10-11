// 페이지 HTML (서버 렌더링). 계산기 화면은 쿼리스트링 입력으로 결과까지 그려서 JS 없이도 동작한다.
import { compute, sanitizeInputs, type CalcKey } from "../render/calculators.ts";
import { renderForm } from "../render/page-forms.ts";
import { comma, esc, hangulWon, wonText } from "../render/html.ts";
import { calcSalary, parseSalaryInput } from "../core/salary.ts";
import { nextSet, resolveRates, todayKst, upcomingFor } from "../core/rates.ts";
import type { Raw } from "../core/inputs.ts";
import { CALCS, seoFor, type Faq } from "./meta.ts";
import { icon, layout } from "./layout.ts";
import { basisBody } from "./basis.ts";
import snapshotJson from "../../data/watch/snapshot.json";

interface Ctx {
  origin: string;
  version: string;
}

// ---------------- 공통 조각 ----------------

function faqHtml(faq: Faq[]): string {
  return `<section class="faq" aria-labelledby="faq-h"><h2 id="faq-h">자주 묻는 질문</h2>${faq
    .map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`)
    .join("")}</section>`;
}

function faqLd(faq: Faq[]): unknown {
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) };
}

function crumbLd(origin: string, items: { name: string; path: string }[]): unknown {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: `${origin}${it.path}` })) };
}

export function toRaw(search: URLSearchParams): Raw {
  const raw: Raw = {};
  for (const [k, v] of search) if (!(k in raw)) raw[k] = v;
  return raw;
}

/** "곧 바뀌는 것" — 다음 연도 세트의 확정·미확정 항목 중 이 계산기에 영향이 있는 것 */
function upcomingBox(key: CalcKey, asOf: string): string {
  const u = upcomingFor(key, asOf);
  if (!u) return "";
  const rows = [...u.confirmed.map((t) => `<span><span class="tag-ok">확정</span>${esc(t)}</span>`), ...u.pending.map((t) => `<span><span class="tag-wait">확정 전</span>${esc(t)}</span>`)];
  const sum = [u.confirmed.length ? `확정 ${u.confirmed.length}건` : "", u.pending.length ? `확정 전 ${u.pending.length}건` : ""].filter(Boolean).join(" · ");
  return `<details class="upcoming"><summary><b>${esc(u.from)}부터 바뀌어요</b><span class="muted">${sum}</span></summary><div class="u-body">${rows.join("")}<a href="/basis#next">확정·미확정 전체 보기</a></div></details>`;
}

// ---------------- 홈 ----------------

export function homePage(c: Ctx): string {
  const rs = resolveRates();
  const y = rs.set.year;
  const r = rs.set.rates;
  const quickAnnual = 40_000_000;
  const quickRaw = { annual: quickAnnual, nonTaxable: r.taxFree.mealMonthly, family: 1, children: 0, asOf: rs.asOf };
  const q = calcSalary(parseSalaryInput(quickRaw).value, rs);
  const ns = nextSet(rs.asOf);
  const lawItems = ns
    ? [...ns.meta.confirmed.slice(0, 2).map((t) => `<li><span class="tag-ok">확정</span><span>${esc(t.item)}</span></li>`), ...ns.meta.pending.slice(0, 1).map((t) => `<li><span class="tag-wait">확정 전</span><span>${esc(t.item)}</span></li>`)].join("")
    : `<li><span class="tag-ok">최신</span><span>${y}년 요율로 계산 중이에요</span></li>`;
  const checked = (snapshotJson as { checkedAt: string }).checkedAt;
  const popular = [3000, 3500, 4000, 4500, 5000, 6000, 7000, 8000, 10000].map((m) => `<a class="pill" href="/salary/table/${m}">${comma(m)}만원</a>`).join("");
  const tile = (key: CalcKey, ico: string, extra = "") => {
    const m = CALCS[key];
    return `<a class="tile t-${key}" href="${m.path}"><span class="t-ico">${icon(ico)}</span><h2>${esc(m.name)}</h2><p>${esc(m.intro.split(". ")[0] ?? m.intro)}</p>${extra}<span class="go">계산하기 ${icon("arrow")}</span></a>`;
  };
  const body = `<section class="hero-home"><div class="wrap hero-grid">
<div class="hero-copy">
<p class="eyebrow"><span class="pill-tag">${icon("spark")}${y}년 기준 · 법이 바뀌면 자동 반영</span></p>
<h1>연봉부터 4대보험까지,<span>정확한 기준으로 계산해요.</span></h1>
<p class="lead">국세청 간이세액표 원문과 공단 요율을 그대로 적용해요. 법령은 매일 확인하고, 어떻게 계산했는지·확인하지 못한 값이 무엇인지도 숨기지 않아요.</p>
<div class="hero-actions"><a class="btn btn-primary" href="/salary">연봉 계산하기 ${icon("arrow")}</a><a class="btn" href="/salary/table">연봉별 실수령액표</a></div>
</div>
<div class="quick card" data-quick data-meal="${r.taxFree.mealMonthly}">
<div class="field"><label for="q-annual">내 연봉 (세전)</label>
<div class="input-wrap"><input id="q-annual" name="q_annual" class="money" type="text" inputmode="numeric" autocomplete="off" value="${comma(quickAnnual)}"><span class="suffix">원</span></div>
<p class="hangul" data-q-hangul>${esc(hangulWon(quickAnnual))}</p>
<input type="range" class="range" data-range-for="q_annual" min="10000000" max="200000000" step="1000000" value="${quickAnnual}" aria-label="연봉 조절 막대"></div>
<div class="quick-out" aria-live="polite"><p class="q-label">월 실수령액 <span data-q-cond>(비과세 ${comma(r.taxFree.mealMonthly)}원 · 부양가족 본인)</span></p><p class="q-net" data-q-net>${wonText(q.netMonthly)}</p><p class="q-sub" data-q-sub>공제 ${wonText(q.totalDeduction)} · 공제율 ${(q.deductionRatio * 100).toFixed(1)}%</p></div>
<a class="btn btn-primary" href="/salary?annual=${quickAnnual}" data-q-link>이 연봉으로 자세히 계산 ${icon("arrow")}</a>
</div>
</div></section>
<section class="wrap"><div class="bento">
<a class="tile t-salary" href="/salary"><span class="t-ico">${icon("salary")}</span><h2>연봉 계산기</h2><p>연봉에서 4대보험과 소득세를 뺀 월 실수령액. 희망 실수령액으로 필요 연봉도 거꾸로 찾아요.</p><span class="mini"><span class="mini-bar" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span class="mini-num">${wonText(q.netMonthly)}</span></span><span class="go">계산하기 ${icon("arrow")}</span></a>
${tile("payroll", "payroll")}
${tile("insurance", "insurance")}
${tile("freelancer", "freelancer")}
${tile("yearend", "yearend")}
<div class="tile t-law"><span class="t-ico">${icon("flag")}</span><h2>법이 바뀌면 계산도 바뀌어요</h2><ul>${lawItems}</ul><p>법령·고시를 매일 확인하고, 시행일이 되면 자동으로 새 기준을 써요. 마지막 확인 ${esc(checked)} · <a href="/basis#watch">감시 현황</a></p></div>
<div class="tile t-stat"><h2>간이세액표 원문 그대로</h2><span class="stat">${rs.set.withholding.bands.length}구간</span><p>소득세는 추정식이 아니라 국세청 표를 조회해요. ${esc(rs.set.withholding.revision.split(" ")[0] ?? "")} 개정.</p></div>
<div class="tile t-table"><h2>자주 찾는 연봉</h2><div class="pills">${popular}</div><a class="go" href="/salary/table">전체 표 보기 ${icon("arrow")}</a></div>
</div></section>`;
  return layout({
    title: `homesell 계산기 — 연봉·급여·4대보험·프리랜서·연말정산 계산기 ${y}`,
    description: "연봉 실수령액, 급여명세서, 4대보험, 프리랜서 원천징수와 종합소득세, 연말정산 환급 예측을 국세청 간이세액표와 공단 요율 그대로 계산해요. 법이 바뀌면 시행일에 맞춰 자동 반영돼요.",
    path: "/",
    origin: c.origin,
    version: c.version,
    body,
    page: "home",
    jsonld: [{ "@context": "https://schema.org", "@type": "WebSite", name: "homesell 계산기", url: c.origin }],
  });
}

// ---------------- 계산기 ----------------

export function calculatorPage(c: Ctx, key: CalcKey, search: URLSearchParams): string {
  const m = CALCS[key];
  const raw = toRaw(search);
  const out = compute(key, raw);
  const form = renderForm(key, raw);
  const query = search.toString();
  const rs = resolveRates();
  const seo = seoFor(key, rs);
  const body = `<section class="wrap page-head"><p class="crumb"><a href="/">홈</a> / ${esc(m.name)}</p><h1>${esc(m.h1)}</h1><p class="lead">${esc(m.intro)}</p>${upcomingBox(key, rs.asOf)}</section>
<section class="wrap calc" data-calc="${key}">
<div class="calc-grid">
<form class="card form" method="get" action="${m.path}" novalidate data-form="${key}">
${form}
<noscript><button class="btn btn-primary" type="submit">계산하기</button></noscript>
</form>
<div class="result-col">
<section id="result" class="card result" aria-live="polite" aria-label="계산 결과" data-result>${out.html}</section>
<div class="actions" data-actions>
<button type="button" class="btn" data-share>${icon("link")}링크 만들기</button>
<a class="btn" data-export="xlsx" href="/api/export/xlsx?c=${key}&${esc(query)}" rel="nofollow">${icon("sheet")}엑셀</a>
<a class="btn" data-export="pdf" href="/api/export/pdf?c=${key}&${esc(query)}" rel="nofollow">${icon("pdf")}PDF</a>
<button type="button" class="btn btn-ghost" data-copy-url>${icon("share")}주소 복사</button>
<a class="btn btn-ghost" href="/feedback?c=${key}">${icon("flag")}값이 달라요</a>
</div>
<p class="share-out" data-share-out hidden></p>
</div>
</div>
</section>
<div class="sticky-bar" data-sticky hidden><span class="sb-label" data-sb-label>${esc(out.summary?.label ?? "")}</span><b class="sb-value" data-sb-value>${esc(out.summary?.value ?? "")}</b><a class="btn btn-small" href="#result">자세히</a></div>
${key === "salary" ? '<p class="wrap muted table-link">연봉 구간별로 한눈에 보려면 <a href="/salary/table">연봉별 실수령액표</a></p>' : ""}
<section class="wrap">${faqHtml(seo.faq)}</section>`;
  return layout({
    title: seo.title,
    description: seo.description,
    path: m.path,
    origin: c.origin,
    version: c.version,
    body,
    current: m.path,
    page: "calc",
    jsonld: [faqLd(seo.faq), crumbLd(c.origin, [{ name: "홈", path: "/" }, { name: m.name, path: m.path }])],
  });
}

// ---------------- 연봉별 실수령액표 ----------------

const BASE_RAW = (annual: number): Raw => ({ annual, nonTaxable: resolveRates().set.rates.taxFree.mealMonthly, family: 1, children: 0, asOf: todayKst() });

export function tableRows(): { man: number; annual: number; net: number; ded: number; ratio: number }[] {
  const rows = [];
  const resolved = resolveRates(todayKst());
  for (let man = 1000; man <= 30000; man += man < 10000 ? 100 : man < 20000 ? 500 : 1000) {
    const p = parseSalaryInput(BASE_RAW(man * 10_000));
    const r = calcSalary(p.value, resolved);
    rows.push({ man, annual: p.value.annual, net: r.netMonthly, ded: r.totalDeduction, ratio: r.deductionRatio });
  }
  return rows;
}

export function tableIndexPage(c: Ctx): string {
  const rs = resolveRates();
  const y = rs.set.year;
  const meal = rs.set.rates.taxFree.mealMonthly;
  const rows = tableRows();
  const tr = rows
    .map((r) => `<tr><th scope="row"><a href="/salary/table/${r.man}">${comma(r.man)}만원</a></th><td class="amt">${wonText(r.net)}</td><td class="amt">${wonText(r.ded)}</td><td class="amt">${(r.ratio * 100).toFixed(1)}%</td></tr>`)
    .join("");
  const body = `<section class="wrap page-head"><p class="crumb"><a href="/">홈</a> / <a href="/salary">연봉 계산기</a> / 실수령액표</p><h1>연봉별 월 실수령액표 (${y})</h1>
<p class="lead">비과세 월 ${comma(meal)}원, 부양가족 본인 1명, 퇴직금 별도 기준이에요. 내 조건으로 바꾸려면 <a href="/salary">연봉 계산기</a>를 사용하세요.</p></section>
<section class="wrap"><div class="card pad"><div class="tbl-wrap" tabindex="0" role="region" aria-label="표 (옆으로 스크롤할 수 있어요)"><table class="tbl tbl-table"><thead><tr><th scope="col">연봉</th><th scope="col" class="amt">월 실수령액</th><th scope="col" class="amt">월 공제액</th><th scope="col" class="amt">공제율</th></tr></thead><tbody>${tr}</tbody></table></div></div></section>`;
  return layout({
    title: `연봉별 월 실수령액표 ${y} — 3000만원~3억 | homesell 계산기`,
    description: `연봉 1,000만원부터 3억원까지 월 실수령액과 공제액을 표로 정리했어요. 국세청 간이세액표와 ${y}년 4대보험 요율 기준이에요.`,
    path: "/salary/table",
    origin: c.origin,
    version: c.version,
    body,
    current: "/salary",
    script: false,
    jsonld: [crumbLd(c.origin, [{ name: "홈", path: "/" }, { name: "연봉 계산기", path: "/salary" }, { name: "연봉별 실수령액표", path: "/salary/table" }])],
  });
}

export function isTableMan(n: number): boolean {
  return Number.isInteger(n) && n >= 1000 && n <= 30000 && n % 100 === 0;
}

export function tableDetailPage(c: Ctx, man: number): string {
  const rs = resolveRates();
  const y = rs.set.year;
  const raw = BASE_RAW(man * 10_000);
  const out = compute("salary", raw);
  const r = calcSalary(parseSalaryInput(raw).value, rs);
  const prev = man - 100 >= 1000 ? man - 100 : null;
  const next = man + 100 <= 30000 ? man + 100 : null;
  const meal = rs.set.rates.taxFree.mealMonthly;
  const faq: Faq[] = [
    { q: `연봉 ${comma(man)}만원의 월 실수령액은 얼마인가요?`, a: `비과세 월 ${comma(meal)}원, 부양가족 본인 1명, 퇴직금 별도 기준으로 월 ${wonText(r.netMonthly)}(공제 ${wonText(r.totalDeduction)})이에요.` },
    { q: `연봉 ${comma(man)}만원의 4대보험료는 얼마인가요?`, a: `국민연금 ${wonText(r.insurance.rows[0]!.worker)}, 건강보험 ${wonText(r.insurance.rows[1]!.worker)}, 장기요양 ${wonText(r.insurance.rows[2]!.worker)}, 고용보험 ${wonText(r.insurance.rows[3]!.worker)}를 매달 내요.` },
    { q: "소득세는 어떤 기준인가요?", a: `국세청 근로소득 간이세액표(${rs.set.withholding.revision.split(" ")[0]} 개정)의 월 원천징수액이에요. 연말정산 결과와는 달라질 수 있어요.` },
  ];
  const nav = `<div class="pills">${prev ? `<a class="pill" href="/salary/table/${prev}">← ${comma(prev)}만원</a>` : ""}<a class="pill" href="/salary/table">전체 표</a>${next ? `<a class="pill" href="/salary/table/${next}">${comma(next)}만원 →</a>` : ""}</div>`;
  const body = `<section class="wrap page-head"><p class="crumb"><a href="/">홈</a> / <a href="/salary">연봉 계산기</a> / <a href="/salary/table">실수령액표</a> / ${comma(man)}만원</p><h1>연봉 ${comma(man)}만원 실수령액 (${y})</h1>
<p class="lead">월 <b>${wonText(r.netMonthly)}</b>, 연 환산 ${wonText(r.netAnnual)}이에요. (${esc(hangulWon(r.input.annual))}, 비과세 ${comma(meal)}원·부양가족 1명 기준)</p></section>
<section class="wrap"><section id="result" class="card result">${out.html}</section>
<p class="muted center"><a class="btn btn-primary" href="/salary?annual=${man * 10_000}">내 조건으로 계산하기</a></p>${nav}</section>
<section class="wrap">${faqHtml(faq)}</section>`;
  return layout({
    title: `연봉 ${comma(man)}만원 실수령액 ${y} — 월 ${comma(r.netMonthly)}원 | homesell 계산기`,
    description: `연봉 ${comma(man)}만원의 월 실수령액은 ${comma(r.netMonthly)}원이에요. 국민연금 ${comma(r.insurance.rows[0]!.worker)}원, 건강보험 ${comma(r.insurance.rows[1]!.worker)}원, 소득세 ${comma(r.incomeTax)}원 등 공제 내역을 확인하세요.`,
    path: `/salary/table/${man}`,
    origin: c.origin,
    version: c.version,
    body,
    current: "/salary",
    script: false,
    jsonld: [faqLd(faq), crumbLd(c.origin, [{ name: "홈", path: "/" }, { name: "연봉 계산기", path: "/salary" }, { name: "연봉별 실수령액표", path: "/salary/table" }, { name: `${comma(man)}만원`, path: `/salary/table/${man}` }])],
  });
}

// ---------------- 공유 결과 ----------------

export function sharedPage(c: Ctx, id: string, key: CalcKey, inputs: Record<string, string>, expiresAt: string, ratesYear: number): string {
  const m = CALCS[key];
  const out = compute(key, inputs);
  const q = new URLSearchParams(sanitizeInputs(key, inputs)).toString();
  const body = `<section class="wrap page-head"><p class="crumb"><a href="/">홈</a> / 공유된 ${esc(m.name)} 결과</p><h1>공유된 ${esc(m.name)} 결과</h1>
<p class="lead">${ratesYear}년 기준으로 저장된 입력을 다시 계산한 결과예요. ${esc(expiresAt.slice(0, 10))}까지 보관돼요.</p></section>
<section class="wrap"><section id="result" class="card result">${out.html}</section>
<p class="center"><a class="btn btn-primary" href="${m.path}?${esc(q)}">이 입력으로 다시 계산하기</a></p></section>`;
  return layout({ title: `공유된 ${m.name} 결과 | homesell 계산기`, description: `${m.name} 공유 결과`, path: `/r/${id}`, origin: c.origin, version: c.version, body, noindex: true, script: false, current: m.path });
}

// ---------------- 기준 / 신고 / 오류 ----------------

export function basisPage(c: Ctx, history: { year: number; version: string; effective_from: string; created_at: string }[] | null, sourceFiles: { name: string; href: string }[]): string {
  const y = resolveRates().set.year;
  return layout({
    title: `계산 기준·요율표·출처 ${y} | homesell 계산기`,
    description: `homesell 계산기가 사용하는 ${y}년 요율, 계산식, 법령·공단 출처와 법령 변경 감시 현황, 공식 원문으로 확인하지 못한 항목을 공개해요.`,
    path: "/basis",
    origin: c.origin,
    version: c.version,
    body: basisBody(history, sourceFiles),
    current: "/basis",
    script: false,
  });
}

export function feedbackPage(c: Ctx, calc: string, status: "ok" | "error" | null, message?: string): string {
  const opts = [["other", "기타"], ...Object.values(CALCS).map((m) => [m.key, m.name])]
    .map(([v, l]) => `<option value="${v}"${v === calc ? " selected" : ""}>${esc(l)}</option>`)
    .join("");
  const notice = status === "ok" ? `<p class="notice notice-info" role="status">접수되었어요. 확인 후 반영할게요.</p>` : status === "error" ? `<p class="notice notice-warn" role="alert">${esc(message ?? "접수하지 못했어요. 잠시 후 다시 시도해 주세요.")}</p>` : "";
  const body = `<section class="wrap page-head"><p class="crumb"><a href="/">홈</a> / 오류·불일치 신고</p><h1>값이 다르거나 오류가 있나요?</h1>
<p class="lead">월급명세서나 공단 고지서와 금액이 다르면 알려 주세요. 어떤 값이 얼마로 다른지 적어 주시면 가장 빨리 확인할 수 있어요. 주민번호 등 개인정보는 적지 마세요.</p></section>
<section class="wrap"><form class="card form narrow" method="post" action="/api/feedback" data-feedback>
${notice}
<div class="field"><label for="f-calculator">계산기</label><select id="f-calculator" name="calculator">${opts}</select></div>
<div class="field"><label for="f-message">내용 <span class="opt">(2,000자 이내)</span></label><textarea id="f-message" name="message" rows="6" maxlength="2000" required placeholder="예) 연봉 4,000만원, 부양가족 1명으로 계산했는데 건강보험이 명세서와 20원 달라요."></textarea></div>
<div class="field"><label for="f-contact">답변 받을 연락처 <span class="opt">(선택)</span></label><input id="f-contact" name="contact" type="text" maxlength="200" placeholder="이메일"></div>
<input type="hidden" name="page_url" value="">
<button class="btn btn-primary" type="submit">보내기</button>
</form></section>`;
  return layout({ title: "오류·불일치 신고 | homesell 계산기", description: "계산 결과가 다를 때 알려 주세요.", path: "/feedback", origin: c.origin, version: c.version, body, noindex: true, current: "", page: "feedback" });
}

export function notFoundPage(c: Ctx): string {
  const body = `<section class="wrap page-head"><h1>페이지를 찾을 수 없어요</h1><p class="lead">주소가 바뀌었거나 만료된 링크일 수 있어요. 계산기를 직접 열어 보세요.</p>
<div class="pills">${Object.values(CALCS).map((m) => `<a class="pill" href="${m.path}">${esc(m.name)}</a>`).join("")}</div></section>`;
  return layout({ title: "페이지를 찾을 수 없어요 | homesell 계산기", description: "페이지를 찾을 수 없어요.", path: "/404", origin: c.origin, version: c.version, body, noindex: true, script: false });
}
