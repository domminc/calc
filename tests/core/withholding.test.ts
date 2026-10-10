import { describe, expect, it } from "vitest";
import { resolveRates } from "../../src/core/rates.ts";
import { withholdingTax, childCredit } from "../../src/core/withholding.ts";

const w = resolveRates("2026-10-10").set.withholding;
const tax = (T: number, f = 1, c = 0) => withholdingTax(w, T, f, c).tax;

describe("간이세액표 — 원문(별표2, 2026.2.27) 대조", () => {
  it("월 3,010천원: 가족 1·2·3명", () => {
    expect(tax(3_010_000, 1)).toBe(74_350);
    expect(tax(3_010_000, 2)).toBe(56_850);
    expect(tax(3_010_000, 3)).toBe(31_940);
  });
  it("경계: [이상, 미만) — 3,000천원은 3,000~3,020 행", () => {
    expect(tax(3_000_000, 1)).toBe(74_350);
    expect(tax(2_999_999, 1)).toBe(73_060);
  });
  it("월 2,500천원 / 5,000천원", () => {
    expect(tax(2_500_000, 1)).toBe(35_600);
    expect(tax(5_000_000, 1)).toBe(335_470);
  });
  it("770천원 미만은 0, 770천원부터 표 시작", () => {
    expect(tax(769_999, 1)).toBe(0);
    expect(withholdingTax(w, 769_999, 1, 0).zeroBand).toBe(true);
    expect(tax(770_000, 1)).toBe(0);
  });
  it("10,000천원 행과 초과 계산식", () => {
    expect(tax(10_000_000, 1)).toBe(1_507_400);
    // 12,000천원: 1,507,400 + 2,000,000×0.98×35% + 25,000
    expect(tax(12_000_000, 1)).toBe(2_218_400);
    // 14,000천원 경계는 아직 첫 구간 (이하)
    expect(tax(14_000_000, 1)).toBe(1_507_400 + 4_000_000 * 0.98 * 0.35 + 25_000);
    // 14,000천원 초과: at10000 + 1,397,000 + 초과 × 98% × 38%
    expect(tax(20_000_000, 1)).toBe(Math.floor((1_507_400 + 1_397_000 + 6_000_000 * 0.98 * 0.38) / 10) * 10);
    // 87,000천원 초과
    expect(tax(100_000_000, 1)).toBe(Math.floor((1_507_400 + 31_034_600 + 13_000_000 * 0.45) / 10) * 10);
  });
  it("구간 연속성: 모든 구간의 끝과 다음 구간의 시작이 이어진다 (646구간)", () => {
    expect(w.bands.length).toBe(646);
    for (let i = 1; i < w.bands.length; i++) expect(w.bands[i]![0]).toBe(w.bands[i - 1]![1]);
  });
  it("가족이 늘면 세액은 줄거나 같다 (모든 구간)", () => {
    for (const b of w.bands) for (let f = 1; f < 11; f++) expect(b[2 + f]!).toBeLessThanOrEqual(b[1 + f]!);
  });
  it("자녀 세액공제 20,830 / 45,830 / +33,330, 음수는 0", () => {
    expect(childCredit(w, 1)).toBe(20_830);
    expect(childCredit(w, 2)).toBe(45_830);
    expect(childCredit(w, 3)).toBe(79_160);
    expect(childCredit(w, 4)).toBe(112_490);
    expect(tax(3_010_000, 3, 1)).toBe(31_940 - 20_830);
    expect(tax(1_000_000, 1, 3)).toBe(0);
  });
  it("가족 11명 초과: 별표 4호 계산식", () => {
    const t10 = tax(5_000_000, 10);
    const t11 = tax(5_000_000, 11);
    expect(tax(5_000_000, 13)).toBe(Math.max(0, t11 - (t10 - t11) * 2));
  });
  it("지방소득세 = 소득세 × 10% (10원 미만 절사)", () => {
    expect(withholdingTax(w, 3_010_000, 1, 0).localTax).toBe(7_430);
  });
});

describe("간이세액표 무결성 — 이상치 검사 (파싱 오류 탐지)", () => {
  it("UT-W1 구간별 증가폭이 이웃과 3배 넘게 어긋나는 곳은 알려진 불연속뿐이다", () => {
    const b = w.bands;
    const known = new Set<number>([5840]); // 연 7,000만원: 별표2 1호 특별소득공제 계산식이 바뀌는 경계 (월 5,833천원 → 5,840천원 구간)
    const unexpected: string[] = [];
    for (let f = 0; f < 11; f++) {
      const col = b.map((r) => r[2 + f]!);
      const slope = b.slice(1).map((r, i) => (col[i + 1]! - col[i]!) / (r[1]! - r[0]!));
      for (let i = 2; i < slope.length - 2; i++) {
        const nb = [slope[i - 2]!, slope[i - 1]!, slope[i + 1]!, slope[i + 2]!].sort((x, y) => x - y);
        const med = (nb[1]! + nb[2]!) / 2;
        const start = b[i + 1]![0]!;
        const zeroOnset = col[i]! === 0 || col[i - 1]! === 0 || col[i + 1]! === 0 || col[i - 2]! === 0; // 세액이 0 에서 처음 생기는 지점
        if (med > 1 && !zeroOnset && (slope[i]! > med * 3 || slope[i]! < med / 3) && !known.has(start)) unexpected.push(`가족${f + 1} ${start}천원`);
      }
    }
    expect(unexpected).toEqual([]);
  });
  it("UT-W2 모든 세액이 10원 단위", () => {
    for (const r of w.bands) for (let k = 2; k < 13; k++) expect(r[k]! % 10).toBe(0);
  });
  it("UT-W3 원문 파일 해시 고정 (표를 바꾸면 이 값과 함께 검토)", () => {
    expect(w.sourceSha256).toBe("5307b1d45c8f946ca2d54f10b1731b2ec8cfd1a26efb653673c13d660ae3b698");
  });
});
