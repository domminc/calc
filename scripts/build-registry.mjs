// data/rates/<연도>/ 를 훑어 src/core/registry.generated.ts 를 만든다 (연도를 추가하면 이것만 다시 돌리면 코드가 새 연도를 안다).
//   rates.json        : 전체 값(첫 연도) 또는 { extends, overrides } (앞 연도를 물려받아 바뀐 것만)
//   withholding.json  : 있으면 그 연도의 간이세액표, 없으면 앞 연도 것을 쓴다
// 사용: node scripts/build-registry.mjs [--check]   (--check: 파일이 최신인지 검사만)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const years = readdirSync(join(root, "data", "rates"))
  .filter((d) => /^\d{4}$/.test(d))
  .sort();
if (!years.length) throw new Error("data/rates 에 연도 폴더가 없습니다");

const lines = ["// 자동 생성 — scripts/build-registry.mjs (직접 고치지 않는다)"];
const entries = [];
for (const y of years) {
  if (!existsSync(join(root, "data", "rates", y, "rates.json"))) throw new Error(`${y}/rates.json 이 없습니다`);
  lines.push(`import r${y} from "../../data/rates/${y}/rates.json";`);
  const hasW = existsSync(join(root, "data", "rates", y, "withholding.json"));
  if (hasW) lines.push(`import w${y} from "../../data/rates/${y}/withholding.json";`);
  entries.push(`  ${y}: { rates: r${y} as unknown, withholding: ${hasW ? `w${y} as unknown` : "undefined"} },`);
}
lines.push("", "export const RAW: Record<number, { rates: unknown; withholding: unknown | undefined }> = {", ...entries, "};", "");
const out = lines.join("\n");
const target = join(root, "src", "core", "registry.generated.ts");

if (process.argv.includes("--check")) {
  const cur = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (cur !== out) {
    console.error("registry.generated.ts 가 최신이 아니에요. node scripts/build-registry.mjs 를 실행하세요.");
    process.exit(1);
  }
  console.log("registry: 최신");
} else {
  writeFileSync(target, out);
  console.log(`registry: ${years.join(", ")}`);
}
