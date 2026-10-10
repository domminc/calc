// 시행일 기준 요율 세트. data/rates/<연도>/ 가 정본이고, src/core/registry.generated.ts 가 연도 목록을 안다 (npm run build:registry).
import type rates2026Type from "../../data/rates/2026/rates.json";
import type withholding2026Type from "../../data/rates/2026/withholding.json";
import { RAW } from "./registry.generated.ts";
import { isIsoDate } from "./money.ts";
import type { Notice } from "./types.ts";

export type Rates = typeof rates2026Type;
export type Withholding = typeof withholding2026Type;

export interface RateMeta {
  /** 확정된 변경 (calcs: 영향받는 계산기) */
  confirmed: { item: string; basis: string; calcs?: string[] }[];
  /** 확정 전 항목과 지금 적용 중인 값 */
  pending: { item: string; now: string; calcs?: string[] }[];
}

export interface RateSet {
  year: number;
  /** 이 세트가 적용되기 시작하는 날 */
  effectiveFrom: string;
  /** final: 공식 원문으로 확정 / provisional: 일부가 확정 전이라 앞 연도 값을 잠정 적용 */
  status: "final" | "provisional";
  rates: Rates;
  withholding: Withholding;
  /** 간이세액표가 실제 어느 연도 파일에서 왔는지 (없으면 앞 연도에서 물려받음) */
  withholdingYear: number;
  /** 간이세액표 시행일 */
  withholdingFrom: string;
  meta: RateMeta;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** 객체는 깊게 합치고, 배열·값은 바꿔 끼운다. */
export function deepMerge(base: unknown, over: unknown): unknown {
  if (!isObj(base) || !isObj(over)) return over;
  const out: Json = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = k in base ? deepMerge(base[k], v) : v;
  return out;
}

function build(): RateSet[] {
  const sets: RateSet[] = [];
  let prev: RateSet | undefined;
  for (const y of Object.keys(RAW).map(Number).sort((a, b) => a - b)) {
    const raw = RAW[y]!;
    const file = raw.rates as Json;
    const rates = (file.extends !== undefined ? deepMerge(prev?.rates, file.overrides) : file) as Rates;
    if (file.extends !== undefined && !prev) throw new Error(`${y}년 요율이 앞 연도를 물려받는데 앞 연도가 없어요`);
    const wh = (raw.withholding as Withholding | undefined) ?? prev?.withholding;
    if (!wh) throw new Error(`${y}년 간이세액표가 없어요`);
    const whFrom = raw.withholding ? ((raw.withholding as Withholding).effectiveFrom ?? `${y}-01-01`) : prev!.withholdingFrom;
    const set: RateSet = {
      year: y,
      effectiveFrom: String(file.effectiveFrom ?? `${y}-01-01`),
      status: file.status === "provisional" ? "provisional" : "final",
      rates,
      withholding: wh,
      withholdingYear: raw.withholding ? y : prev!.withholdingYear,
      withholdingFrom: whFrom,
      meta: { confirmed: (file.confirmed as RateMeta["confirmed"]) ?? [], pending: (file.pending as RateMeta["pending"]) ?? [] },
    };
    sets.push(set);
    prev = set;
  }
  return sets;
}

export const RATE_SETS: RateSet[] = build();
export const SUPPORTED_YEARS = RATE_SETS.map((s) => s.year);
export const LATEST_YEAR = Math.max(...SUPPORTED_YEARS);

/** 오늘 날짜(Asia/Seoul) YYYY-MM-DD */
export function todayKst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export interface Resolved {
  set: RateSet;
  asOf: string;
  /** 기준일에 맞는 세트가 없어 가까운 세트로 대체했을 때 */
  fallback?: { requestedYear: number; usedYear: number };
}

/**
 * 기준일에 적용되는 요율 세트: 시행일이 기준일 이전인 것 중 가장 늦은 것.
 * 기준일이 마지막 세트의 연도를 넘으면(예: 2028년인데 2027년 세트까지만 있음) 마지막 세트로 계산하고 fallback 을 알린다.
 */
export function resolveRates(asOf?: string): Resolved {
  const date = asOf && isIsoDate(asOf) ? asOf : todayKst();
  const year = Number(date.slice(0, 4));
  let pick: RateSet | undefined;
  for (const s of RATE_SETS) if (s.effectiveFrom <= date) pick = s;
  if (!pick) return { set: RATE_SETS[0]!, asOf: date, fallback: { requestedYear: year, usedYear: RATE_SETS[0]!.year } };
  if (year > pick.year) return { set: pick, asOf: date, fallback: { requestedYear: year, usedYear: pick.year } };
  return { set: pick, asOf: date };
}

/** 기준일에 적용되는 국민연금 기준소득월액 상·하한 (시행일이 가장 늦은 항목). */
export function npsLimitsAt(rates: Rates, asOf: string): { min: number; max: number; from: string } {
  const list = [...rates.nps.limits].sort((a, b) => a.from.localeCompare(b.from));
  let pick = list[0]!;
  for (const l of list) if (l.from <= asOf) pick = l;
  return pick;
}

/** 요율 세트와 기준일에 따라 결과 위에 붙일 안내 (잠정 요율·간이세액표 시행 전 날짜·대체 연도) */
export function rateNotices(r: Resolved): Notice[] {
  const out: Notice[] = [];
  const { set } = r;
  if (set.status === "provisional") {
    const pend = set.meta.pending.map((p) => p.item).join(" · ");
    out.push({ level: "warn", code: "rates-provisional", text: `${set.year}년 요율은 일부만 확정돼 있어요. 확정 전 항목(${pend})은 앞 연도 값을 잠정 적용했어요. 확정되면 자동으로 바뀌어요.` });
  }
  if (r.asOf < set.withholdingFrom) {
    out.push({ level: "warn", code: "withholding-before", text: `간이세액표는 ${set.withholdingFrom} 시행분이에요. 그 전 지급분은 직전 개정표가 적용되어 소득세가 조금 다를 수 있어요.` });
  }
  if (r.fallback) {
    out.push({ level: "warn", code: "rates-fallback", text: `${r.fallback.requestedYear}년 요율은 아직 없어 ${r.fallback.usedYear}년 기준으로 계산했어요.` });
  }
  return out;
}

/** 기준일 이후 처음 시작하는 세트 (다음 연도 요율). 없으면 undefined */
export function nextSet(asOf: string): RateSet | undefined {
  return RATE_SETS.find((s) => s.effectiveFrom > asOf);
}

/** 계산기별로 "곧 바뀔 수 있는 것" 안내: 다음 세트의 확정·미확정 항목 중 해당 계산기에 영향이 있는 것 */
export function upcomingFor(calc: string, asOf: string): { from: string; confirmed: string[]; pending: string[] } | undefined {
  const n = nextSet(asOf);
  if (!n) return undefined;
  const hit = (c?: string[]) => !c || c.includes(calc);
  const confirmed = n.meta.confirmed.filter((c) => hit(c.calcs)).map((c) => c.item);
  const pending = n.meta.pending.filter((c) => hit(c.calcs)).map((c) => c.item);
  return confirmed.length || pending.length ? { from: n.effectiveFrom, confirmed, pending } : undefined;
}
