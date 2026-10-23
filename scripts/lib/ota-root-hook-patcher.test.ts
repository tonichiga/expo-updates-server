import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { patchOtaRootHook, planOtaRootHook } from "./ota-root-hook-patcher.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
const root = "/example";
const filename = "/example/src/app/_layout.tsx";
function patch(source: string, file = filename) {
  return patchOtaRootHook(source, file, root);
}
function assertValid(source: string, file = filename) {
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  });
  expect(result.diagnostics).toEqual([]);
}
describe("root OTA component patch", () => {
  it("renders JSX siblings, preserves comments and is idempotent with custom props", () => {
    const source = `'use client';\n// Header\nimport { Stack } from 'expo-router';\nexport default function Layout() {\n  // Keep this check.\n  if (loading) return null;\n  return <Stack />;\n}\n`;
    const result = patch(source);
    expect(result).toContain("'use client';");
    expect(result).toContain("// Keep this check.");
    expect(result).toContain("from '../../ota-client'");
    expect(result.match(/<OtaUpdates /g)).toHaveLength(2);
    expect(result).toContain("autoCheck autoUpdate={false} autoReload={false}");
    expect(result).not.toContain("createElement");
    expect(result).not.toContain("useOtaUpdates");
    expect(result).toContain("      <Stack />");
    const custom = result.replaceAll("autoUpdate={false}", "autoUpdate={true}");
    expect(patch(custom)).toBe(custom);
    assertValid(result);
  });
  it.each([
    "const Layout = () => (<Stack />); export default Layout;",
    "export default () => <Stack />;",
    "export default function () { return <Stack />; }",
    "function Layout() { return <Stack />; } export default Layout;",
    "const Layout = function() { return <Stack />; }; export default Layout;",
    "const Layout = (() => <Stack />) satisfies ComponentType; export default Layout;",
  ])("supports synchronous root: %s", (source) => {
    const result = patch(source);
    expect(result).toContain("<OtaUpdates ");
    expect(patch(result)).toBe(result);
    assertValid(result);
  });
  it("does not inject into nested render callbacks and handles bare returns", () => {
    const result = patch(
      "export default function Root() { const render = () => { return <Text />; }; if (loading) return; return <Stack render={render} />; }",
    );
    expect(result.match(/<OtaUpdates /g)).toHaveLength(2);
    assertValid(result);
  });
  it("migrates the released createElement gate and preserves hook options", () => {
    const source = `import { useOtaUpdates as useUpdates, OtaUpdateGate as Gate } from '../../ota-client';
import { createElement as el } from 'react';
export default function Root() {
  const ota = useUpdates({ autoCheck: false, autoUpdate: true, autoReload: true, guardHandlers });
  if (loading) return el(Gate, { controller: ota }, null);
  return el(Gate, { controller: ota }, <Stack />);
}`;
    const result = patch(source);
    expect(result).not.toContain("useUpdates");
    expect(result).not.toContain("createElement");
    expect(result).not.toContain("OtaUpdateGate");
    expect(result).toContain("autoUpdate: true");
    expect(result).toContain("guardHandlers");
    expect(result.match(/<OtaUpdates /g)).toHaveLength(2);
    expect(patch(result)).toBe(result);
    assertValid(result);
  });
  it("migrates a JSX gate without dropping its original children", () => {
    const result =
      patch(`import { useOtaUpdates, OtaUpdateGate } from '../../ota-client';
export default function Root() {
 const ota = useOtaUpdates({ autoCheck: false });
 return <OtaUpdateGate controller={ota}><Stack /><StatusBar /></OtaUpdateGate>;
}`);
    expect(result).toContain("<Stack");
    expect(result).toContain("<StatusBar");
    expect(result).not.toContain("OtaUpdateGate");
    expect(patch(result)).toBe(result);
    assertValid(result);
  });
  it("preserves React createElement when unrelated application code still uses it", () => {
    const result = patch(`import { createElement } from 'react';
export default function Root() { return createElement(AppTabs); }`);
    expect(result).toContain("import { createElement } from 'react'");
    expect(result).toContain("{createElement(AppTabs)}");
    assertValid(result);
  });
  it("supports an aliased existing component without adding a second instance", () => {
    const source = `import { OtaUpdates as Updates } from '../../ota-client';
export default () => <><Updates autoUpdate /><Stack /></>;`;
    expect(patch(source)).toBe(source);
  });
  it("avoids collisions with local component names", () => {
    const result = patch(
      "const OtaUpdates = 1; export default () => <Stack/>;",
    );
    expect(result).toContain("OtaUpdates as OtaUpdates2");
    expect(result).toContain("<OtaUpdates2 ");
    assertValid(result);
  });
  it.each([
    "export default memo(() => <Stack/>);",
    "export default class Root { render() { return null; } }",
    "export default async function Root() { return null; }",
    "export default function* Root() { return null; }",
    "export { default } from './Root';",
    "export default function Root( { return null;",
    "import { useOtaUpdates } from '../../ota-client'; export default function Root() { if (ready) useOtaUpdates(); return null; }",
    "import { useOtaUpdates } from '../../ota-client'; export default function Root() { if (loading) return null; const updates = useOtaUpdates(); return null; }",
    "import { OtaUpdates } from '../../ota-client'; export default function Root(OtaUpdates) { return null; }",
    "import { useOtaUpdates } from '@/ota-client'; export default function Root() { useOtaUpdates(); return null; }",
    "import { useOtaUpdates } from '../../ota-client'; export default function Root() { useOtaUpdates(...options); return null; }",
    "import { useOtaUpdates, OtaUpdateGate } from '../../ota-client'; export default function Root() { const ota = useOtaUpdates(); return <OtaUpdateGate controller={ota}><Text>{ota.status}</Text></OtaUpdateGate>; }",
  ])("rejects an unsafe root before changing it: %s", (source) => {
    expect(() => patch(source)).toThrow("Cannot automatically connect");
  });
  it("requires a TSX extension instead of emitting JSX into a .ts file", () => {
    expect(() =>
      patch("export default () => null;", "/example/App.ts"),
    ).toThrow("rename the root to .tsx");
  });
  it("preserves CRLF and directives", () => {
    const result = patch(
      'export default function Root() {\r\n  "use strict";\r\n return null;\r\n}\r\n',
    );
    expect(result).toContain('"use strict";');
    expect(result.replaceAll("\r\n", "")).not.toContain("\n");
    expect(patch(result)).toBe(result);
  });
});

