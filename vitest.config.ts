import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";

/** wrangler 의 `rules: Data` 와 같이 .ttf 를 ArrayBuffer 로 불러온다 (테스트용) */
function otfAsArrayBuffer(): Plugin {
  return {
    name: "otf-as-arraybuffer",
    enforce: "pre",
    load(id) {
      if (!id.endsWith(".ttf")) return null;
      const b64 = readFileSync(id).toString("base64");
      return `const b = Uint8Array.from(atob("${b64}"), (c) => c.charCodeAt(0)); export default b.buffer;`;
    },
  };
}

export default defineConfig({
  plugins: [otfAsArrayBuffer()],
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    environment: "node",
  },
});
