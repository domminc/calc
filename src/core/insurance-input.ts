import type { CompanySize, FieldErrors, Parsed } from "./types.ts";
import { dateField, intField, parsed, sizeField, toNumber, type Raw } from "./inputs.ts";
import { todayKst } from "./rates.ts";

export interface InsuranceFormInput {
  monthly: number;
  asOf: string;
  size: CompanySize;
  wciRate: number | undefined;
}

export function parseInsuranceInput(raw: Raw): Parsed<InsuranceFormInput> {
  const errors: FieldErrors = {};
  const monthly = intField(raw, { field: "monthly", label: "월 보수", required: true, def: 3_000_000, min: 0, max: 1_000_000_000, errors });
  const w = toNumber(raw.wciRate);
  let wciRate: number | undefined;
  if (w !== undefined) {
    if (Number.isNaN(w) || w < 0 || w > 30) errors.wciRate = "산재보험료율은 0~30% 사이로 입력해 주세요.";
    else wciRate = w / 100;
  }
  return parsed({ monthly, asOf: dateField(raw, "asOf", todayKst(), errors), size: sizeField(raw), wciRate }, errors);
}
