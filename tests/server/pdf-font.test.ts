import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// PDF 는 KS X 1001 한글 2,350자 서브셋 폰트를 쓴다 (scripts/build-pdf-font.py).
// 보고서·결과·계산 안내 문구에 그 밖의 한글이 들어가면 PDF 에서 "?" 로 보이므로 미리 잡는다.
const KSX1001 = new Set<string>();
const dec = new TextDecoder("euc-kr");
for (let hi = 0xb0; hi <= 0xc8; hi++) for (let lo = 0xa1; lo <= 0xfe; lo++) {
  const ch = dec.decode(new Uint8Array([hi, lo]));
  if (/[가-힣]/.test(ch)) KSX1001.add(ch);
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
}

describe("PDF 폰트 커버리지", () => {
  it("UT-X2 PDF 에 들어갈 수 있는 문구(src/core, src/render, report.ts)의 한글이 모두 서브셋에 있다", () => {
    expect(KSX1001.size).toBe(2350);
    const targets = [...files("src/core"), ...files("src/render"), "src/server/report.ts", "src/server/meta.ts"];
    const missing = new Map<string, string>();
    for (const f of targets) {
      for (const ch of readFileSync(f, "utf8").match(/[가-힣]/g) ?? []) if (!KSX1001.has(ch) && !missing.has(ch)) missing.set(ch, f);
    }
    expect([...missing.entries()].map(([c, f]) => `${c} (${f})`)).toEqual([]);
  });
});
