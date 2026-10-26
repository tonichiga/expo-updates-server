"use client";

import { useI18n } from "@/src/client/i18n/provider";
import { resolveLocale } from "@/src/client/i18n/messages";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const label = t("Interface language");
  return (
    <select
      aria-label={label}
      title={label}
      value={locale}
      onChange={(event) => setLocale(resolveLocale(event.target.value))}
      className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <option value="en" lang="en">
        English
      </option>
      <option value="ru" lang="ru">
        Русский
      </option>
      <option value="uk" lang="uk">
        Українська
      </option>
    </select>
  );
}
