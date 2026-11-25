import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "patched-ota-client": process.env.OTA_E2E_CLIENT_DIRECTORY!,
      "react-native": fileURLToPath(
        new URL("../fixtures/react-native-ui.tsx", import.meta.url),
      ),
    },
  },
  test: {
    include: ["scripts/tests/e2e/client-lifecycle.scenario.jsx"],
    environment: "jsdom",
    testTimeout: 90_000,
  },
});
