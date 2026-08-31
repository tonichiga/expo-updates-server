import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "docs/.vitepress/cache/**",
    "docs/.vitepress/dist/**",
    "packages/create-expo-updates-server/dist/**",
    "packages/create-expo-updates-server/.dist-building-*/**",
    "packages/create-expo-updates-server/.test-work/**",
    "packages/create-expo-updates-server/.smoke-work/**",
    "next-env.d.ts",
  ]),
  {
    files: ["templates/expo-app/plugins/**/*.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
