import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// docs/DESIGN.md §12 "Liquid"(iOS 27 의 다듬은 Liquid Glass 를 웹에 옮김) 방향을 지키는 가드.
// 유리는 내비게이션 층에만, 반지름은 토큰 체계로, 장식 효과(그라데이션·번지는 그림자·보라 계열)는 되돌아오지 않게 막는다.
const css = readFileSync(new URL("../../public/css/app.css", import.meta.url), "utf8");
const lines = css.split("\n");

const srcFiles = (dir: string): string[] =>
  readdirSync(new URL(`../../${dir}`, import.meta.url)).filter((f) => f.endsWith(".ts")).map((f) => `${dir}/${f}`);

// 가장 안쪽 규칙 블록 { 선택자, 선언 } 목록 (@media 안의 규칙도 잡힌다)
const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1]!.trim(), body: m[2]! }));

describe("디자인 방향 가드 (Liquid: iOS 27 식 유리 + 그룹 카드)", () => {
  it("UT-D1 장식용 그라데이션·그라데이션 글자·번지는 그림자가 없다", () => {
    expect(css).not.toMatch(/radial-gradient|conic-gradient/);
    expect(css).not.toMatch(/background-clip\s*:\s*text/);
    // linear-gradient 는 기능을 그리는 두 곳(슬라이더 채움 줄, select 화살표)에만 허용
    const bad = lines.filter((l) => /linear-gradient/.test(l) && !/\.range|^select \{/.test(l));
    expect(bad).toEqual([]);
    // 그림자 대신 또렷한 테두리: box-shadow 는 안쪽(inset) 선·하이라이트만 허용 — 바깥으로 번지는 그림자 금지
    const shadows = [...css.matchAll(/box-shadow\s*:\s*([^;]+);/g)].map((m) => m[1]!.trim());
    expect(shadows.filter((v) => v !== "none" && !/^inset /.test(v))).toEqual([]);
  });

  it("UT-D2 유리(backdrop-filter)는 헤더·탭바·요약바에만 쓰고, 투명도 줄이기·유리 미지원·고대비에서 불투명으로 바뀐다", () => {
    const allowed = new Set([".site-header", ".tabbar", ".sticky-bar"]);
    for (const r of rules) {
      const uses = /(?:-webkit-)?backdrop-filter\s*:\s*(?!none)/.test(r.body);
      if (!uses) continue;
      const sels = r.selector.split(",").map((s) => s.trim());
      expect(sels.every((s) => allowed.has(s)), `유리 허용 밖: ${r.selector}`).toBe(true);
    }
    expect(css).toMatch(/@media \(prefers-reduced-transparency: reduce\)\s*\{[^@]*backdrop-filter:\s*none/);
    expect(css).toMatch(/@media \(prefers-contrast: more\)/);
    expect(css).toMatch(/@supports not \(/);
  });

  it("UT-D3 모서리는 --r-* 토큰만 쓴다 (카드 28 ⊃ 패널 20, 조절 14 ⊃ 안쪽 10)", () => {
    expect(css).toMatch(/--r-xs:\s*10px;\s*--r-s:\s*14px;\s*--r-m:\s*20px;\s*--r-l:\s*28px;\s*--r-pill:\s*999px;/);
    const tokenOnly = /^(?:var\(--r-(?:xs|s|m|l|pill)\)|0|50%)$/;
    const bad: string[] = [];
    for (const m of css.matchAll(/border-radius\s*:\s*([^;]+);/g)) {
      for (const tok of m[1]!.trim().split(/\s+/)) if (!tokenOnly.test(tok)) bad.push(m[1]!.trim());
    }
    expect(bad).toEqual([]);
  });

  it("UT-D4 호버로 떠오르는 효과·통통 튀는 이징·키프레임 애니메이션이 없다", () => {
    expect(css).not.toMatch(/translateY\(\s*-/);
    expect(css).not.toMatch(/cubic-bezier\([^)]*-?\d+\.\d+\s*,\s*(?:1\.\d+|-\d)/); // overshoot(바운스)
    expect(css).not.toMatch(/@keyframes/);
  });

  it("UT-D5 강조색은 파랑 하나이고 보라·자주 계열을 쓰지 않는다", () => {
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
    const purples = hexes.filter((h) => { const x = hue(h); return x >= 260 && x <= 330; });
    expect(purples).toEqual([]);
  });

  it("UT-D6 마크업에 장식 요소(스파클·알약 태그·벤토·도넛·타일 아이콘)가 없다", () => {
    const files = [...srcFiles("src/server"), ...srcFiles("src/render")];
    const banned = /icon\("spark"|class="pill-tag"|class="bento"|class="tile|class="donut"|class="t-ico"|i-spark/;
    const hits = files.filter((f) => banned.test(readFileSync(new URL(`../../${f}`, import.meta.url), "utf8")));
    expect(hits).toEqual([]);
  });
});
