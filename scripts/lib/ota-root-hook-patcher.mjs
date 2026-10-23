import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const extensions = ['tsx', 'jsx', 'ts', 'js'];
const suffixes = ['', '.android', '.ios', '.native', '.web'];

function unwrap(node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))) node = node.expression;
  return node;
}

function componentFor(source) {
  const exported = source.statements.find((node) => node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword));
  if (exported) return exported;
  const assignment = source.statements.find((node) => ts.isExportAssignment(node) && !node.isExportEquals);
  let component = unwrap(assignment?.expression);
  if (component && ts.isIdentifier(component)) {
    const name = component.text;
    component = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name)
      || source.statements.flatMap((node) => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
        .find((node) => ts.isIdentifier(node.name) && node.name.text === name)?.initializer;
  }
  return unwrap(component);
}

function isDirective(node) {
  return ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression);
}

/** Parse for insertion locations only: never reprint or reformat application code. */
export function patchOtaRootHook(text, filename, appRoot) {
  const source = ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
  const fail = (reason) => { throw new Error(`Cannot automatically connect useOtaUpdates in ${filename}: ${reason}. Export a synchronous function component directly or through a local identifier, then rerun configure-app.`); };
  if (source.parseDiagnostics.length) fail('the root file has syntax errors');
  const component = componentFor(source);
  if (!component || !(ts.isFunctionDeclaration(component) || ts.isFunctionExpression(component) || ts.isArrowFunction(component)) || !component.body) fail('unsupported default root component');
  if (component.asteriskToken || component.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) fail('async/generator components cannot call React hooks');

  const clientPath = path.join(appRoot, 'ota-client');
  const imports = source.statements.filter(ts.isImportDeclaration);
  const identifiers = new Set();
  const gather = (node) => { if (ts.isIdentifier(node)) identifiers.add(node.text); ts.forEachChild(node, gather); };
  gather(source);
  const unique = (name) => {
    let candidate = name;
    for (let index = 2; identifiers.has(candidate); index += 1) candidate = `${name}${index}`;
    identifiers.add(candidate);
    return candidate;
  };
  const clientImports = imports.filter((node) => ts.isStringLiteral(node.moduleSpecifier)
    && node.moduleSpecifier.text.startsWith('.')
    && [clientPath, `${clientPath}/index`, `${clientPath}/index.js`].includes(path.resolve(path.dirname(filename), node.moduleSpecifier.text)));
  const binding = (nodes, name) => nodes.flatMap((node) => !node.importClause?.isTypeOnly && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
    ? [...node.importClause.namedBindings.elements] : [])
    .find((element) => !element.isTypeOnly && (element.propertyName || element.name).text === name)?.name.text;
  if (imports.some((node) => !clientImports.includes(node) && binding([node], 'useOtaUpdates'))) {
    fail('an existing useOtaUpdates import cannot be resolved to the generated ota-client; use a relative import to ota-client so its options can be preserved');
  }
  const importedHook = binding(clientImports, 'useOtaUpdates');
  const importedGate = binding(clientImports, 'OtaUpdateGate');
  const importedCreate = binding(imports.filter((node) => node.moduleSpecifier.text === 'react'), 'createElement');
  const importedNames = new Set([importedHook, importedGate, importedCreate].filter(Boolean));
  const checkBinding = (name) => {
    if (!name) return;
    if (ts.isIdentifier(name) && importedNames.has(name.text)) fail(`the imported OTA/React binding ${name.text} is shadowed in the component`);
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) for (const element of name.elements) {
      if (ts.isBindingElement(element)) checkBinding(element.name);
    }
  };
  for (const parameter of component.parameters) checkBinding(parameter.name);
  const hookName = importedHook || unique('useOtaUpdates');
  const gateName = importedGate || unique('OtaUpdateGate');
  const createName = importedCreate || unique('createElement');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const edits = [];
  let controllerName;
  let existingHookCall;
  const returns = [];
  const inspect = (node) => {
    if (ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) checkBinding(node.name);
    if (ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === importedHook) {
      if (existingHookCall) fail('multiple update hooks in the root component');
      existingHookCall = node;
    }
    if (ts.isReturnStatement(node)) returns.push(node);
    ts.forEachChild(node, inspect);
  };
  inspect(component.body);
  if (existingHookCall) {
    if (returns.some((statement) => statement.pos < existingHookCall.pos)) fail('the existing hook appears after an early return');
    const owner = existingHookCall.parent;
    if (ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name) && owner.parent.parent.parent === component.body) {
      controllerName = owner.name.text;
    } else if (ts.isExpressionStatement(owner) && owner.parent === component.body) {
      controllerName = unique('otaUpdates');
      edits.push({ start: owner.getStart(source), end: owner.getStart(source), content: `const ${controllerName} = ` });
    } else fail('the existing update hook must be called unconditionally at the top of the root component');
  } else {
    controllerName = unique('otaUpdates');
  }
  const hook = `const ${controllerName} = ${hookName}({ autoCheck: true, autoUpdate: false, autoReload: false });`;
  const wrap = (expression) => {
    const unwrapped = unwrap(expression);
    if (unwrapped && ts.isCallExpression(unwrapped) && ts.isIdentifier(unwrapped.expression) && unwrapped.expression.text === createName
      && unwrapped.arguments[0] && ts.isIdentifier(unwrapped.arguments[0]) && unwrapped.arguments[0].text === gateName) return;
    if (unwrapped && (ts.isJsxElement(unwrapped) || ts.isJsxSelfClosingElement(unwrapped))
      && (unwrapped.openingElement?.tagName || unwrapped.tagName)?.getText(source) === gateName) return;
    if (!expression) return;
    edits.push({ start: expression.getStart(source), end: expression.getStart(source), content: `${createName}(${gateName}, { controller: ${controllerName} }, ` });
    edits.push({ start: expression.end, end: expression.end, content: ')' });
  };
  if (ts.isBlock(component.body)) {
    if (!existingHookCall) {
      let at = component.body.getStart(source) + 1;
      for (const statement of component.body.statements) {
        if (!isDirective(statement)) break;
        at = statement.end;
      }
      edits.push({ start: at, end: at, content: `${newline}  ${hook}${newline}` });
    }
    for (const statement of returns) {
      if (statement.expression) wrap(statement.expression);
      else edits.push({ start: statement.getStart(source), end: statement.end, content: `return ${createName}(${gateName}, { controller: ${controllerName} }, null);` });
    }
    if (!returns.length) fail('the root component has no return statement');
  } else {
    edits.push({ start: component.body.getStart(source), end: component.body.end, content: `{${newline}  ${hook}${newline}  return ${createName}(${gateName}, { controller: ${controllerName} }, (${component.body.getText(source)}));${newline}}` });
  }
  const newImports = [];
  let relative = path.relative(path.dirname(filename), clientPath).split(path.sep).join('/');
  if (!relative.startsWith('.')) relative = `./${relative}`;
  const specifier = (name, alias) => name === alias ? name : `${name} as ${alias}`;
  const missingClientBindings = [];
  if (!importedHook) missingClientBindings.push(specifier('useOtaUpdates', hookName));
  if (!importedGate) missingClientBindings.push(specifier('OtaUpdateGate', gateName));
  if (missingClientBindings.length) newImports.push(`import { ${missingClientBindings.join(', ')} } from '${relative}';`);
  if (!importedCreate) newImports.push(`import { ${specifier('createElement', createName)} } from 'react';`);
  if (newImports.length) {
    let at = imports.at(-1)?.end ?? source.statements[0]?.getStart(source) ?? text.length;
    if (!imports.length) for (const statement of source.statements) {
      if (!isDirective(statement)) break;
      at = statement.end;
    }
    edits.push({ start: at, end: at, content: `${newline}${newImports.join(newline)}${newline}` });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.content + text.slice(edit.end);
  return text;
}

