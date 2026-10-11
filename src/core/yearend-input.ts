// 연말정산 입력 해석. 서버(쿼리스트링·공유 JSON)와 브라우저(폼)가 같은 규칙을 쓴다.
import { SUPPORTED_YEARS, resolveRates, todayKst } from "./rates.ts";
import type { FieldErrors, Parsed } from "./types.ts";
import { dateField, intField, parsed, toBool, toNumber, type Raw } from "./inputs.ts";
import type { Dep, PersonInput, PersonKind, Relation } from "./yearend.ts";

export type YearendTab = "me" | "couple";

export const MAX_DEPS = 6;
export const RELATIONS: readonly Relation[] = ["spouse", "child", "parent"];

export interface YearendInput {
  tab: YearendTab;
  /** 귀속연도 (소득을 번 해) */
  year: number;
  asOf: string;
  a: PersonInput;
  b: PersonInput;
  deps: Dep[];
  /** 부부 비교: 어느 쪽 카드로 써도 되는 공동 지출 */
  sharedCredit: number;
  sharedDebit: number;
}

const MONEY_MAX = 100_000_000_000;

/** 1~2월에 열면 직전 연도(정산 중인 해), 그 밖에는 올해를 귀속연도로 본다 */
export function defaultTaxYear(asOf: string): number {
  const y = Number(asOf.slice(0, 4));
  const m = Number(asOf.slice(5, 7));
  const guess = m <= 2 ? y - 1 : y;
  const min = Math.min(...SUPPORTED_YEARS);
  const max = Math.max(...SUPPORTED_YEARS);
  return Math.min(Math.max(guess, min), max);
}

function personFrom(raw: Raw, p: "a_" | "b_", def: { gross: number; nonTaxable: number; expenseRate: number }, allowKind: boolean, errors: FieldErrors, adjusted: string[]): PersonInput {
  const m = (field: string, label: string, d = 0): number => intField(raw, { field: p + field, label, def: d, min: 0, max: MONEY_MAX, errors });
  const opt = (field: string, label: string): number | undefined => {
    const n = toNumber(raw[p + field]);
    if (n === undefined) return undefined;
    if (Number.isNaN(n) || n < 0 || !Number.isInteger(n)) {
      errors[p + field] = `${label}은(는) 0 이상의 정수로 입력해 주세요.`;
      return undefined;
    }
    return n;
  };
  const gross = intField(raw, { field: `${p}gross`, label: "연 총급여", required: true, def: def.gross, min: 0, max: MONEY_MAX, errors });
  let nonTaxable = intField(raw, { field: `${p}nt`, label: "연 비과세", def: def.nonTaxable, min: 0, max: MONEY_MAX, errors });
  if (nonTaxable > gross) {
    adjusted.push("비과세액이 총급여보다 커서 총급여까지만 반영했어요.");
    nonTaxable = gross;
  }
  let wFamily = intField(raw, { field: `${p}wf`, label: "신고한 공제대상가족 수", def: 1, min: 1, max: 20, errors });
  let wChildren = intField(raw, { field: `${p}wc`, label: "신고한 8~20세 자녀 수", def: 0, min: 0, max: 10, errors });
  if (wChildren > wFamily - 1) {
    wFamily = Math.min(wChildren + 1, 20);
    wChildren = Math.min(wChildren, 10);
  }
  const kind: PersonKind = allowKind && raw[`${p}kind`] === "freelancer" ? "freelancer" : "worker";
  const fl = kind === "freelancer";
  // 프리랜서(사업소득) 전용 입력
  const revenue = fl ? intField(raw, { field: `${p}rev`, label: "연 수입금액", required: true, def: 36_000_000, min: 0, max: MONEY_MAX, errors }) : 0;
  const expenseMode = raw[`${p}xm`] === "actual" ? "actual" : "rate";
  let expenseRate = def.expenseRate;
  const xr = fl ? toNumber(raw[`${p}xr`]) : undefined;
  if (xr !== undefined) {
    if (Number.isNaN(xr) || xr < 0 || xr > 100) errors[`${p}xr`] = "경비율은 0~100% 사이로 입력해 주세요.";
    else expenseRate = xr / 100;
  }
  const actualExpense = fl ? intField(raw, { field: `${p}xa`, label: "실제 경비", def: 0, min: 0, max: MONEY_MAX, errors }) : 0;
  const bc = Number(raw[`${p}${fl ? "fbirth" : "birth"}`]);
  const birthChild = (bc === 1 || bc === 2 || bc === 3 ? bc : 0) as 0 | 1 | 2 | 3;
  return {
    kind, revenue, expenseMode, expenseRate, actualExpense,
    gross,
    nonTaxable,
    npsOverride: fl ? opt("fnps", "국민연금") : opt("nps", "국민연금"),
    healthOverride: opt("hi", "건강·고용·장기요양보험료"),
    prepaidOverride: fl ? opt("ftax", "이미 낸 소득세") : opt("tax", "이미 낸 소득세"),
    wFamily,
    wChildren,
    credit: m("cc", "신용카드 사용액"),
    debit: m("dc", "체크카드·현금영수증 사용액"),
    market: m("mk", "전통시장 사용액"),
    transit: m("tr", "대중교통 사용액"),
    culture: m("cu", "문화체육 사용액"),
    medical: m("med", "본인 의료비"),
    medicalSpouse: m("medsp", "배우자 의료비"),
    education: m("edu", "본인 교육비"),
    premium: m("prem", "보장성 보험료"),
    donLegal: m("dl", "특례기부금"),
    donGeneral: m("dg", "일반기부금"),
    donReligious: m("dr", "종교단체 기부금"),
    hometown: m("hs", "고향사랑 기부금"),
    pensionSavings: fl ? m("fps", "연금저축 납입액") : m("ps", "연금저축 납입액"),
    irp: fl ? m("firp", "IRP·퇴직연금 납입액") : m("irp", "IRP·퇴직연금 납입액"),
    housingSavings: m("hsv", "주택청약저축 납입액"),
    rent: m("rent", "월세 지급액"),
    noHome: toBool(raw[`${p}nh`]),
    birthChild,
  };
}

