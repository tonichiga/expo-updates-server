import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const extensions = ["tsx", "jsx", "ts", "js"];
const suffixes = ["", ".android", ".ios", ".native", ".web"];

function unwrap(node) {
  while (
    node &&
    (ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node))
  )
    node = node.expression;
  return node;
}

function componentFor(source) {
  const exported = source.statements.find((node) =>
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
    ),
  );
  if (exported) return exported;
  const assignment = source.statements.find(
    (node) => ts.isExportAssignment(node) && !node.isExportEquals,
  );
  let component = unwrap(assignment?.expression);
  if (component && ts.isIdentifier(component)) {
    const name = component.text;
    component =
      source.statements.find(
        (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
      ) ||
      source.statements
        .flatMap((node) =>
          ts.isVariableStatement(node)
            ? [...node.declarationList.declarations]
            : [],
        )
        .find((node) => ts.isIdentifier(node.name) && node.name.text === name)
        ?.initializer;
  }
  return unwrap(component);
}

function isDirective(node) {
  return ts.isExpressionStatement(node) && ts.isStringLiteral(node.expression);
}

/** Parse insertion locations without reprinting the application's existing code. */
export function patchOtaRootHook(text, filename, appRoot) {
  const source = ts.createSourceFile(
    filename,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const fail = (reason) => {
    throw new Error(
      `Cannot automatically connect OtaUpdates in ${filename}: ${reason}. Render <OtaUpdates /> once beside navigation in a synchronous JSX root component, then rerun configure-app.`,
    );
  };
  if (source.parseDiagnostics.length) fail("the root file has syntax errors");
  if (filename.endsWith(".ts"))
    fail("rename the root to .tsx before inserting JSX");
  const component = componentFor(source);
  if (
    !component ||
    !(
      ts.isFunctionDeclaration(component) ||
      ts.isFunctionExpression(component) ||
      ts.isArrowFunction(component)
    ) ||
    !component.body
  )
    fail("unsupported default root component");
  if (
    component.asteriskToken ||
    component.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
  )
    fail("async/generator root components are unsupported");
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const clientPath = path.join(appRoot, "ota-client");
  const imports = source.statements.filter(ts.isImportDeclaration);
  const clientImports = imports.filter(
    (node) =>
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text.startsWith(".") &&
      ["", "/index", "/index.js", "/index.ts"].some(
        (suffix) =>
          path.resolve(path.dirname(filename), node.moduleSpecifier.text) ===
          clientPath + suffix,
      ),
  );
  const binding = (nodes, name) =>
    nodes
      .flatMap((node) =>
        !node.importClause?.isTypeOnly &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)
          ? [...node.importClause.namedBindings.elements]
          : [],
      )
      .find(
        (element) =>
          !element.isTypeOnly &&
          (element.propertyName || element.name).text === name,
      )?.name.text;
  if (
    imports.some(
      (node) =>
        !clientImports.includes(node) &&
        (binding([node], "useOtaUpdates") || binding([node], "OtaUpdates")),
    )
  )
    fail(
      "use a relative import to ota-client so existing configuration can be preserved",
    );
  const hookName = binding(clientImports, "useOtaUpdates");
  const gateName = binding(clientImports, "OtaUpdateGate");
  const createName = binding(
    imports.filter((node) => node.moduleSpecifier.text === "react"),
    "createElement",
  );
  const existingName = binding(clientImports, "OtaUpdates");
  const identifiers = new Set();
  const gather = (node) => {
    if (ts.isIdentifier(node)) identifiers.add(node.text);
    ts.forEachChild(node, gather);
  };
  gather(source);
  let name = existingName || "OtaUpdates";
  if (!existingName)
    for (let i = 2; identifiers.has(name); i++) name = `OtaUpdates${i}`;
  const watched = new Set(
    [hookName, gateName, createName, existingName].filter(Boolean),
  );
  const checkBinding = (node) => {
    if (!node) return;
    if (ts.isIdentifier(node) && watched.has(node.text))
      fail(`imported OTA/React binding ${node.text} is shadowed`);
    if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node))
      for (const element of node.elements)
        if (ts.isBindingElement(element)) checkBinding(element.name);
  };
  for (const parameter of component.parameters) checkBinding(parameter.name);
  const returns = [];
  let hook;
  const inspect = (node) => {
    if (
      ts.isVariableDeclaration(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node)
    )
      checkBinding(node.name);
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) returns.push(node);
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === hookName
    ) {
      if (hook) fail("multiple update hooks in the root");
      hook = node;
    }
    ts.forEachChild(node, inspect);
  };
  inspect(component.body);
  const edits = [];
  let props = "autoCheck autoUpdate={false} autoReload={false}";
  let controller;
  let hookStatement;
  if (hook) {
    if (returns.some((node) => node.pos < hook.pos))
      fail("the existing hook appears after an early return");
    const parent = hook.parent;
    if (
      ts.isVariableDeclaration(parent) &&
      ts.isIdentifier(parent.name) &&
      parent.parent.parent.parent === component.body &&
      parent.parent.declarations.length === 1
    ) {
      controller = parent.name.text;
      hookStatement = parent.parent.parent;
    } else if (
      ts.isExpressionStatement(parent) &&
      parent.parent === component.body
    )
      hookStatement = parent;
    else fail("the existing hook must be unconditional at the top level");
    if (hook.arguments.length > 1 || hook.arguments.some(ts.isSpreadElement)) {
      fail("unsupported hook arguments");
    }
    props = "autoCheck={false}";
    if (hook.arguments[0])
      props += ` {...${hook.arguments[0].getText(source)}}`;
    edits.push({
      start: hookStatement.getStart(source),
      end: hookStatement.end,
      content: "",
    });
  }
  const tagName = (node) =>
    (node.openingElement?.tagName || node.tagName)?.getText(source);
  const hasComponent = (node) => {
    node = unwrap(node);
    if (!node) return false;
    if (
      (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) &&
      tagName(node) === existingName
    )
      return true;
    if (ts.isJsxElement(node) || ts.isJsxFragment(node))
      return node.children.some((child) => hasComponent(child));
    if (ts.isJsxExpression(node)) return hasComponent(node.expression);
    return false;
  };
  const obsolete = new Set([hookName, gateName, createName].filter(Boolean));
  const expressions = ts.isBlock(component.body)
    ? returns.map((node) => ({ node, expression: node.expression }))
    : [{ expression: component.body }];
  if (!expressions.length) fail("the root has no return statement");
  const legacyReferences = new Set();
  for (const { node, expression } of expressions) {
    if (hasComponent(expression)) {
      if (hook)
        fail(
          "both a root hook and OtaUpdates are present; consolidate their options manually",
        );
      continue;
    }
    let child = unwrap(expression);
    if (
      child &&
      ts.isCallExpression(child) &&
      ts.isIdentifier(child.expression) &&
      child.expression.text === createName &&
      child.arguments[0]?.getText(source) === gateName
    ) {
      const settings = child.arguments[1];
      if (
        !hook ||
        !settings ||
        !ts.isObjectLiteralExpression(settings) ||
        settings.properties.length !== 1 ||
        !ts.isPropertyAssignment(settings.properties[0]) ||
        settings.properties[0].name.getText(source) !== "controller" ||
        settings.properties[0].initializer.getText(source) !== controller ||
        child.arguments.length > 3
      )
        fail("custom legacy gate needs manual migration");
      legacyReferences.add(settings.properties[0].initializer);
      child = unwrap(child.arguments[2]);
    } else if (
      child &&
      (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) &&
      tagName(child) === gateName
    ) {
      const opening = child.openingElement || child;
      const attrs = opening.attributes.properties;
      if (
        !hook ||
        attrs.length !== 1 ||
        !ts.isJsxAttribute(attrs[0]) ||
        attrs[0].name.text !== "controller" ||
        !attrs[0].initializer ||
        !ts.isJsxExpression(attrs[0].initializer) ||
        attrs[0].initializer.expression?.getText(source) !== controller
      )
        fail("custom legacy gate needs manual migration");
      legacyReferences.add(attrs[0].initializer.expression);
      // A fragment preserves all original gate children without retaining the wrapper.
      const children = ts.isJsxElement(child)
        ? text.slice(
            child.openingElement.end,
            child.closingElement.getStart(source),
          )
        : "";
      child = { getText: () => `<>${children}</>` };
    }
    const start = expression?.getStart(source) ?? node.getStart(source);
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    const indent = text.slice(lineStart, start).match(/^\s*/)[0];
    let original = child?.getText(source) ?? "null";
    const rendered =
      original === "null" || original === "undefined"
        ? ""
        : `${newline}${indent}    ${original.startsWith("<") ? original : `{${original}}`}`;
    const content = `(${newline}${indent}  <>${newline}${indent}    <${name} ${props} />${rendered}${newline}${indent}  </>${newline}${indent})`;
    edits.push(
      expression
        ? { start, end: expression.end, content }
        : { start, end: node.end, content: `return ${content};` },
    );
  }
  if (controller) {
    const inspectReferences = (node) => {
      if (node === hookStatement || legacyReferences.has(node)) return;
      if (ts.isIdentifier(node) && node.text === controller)
        fail(
          "the old controller is used by custom root code; migrate those references manually",
        );
      ts.forEachChild(node, inspectReferences);
    };
    inspectReferences(component.body);
  }
  if (!edits.length) return text;
  if (!existingName) {
    let relative = path
      .relative(path.dirname(filename), clientPath)
      .split(path.sep)
      .join("/");
    if (!relative.startsWith(".")) relative = `./${relative}`;
    let at =
      imports.at(-1)?.end ??
      source.statements[0]?.getStart(source) ??
      text.length;
    if (!imports.length)
      for (const statement of source.statements) {
        if (!isDirective(statement)) break;
        at = statement.end;
      }
    const specifier = name === "OtaUpdates" ? name : `OtaUpdates as ${name}`;
    edits.push({
      start: at,
      end: at,
      content: `${newline}import { ${specifier} } from '${relative}';${newline}`,
    });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start))
    text = text.slice(0, edit.start) + edit.content + text.slice(edit.end);
  // Drop only obsolete imports which no longer have references after migration.
  const updated = ts.createSourceFile(
    filename,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const counts = new Map();
  const count = (node) => {
    if (ts.isIdentifier(node))
      counts.set(node.text, (counts.get(node.text) || 0) + 1);
    ts.forEachChild(node, count);
  };
  count(updated);
  const removals = [];
  for (const node of updated.statements.filter(ts.isImportDeclaration)) {
    const clause = node.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings))
      continue;
    const kept = clause.namedBindings.elements.filter(
      (element) =>
        !obsolete.has(element.name.text) ||
        (counts.get(element.name.text) || 0) >
          (element.propertyName?.text === element.name.text ? 2 : 1),
    );
    if (kept.length === clause.namedBindings.elements.length) continue;
    let content = "";
    if (kept.length || clause.name) {
      const bindings = kept.length
        ? `{ ${kept.map((element) => element.getText(updated)).join(", ")} }`
        : "";
      content = `import ${clause.name?.text || ""}${clause.name && bindings ? ", " : ""}${bindings} from ${node.moduleSpecifier.getText(updated)};`;
    }
    removals.push({ start: node.getStart(updated), end: node.end, content });
  }
  for (const edit of removals.sort((a, b) => b.start - a.start))
    text = text.slice(0, edit.start) + edit.content + text.slice(edit.end);
  return formatRoot(text, filename, newline);
}

