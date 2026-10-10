// 소득세법 시행령 별표2(근로소득 간이세액표) 개정 탐지. 법제처 lawService XML 에서 별표 제목·개정일·PDF 링크를 찾는다.
// 별표 요소의 태그 이름이 바뀌어도 동작하도록 "제목에 [별표 2]·간이세액표가 있는 블록" 안의 flDownload 링크를 정규식으로 찾는다.

export interface Annex {
  title: string;
  /** 개정일 YYYY-MM-DD (제목의 <개정 2026. 2. 27.>) */
  revision: string;
  /** flDownload.do?flSeq= 값 (PDF 우선) */
  flSeq: string;
}

const REV = /<개정\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?>|&lt;개정\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?&gt;/;

export function revisionOf(title: string): string | undefined {
  const m = REV.exec(title);
  if (!m) return undefined;
  const [y, mo, d] = m[1] ? [m[1], m[2], m[3]] : [m[4], m[5], m[6]];
  return `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
}

/** 시행령 XML 에서 [별표 2] 근로소득 간이세액표를 찾는다. 없으면 undefined */
export function findWithholdingAnnex(xml: string): Annex | undefined {
  const blocks = xml.match(/<별표단위[^>]*>[\s\S]*?<\/별표단위>/g) ?? [];
  for (const b of blocks) {
    const head = b.slice(0, 1500);
    if (!/\[별표\s*2\]/.test(head) || !/간이세액표/.test(head)) continue;
    // 내용(<별표내용>)은 매우 길 수 있으니 링크는 내용 앞쪽에서만 찾는다
    const pre = b.replace(/<별표내용>[\s\S]*?<\/별표내용>/, "");
    const links = [...pre.matchAll(/flDownload\.do\?(?:[^"'<\s]*?&(?:amp;)?)?flSeq=(\d+)/g)];
    if (!links.length) continue;
    const pdfLine = pre.split(/\n|></).find((l) => /PDF/.test(l) && /flSeq=\d+/.test(l));
    const pdfSeq = pdfLine ? /flSeq=(\d+)/.exec(pdfLine)?.[1] : undefined;
    const title = /<별표제목>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/별표제목>/.exec(pre)?.[1]?.trim() ?? head.slice(0, 200);
    const revision = revisionOf(title) ?? revisionOf(pre);
    if (!revision) continue;
    return { title, revision, flSeq: pdfSeq ?? links[links.length - 1]![1]! };
  }
  return undefined;
}

/** 개정일 다음 달 1일 — 간이세액표는 통상 개정 다음 달부터 적용된다 (2026-02-27 개정 → 2026-03-01 시행). 부칙으로 확인 필요. */
export function guessEffectiveFrom(revision: string): string {
  const [y, m] = revision.split("-").map(Number) as [number, number];
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}
