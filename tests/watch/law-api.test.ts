import { describe, expect, it } from "vitest";
import {
  diffSnapshots,
  hasChanges,
  lawEntries,
  parseItems,
  reportMarkdown,
  ruleEntries,
  totalCount,
  upcoming,
  type Snapshot,
  type Targets,
} from "../../src/watch/law-api.ts";
import { findWithholdingAnnex, guessEffectiveFrom, revisionOf } from "../../src/watch/annex.ts";

const item = (tag: string, f: Record<string, string>, id = 1) =>
  `<${tag} id="${id}">${Object.entries(f).map(([k, v]) => `<${k}><![CDATA[${v}]]></${k}>`).join("")}</${tag}>`;
const wrap = (root: string, total: number, items: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><${root}><target>x</target><totalCnt>${total}</totalCnt><resultCode>00</resultCode>${items.join("")}</${root}>`;

const law = (name: string, status: string, mst: string, eff: string, prom: string, kind = "일부개정") =>
  item("law", { 법령일련번호: mst, 현행연혁코드: status, 법령명한글: name, 공포일자: prom, 시행일자: eff, 제개정구분명: kind });

describe("법제처 API 응답 해석", () => {
  it("UT-L1 항목·총 건수 파싱 (CDATA 포함)", () => {
    const xml = wrap("LawSearch", 2, [law("소득세법", "현행", "280405", "20260701", "20251223"), law("소득세법 시행령", "시행예정", "1", "20270101", "20260930")]);
    expect(totalCount(xml)).toBe(2);
    const items = parseItems(xml, "law");
    expect(items.length).toBe(2);
    expect(items[0]).toMatchObject({ 법령명한글: "소득세법", 현행연혁코드: "현행", 시행일자: "20260701" });
  });

  it("UT-L2 법령명이 정확히 같은 현행·시행예정만 남기고 연혁은 버린다, 시행일 순", () => {
    const xml = wrap("LawSearch", 5, [
      law("소득세법", "시행예정", "3", "20270101", "20241231"),
      law("소득세법", "연혁", "2", "20250101", "20241231"),
      law("소득세법 시행령", "현행", "9", "20261001", "20260930"), // 이름이 다르면 제외
      law("소득세법", "현행", "1", "20260701", "20251223"),
      law("소득세법", "현행", "1", "20260701", "20251223"), // 중복
    ]);
    const e = lawEntries(parseItems(xml, "law"), "소득세법");
    expect(e.map((x) => `${x.status}${x.effective}`)).toEqual(["현행20260701", "시행예정20270101"]);
  });

  it("UT-L3 고시: 소관부처·이름 패턴으로 거르고 최근 발령순 8건", () => {
    const rule = (id: string, name: string, agency: string, issued: string) => item("admrul", { 행정규칙일련번호: id, 행정규칙명: name, 소관부처명: agency, 발령일자: issued, 시행일자: issued, 현행연혁구분: "현행" });
    const xml = wrap("AdmRulSearch", 4, [
      rule("1", "2026년 적용 최저임금 고시", "고용노동부", "20250805"),
      rule("2", "2027년 적용 최저임금 고시", "고용노동부", "20260805"),
      rule("3", "2026년 선원 최저임금 고시", "해양수산부", "20251208"),
      rule("4", "최저임금법 제5조에 따른 단순노무직종 근로자 지정 고시", "고용노동부", "20180319"),
    ]);
    const e = ruleEntries(parseItems(xml, "admrul"), { agency: "고용노동부", match: "^\\d{4}년 적용 최저임금" });
    expect(e.map((x) => x.id)).toEqual(["2", "1"]);
  });
});

const targets: Targets = {
  laws: [{ name: "소득세법", affects: ["세율"] }],
  rules: [{ id: "min-wage", label: "최저임금 고시", query: "최저임금", agency: "고용노동부", match: "^\\d{4}년", affects: ["최저임금"] }],
};
const snap = (laws: Snapshot["laws"], rules: Snapshot["rules"]): Snapshot => ({ checkedAt: "2026-10-11", laws, rules });
const L = (status: "현행" | "시행예정", mst: string, effective: string) => ({ status, mst, effective, promulgated: "20260930", kind: "일부개정" });

describe("변경 감지", () => {
  const base = snap({ 소득세법: [L("현행", "1", "20260701"), L("시행예정", "2", "20270101")] }, { "min-wage": [{ id: "10", name: "2026년 적용 최저임금 고시", issued: "20250805", effective: "20260101", status: "현행" }] });

  it("UT-L4 같으면 변경 없음", () => {
    expect(hasChanges(diffSnapshots(targets, base, structuredClone(base)))).toBe(false);
  });

  it("UT-L5 새 시행예정 개정과 새 고시를 잡는다", () => {
    const after = structuredClone(base);
    after.laws["소득세법"]!.push(L("시행예정", "3", "20280101"));
    after.rules["min-wage"]!.unshift({ id: "11", name: "2027년 적용 최저임금 고시", issued: "20260805", effective: "20270101", status: "현행" });
    const c = diffSnapshots(targets, base, after);
    expect(c.laws[0]!.change.added.map((e) => e.mst)).toEqual(["3"]);
    expect(c.rules[0]!.change.added.map((e) => e.id)).toEqual(["11"]);
    const md = reportMarkdown(c, "2026-10-11");
    expect(md).toContain("소득세법");
    expect(md).toContain("시행 2028-01-01");
    expect(md).toContain("2027년 적용 최저임금 고시");
    expect(md).toContain("lsiSeq=3");
  });

  it("UT-L6 시행예정이 시행되어 현행으로 바뀌면 (일련번호·상태 변경) 알린다", () => {
    const after = structuredClone(base);
    after.laws["소득세법"] = [L("현행", "2", "20270101")];
    const c = diffSnapshots(targets, base, after);
    expect(c.laws[0]!.change.added.map((e) => `${e.status}${e.mst}`)).toEqual(["현행2"]);
    expect(c.laws[0]!.change.removed.length).toBe(2);
  });

  it("UT-L7 앞으로 시행될 개정 목록은 기준일 이후만, 시행일 순", () => {
    const s = snap({ 소득세법: [L("현행", "1", "20260701"), L("시행예정", "2", "20270101"), L("시행예정", "9", "20260101")] }, {});
    expect(upcoming(s, "2026-10-11").map((u) => u.effective)).toEqual(["20270101"]);
  });
});

describe("간이세액표(별표2) 개정 탐지", () => {
  const block = (title: string, link: string) =>
    `<별표단위 별표키="1"><별표번호>0002</별표번호><별표제목><![CDATA[${title}]]></별표제목><별표서식PDF파일링크>${link}</별표서식PDF파일링크><별표내용><![CDATA[표 본문 flSeq=999]]></별표내용></별표단위>`;

  it("UT-L8 제목의 개정일과 PDF 링크를 찾는다", () => {
    const xml = `<법령>${block("[별표 1] <개정 2026. 1. 1.> 다른 표", "/LSW/flDownload.do?flSeq=111")}${block("[별표 2] <개정 2026. 2. 27.> 근로소득 간이세액표(제189조제1항 관련)", "/LSW/flDownload.do?flSeq=164357181&bylClsCd=110201")}</법령>`;
    const a = findWithholdingAnnex(xml);
    expect(a?.revision).toBe("2026-02-27");
    expect(a?.flSeq).toBe("164357181");
  });

  it("UT-L9 못 찾으면 undefined (엉뚱한 표를 고르지 않는다)", () => {
    expect(findWithholdingAnnex(`<법령>${block("[별표 3] <개정 2026. 1. 1.> 다른 표", "/LSW/flDownload.do?flSeq=1")}</법령>`)).toBeUndefined();
  });

  it("UT-L10 개정일 추출과 시행일 추정 (개정 다음 달 1일)", () => {
    expect(revisionOf("[별표 2] <개정 2027. 3. 5.> 근로소득 간이세액표")).toBe("2027-03-05");
    expect(revisionOf("&lt;개정 2024. 2. 29.&gt;")).toBe("2024-02-29");
    expect(guessEffectiveFrom("2026-02-27")).toBe("2026-03-01");
    expect(guessEffectiveFrom("2026-12-15")).toBe("2027-01-01");
  });
});
