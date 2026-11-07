import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// docs/DESIGN.md §11 "명세서(종이와 잉크)" 방향을 지키는 가드. 장식용 효과가 조용히 되돌아오는 것을 막는다.
const css = readFileSync(new URL("../../public/css/app.css", import.meta.url), "utf8");
const lines = css.split("\n");

const srcFiles = (dir: string): string[] =>
  readdirSync(new URL(`../../${dir}`, import.meta.url)).filter((f) => f.endsWith(".ts")).map((f) => `${dir}/${f}`);

describe("디자인 방향 가드 (명세서: 종이와 잉크)", () => {
  it("UT-D1 장식용 그라데이션·블러·그림자·그라데이션 글자가 없다", () => {
    expect(css).not.toMatch(/radial-gradient|conic-gradient/);
    expect(css).not.toMatch(/backdrop-filter/);
    expect(css).not.toMatch(/background-clip\s*:\s*text/);
    // linear-gradient 는 기능을 그리는 두 곳(슬라이더 채움 줄, select 화살표)에만 허용
    const bad = lines.filter((l) => /linear-gradient/.test(l) && !/\.range|^select \{/.test(l));
    expect(bad).toEqual([]);
    // box-shadow 는 안쪽 1px 포커스 선(inset 0 0 0 …)만 허용 — 번지는 그림자 금지
    const shadows = [...css.matchAll(/box-shadow\s*:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(shadows.filter((v) => v !== "none" && !/^inset 0 0 0 \d+px /.test(v))).toEqual([]);
  });

  it("UT-D2 모서리는 거의 직각(≤4px)이고 알약·원형이 없다", () => {
    const radii = [...css.matchAll(/border-radius\s*:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    for (const v of radii) {
      for (const n of v.matchAll(/(\d+(?:\.\d+)?)px/g)) expect(Number(n[1]), `border-radius: ${v}`).toBeLessThanOrEqual(4);
      expect(v, "원형(50%)·알약(999px) 금지").not.toMatch(/%|999/);
    }
    expect(css).toMatch(/--r:\s*2px/);
  });

  it("UT-D3 호버로 떠오르는 효과·통통 튀는 이징이 없다", () => {
    expect(css).not.toMatch(/translateY\(\s*-/);
    expect(css).not.toMatch(/cubic-bezier\([^)]*-?\d+\.\d+\s*,\s*(?:1\.\d+|-\d)/); // overshoot(바운스)
    expect(css).not.toMatch(/@keyframes/);
  });

  it("UT-D4 강조색은 하나(--accent)이고 보라·네온 계열을 쓰지 않는다", () => {
    const hexes = [...css.matchAll(/#([0-9a-f]{6})\b/gi)].map((m) => m[1]!.toLowerCase());
    const hue = (h: string) => {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      if (max - min < 0.12) return -1; // 무채색에 가까움
      let d = 0;
      if (max === r) d = ((g - b) / (max - min)) % 6;
      else if (max === g) d = (b - r) / (max - min) + 2;
      else d = (r - g) / (max - min) + 4;
      return Math.round((d * 60 + 360) % 360);
    };
    // 보라·자주 구간(260~330°)의 채도 높은 색 금지 — 잉크 블루(≈225°)는 허용
    const purples = hexes.filter((h) => { const x = hue(h); return x >= 260 && x <= 330; });
    expect(purples).toEqual([]);
  });

  it("UT-D5 마크업에 장식 요소(스파클·알약 태그·벤토·도넛·타일 아이콘)가 없다", () => {
    const files = [...srcFiles("src/server"), ...srcFiles("src/render")];
    const banned = /icon\("spark"|class="pill-tag"|class="bento"|class="tile|class="donut"|class="t-ico"|i-spark/;
    const hits = files.filter((f) => banned.test(readFileSync(new URL(`../../${f}`, import.meta.url), "utf8")));
    expect(hits).toEqual([]);
  });
});
