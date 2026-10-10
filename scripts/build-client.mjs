// src/client/main.ts → public/js/app.js (esbuild). 서버·브라우저가 같은 src/core, src/render 코드를 쓴다.
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

const watch = process.argv.includes("--watch");
const result = await build({
  entryPoints: ["src/client/main.ts"],
  outfile: "public/js/app.js",
  bundle: true,
  format: "esm",
  target: ["es2022", "safari15"],
  minify: !watch,
  sourcemap: false,
  legalComments: "none",
  logLevel: "warning",
  loader: { ".json": "json" },
});
const bytes = readFileSync("public/js/app.js");
console.log(`client: public/js/app.js ${(bytes.length / 1024).toFixed(1)}KB (gzip ${(gzipSync(bytes).length / 1024).toFixed(1)}KB)`);
void result;
