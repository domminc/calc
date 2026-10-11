// 연말정산 입력 폼. 안내 문구의 법령 숫자는 모두 data/rates 의 yearend 에서 읽는다.
import type { FieldErrors } from "../core/types.ts";
import { SUPPORTED_YEARS, resolveRates } from "../core/rates.ts";
import { pct } from "../core/money.ts";
import { MAX_DEPS, type YearendInput } from "../core/yearend-input.ts";
import type { Dep, PersonInput } from "../core/yearend.ts";
import { comma, esc } from "./html.ts";
import { check, dateInput, money, segmented, select, stepper } from "./forms.ts";

type Errors = FieldErrors;

const REL_LABEL: Record<string, string> = { child: "자녀", parent: "부모·조부모", spouse: "배우자" };

/** 부양가족 행 하나 (서버 렌더와 브라우저 '추가' 버튼이 같이 쓴다) */
export function depRow(n: number, d: Dep, errors: Errors, year: number): string {
  const k = (f: string) => `d${n}_${f}`;
  const amt = (f: string, label: string, key: "medical" | "education" | "premium" | "credit" | "debit", when?: { rels: string }) => {
    const name = k(f);
    const v = d[key];
    const w = when ? ` data-when="${k("rel")}=${when.rels}"${when.rels.split("|").includes(d.rel) ? "" : " hidden"}` : "";
    return `<div class="dep-amt${errors[name] ? " has-error" : ""}"${w}><label for="f-${name}">${esc(label)}</label><div class="input-wrap"><input id="f-${name}" name="${name}" class="money" type="text" inputmode="numeric" autocomplete="off" value="${v ? comma(v) : ""}" placeholder="0"><span class="suffix">원</span></div><p class="field-error" id="e-${name}" role="alert"${errors[name] ? "" : " hidden"}>${esc(errors[name] ?? "")}</p></div>`;
  };
  const relErr = errors[k("rel")];
  const yearErr = errors[k("year")];
  return `<div class="dep-row" data-dep-row>
<div class="dep-head">
<div class="dep-rel${relErr ? " has-error" : ""}"><label class="sr" for="f-${k("rel")}">관계</label><select id="f-${k("rel")}" name="${k("rel")}">${(["child", "parent", "spouse"] as const).map((r) => `<option value="${r}"${r === d.rel ? " selected" : ""}>${REL_LABEL[r]}</option>`).join("")}</select><p class="field-error" id="e-${k("rel")}" role="alert"${relErr ? "" : " hidden"}>${esc(relErr ?? "")}</p></div>
<div class="dep-year${yearErr ? " has-error" : ""}" data-when="${k("rel")}=child|parent"${d.rel === "spouse" ? " hidden" : ""}><label class="sr" for="f-${k("year")}">출생연도</label><div class="input-wrap"><input id="f-${k("year")}" name="${k("year")}" type="text" inputmode="numeric" autocomplete="off" value="${d.rel === "spouse" ? "" : d.year || year - 10}" placeholder="출생연도"><span class="suffix">년생</span></div><p class="field-error" id="e-${k("year")}" role="alert"${yearErr ? "" : " hidden"}>${esc(yearErr ?? "")}</p></div>
<label class="check small"><input type="hidden" name="${k("hi")}" value="0"><input type="checkbox" name="${k("hi")}" value="1"${d.highIncome ? " checked" : ""}><span>연 소득 100만원 초과</span></label>
<button type="button" class="btn btn-ghost icon-btn" data-remove-dep aria-label="부양가족 삭제">삭제</button>
</div>
<div class="dep-amts">${amt("med", "의료비", "medical")}${amt("edu", "교육비(자녀)", "education", { rels: "child" })}${amt("prem", "보장성 보험료", "premium")}${amt("cc", "신용카드", "credit")}${amt("dc", "체크·현금영수증", "debit")}</div>
</div>`;
}

type Y = ReturnType<typeof resolveRates>["set"]["rates"]["yearend"];

