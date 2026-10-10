// 법제처 국가법령정보 공동활용 API(DRF) 조회·비교. scripts/law-watch.ts 가 쓰고, 테스트가 합성 응답으로 검증한다.
// 이 모듈은 Worker/브라우저 번들에 들어가지 않는다.

export type LawStatus = "현행" | "시행예정";

export interface LawEntry {
  status: LawStatus;
  /** 법령일련번호 */
  mst: string;
  promulgated: string; // YYYYMMDD
  effective: string; // YYYYMMDD
  kind: string; // 제개정구분 (일부개정·타법개정 …)
}

export interface RuleEntry {
  id: string;
  name: string;
  issued: string; // 발령일자 YYYYMMDD
  effective: string;
  status: string; // 현행·연혁
}

export interface LawTarget {
  name: string;
  affects: string[];
}
export interface RuleTarget {
  id: string;
  label: string;
  query: string;
  agency: string;
  match: string;
  affects: string[];
}
export interface ManualTarget {
  item: string;
  /** 점검이 필요한 달 (1~12) */
  months: number[];
  when: string;
  where: string;
  affects: string[];
}
export interface Targets {
  laws: LawTarget[];
  rules: RuleTarget[];
  manual?: ManualTarget[];
}

export interface Snapshot {
  checkedAt: string;
  laws: Record<string, LawEntry[]>;
  rules: Record<string, RuleEntry[]>;
}

const FIELD = /<([^<>/\s!?]+)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/g;

/** `<law id="1">…</law>` 같은 항목 블록을 {태그: 값} 목록으로 */
export function parseItems(xml: string, itemTag: string): Record<string, string>[] {
  const blocks = xml.match(new RegExp(`<${itemTag}(?: [^>]*)?>[\\s\\S]*?</${itemTag}>`, "g")) ?? [];
  return blocks.map((b) => {
    const o: Record<string, string> = {};
    for (const m of b.matchAll(FIELD)) o[m[1]!] = (m[2] ?? m[3] ?? "").trim();
    return o;
  });
}

export function totalCount(xml: string): number {
  return Number(/<totalCnt>(\d+)<\/totalCnt>/.exec(xml)?.[1] ?? 0);
}

/** 법령명이 정확히 같은 것 중 현행·시행예정만, 시행일 순으로 */
export function lawEntries(items: Record<string, string>[], name: string): LawEntry[] {
  const out: LawEntry[] = [];
  for (const it of items) {
    if (it["법령명한글"] !== name) continue;
    const status = it["현행연혁코드"];
    if (status !== "현행" && status !== "시행예정") continue;
    out.push({ status, mst: it["법령일련번호"] ?? "", promulgated: it["공포일자"] ?? "", effective: it["시행일자"] ?? "", kind: it["제개정구분명"] ?? "" });
  }
  return sortLaw(dedupeLaw(out));
}

