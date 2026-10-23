import { describe, expect, it } from "vitest";
import { createTranslator, resolveLocale } from "./messages";
import english from "./en.json";

describe("admin interface language", () => {
  it("defaults to English regardless of an absent or unsupported preference", () => {
    expect(resolveLocale(undefined)).toBe("en");
    expect(resolveLocale("uk")).toBe("en");
    expect(resolveLocale("en")).toBe("en");
    expect(resolveLocale("ru")).toBe("ru");
  });
  it("translates labels without translating recipient data", () => {
    expect(createTranslator("en")("Установки")).toBe("Installations");
    expect(createTranslator("ru")("Установки")).toBe("Установки");
    expect(createTranslator("ru")("Invalid credentials")).toBe(
      "Неверные учётные данные",
    );
    expect(
      createTranslator("en")("Канал {0}, {1}", ["Мой канал", "android"]),
    ).toBe("Channel Мой канал, android");
    expect(createTranslator("en")("Скопировать {0}", ["$& <script>"])).toBe(
      "Copy $& <script>",
    );
  });
  it("preserves every interpolation slot in the English catalog", () => {
    const slots = (s: string) =>
      [...s.matchAll(/\{\d+\}/g)].map(([value]) => value).sort();
    for (const [source, translated] of Object.entries(english)) {
      expect(translated.trim(), source).not.toBe("");
      expect(translated, source).not.toMatch(/[А-Яа-яЁё]/);
      expect(slots(translated), source).toEqual(slots(source));
    }
  });
  it("preserves unknown technical errors and incomplete placeholders", () => {
    expect(createTranslator("en")("HTTP 503")).toBe("HTTP 503");
    expect(createTranslator("en")("constructor")).toBe("constructor");
    expect(createTranslator("ru")("toString")).toBe("toString");
    expect(createTranslator("en")("Канал {0}, {1}", ["preview"])).toBe(
      "Channel preview, {1}",
    );
  });
});