export function planOtaRootHook({ appRoot, originalEntry }) {
  const candidates = (base) => suffixes.flatMap((suffix) => extensions.map((extension) => `${base}${suffix}.${extension}`)).filter((name) => fs.existsSync(path.join(appRoot, name)));
  const router = originalEntry === 'expo-router/entry';
  let roots = [];
  if (router) {
    roots = candidates(fs.existsSync(path.join(appRoot, 'src/app')) ? 'src/app/_layout' : 'app/_layout');
  } else if (['__platform_default__', '__app_fallback__', 'node_modules/expo/AppEntry.js', 'expo/AppEntry', 'expo/AppEntry.js'].includes(originalEntry.replace(/^\.\//, ''))) {
    // A custom index may register another root; never guess in that case.
    if (!candidates('index').length) roots = candidates('App');
  }
  if (!roots.length) return {
    files: [],
    warnings: ['The OTA identity/telemetry bootstrap is configured, but no safely identifiable root component was found. Call useOtaUpdates from ota-client in your main layout to enable update orchestration.'],
  };
  return {
    files: roots.map((name) => {
      const filename = path.join(appRoot, name);
      return [name, patchOtaRootHook(fs.readFileSync(filename, 'utf8'), filename, appRoot)];
    }),
    warnings: [],
  };
}