function personFields(p: "a_" | "b_", v: PersonInput, errors: Errors, y: Y, tab: "me" | "couple"): string {
  const m = (field: string, label: string, value: number, hint?: string) => money({ name: p + field, label, value, errors, ...(hint ? { hint } : {}), hangul: false });
  const adv = (field: string, label: string, value: number | undefined, hint: string) =>
    money({ name: p + field, label, value: value === undefined ? "" : value, errors, hint, hangul: false, optional: true });
  return `${money({ name: `${p}gross`, label: "연 총급여 (세전, 비과세 포함)", value: v.gross, errors, slider: { min: 10_000_000, max: 200_000_000, step: 1_000_000 }, hint: "원천징수영수증·급여명세서의 연간 지급 총액이에요. 상여·성과급도 포함하세요." })}
${money({ name: `${p}nt`, label: "연 비과세 합계", value: v.nonTaxable, errors, hint: "식대·자가운전보조금 등. 총급여에서 빠져요.", hangul: false })}
<details class="more"><summary>카드·현금영수증 사용액 (연간)</summary>
${m("cc", "신용카드", v.credit, `총급여의 ${pct(y.card.minRatio)}를 넘는 부분부터 공제돼요. 해외 사용분·자동차 구입비는 빼세요.`)}
${m("dc", "체크카드·현금영수증", v.debit)}
${m("mk", "전통시장", v.market)}
${m("tr", "대중교통", v.transit)}
${m("cu", "도서·공연·박물관·영화·체육시설", v.culture, `총급여 ${comma(y.card.highSalary)}원 이하일 때만 우대돼요.`)}
</details>
<details class="more"><summary>의료비·교육비·보험료 (본인분)</summary>
${m("med", "본인 의료비", v.medical, "실손보험으로 돌려받은 금액은 빼세요. 미용·성형은 제외예요.")}
<div data-when="tab=couple"${tab === "couple" ? "" : " hidden"}>${m("medsp", "배우자를 위해 내가 낸 의료비", v.medicalSpouse, "의료비는 낸 사람이 공제받아요.")}</div>
${m("edu", "본인 교육비", v.education, "대학원·직업훈련 등. 자녀 교육비는 부양가족에 넣으세요.")}
${m("prem", "보장성 보험료", v.premium, `보장성 보험만 해당(저축성 제외). 연 ${comma(y.insurance.cap)}원까지 반영돼요.`)}
</details>
<details class="more"><summary>기부금 (연간)</summary>
${m("dl", "특례기부금", v.donLegal, "국가·지자체·국방헌금·수재의연금 등")}
${m("dg", "일반기부금 (종교단체 제외)", v.donGeneral, "사회복지·학교·공익법인 등")}
${m("dr", "종교단체 기부금", v.donReligious)}
${m("hs", "고향사랑 기부금", v.hometown, `${comma(y.hometown.tier1)}원까지는 전액 세액공제돼요.`)}
</details>
<details class="more"><summary>연금저축·주택·월세</summary>
${m("ps", "연금저축 납입액", v.pensionSavings, `연금저축은 연 ${comma(y.pension.savingsCap)}원, IRP·퇴직연금을 합쳐 연 ${comma(y.pension.totalCap)}원까지 공제돼요.`)}
${m("irp", "IRP·퇴직연금 납입액", v.irp)}
${m("hsv", "주택청약저축 납입액", v.housingSavings, `총급여 ${comma(y.housingSavings.salaryLimit)}원 이하 무주택 세대주만 해당.`)}
${m("rent", "월세 지급액 (연간)", v.rent, `총급여 ${comma(y.rent.salaryLimit)}원 이하 무주택 세대주만 해당. 월세 공제를 받으면 표준세액공제는 받을 수 없어요.`)}
${check({ name: `${p}nh`, label: "무주택 세대주예요 (월세·주택청약 공제 요건)", checked: v.noHome })}
<div class="field"><label for="f-${p}birth">올해 출산·입양한 자녀</label><select id="f-${p}birth" name="${p}birth">${[["0", "없음"], ["1", "첫째"], ["2", "둘째"], ["3", "셋째 이상"]].map(([val, t]) => `<option value="${val}"${String(v.birthChild) === val ? " selected" : ""}>${t}</option>`).join("")}</select></div>
</details>
<details class="more"><summary>4대보험·이미 낸 세금 직접 입력 (선택)</summary>
<p class="hint">비워 두면 총급여로 추정해요. 연말정산 간소화·급여명세서 합계를 넣으면 더 정확해요.</p>
${adv("nps", "연 국민연금 납부액", v.npsOverride, "급여명세서의 국민연금 × 12")}
${adv("hi", "연 건강·장기요양·고용보험료", v.healthOverride, "세 보험료 합계 × 12")}
${adv("tax", "올해 이미 낸 소득세 (원천징수 합계)", v.prepaidOverride, "급여명세서의 소득세 합계. 지방소득세는 자동으로 계산해요.")}
<div class="two">${stepper({ name: `${p}wf`, label: "공제대상가족 수", value: v.wFamily, min: 1, max: 20, unit: "명", hint: "본인 포함", errors })}${stepper({ name: `${p}wc`, label: "8~20세 자녀 수", value: v.wChildren, min: 0, max: 10, unit: "명", hint: "그중 자녀", errors })}</div>
<p class="hint">두 칸은 이미 낸 소득세를 비웠을 때만 쓰여요. 회사에 낸 '부양가족 공제 신고서' 기준이에요.</p>
</details>`;
}

