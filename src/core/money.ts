// 금액 계산 보조. 모든 값은 원 단위 정수. 곱셈은 정수 비율(ppm)로 해서 부동소수 오차를 피한다.

export const floor10 = (x: number): number => Math.floor(x / 10) * 10;
export const floor1000 = (x: number): number => Math.floor(x / 1000) * 1000;
export const clamp = (x: number, lo: number, hi: number): number => Math.min(Math.max(x, lo), hi);

/** 요율(0.0475)을 백만분율 정수(47500)로. */
export const ppm = (rate: number): number => Math.round(rate * 1_000_000);

/** ⌊x × ppm / 1,000,000⌋ */
export const mulPpm = (x: number, rppm: number): number => Math.floor((x * rppm) / 1_000_000);

export const won = (n: number): string => `${Math.round(n).toLocaleString("ko-KR")}원`;
export const num = (n: number): string => Math.round(n).toLocaleString("ko-KR");

/** 요율 표시: 0.0475 → "4.75%" */
export function pct(rate: number): string {
  const s = (rate * 100).toFixed(4).replace(/\.?0+$/, "");
  return `${s}%`;
}

/** YYYY-MM-DD 형식 검사 + 실제 달력 날짜인지. */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
