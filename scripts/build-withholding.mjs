// 국세청 근로소득 간이세액표(소득세법 시행령 별표2) 원문 텍스트 → data/rates/<year>/withholding.json
// 사용: node scripts/build-withholding.mjs 2026
// 원문: data/source/<year>/income-tax-decree-annex2-*.txt (pdftotext -layout 결과)
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const year = process.argv[2] ?? "2026";
const srcDir = `data/source/${year}`;
const txtName = readdirSync(srcDir).find((f) => f.startsWith("income-tax-decree-annex2") && f.endsWith(".txt"));
if (!txtName) throw new Error(`${srcDir} 에 별표2 텍스트가 없습니다`);
const raw = readFileSync(`${srcDir}/${txtName}`, "utf8");

const num = (s) => (s === "-" ? 0 : Number(s.replaceAll(",", "")));
const rowRe = /^\s*([\d,]+)\s+([\d,]+)((?:\s+(?:[\d,]+|-)){11})\s*$/;
const rows = [];
for (const line of raw.split("\n")) {
  const m = rowRe.exec(line);
  if (!m) continue;
  const cols = m[3].trim().split(/\s+/).map(num);
  if (cols.length !== 11) continue;
  rows.push([num(m[1]), num(m[2]), ...cols]);
}
// 마지막 "10,000천원" 단독 행 (정확히 10,000천원일 때)
const top = /^\s*10,000천원\s+((?:[\d,]+\s*){11})\s*$/m.exec(raw);
if (!top) throw new Error("10,000천원 행을 찾지 못했습니다");
const topRow = top[1].trim().split(/\s+/).map(num);

// 무결성: 구간이 끊김 없이 이어지는가
for (let i = 1; i < rows.length; i++) {
  if (rows[i][0] !== rows[i - 1][1]) throw new Error(`구간 불연속: ${rows[i - 1]} → ${rows[i]}`);
}
if (rows[0][0] !== 770) throw new Error(`첫 구간이 770천원이 아닙니다: ${rows[0]}`);
if (rows.at(-1)[1] !== 10000) throw new Error(`마지막 구간이 10,000천원이 아닙니다: ${rows.at(-1)}`);

// 가족 수가 늘수록 세액이 줄어야 한다 (단조성)
for (const r of rows) {
  for (let k = 3; k < 13; k++) if (r[k] > r[k - 1]) throw new Error(`가족수 단조성 위반: ${r}`);
}

const out = {
  year: Number(year),
  source: "소득세법 시행령 [별표 2] 근로소득 간이세액표 (제189조제1항 관련)",
  revision: "2026-02-27 개정 (2026-03-01 시행분부터)",
  sourceUrl: "https://www.law.go.kr/LSW/flDownload.do?flSeq=163623339&bylClsCd=110201",
  sourceSha256: createHash("sha256").update(readFileSync(`${srcDir}/${txtName.replace(".txt", ".pdf")}`)).digest("hex"),
  unit: "원 / 월급여 단위: 천원",
  // rows: [이상, 미만, 가족1..11] (월급여 천원, 세액 원)
  bands: rows,
  // 월급여가 정확히 10,000천원일 때
  at10000: topRow,
  // 10,000천원 초과 구간 계산식 (별표2 말미)
  over10000: [
    { upTo: 14000, base: "at10000", add: 0, rate: 0.35, factor: 0.98, threshold: 10000, plus: 25000 },
    { upTo: 28000, base: "at10000", add: 1397000, rate: 0.38, factor: 0.98, threshold: 14000, plus: 0 },
    { upTo: 30000, base: "at10000", add: 6610600, rate: 0.4, factor: 0.98, threshold: 28000, plus: 0 },
    { upTo: 45000, base: "at10000", add: 7394600, rate: 0.4, factor: 1, threshold: 30000, plus: 0 },
    { upTo: 87000, base: "at10000", add: 13394600, rate: 0.42, factor: 1, threshold: 45000, plus: 0 },
    { upTo: null, base: "at10000", add: 31034600, rate: 0.45, factor: 1, threshold: 87000, plus: 0 },
  ],
  childCredit: { one: 20830, two: 45830, perExtraChild: 33330 },
};

mkdirSync(`data/rates/${year}`, { recursive: true });
writeFileSync(`data/rates/${year}/withholding.json`, JSON.stringify(out) + "\n");
console.log(`withholding ${year}: ${rows.length}개 구간 (${rows[0][0]}~${rows.at(-1)[1]}천원), 10,000천원 행 ${topRow[0]}원`);
