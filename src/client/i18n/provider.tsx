"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createTranslator,
  defaultLocale,
  LOCALE_COOKIE,
  type Locale,
} from "./messages";

const defaultValue = {
  locale: defaultLocale,
  formatLocale: "en-US",
  t: createTranslator(defaultLocale),
  setLocale: (_locale: Locale) => {
    void _locale;
  },
};
const LocaleContext = createContext(defaultValue);

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, updateLocale] = useState(initialLocale);
  const value = useMemo(
    () => ({
      locale,
      formatLocale: locale === "ru" ? "ru-RU" : "en-US",
      t: createTranslator(locale),
      setLocale(next: Locale) {
        document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
        document.documentElement.lang = next;
        updateLocale(next);
      },
    }),
    [locale],
  );
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useI18n() {
  return useContext(LocaleContext);
}