function formatRoot(text, filename, newline) {
  const service = ts.createLanguageService({
    getScriptFileNames: () => [filename],
    getScriptVersion: () => "0",
    getScriptSnapshot: (name) =>
      name === filename ? ts.ScriptSnapshot.fromString(text) : undefined,
    getCurrentDirectory: () => path.dirname(filename),
    getCompilationSettings: () => ({ jsx: ts.JsxEmit.ReactJSX }),
    getDefaultLibFileName: () => "lib.d.ts",
    fileExists: (name) => name === filename,
    readFile: (name) => (name === filename ? text : undefined),
  });
  try {
    const edits = service.getFormattingEditsForDocument(filename, {
      indentSize: 2,
      tabSize: 2,
      convertTabsToSpaces: true,
      newLineCharacter: newline,
      indentStyle: ts.IndentStyle.Smart,
    });
    for (const edit of edits.sort((a, b) => b.span.start - a.span.start))
      text =
        text.slice(0, edit.span.start) +
        edit.newText +
        text.slice(edit.span.start + edit.span.length);
    return text;
  } finally {
    service.dispose();
  }
}

export function planOtaRootHook({ appRoot, originalEntry }) {
  const candidates = (base) =>
    suffixes
      .flatMap((suffix) =>
        extensions.map((extension) => `${base}${suffix}.${extension}`),
      )
      .filter((name) => fs.existsSync(path.join(appRoot, name)));
  const router = originalEntry === "expo-router/entry";
  let roots = [];
  if (router) {
    roots = candidates(
      fs.existsSync(path.join(appRoot, "src/app"))
        ? "src/app/_layout"
        : "app/_layout",
    );
  } else if (
    [
      "__platform_default__",
      "__app_fallback__",
      "node_modules/expo/AppEntry.js",
      "expo/AppEntry",
      "expo/AppEntry.js",
    ].includes(originalEntry.replace(/^\.\//, ""))
  ) {
    // A custom index may register another root; never guess in that case.
    if (!candidates("index").length) roots = candidates("App");
  }
  if (!roots.length)
    return {
      files: [],
      warnings: [
        "The OTA identity/telemetry bootstrap is configured, but no safely identifiable root component was found. Render <OtaUpdates /> from ota-client beside navigation in your main layout to enable update orchestration.",
      ],
    };
  return {
    files: roots.map((name) => {
      const filename = path.join(appRoot, name);
      return [
        name,
        patchOtaRootHook(fs.readFileSync(filename, "utf8"), filename, appRoot),
      ];
    }),
    warnings: [],
  };
}