export function parseYearendInput(raw: Raw): Parsed<YearendInput> {
  const errors: FieldErrors = {};
  const adjusted: string[] = [];
  const asOf = dateField(raw, "asOf", todayKst(), errors);
  const tab: YearendTab = raw.tab === "couple" ? "couple" : "me";

  const defYear = defaultTaxYear(asOf);
  let year = defYear;
  const yr = toNumber(raw.year);
  if (yr !== undefined) {
    if (Number.isNaN(yr) || !SUPPORTED_YEARS.includes(yr)) errors.year = `귀속연도는 ${SUPPORTED_YEARS.join("·")}년 중에서 골라 주세요.`;
    else year = yr;
  }

  // 기본 비과세 = 식대 월 한도 × 12 (data/rates 의 값)
  const meal = resolveRates(`${year}-12-31`).set.rates.taxFree.mealMonthly * 12;
  const expenseRate = resolveRates(`${year}-12-31`).set.rates.freelancer.defaultSimpleExpenseRate;
  const couple = tab === "couple";
  const a = personFrom(raw, "a_", { gross: 50_000_000, nonTaxable: meal, expenseRate }, couple, errors, adjusted);
  const b = personFrom(raw, "b_", { gross: 40_000_000, nonTaxable: meal, expenseRate }, couple, errors, adjusted);

  const deps: Dep[] = [];
  let spouses = 0;
  for (let n = 0; n < MAX_DEPS; n++) {
    const rel = String(raw[`d${n}_rel`] ?? "") as Relation;
    if (!RELATIONS.includes(rel)) continue;
    const k = (f: string) => `d${n}_${f}`;
    const num = (f: string, label: string): number => intField(raw, { field: k(f), label, def: 0, min: 0, max: MONEY_MAX, errors });
    if (rel === "spouse") {
      spouses++;
      if (tab === "couple") {
        errors[k("rel")] = "부부 비교에서는 배우자를 부양가족으로 넣지 않아요. 배우자는 위의 '배우자' 입력을 쓰세요.";
        continue;
      }
      if (spouses > 1) {
        errors[k("rel")] = "배우자는 한 명만 넣을 수 있어요.";
        continue;
      }
    }
    const defYearOfBirth = rel === "child" ? year - 10 : rel === "parent" ? year - 65 : 0;
    const birth = rel === "spouse" ? 0 : intField(raw, { field: k("year"), label: "출생연도", def: defYearOfBirth, min: year - 110, max: year, errors });
    deps.push({
      rel,
      year: birth,
      highIncome: toBool(raw[k("hi")]),
      medical: num("med", "의료비"),
      education: rel === "child" ? num("edu", "교육비") : 0,
      premium: num("prem", "보험료"),
      credit: num("cc", "신용카드"),
      debit: num("dc", "체크카드·현금영수증"),
    });
  }

  const sharedCredit = intField(raw, { field: "sc", label: "공동 신용카드 지출", def: 0, min: 0, max: MONEY_MAX, errors });
  const sharedDebit = intField(raw, { field: "sd", label: "공동 체크카드·현금영수증 지출", def: 0, min: 0, max: MONEY_MAX, errors });
  return parsed({ tab, year, asOf, a, b, deps, sharedCredit, sharedDebit }, errors, adjusted);
}
