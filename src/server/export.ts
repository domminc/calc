// 엑셀(.xlsx)·PDF 생성. PDF 는 Pretendard 서브셋(TrueType) 폰트를 내장한다 (scripts/build-pdf-font.py).
import writeXlsxFile from "write-excel-file/universal";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import regularTtf from "./fonts/Pretendard-Regular.subset.ttf";
import type { Report, Cell } from "./report.ts";

const fmt = (c: Cell): string => (typeof c === "number" ? c.toLocaleString("ko-KR") : c);

export async function toXlsx(rep: Report): Promise<Uint8Array> {
  const bold = { fontWeight: "bold" as const };
  const data: unknown[][] = [
    [{ value: rep.title, ...bold, fontSize: 14 }],
    [{ value: rep.subtitle, color: "#6a6f76" }],
    [],
    [{ value: rep.hero.label, ...bold }, { value: rep.hero.value, type: Number, format: "#,##0", ...bold }, rep.hero.unit],
    [],
    [{ value: "입력", ...bold }],
    ...rep.inputs.map(([k, v]) => [k, v]),
  ];
  for (const s of rep.sections) {
    data.push([], [{ value: s.heading, ...bold }]);
    data.push(s.columns.map((c, i) => ({ value: c, ...bold, backgroundColor: "#f0f0ec", align: i === s.columns.length - 1 || typeof s.rows[0]?.[i] === "number" ? "right" : "left" })));
    for (const r of s.rows) data.push(r.map((c) => (typeof c === "number" ? { value: c, type: Number, format: "#,##0" } : c)));
    if (s.total) data.push(s.total.map((c) => (typeof c === "number" ? { value: c, type: Number, format: "#,##0", ...bold } : { value: c, ...bold })));
  }
  data.push([]);
  for (const n of rep.notes) data.push([{ value: n, color: "#6a6f76" }]);
  const blob = await writeXlsxFile(data as never, { sheet: "계산 결과", columns: [{ width: 28 }, { width: 52 }, { width: 18 }, { width: 18 }] } as never).toBlob();
  return new Uint8Array(await blob.arrayBuffer());
}

const PAGE = { w: 595.28, h: 841.89, m: 48 };
const INK = rgb(0.067, 0.075, 0.082);
const SUB = rgb(0.416, 0.435, 0.463);
const ACCENT = rgb(0.043, 0.42, 0.322);
const LINE = rgb(0.894, 0.894, 0.871);