export function yearendForm(i: YearendInput, errors: Errors): string {
  const y = resolveRates(`${i.year}-12-31`).set.rates.yearend;
  const couple = i.tab === "couple";
  const depRows = i.deps.map((d, n) => depRow(n, d, errors, i.year)).join("");
  return `${segmented({ name: "tab", label: "무엇을 확인할까요?", value: i.tab, options: [{ value: "me", label: "내 연말정산 예측" }, { value: "couple", label: "부부 중 누가 공제받을까" }] })}
${select({ name: "year", label: "귀속연도 (소득을 번 해)", value: String(i.year), options: SUPPORTED_YEARS.map((v) => ({ value: String(v), label: `${v}년 소득` })), hint: "올해 번 소득의 연말정산은 내년 2월 급여에서 정산돼요." })}
<div class="grp-title" data-when="tab=couple"${couple ? "" : " hidden"}><b>나</b></div>
${personFields("a_", i.a, errors, y, i.tab)}
<div class="deps" data-deps data-max="${MAX_DEPS}">
<div class="allow-head"><b>부양가족</b><span class="hint" data-when="tab=me"${couple ? " hidden" : ""}>배우자·자녀·부모를 넣으면 인적공제와 가족 지출 공제가 반영돼요.</span><span class="hint" data-when="tab=couple"${couple ? "" : " hidden"}>자녀·부모를 넣으면 누가 공제받는 게 유리한지 비교해요.</span></div>
<div data-dep-rows>${depRows}</div>
<div class="allow-actions"><button type="button" class="btn btn-ghost" data-add-dep>+ 부양가족 추가</button></div>
<p class="hint">자녀 20세 이하·부모 60세 이상, 연 소득금액 100만원(총급여 500만원) 이하만 기본공제 대상이에요. 나이는 출생연도로 판정해요.</p>
</div>
<div data-when="tab=couple"${couple ? "" : " hidden"}>
<div class="grp-title"><b>배우자</b></div>
${personFields("b_", i.b, errors, y, i.tab)}
<div class="grp-title"><b>부부 공동 카드 지출</b></div>
<p class="hint">생활비처럼 누구 카드로 써도 되는 지출이에요. 어느 쪽 카드로 쓰는 게 유리한지 같이 비교해요.</p>
${money({ name: "sc", label: "공동 신용카드 지출 (연간)", value: i.sharedCredit, errors, hangul: false })}
${money({ name: "sd", label: "공동 체크카드·현금영수증 지출 (연간)", value: i.sharedDebit, errors, hangul: false })}
</div>
<details class="more"><summary>고급 설정 (기준일)</summary>
${dateInput({ name: "asOf", label: "기준일", value: i.asOf, errors, hint: "귀속연도를 직접 고르지 않았을 때 기준이 돼요." })}
</details>`;
}
