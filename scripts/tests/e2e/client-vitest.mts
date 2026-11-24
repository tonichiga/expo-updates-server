import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "react-native": fileURLToPath(new URL("../fixtures/react-native-ui.tsx", import.meta.url)),
    },
  },
  test: {
    include: ["scripts/tests/e2e/client-lifecycle.scenario.jsx"],
    environment: "jsdom",
    testTimeout: 90_000,
  },
});
