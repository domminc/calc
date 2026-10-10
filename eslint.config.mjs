import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["src/core/registry.generated.ts", "node_modules", ".wrangler", "public/js", "test-results", "playwright-report", "scripts/*.py", "data"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "off",
    },
  },
  { files: ["scripts/**/*.mjs"], languageOptions: { globals: { process: "readonly", console: "readonly" } } },
);