function dedupeLaw(list: LawEntry[]): LawEntry[] {
  const seen = new Set<string>();
  return list.filter((e) => {
    const k = lawKey(e);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
const sortLaw = (l: LawEntry[]) => [...l].sort((a, b) => a.effective.localeCompare(b.effective) || a.mst.localeCompare(b.mst) || a.status.localeCompare(b.status));
export const lawKey = (e: LawEntry): string => `${e.status}|${e.mst}|${e.effective}`;

/** 행정규칙(고시): 소관부처·이름 패턴이 맞는 것 중 최근 발령 8건 */
export function ruleEntries(items: Record<string, string>[], t: Pick<RuleTarget, "agency" | "match">): RuleEntry[] {
  const re = new RegExp(t.match);
  const out: RuleEntry[] = [];
  for (const it of items) {
    if (it["소관부처명"] !== t.agency || !re.test(it["행정규칙명"] ?? "")) continue;
    out.push({ id: it["행정규칙일련번호"] ?? "", name: it["행정규칙명"] ?? "", issued: it["발령일자"] ?? "", effective: it["시행일자"] ?? "", status: it["현행연혁구분"] ?? "" });
  }
  return out.sort((a, b) => b.issued.localeCompare(a.issued) || b.id.localeCompare(a.id)).slice(0, 8);
}
export const ruleKey = (e: RuleEntry): string => `${e.id}|${e.status}`;

export interface Change<T> {
  added: T[];
  removed: T[];
}

export function diffBy<T>(before: T[] | undefined, after: T[], key: (t: T) => string): Change<T> {
  const b = new Map((before ?? []).map((e) => [key(e), e]));
  const a = new Map(after.map((e) => [key(e), e]));
  return { added: after.filter((e) => !b.has(key(e))), removed: (before ?? []).filter((e) => !a.has(key(e))) };
}

export interface ChangeSet {
  laws: { name: string; affects: string[]; change: Change<LawEntry>; first: boolean }[];
  rules: { id: string; label: string; affects: string[]; change: Change<RuleEntry>; first: boolean }[];
}

export function diffSnapshots(targets: Targets, before: Snapshot | undefined, after: Snapshot): ChangeSet {
  const laws = targets.laws
    .map((t) => ({ name: t.name, affects: t.affects, first: !before?.laws[t.name], change: diffBy(before?.laws[t.name], after.laws[t.name] ?? [], lawKey) }))
    .filter((c) => c.change.added.length || c.change.removed.length);
  const rules = targets.rules
    .map((t) => ({ id: t.id, label: t.label, affects: t.affects, first: !before?.rules[t.id], change: diffBy(before?.rules[t.id], after.rules[t.id] ?? [], ruleKey) }))
    .filter((c) => c.change.added.length || c.change.removed.length);
  return { laws, rules };
}

export const hasChanges = (c: ChangeSet): boolean => c.laws.length > 0 || c.rules.length > 0;

const fmt = (d: string): string => (d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d);
const lawLink = (name: string): string => `https://www.law.go.kr/법령/${encodeURIComponent(name)}`;

/** 이슈 본문 (마크다운) */
export function reportMarkdown(c: ChangeSet, checkedAt: string): string {
  const L: string[] = [`# 법령 변경 감지 (${checkedAt})`, "", "계산에 쓰는 법령·고시에서 변경 또는 시행 예정 개정이 감지됐어요. `docs/LAW-WATCH.md` 의 처리 절차를 따라 요율·계산식·테스트를 갱신하세요.", ""];
  for (const l of c.laws) {
    L.push(`## ${l.name}  ·  [원문](${lawLink(l.name)})`, `영향: ${l.affects.join(", ")}`, "");
    for (const e of l.change.added) L.push(`- ➕ **${e.status}** 시행 ${fmt(e.effective)} · 공포 ${fmt(e.promulgated)} · ${e.kind} · [신구조문대비](https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=${e.mst})`);
    for (const e of l.change.removed) L.push(`- ➖ ${e.status} 시행 ${fmt(e.effective)} · 공포 ${fmt(e.promulgated)} (일련번호 ${e.mst}) — 더 이상 목록에 없음(시행되어 현행으로 바뀌었거나 대체됨)`);
    L.push("");
  }
  for (const r of c.rules) {
    L.push(`## ${r.label}`, `영향: ${r.affects.join(", ")}`, "");
    for (const e of r.change.added) L.push(`- ➕ ${e.name} · 발령 ${fmt(e.issued)} · 시행 ${fmt(e.effective)} · ${e.status}`);
    for (const e of r.change.removed) L.push(`- ➖ ${e.name} · 발령 ${fmt(e.issued)} (${e.status})`);
    L.push("");
  }
  return L.join("\n");
}

/** 앞으로 시행될 개정 목록 (기준일 이후 시행) — /basis 표시용 */
export function upcoming(s: Snapshot, today: string): { name: string; effective: string; promulgated: string; kind: string }[] {
  const t = today.replaceAll("-", "");
  const out: { name: string; effective: string; promulgated: string; kind: string }[] = [];
  for (const [name, list] of Object.entries(s.laws)) {
    for (const e of list) if (e.status === "시행예정" && e.effective > t) out.push({ name, effective: e.effective, promulgated: e.promulgated, kind: e.kind });
  }
  return out.sort((a, b) => a.effective.localeCompare(b.effective) || a.name.localeCompare(b.name));
}
