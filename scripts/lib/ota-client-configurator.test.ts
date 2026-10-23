import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { planOtaClient } from "./ota-client-configurator.mjs";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
function setup(main?: string) {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ota-entry-"));
  roots.push(appRoot);
  const options = {
    appRoot,
    templateRoot: path.resolve("templates/expo-app"),
    packageJson: main ? { main } : {},
    manifestUrl: "https://example.org/prefix/api/manifest",
    channel: "test",
    force: false,
  };
  return {
    options,
    entry: () => fs.readFileSync(path.join(appRoot, "ota-entry.js"), "utf8"),
  };
}
describe("configure-only bootstrap", () => {
  it("migrates legacy JavaScript modules without leaving files that shadow TypeScript", () => {
    const f = setup("expo-router/entry");
    const legacy = [
      "index.js",
      "index.d.ts",
      "runtime.js",
      "controller.js",
      "device-identity.js",
      "model/update-controller.js",
      "model/hooks/useOtaUpdates.js",
      "ui/ota-update-gate.js",
    ];
    for (const name of legacy) {
      const file = path.join(f.options.appRoot, "ota-client", name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "// old customized client");
    }
    const layout = path.join(f.options.appRoot, "app/_layout.tsx");
    fs.mkdirSync(path.dirname(layout), { recursive: true });
    fs.writeFileSync(
      layout,
      `import { useOtaUpdates, OtaUpdateGate } from '../ota-client';
import { createElement } from 'react';
export default function Layout() {
  const ota = useOtaUpdates({ autoCheck: true, autoUpdate: true });
  return createElement(OtaUpdateGate, { controller: ota }, <AppTabs />);
}`,
    );
    expect(() => planOtaClient(f.options)).toThrow("Refusing");
    expect(
      fs.existsSync(path.join(f.options.appRoot, "ota-client/index.js")),
    ).toBe(true);
    planOtaClient({ ...f.options, force: true }).apply();
    for (const name of legacy)
      expect(
        fs.existsSync(path.join(f.options.appRoot, "ota-client", name)),
      ).toBe(false);
    expect(
      fs.existsSync(path.join(f.options.appRoot, "ota-client/index.ts")),
    ).toBe(true);
    const migrated = fs.readFileSync(layout, "utf8");
    expect(migrated).toContain("<OtaUpdates");
    expect(migrated).toContain("autoUpdate: true");
    expect(migrated).not.toContain("createElement");
    planOtaClient({
      ...f.options,
      packageJson: { main: "ota-entry.js" },
    }).apply();
    expect(fs.readFileSync(layout, "utf8")).toBe(migrated);
  });
  it("preserves Router entry across repeated configurations and keeps URL prefix", () => {
    const f = setup("expo-router/entry");
    const plan = planOtaClient(f.options);
    plan.apply();
    expect(f.entry()).toContain('require("expo-router/entry")');
    planOtaClient({
      ...f.options,
      packageJson: plan.patchPackage(f.options.packageJson),
    }).apply();
    expect(f.entry()).toContain('require("expo-router/entry")');
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(f.options.appRoot, "ota-client/config.json"),
          "utf8",
        ),
      ).heartbeatUrl,
    ).toBe("https://example.org/prefix/api/device-heartbeat");
  });
  it("uses platform-aware root index when main is missing", () => {
    const f = setup();
    fs.writeFileSync(path.join(f.options.appRoot, "index.android.ts"), "");
    planOtaClient(f.options).apply();
    expect(
      fs.readFileSync(
        path.join(f.options.appRoot, "ota-original-entry.android.js"),
        "utf8",
      ),
    ).toContain('require("./index")');
    expect(
      fs.readFileSync(
        path.join(f.options.appRoot, "ota-original-entry.ios.js"),
        "utf8",
      ),
    ).toContain("require('./App')");
  });
  it("registers root App fallback without depending on hoisted expo/AppEntry", () => {
    const f = setup();
    planOtaClient(f.options).apply();
    expect(
      fs.readFileSync(
        path.join(f.options.appRoot, "ota-original-entry.ios.js"),
        "utf8",
      ),
    ).toContain("registerRootComponent(require('./App').default)");
    planOtaClient({
      ...f.options,
      packageJson: { main: "ota-entry.js" },
    }).apply();
  });
  it("resolves extensionless local main", () => {
    const f = setup("bootstrap");
    fs.writeFileSync(path.join(f.options.appRoot, "bootstrap.tsx"), "");
    planOtaClient(f.options).apply();
    expect(f.entry()).toContain('require("./bootstrap")');
  });
  it("normalizes an existing local custom main and refuses edits without force", () => {
    const f = setup("entry.js");
    fs.writeFileSync(path.join(f.options.appRoot, "entry.js"), "");
    planOtaClient(f.options).apply();
    expect(f.entry()).toContain('require("./entry.js")');
    fs.writeFileSync(
      path.join(f.options.appRoot, "ota-client/index.ts"),
      "user changes",
    );
    expect(() =>
      planOtaClient({ ...f.options, packageJson: { main: "ota-entry.js" } }),
    ).toThrow("Refusing");
  });
  it("automatically starts the client, preserves namespace when URL/channel changes, and copies identity model", () => {
    const f = setup("expo-router/entry");
    planOtaClient(f.options).apply();
    expect(
      f.entry().indexOf("require('./ota-client/runtime').start()"),
    ).toBeLessThan(f.entry().indexOf('require("expo-router/entry")'));
    expect(
      fs.existsSync(
        path.join(f.options.appRoot, "ota-client/device-identity.ts"),
      ),
    ).toBe(true);
    planOtaClient({
      ...f.options,
      packageJson: { main: "ota-entry.js" },
      manifestUrl: "https://new-tunnel.example/api/manifest",
      channel: "another",
      force: true,
    }).apply();
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(f.options.appRoot, "ota-client/config.json"),
          "utf8",
        ),
      ).identityNamespace,
    ).toBe("https://example.org");
  });

  it("patches the Router layout without force and preserves custom hook modes on rerun", () => {
    const f = setup("expo-router/entry");
    const layout = path.join(f.options.appRoot, "src/app/_layout.tsx");
    fs.mkdirSync(path.dirname(layout), { recursive: true });
    fs.writeFileSync(
      layout,
      "export default function Root() { return null; }\n",
    );
    const plan = planOtaClient(f.options);
    expect(plan.warnings).toEqual([]);
    plan.apply();
    expect(fs.readFileSync(layout, "utf8")).toContain("<OtaUpdates autoCheck");
    expect(
      fs.existsSync(
        path.join(f.options.appRoot, "ota-client/model/hooks/useOtaUpdates.ts"),
      ),
    ).toBe(true);
    const customized = fs
      .readFileSync(layout, "utf8")
      .replace("autoUpdate={false}", "autoUpdate={true}");
    fs.writeFileSync(layout, customized);
    planOtaClient({
      ...f.options,
      packageJson: plan.patchPackage(f.options.packageJson),
    }).apply();
    expect(fs.readFileSync(layout, "utf8")).toBe(customized);
  });

  it("preflights an unsupported root without mutating application or generated files", () => {
    const f = setup("expo-router/entry");
    const layout = path.join(f.options.appRoot, "app/_layout.tsx");
    const original = "export default memo(() => null);\n";
    fs.mkdirSync(path.dirname(layout), { recursive: true });
    fs.writeFileSync(layout, original);
    expect(() => planOtaClient(f.options)).toThrow("unsupported default root");
    expect(fs.readFileSync(layout, "utf8")).toBe(original);
    expect(fs.existsSync(path.join(f.options.appRoot, "ota-entry.js"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(f.options.appRoot, "ota-client"))).toBe(
      false,
    );
  });

  it("preserves all files if an aliased existing OTA hook cannot be safely resolved", () => {
    const f = setup("expo-router/entry");
    const layout = path.join(f.options.appRoot, "app/_layout.tsx");
    const original =
      "import { useOtaUpdates } from '@/ota-client'; export default function Root() { const ota = useOtaUpdates({ autoCheck: false }); return null; }\n";
    fs.mkdirSync(path.dirname(layout), { recursive: true });
    fs.writeFileSync(layout, original);
    expect(() => planOtaClient(f.options)).toThrow(
      "use a relative import to ota-client",
    );
    expect(fs.readFileSync(layout, "utf8")).toBe(original);
    expect(fs.existsSync(path.join(f.options.appRoot, "ota-entry.js"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(f.options.appRoot, "ota-client"))).toBe(
      false,
    );
  });
});