describe("root selection", () => {
  function fixture(files: Record<string, string>) {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ota-root-hook-"));
    roots.push(appRoot);
    for (const [name, source] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(appRoot, name)), { recursive: true });
      fs.writeFileSync(path.join(appRoot, name), source);
    }
    return appRoot;
  }
  const component = "export default function Root() { return null; }";
  it("prefers src/app and patches all its platform roots only", () => {
    const appRoot = fixture({
      "src/app/_layout.tsx": component,
      "src/app/_layout.ios.tsx": component,
      "app/_layout.tsx": "unsupported",
    });
    const result = planOtaRootHook({
      appRoot,
      originalEntry: "expo-router/entry",
    });
    expect(result.files.map((file: string[]) => file[0])).toEqual([
      "src/app/_layout.tsx",
      "src/app/_layout.ios.tsx",
    ]);
    expect(result.warnings).toEqual([]);
    expect(
      fs.readFileSync(path.join(appRoot, "src/app/_layout.tsx"), "utf8"),
    ).toBe(component);
  });
  it("supports standard App fallback and warns for unknown custom entry", () => {
    const appRoot = fixture({ "App.tsx": component });
    expect(
      planOtaRootHook({ appRoot, originalEntry: "__platform_default__" }).files,
    ).toHaveLength(1);
    expect(
      planOtaRootHook({ appRoot, originalEntry: "./entry.js" }).warnings,
    ).toHaveLength(1);
    fs.writeFileSync(
      path.join(appRoot, "index.android.js"),
      "custom registration",
    );
    expect(
      planOtaRootHook({ appRoot, originalEntry: "__platform_default__" }).files,
    ).toHaveLength(0);
  });
  it("does not patch ignored app root when src/app exists without a layout", () => {
    const appRoot = fixture({
      "src/app/index.tsx": component,
      "app/_layout.tsx": component,
    });
    expect(
      planOtaRootHook({ appRoot, originalEntry: "expo-router/entry" }).warnings,
    ).toHaveLength(1);
  });
});
