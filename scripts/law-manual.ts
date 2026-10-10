// 법제처 DB 에 없어 기계 감시가 안 되는 항목(장기요양보험료율·경비율 등)의 이번 달 점검 목록.
//   node scripts/law-manual.ts [YYYY-MM]   해당하는 항목이 있으면 마크다운을 출력하고 종료 코드 10
import { readFileSync } from "node:fs";
import type { Targets } from "../src/watch/law-api.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const targets = JSON.parse(readFileSync(`${ROOT}data/watch/targets.json`, "utf8")) as Targets;
const ym = process.argv[2] ?? new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);
const month = Number(ym.slice(5, 7));
const due = (targets.manual ?? []).filter((m) => m.months.includes(month));
if (!due.length) {
  console.log(`${ym}: 이번 달 수동 점검 항목 없음`);
  process.exit(0);
}
console.log(`# ${ym} 수동 점검 (법제처 고시 DB 로 감시할 수 없는 항목)\n`);
console.log("이번 달에 공고·결정이 나올 수 있는 항목이에요. 새 값이 나왔으면 `data/rates/` 를 갱신하고(docs/LAW-WATCH.md), 아직이면 닫아 주세요.\n");
for (const m of due) console.log(`- [ ] **${m.item}** — ${m.when}\n  - 확인처: ${m.where}\n  - 영향: ${m.affects.join(", ")}`);
process.exit(10);