export async function toPdf(rep: Report): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  // subset:true 는 pdf-lib 의 fontkit 이 글자를 빠뜨려 쓰지 않는다 (scripts/build-pdf-font.py 주석)
  const reg = await pdf.embedFont(regularTtf, { subset: false });
  const bld = Object.create(reg) as PDFFont; // 굵은 글씨 표시용 구분값 (같은 글꼴을 겹쳐 찍는다)
  pdf.setTitle(rep.title);
  pdf.setProducer("homesell 계산기");
  pdf.setCreator("homesell 계산기");

  let page = pdf.addPage([PAGE.w, PAGE.h]);
  let y = PAGE.h - PAGE.m;
  const maxX = PAGE.w - PAGE.m;

  const newPage = () => {
    page = pdf.addPage([PAGE.w, PAGE.h]);
    y = PAGE.h - PAGE.m;
  };
  const need = (h: number) => {
    if (y - h < PAGE.m + 24) newPage();
  };
  // 폰트에 없는 글자(서브셋 밖의 한글·이모지 등)는 ? 로
  const charset = new Set(reg.getCharacterSet());
  const safe = (_font: PDFFont, s: string) => {
    let out = "";
    for (const ch of s) out += charset.has(ch.codePointAt(0)!) || ch === "\n" ? ch : "?";
    return out;
  };
  const wrap = (font: PDFFont, text: string, size: number, width: number): string[] => {
    const lines: string[] = [];
    let cur = "";
    for (const ch of safe(font, text)) {
      if (ch === "\n") { lines.push(cur); cur = ""; continue; }
      if (font.widthOfTextAtSize(cur + ch, size) > width) { lines.push(cur); cur = ch; } else cur += ch;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  };
  const text = (p: PDFPage, s: string, x: number, yy: number, size: number, font = reg, color = INK) => {
    const t = safe(font, s);
    p.drawText(t, { x, y: yy, size, font: reg, color });
    if (font === bld) p.drawText(t, { x: x + size * 0.025, y: yy, size, font: reg, color });
  };
  const right = (p: PDFPage, s: string, xr: number, yy: number, size: number, font = reg, color = INK) => {
    const t = safe(font, s);
    text(p, t, xr - reg.widthOfTextAtSize(t, size), yy, size, font, color);
  };

  text(page, "homesell 계산기", PAGE.m, y, 10, bld, ACCENT);
  y -= 26;
  text(page, rep.title, PAGE.m, y, 20, bld);
  y -= 18;
  text(page, rep.subtitle, PAGE.m, y, 10, reg, SUB);
  y -= 34;
  text(page, rep.hero.label, PAGE.m, y, 11, reg, SUB);
  y -= 30;
  text(page, `${rep.hero.value.toLocaleString("ko-KR")}${rep.hero.unit}`, PAGE.m, y, 30, bld, ACCENT);
  y -= 26;

  for (const [k, v] of rep.inputs) {
    need(16);
    text(page, k, PAGE.m, y, 10, reg, SUB);
    right(page, v, maxX, y, 10);
    y -= 15;
  }
  y -= 8;

  for (const s of rep.sections) {
    need(60);
    y -= 8;
    text(page, s.heading, PAGE.m, y, 12, bld);
    y -= 8;
    page.drawLine({ start: { x: PAGE.m, y }, end: { x: maxX, y }, thickness: 0.7, color: INK });
    y -= 15;
    const n = s.columns.length;
    const textCols = n === 3 ? [0, 1] : n === 2 ? [0] : [0];
    const widths = n === 3 ? [130, maxX - PAGE.m - 130 - 90, 90] : n === 2 ? [maxX - PAGE.m - 120, 120] : [130, 120, 120, 120].map((w, i) => (i === 0 ? maxX - PAGE.m - 360 : w));
    const xs: number[] = [];
    widths.reduce((acc, w) => { xs.push(acc); return acc + w; }, PAGE.m);
    const drawRow = (cells: Cell[], font: PDFFont, color = INK) => {
      const wrapped = cells.map((c, i) => (typeof c === "number" || !textCols.includes(i) && n !== 2 && n !== 3 ? [fmt(c)] : wrap(font, fmt(c), 9.5, widths[i]! - 8)));
      const h = Math.max(...wrapped.map((w) => w.length)) * 13 + 4;
      need(h);
      cells.forEach((c, i) => {
        const isNum = typeof c === "number" || (i === cells.length - 1) || (n === 4 && i > 0);
        wrapped[i]!.forEach((line, li) => {
          const yy = y - li * 13;
          if (isNum) right(page, line, xs[i]! + widths[i]! - 2, yy, 9.5, font, color);
          else text(page, line, xs[i]!, yy, 9.5, font, color);
        });
      });
      y -= h;
      page.drawLine({ start: { x: PAGE.m, y: y + 8 }, end: { x: maxX, y: y + 8 }, thickness: 0.4, color: LINE });
    };
    drawRow(s.columns, bld, SUB);
    for (const r of s.rows) drawRow(r, reg);
    if (s.total) drawRow(s.total, bld);
    y -= 6;
  }

  y -= 10;
  for (const note of rep.notes) {
    for (const line of wrap(reg, note, 8.5, maxX - PAGE.m)) {
      need(12);
      text(page, line, PAGE.m, y, 8.5, reg, SUB);
      y -= 12;
    }
    y -= 3;
  }

  const pages = pdf.getPages();
  pages.forEach((p, i) => right(p, `${i + 1} / ${pages.length}`, maxX, 24, 8, reg, SUB));
  return pdf.save();
}

export function contentDisposition(name: string, ext: string): string {
  const full = `${name}.${ext}`;
  return `attachment; filename="calc.${ext}"; filename*=UTF-8''${encodeURIComponent(full)}`;
}
