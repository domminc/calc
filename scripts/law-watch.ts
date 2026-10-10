// 법령 변경 감시. 계산에 쓰는 법령·고시의 현행/시행예정 목록을 저장해 둔 스냅샷과 비교한다.
//   node scripts/law-watch.ts check  [--out report.md]   변경이 있으면 종료 코드 10 (보고서 출력)
//   node scripts/law-watch.ts update                      스냅샷을 현재 상태로 갱신 (변경을 반영·확인한 뒤)
// 환경: LAW_OC (법제처 OPEN API 인증키, 기본 "test"). 대상: data/watch/targets.json, 스냅샷: data/watch/snapshot.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { diffSnapshots, hasChanges, lawEntries, parseItems, reportMarkdown, ruleEntries, totalCount, type LawEntry, type RuleEntry, type Snapshot, type Targets } from "../src/watch/law-api.ts";

const OC = process.env.LAW_OC || "test";
const ROOT = new URL("..", import.meta.url).pathname;
const TARGETS = `${ROOT}data/watch/targets.json`;
const SNAPSHOT = `${ROOT}data/watch/snapshot.json`;
const BASE = "https://www.law.go.kr/DRF/lawSearch.do";

async function fetchXml(params: Record<string, string>): Promise<string> {
  const url = `${BASE}?${new URLSearchParams({ OC, type: "XML", ...params })}`;
  let last: unknown;
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!/<resultCode>00<\/resultCode>/.test(text)) throw new Error(`응답 이상: ${text.slice(0, 120).replace(/\s+/g, " ")}`);
      return text;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw new Error(`조회 실패 (${params.query}): ${last instanceof Error ? last.message : last}`);
}

async function allPages(params: Record<string, string>, itemTag: string): Promise<Record<string, string>[]> {
  const items: Record<string, string>[] = [];
  for (let page = 1; page <= 12; page++) {
    const xml = await fetchXml({ ...params, display: "100", page: String(page) });
    items.push(...parseItems(xml, itemTag));
    if (page * 100 >= totalCount(xml)) break;
  }
  return items;
}

async function collect(targets: Targets): Promise<{ snapshot: Snapshot; failures: string[] }> {
  const laws: Record<string, LawEntry[]> = {};
  const rules: Record<string, RuleEntry[]> = {};
  const failures: string[] = [];
  for (const t of targets.laws) {
    try {
      const items = await allPages({ target: "eflaw", query: t.name, nw: "2,3" }, "law");
      const entries = lawEntries(items, t.name);
      if (!entries.some((e) => e.status === "현행")) throw new Error("현행 법령이 조회되지 않음");
      laws[t.name] = entries;
    } catch (e) {
      failures.push(`${t.name}: ${e instanceof Error ? e.message : e}`);
    }
  }
  for (const t of targets.rules) {
    try {
      rules[t.id] = ruleEntries(await allPages({ target: "admrul", query: t.query }, "admrul"), t);
    } catch (e) {
      failures.push(`${t.label}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { snapshot: { checkedAt: new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10), laws, rules }, failures };
}

const [, , cmd = "check", ...rest] = process.argv;
const targets = JSON.parse(readFileSync(TARGETS, "utf8")) as Targets;
const before = existsSync(SNAPSHOT) ? (JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot) : undefined;
const { snapshot, failures } = await collect(targets);
const total = targets.laws.length + targets.rules.length;

if (failures.length) console.error(`조회 실패 ${failures.length}/${total}:\n- ${failures.join("\n- ")}`);
if (failures.length > total * 0.3) {
  console.error("조회 실패가 너무 많아 비교하지 않아요 (API 장애로 보임).");
  process.exit(2);
}
// 일부만 실패했으면 그 대상은 이전 스냅샷을 유지해 오탐을 막는다
for (const t of targets.laws) if (!snapshot.laws[t.name] && before?.laws[t.name]) snapshot.laws[t.name] = before.laws[t.name]!;
for (const t of targets.rules) if (!snapshot.rules[t.id] && before?.rules[t.id]) snapshot.rules[t.id] = before.rules[t.id]!;

if (cmd === "update") {
  writeFileSync(SNAPSHOT, JSON.stringify(snapshot, null, 1) + "\n");
  console.log(`스냅샷 갱신: 법령 ${Object.keys(snapshot.laws).length}개, 고시 ${Object.keys(snapshot.rules).length}종 (${snapshot.checkedAt})`);
} else if (cmd === "check") {
  const changes = diffSnapshots(targets, before, snapshot);
  if (!before) {
    console.log("스냅샷이 없어요. `update` 로 먼저 만드세요.");
    process.exit(3);
  }
  if (!hasChanges(changes)) {
    console.log(`변경 없음 (${snapshot.checkedAt}) — 법령 ${Object.keys(snapshot.laws).length}개, 고시 ${Object.keys(snapshot.rules).length}종 확인`);
    // 확인 날짜만 갱신하려면 update 를 쓴다 (불필요한 커밋을 만들지 않으려고 check 는 파일을 바꾸지 않는다)
  } else {
    const md = reportMarkdown(changes, snapshot.checkedAt);
    const outIdx = rest.indexOf("--out");
    if (outIdx >= 0 && rest[outIdx + 1]) writeFileSync(rest[outIdx + 1]!, md + "\n");
    console.log(md);
    process.exit(10);
  }
} else {
  console.error("사용법: law-watch.ts check|update [--out 파일]");
  process.exit(64);
}
