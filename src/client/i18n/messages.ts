import english from "./en.json";

const englishByRussian = new Map<string, string>(Object.entries(english));
const russianByEnglish = new Map<string, string>(
  Object.entries(english).map(([russian, translated]) => [translated, russian]),
);

export type Locale = "en" | "ru";
export const LOCALE_COOKIE = "ota-locale";
export const defaultLocale: Locale = "en";
export function resolveLocale(value: string | undefined): Locale {
  return value === "ru" ? "ru" : defaultLocale;
}

/** Original Russian messages are keys; interpolate values without translating user data. */
export function createTranslator(locale: Locale) {
  return (
    message: string,
    values: readonly (string | number | null | undefined)[] = [],
  ) => {
    const translated =
      locale === "en"
        ? (englishByRussian.get(message) ?? message)
        : (russianByEnglish.get(message) ?? message);
    return translated.replace(/\{(\d+)\}/g, (placeholder, index) =>
      values[Number(index)] === undefined
        ? placeholder
        : String(values[Number(index)]),
    );
  };
}
