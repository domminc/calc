export type CompanySize = "lt150" | "priority150" | "lt1000" | "ge1000";

export interface Line {
  key: string;
  label: string;
  /** 근로자(본인) 부담 */
  amount: number;
  /** 요율·근거 한 줄 설명 */
  basis: string;
}

export interface Notice {
  level: "info" | "warn";
  code: string;
  text: string;
}

export interface FieldErrors {
  [field: string]: string;
}

export interface Parsed<T> {
  value: T;
  errors: FieldErrors;
  /** 자동 보정한 내용 (화면 안내용) */
  adjusted: string[];
}
