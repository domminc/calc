import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// "법이 바뀌면 data/rates 만 고치면 계산과 화면 문구가 함께 바뀐다"를 지키기 위한 가드:
// 계산·렌더 코드에 요율·한도 숫자를 직접 쓰면 실패한다. (마케팅 문구 meta.ts·감시 코드·데이터는 제외)
const FORBIDDEN: [RegExp, string][] = [
  [/\b7\.19\b/, "건강보험료율"],
  [/\b9\.5%/, "국민연금 보험료율"],
  [/\b4\.75\b/, "국민연금 근로자 요율"],
  [/\b3\.595\b/, "건강보험 근로자 요율"],
  [/\b13\.14\b/, "장기요양 비율"],
  [/\b0\.9448\b/, "장기요양보험료율"],
  [/\b3\.3%/, "원천징수 합계세율"],
  [/\b0\.967\b/, "원천징수 실수령 비율"],
  [/\b10,?320\b/, "2026 최저임금"],
  [/\b10,?700\b/, "2027 최저임금"],
  [/\b20,?160\b/, "건강보험료 하한"],
  [/\b211\.5\b/, "부과점수당 금액"],
  [/\b2,?156,?880\b/, "최저임금 월 환산"],
  [/\b1\.47%/, "산재 평균요율"],
  [/\b64\.1%/, "단순경비율 예시"],
  [/\b6,?590,?000\b/, "국민연금 상한"],
  [/\b410,?000\b/, "국민연금 하한"],
];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []));
}
const SKIP = [/registry\.generated\.ts$/, /server\/meta\.ts$/, /src\/watch\//, /src\/client\//]; // 주석·마케팅 문구는 별도 점검

describe("하드코딩 방지", () => {
  it("UT-H1 src/core·render·server 에 요율·한도 숫자가 직접 들어 있지 않다", () => {
    const hits: string[] = [];
    for (const f of [...files("src/core"), ...files("src/render"), ...files("src/server")]) {
      if (SKIP.some((r) => r.test(f))) continue;
      const lines = readFileSync(f, "utf8").split("\n");
      lines.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, ""); // 주석 제외
        for (const [re, what] of FORBIDDEN) if (re.test(code)) hits.push(`${f}:${i + 1} ${what}: ${line.trim().slice(0, 90)}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("UT-H2 연도 목록 레지스트리가 data/rates 와 일치한다 (npm run build:registry)", async () => {
    const { execFileSync } = await import("node:child_process");
    expect(() => execFileSync("node", ["scripts/build-registry.mjs", "--check"], { stdio: "pipe" })).not.toThrow();
  });
});
