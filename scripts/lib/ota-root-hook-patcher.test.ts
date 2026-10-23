import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import { patchOtaRootHook, planOtaRootHook } from './ota-root-hook-patcher.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
const root = '/example';
const filename = '/example/src/app/_layout.tsx';
function patch(source: string, file = filename) { return patchOtaRootHook(source, file, root); }
function assertValid(source: string, file = filename) {
  const result = ts.transpileModule(source, { fileName: file, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  expect(result.diagnostics).toEqual([]);
}
describe('root update hook patch', () => {
  it('preserves directives, comments, custom options and conditional returns on rerun', () => {
    const source = `'use client';\n// Header\nimport { Stack } from 'expo-router';\n// Component\nexport default function Layout() {\n  // Keep this check.\n  if (loading) return null;\n  return <Stack />;\n}\n`;
    const result = patch(source);
    expect(result.startsWith("'use client';\n// Header\n")).toBe(true);
    expect(result).toContain('// Component\nexport default function Layout()');
    expect(result).toContain("from '../../ota-client'");
    expect(result).toContain('const otaUpdates = useOtaUpdates({ autoCheck: true, autoUpdate: false, autoReload: false });');
    expect(result).toContain('if (loading) return createElement(OtaUpdateGate, { controller: otaUpdates }, null)');
    expect(result).toContain('return createElement(OtaUpdateGate, { controller: otaUpdates }, <Stack />)');
    expect(result).toContain('// Keep this check.');
    const customized = result.replace('autoCheck: true', 'autoCheck: false');
    expect(patch(customized)).toBe(customized);
    assertValid(result);
  });
  it.each([
    'const Layout = () => (<Stack />); export default Layout;',
    'export default () => <Stack />;',
    'export default function () { return <Stack />; }',
    'function Layout() { return <Stack />; } export default Layout;',
    'const Layout = function() { return <Stack />; }; export default Layout;',
    'const Layout = (() => <Stack />) satisfies ComponentType; export default Layout;',
  ])('supports a synchronous root shape: %s', (source) => {
    const result = patch(source);
    expect(result).toContain('useOtaUpdates({');
    expect(result).toContain('createElement(OtaUpdateGate,');
    expect(patch(result)).toBe(result);
    assertValid(result);
  });
  it('leaves nested render callbacks alone and preserves all root early returns', () => {
    const result = patch('export default function Layout() { const render = () => { return <Text />; }; if (ready) return <Stack render={render} />; return null; }');
    expect(result).toContain('const render = () => { return <Text />; }');
    expect(result.match(/createElement\(OtaUpdateGate/g)).toHaveLength(2);
    assertValid(result);
  });
  it('uses alias imports and keeps the existing hook configuration', () => {
    const result = patch("import { useOtaUpdates as useUpdates, OtaUpdateGate as Gate } from '../../ota-client';\nimport { createElement as el } from 'react';\nexport default function Root() { const updates = useUpdates({ autoCheck: false, autoReload: true }); return <Stack/>; }");
    expect(result.match(/useUpdates\(/g)).toHaveLength(1);
    expect(result).toContain('const updates = useUpdates({ autoCheck: false, autoReload: true });');
    expect(result).toContain('return el(Gate, { controller: updates }, <Stack/>)');
    expect(patch(result)).toBe(result);
    assertValid(result);
  });
  it('upgrades an existing unassigned top-level hook to provide the gate controller', () => {
    const result = patch("import { useOtaUpdates } from '../../ota-client';\nexport default function Root() { useOtaUpdates({ autoCheck: false }); return null; }");
    expect(result).toContain('const otaUpdates = useOtaUpdates({ autoCheck: false });');
    expect(result).toContain('controller: otaUpdates');
    expect(patch(result)).toBe(result);
  });
  it('rejects an unresolved import alias instead of installing a competing default hook', () => {
    const source = "import { useOtaUpdates as useUpdates } from '@/ota-client';\nexport default function Root() { const updates = useUpdates({ autoCheck: false }); return null; }";
    expect(() => patch(source)).toThrow('use a relative import to ota-client');
  });
  it('avoids collisions with local names and supports non-JSX TS App roots', () => {
    const result = patch('const useOtaUpdates = 1; const OtaUpdateGate = 2; const createElement = 3; const otaUpdates = 4; export default function App() { return null; }', '/example/App.ts');
    expect(result).toContain("import { useOtaUpdates as useOtaUpdates2, OtaUpdateGate as OtaUpdateGate2 } from './ota-client';");
    expect(result).toContain('const otaUpdates2 = useOtaUpdates2(');
    expect(result).toContain('return createElement2(OtaUpdateGate2,');
    assertValid(result, '/example/App.ts');
  });
  it.each([
    'export default memo(() => <Stack/>);',
    'export default class Root { render() { return null; } }',
    'export default async function Root() { return null; }',
    'export default function* Root() { return null; }',
    "export { default } from './Root';",
    'export default function Root( { return null;',
    "import { useOtaUpdates } from '../../ota-client'; export default function Root() { if (ready) useOtaUpdates(); return null; }",
    "import { useOtaUpdates } from '../../ota-client'; export default function Root() { if (loading) return null; const updates = useOtaUpdates(); return null; }",
    "import { useOtaUpdates } from '../../ota-client'; export default function Root(useOtaUpdates) { return null; }",
    "import { OtaUpdateGate } from '../../ota-client'; export default function Root() { const OtaUpdateGate = CustomGate; return null; }",
  ])('rejects an unsafe root before patching: %s', (source) => {
    expect(() => patch(source)).toThrow('Cannot automatically connect');
  });
  it('preserves CRLF and function directives', () => {
    const result = patch('export default function Root() {\r\n  "use strict";\r\n return null;\r\n}\r\n');
    expect(result).toContain('"use strict";\r\n  const otaUpdates');
    expect(result.replaceAll('\r\n', '')).not.toContain('\n');
  });
});

describe('root selection', () => {
  function fixture(files: Record<string, string>) {
    const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-root-hook-')); roots.push(appRoot);
    for (const [name, source] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(appRoot, name)), { recursive: true }); fs.writeFileSync(path.join(appRoot, name), source); }
    return appRoot;
  }
  const component = 'export default function Root() { return null; }';
  it('prefers src/app and patches all its platform roots only', () => {
    const appRoot = fixture({ 'src/app/_layout.tsx': component, 'src/app/_layout.ios.tsx': component, 'app/_layout.tsx': 'unsupported' });
    const result = planOtaRootHook({ appRoot, originalEntry: 'expo-router/entry' });
    expect(result.files.map((file: string[]) => file[0])).toEqual(['src/app/_layout.tsx', 'src/app/_layout.ios.tsx']);
    expect(result.warnings).toEqual([]);
    expect(fs.readFileSync(path.join(appRoot, 'src/app/_layout.tsx'), 'utf8')).toBe(component);
  });
  it('supports standard App fallback and warns for unknown custom entry', () => {
    const appRoot = fixture({ 'App.tsx': component });
    expect(planOtaRootHook({ appRoot, originalEntry: '__platform_default__' }).files).toHaveLength(1);
    expect(planOtaRootHook({ appRoot, originalEntry: './entry.js' }).warnings).toHaveLength(1);
    fs.writeFileSync(path.join(appRoot, 'index.android.js'), 'custom registration');
    expect(planOtaRootHook({ appRoot, originalEntry: '__platform_default__' }).files).toHaveLength(0);
  });
  it('does not patch ignored app root when src/app exists without a layout', () => {
    const appRoot = fixture({ 'src/app/index.tsx': component, 'app/_layout.tsx': component });
    expect(planOtaRootHook({ appRoot, originalEntry: 'expo-router/entry' }).warnings).toHaveLength(1);
  });
});
