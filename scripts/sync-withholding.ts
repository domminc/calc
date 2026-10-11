// 근로소득 간이세액표(소득세법 시행령 별표2) 개정을 감지해 data/ 를 갱신한다.
//   node scripts/sync-withholding.ts          개정이 있으면 원문 PDF 를 받아 표를 만들고 종료 코드 10
//   node scripts/sync-withholding.ts --check  개정 여부만 확인 (파일을 바꾸지 않음)
// 필요: pdftotext(poppler-utils). 표 무결성 검사에 실패하면 아무것도 바꾸지 않고 종료 코드 1.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { findWithholdingAnnex, guessEffectiveFrom } from "../src/watch/annex.ts";

const OC = process.env.LAW_OC || "test";
const ROOT = new URL("..", import.meta.url).pathname;
const check = process.argv.includes("--check");

async function get(url: string, binary = false): Promise<Buffer | string> {
  let last: unknown;
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw new Error(`내려받기 실패: ${url} — ${last instanceof Error ? last.message : last}`);
}

/** 지금 저장된 간이세액표 중 가장 늦은 개정일 */
function currentRevision(): string {
  let best = "";
  for (const y of readdirSync(`${ROOT}data/rates`).filter((d) => /^\d{4}$/.test(d))) {
    const f = `${ROOT}data/rates/${y}/withholding.json`;
    if (!existsSync(f)) continue;
    const m = /(\d{4}-\d{2}-\d{2})/.exec((JSON.parse(readFileSync(f, "utf8")) as { revision: string }).revision);
    if (m && m[1]! > best) best = m[1]!;
  }
  return best;
}

const xml = (await get(`https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=law&ID=003956&type=XML`)) as string;
const annex = findWithholdingAnnex(xml);
if (!annex) {
  console.error("시행령 XML 에서 [별표 2] 근로소득 간이세액표를 찾지 못했어요 (응답 형식 변경 가능성). 수동 확인이 필요해요.");
  process.exit(2);
}
const have = currentRevision();
console.log(`법제처 별표2 개정일 ${annex.revision} / 저장된 개정일 ${have}`);
if (annex.revision <= have) {
  console.log("간이세액표 변경 없음");
  process.exit(0);
}
if (check) {
  console.log(`간이세액표 새 개정 감지: ${annex.revision} (${annex.title})`);
  process.exit(10);
}

const year = annex.revision.slice(0, 4);
const effectiveFrom = guessEffectiveFrom(annex.revision);
const dir = `${ROOT}data/source/${year}`;
mkdirSync(dir, { recursive: true });
const base = `income-tax-decree-annex2-${annex.revision}`;
const pdfUrl = `https://www.law.go.kr/LSW/flDownload.do?flSeq=${annex.flSeq}&bylClsCd=110201`;
const pdf = (await get(pdfUrl, true)) as Buffer;
if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("내려받은 파일이 PDF 가 아니에요");
writeFileSync(`${dir}/${base}.pdf`, pdf);
execFileSync("pdftotext", ["-layout", `${dir}/${base}.pdf`, `${dir}/${base}.txt`]);
writeFileSync(`${dir}/${base}.meta.json`, JSON.stringify({ revision: `${annex.revision} 개정 (${effectiveFrom} 시행분부터 — 시행일은 부칙으로 확인 필요)`, sourceUrl: pdfUrl, title: `소득세법 시행령 [별표 2] ${annex.title.replace(/<개정[^>]*>\s*/, "").replace(/^\[별표\s*2\]\s*/, "")}` }, null, 2) + "\n");

// 같은 연도에 이전 원문이 있으면 새 것만 쓰도록 오래된 .txt 는 치운다 (build-withholding 은 연도 폴더의 첫 파일을 쓴다)
for (const f of readdirSync(dir)) {
  if (f.startsWith("income-tax-decree-annex2-") && f.endsWith(".txt") && !f.startsWith(base)) rmSync(`${dir}/${f}`);
}
try {
  execFileSync("node", ["scripts/build-withholding.mjs", year, effectiveFrom], { cwd: ROOT, stdio: "inherit" });
  execFileSync("node", ["scripts/build-registry.mjs"], { cwd: ROOT, stdio: "inherit" });
} catch {
  console.error("표 변환·무결성 검사에 실패했어요. 자동 갱신하지 않아요 (수동 확인 필요).");
  process.exit(1);
}
console.log(`간이세액표 갱신: ${year}년 폴더, 적용 시작일 ${effectiveFrom} (부칙 확인 필요)`);
process.exit(10);
