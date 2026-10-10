// 서버·브라우저 공용 HTML 문자열 도우미. 사용자 입력은 항상 esc() 를 거친다.
export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const comma = (n: number): string => Math.round(n).toLocaleString("ko-KR");
export const wonText = (n: number): string => `${comma(n)}원`;

/** 40,000,000 → "4천만 원", 123,456,789 → "1억 2,345만 6,789원" */
export function hangulWon(n: number): string {
  const v = Math.floor(Math.abs(n));
  if (v === 0) return "0원";
  const eok = Math.floor(v / 100_000_000);
  const man = Math.floor((v % 100_000_000) / 10_000);
  const rest = v % 10_000;
  const parts: string[] = [];
  if (eok) parts.push(`${comma(eok)}억`);
  if (man) {
    const thousand = Math.floor(man / 1000);
    parts.push(man % 1000 === 0 && thousand ? `${thousand}천만` : `${comma(man)}만`);
  }
  if (rest) parts.push(comma(rest));
  const s = parts.join(" ");
  return rest || !(man || eok) ? `${s}원` : `${s} 원`;
}

export function attrs(a: Record<string, string | number | boolean | undefined | null>): string {
  return Object.entries(a)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
    .join("");
}
