// 자동 생성 — scripts/build-registry.mjs (직접 고치지 않는다)
/* eslint-disable */
import r2026 from "../../data/rates/2026/rates.json";
import w2026 from "../../data/rates/2026/withholding.json";
import r2027 from "../../data/rates/2027/rates.json";

export const RAW: Record<number, { rates: unknown; withholding: unknown | undefined }> = {
  2026: { rates: r2026 as unknown, withholding: w2026 as unknown },
  2027: { rates: r2027 as unknown, withholding: undefined },
};
