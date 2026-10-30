import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // web/ is the Astro frontend with its own type check (npm --prefix web run check);
  // _incoming/ holds unpacked downloads and is never source.
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "web/**", "_incoming/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  {
    files: ["tests/**/*.mjs", "scripts/**/*.mjs", "bin/**/*.mjs", "*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
);
