import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createMarkdownRenderer } from "vitepress";
import config from "./config.mjs";
import { showcaseLocales } from "./theme/showcase-locales.mjs";

const docs = fileURLToPath(new URL("../", import.meta.url));
const excluded = new Set(["analytics-implementation-plan.md", "getting-started.ru.md"]);
const pages = readdirSync(docs).filter((name) => name.endsWith(".md") && !excluded.has(name)).sort();
const languages = ["", "ru", "uk"];
const md = await createMarkdownRenderer(docs, config.markdown, config.base);
const documents = new Map();

for (const language of languages) {
  for (const page of pages) {
    const relativePath = path.posix.join(language, page);
    const source = readFileSync(path.join(docs, relativePath), "utf8");
    const env = { relativePath };
    const html = md.render(source, env);
    const tokens = md.parse(source, { relativePath });
    documents.set(relativePath, {
      source, html, frontmatter: env.frontmatter,
      headings: [...html.matchAll(/<h[1-6] id="([^"]+)"/g)].map((match) => match[1]),
      code: tokens.filter((token) => token.type === "fence").map(({ info, content }) => ({ info, content })),
    });
  }
}

function checkLink(href, from, language) {
  if (/^(?:[a-z]+:|\/\/)/i.test(href)) return;
  const url = new URL(href, `https://docs.example${config.base}${from}`);
  assert.ok(url.pathname.startsWith(config.base), `${from}: link outside site base: ${href}`);
  let target = decodeURIComponent(url.pathname.slice(config.base.length));
  if (!target || target.endsWith("/")) target += "index";
  target = target.replace(/\.(?:html|md)$/, "") + ".md";
  const document = documents.get(target);
  assert.ok(document, `${from}: missing page ${href} (${target})`);
  if (language) assert.ok(target.startsWith(`${language}/`), `${from}: link leaves locale: ${href}`);
  if (url.hash) assert.ok(document.headings.includes(decodeURIComponent(url.hash.slice(1))), `${from}: missing section ${href}`);
}

for (const language of ["ru", "uk"]) {
  test(`${language}: every public page is translated with matching sections and code examples`, () => {
    assert.deepEqual(readdirSync(path.join(docs, language)).filter((name) => name.endsWith(".md")).sort(), pages);
    for (const page of pages) {
      const original = documents.get(page);
      const translated = documents.get(`${language}/${page}`);
      assert.doesNotMatch(translated.source, /\{\{CODE_\d+\}\}/, page);
      assert.deepEqual(translated.headings, original.headings, `${page}: language switching must preserve section anchors`);
      assert.deepEqual(translated.code, original.code, `${page}: executable examples must remain unchanged`);
    }
  });

  test(`${language}: Markdown controls and showcase have localized text`, () => {
    for (const page of pages) {
      const { html } = documents.get(`${language}/${page}`);
      assert.doesNotMatch(html, /title="Copy Code"|aria-label="Permalink to/, page);
      assert.doesNotMatch(html, /aria-label="[^"]*\{#/, page);
    }
    const copy = showcaseLocales[language];
    for (const key of Object.keys(showcaseLocales.en)) assert.ok(copy[key], key);
    assert.equal(copy.slides.length, 4);
    for (const slide of copy.slides) {
      for (const key of ["label", "eyebrow", "title", "description", "alt"]) assert.ok(slide[key], key);
    }
  });
}

test("all content links and home actions resolve within their language, including sections", () => {
  for (const [relativePath, document] of documents) {
    const language = relativePath.includes("/") ? relativePath.split("/")[0] : "";
    for (const [, href] of document.html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) checkLink(href, relativePath, language);
    for (const action of document.frontmatter.hero?.actions ?? []) {
      const href = action.link.startsWith("/") ? config.base.slice(0, -1) + action.link : action.link;
      checkLink(href, relativePath, language);
    }
  }
});

test("navigation and sidebar links resolve within their language", () => {
  function visit(items, language) {
    for (const item of items) {
      if (item.link) checkLink(config.base.slice(0, -1) + item.link, `${language ? language + "/" : ""}index.md`, language);
      if (item.items) visit(item.items, language);
    }
  }
  for (const [key, locale] of Object.entries(config.locales)) {
    const language = key === "root" ? "" : key;
    visit(locale.themeConfig.nav, language);
    visit(locale.themeConfig.sidebar, language);
  }
});

test("the old Russian quick-start URL points to its new localized page", () => {
  const source = readFileSync(path.join(docs, "getting-started.ru.md"), "utf8");
  assert.match(source, /url=\/expo-updates-server\/ru\/getting-started/);
  assert.match(source, /\.\/ru\/getting-started\.md/);
  assert.match(source, /search: false/);
});
