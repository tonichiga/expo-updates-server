import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": rootDir,
    },
  },
  test: {
    alias: {
      'react-native': path.join(rootDir, 'scripts/tests/fixtures/react-native-ui.tsx'),
    },
    environment: "node",
    exclude: [
      ...configDefaults.exclude,
      "packages/create-expo-updates-server/**",
    ],
  },
});
