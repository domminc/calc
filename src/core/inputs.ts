// 입력 정규화. 서버(쿼리스트링·공유 JSON)와 브라우저(폼)가 같은 규칙을 쓴다.
import type { CompanySize, FieldErrors, Parsed } from "./types.ts";
import { isIsoDate } from "./money.ts";

export type Raw = Record<string, string | number | boolean | null | undefined>;

/** "40,000,000" · "4000만" 이 아닌 숫자 문자열 → number. 비어 있으면 undefined, 숫자가 아니면 NaN. */
export function toNumber(v: Raw[string]): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = v.replaceAll(",", "").replaceAll(" ", "").replace(/원$/, "");
  if (s === "") return undefined;
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : Number.NaN;
}

export const toBool = (v: Raw[string], fallback = false): boolean => {
  if (v === undefined || v === null || v === "") return fallback;
  return v === true || v === "1" || v === "true" || v === "on" || v === 1;
};

interface IntOpts {
  field: string;
  label: string;
  def: number;
  min: number;
  max: number;
  errors: FieldErrors;
  /** false 면 소수 허용 */
  integer?: boolean;
  /** 키가 있는데 비어 있으면(사용자가 지움) 오류. 키가 아예 없으면 기본값. */
  required?: boolean;
}

/** 필수 정수 필드. 오류가 있으면 기본값으로 계산을 이어가되 errors 에 기록한다. */
export function intField(raw: Raw, o: IntOpts): number {
  const n = toNumber(raw[o.field]);
  if (n === undefined) {
    const present = raw[o.field] !== undefined && raw[o.field] !== null;
    if (o.required && present) o.errors[o.field] = `${o.label}을(를) 입력해 주세요.`;
    return o.def;
  }
  if (Number.isNaN(n)) {
    o.errors[o.field] = `${o.label}은(는) 숫자로 입력해 주세요.`;
    return o.def;
  }
  if (o.integer !== false && !Number.isInteger(n)) {
    o.errors[o.field] = `${o.label}은(는) 원 단위 정수로 입력해 주세요.`;
    return o.def;
  }
  if (n < o.min || n > o.max) {
    o.errors[o.field] = `${o.label}은(는) ${o.min.toLocaleString("ko-KR")}~${o.max.toLocaleString("ko-KR")} 사이로 입력해 주세요.`;
    return o.def;
  }
  return n;
}

export function dateField(raw: Raw, field: string, def: string, errors: FieldErrors): string {
  const v = raw[field];
  if (v === undefined || v === null || v === "") return def;
  const s = String(v);
  if (!isIsoDate(s)) {
    errors[field] = "기준일은 YYYY-MM-DD 형식으로 입력해 주세요.";
    return def;
  }
  return s;
}

export const COMPANY_SIZES: readonly CompanySize[] = ["lt150", "priority150", "lt1000", "ge1000"];

export function sizeField(raw: Raw, field = "size"): CompanySize {
  const v = String(raw[field] ?? "");
  return (COMPANY_SIZES as readonly string[]).includes(v) ? (v as CompanySize) : "lt150";
}

export function parsed<T>(value: T, errors: FieldErrors, adjusted: string[] = []): Parsed<T> {
  return { value, errors, adjusted };
}

/** 가족·자녀 보정: 자녀는 본인을 뺀 가족 수를 넘을 수 없다. */
export function fixFamily(family: number, children: number, adjusted: string[]): { family: number; children: number } {
  if (children > family - 1) {
    adjusted.push(`자녀 수(${children}명)가 부양가족(본인 제외 ${family - 1}명)보다 많아 부양가족 수를 ${children + 1}명으로 맞췄어요.`);
    return { family: Math.min(children + 1, 20), children: Math.min(children, 10) };
  }
  return { family, children };
}
