import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { createTranslator, resolveLocale, type Locale } from "./messages";
import english from "./en.json";
import russian from "./ru.json";
import ukrainian from "./uk.json";

const catalogs = { en: english, ru: russian, uk: ukrainian };

describe("admin interface language", () => {
  it("resolves supported preferences and keeps English as the default", () => {
    for (const locale of ["en", "ru", "uk"]) {
      expect(resolveLocale(locale)).toBe(locale);
    }
    for (const locale of [undefined, "ua", "de", "constructor"]) {
      expect(resolveLocale(locale)).toBe("en");
    }
  });

  it("translates labels and English API errors without translating user data", () => {
    expect(createTranslator("en")("Установки")).toBe("Installations");
    expect(createTranslator("ru")("Установки")).toBe("Установки");
    expect(createTranslator("uk")("Установки")).toBe("Встановлення");
    expect(createTranslator("ru")("Invalid credentials")).toBe(
      "Неверные учётные данные",
    );
    expect(createTranslator("uk")("Invalid credentials")).toBe(
      "Неправильні облікові дані",
    );
    expect(
      createTranslator("uk")("fromChannel and toChannel must differ"),
    ).toBe("Початковий і цільовий канали мають відрізнятися");
    expect(
      createTranslator("uk")("Канал {0}, {1}", ["Мой канал", "android"]),
    ).toBe("Канал Мой канал, android");
    expect(createTranslator("en")("Скопировать {0}", ["$& <script>"])).toBe(
      "Copy $& <script>",
    );
  });

  it("can render an existing notification in another language", () => {
    const notice = { key: "Policy saved as version {0}.", values: [3] };
    expect(createTranslator("en")(notice)).toBe(
      "Policy saved as version 3.",
    );
    expect(createTranslator("ru")(notice)).toBe(
      "Политика сохранена как версия 3.",
    );
    expect(createTranslator("uk")(notice)).toBe(
      "Політику збережено як версію 3.",
    );
  });

  it.each(Object.keys(catalogs) as Locale[])(
    "keeps %s complete with matching interpolation slots",
    (locale) => {
      const slots = (s: string) =>
        [...s.matchAll(/\{\d+\}/g)].map(([value]) => value).sort();
      expect(Object.keys(catalogs[locale]).sort()).toEqual(
        Object.keys(english).sort(),
      );
      for (const [source, translated] of Object.entries(catalogs[locale])) {
        expect(translated.trim(), source).not.toBe("");
        expect(slots(translated), source).toEqual(slots(source));
        if (locale === "en")
          expect(translated, source).not.toMatch(/[А-Яа-яЁёІіЇїЄєҐґ]/);
        if (locale === "uk")
          expect(translated, source).not.toMatch(/[ыэъёЫЭЪЁ]/);
      }
    },
  );

  it("has translations for every literal UI translation key", () => {
    function files(directory: string): string[] {
      return readdirSync(directory, { withFileTypes: true }).flatMap(
        (entry) => {
          const path = join(directory, entry.name);
          return entry.isDirectory()
            ? files(path)
            : /\.tsx?$/.test(path) && !path.includes(".test.")
              ? [path]
              : [];
        },
      );
    }
    const keys = new Set([
      ...Object.keys(english),
      ...Object.values(english),
    ]);
    for (const path of ["app", "components", "src/client"].flatMap(files)) {
      const source = ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      function visit(node: ts.Node) {
        if (
          ts.isCallExpression(node) &&
          node.expression.getText(source) === "t"
        ) {
          const key = node.arguments[0];
          if (key && ts.isStringLiteral(key))
            expect(keys.has(key.text), `${path}: ${key.text}`).toBe(true);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  });

  it("preserves unknown technical errors and incomplete placeholders", () => {
    for (const locale of Object.keys(catalogs) as Locale[]) {
      const t = createTranslator(locale);
      expect(t("HTTP 503")).toBe("HTTP 503");
      expect(t("constructor")).toBe("constructor");
      expect(t("toString")).toBe("toString");
    }
    expect(createTranslator("en")("Канал {0}, {1}", ["preview"])).toBe(
      "Channel preview, {1}",
    );
  });
});
