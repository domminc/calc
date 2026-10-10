export interface Env {
  ASSETS: Fetcher;
  /** Neon (Hyperdrive). 없으면 공유·통계·신고 기능만 꺼진다 */
  HYPERDRIVE?: Hyperdrive;
  /** R2: exports/ (내려받기 캐시), sources/ (근거 원문) */
  FILES?: R2Bucket;
  SITE_ORIGIN?: string;
  ASSET_VERSION?: string;
  /** IP 해시용 비밀값 (Worker secret). 없으면 고정 문자열 */
  IP_SALT?: string;
}

export const DEFAULT_ORIGIN = "https://calc.homesell.co.kr";
export const origin = (env: Env): string => (env.SITE_ORIGIN ?? DEFAULT_ORIGIN).replace(/\/$/, "");
