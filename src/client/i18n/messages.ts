import english from "./en.json";
import russian from "./ru.json";
import ukrainian from "./uk.json";

const catalogs = {
  en: new Map(Object.entries(english)),
  ru: new Map(Object.entries(russian)),
  uk: new Map(Object.entries(ukrainian)),
};
// Also accept English API errors and labels from the original interface.
const keysByEnglish = new Map(
  Object.entries(english).map(([key, translated]) => [translated, key]),
);

export type Locale = "en" | "ru" | "uk";
export const formatLocales: Record<Locale, string> = {
  en: "en-US",
  ru: "ru-RU",
  uk: "uk-UA",
};
type TranslationValues = readonly (string | number | null | undefined)[];
export type TranslationMessage =
  string | { key: string; values?: TranslationValues };
export const LOCALE_COOKIE = "ota-locale";
export const defaultLocale: Locale = "en";
export function resolveLocale(value: string | undefined): Locale {
  return value === "ru" || value === "uk" ? value : defaultLocale;
}

/** Translate at render time so existing notices follow language changes too. */
export function createTranslator(locale: Locale) {
  return (message: TranslationMessage, values: TranslationValues = []) => {
    const source = typeof message === "string" ? message : message.key;
    const replacements =
      typeof message === "string" ? values : (message.values ?? []);
    const key = catalogs.en.has(source)
      ? source
      : (keysByEnglish.get(source) ?? source);
    const translated = catalogs[locale].get(key) ?? source;
    return translated.replace(/\{(\d+)\}/g, (placeholder, index) =>
      replacements[Number(index)] === undefined
        ? placeholder
        : String(replacements[Number(index)]),
    );
  };
}
