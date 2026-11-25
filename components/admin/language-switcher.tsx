"use client";

import { Languages } from "lucide-react";
import { NativeSelect } from "@/components/ui/native-select";
import { useI18n } from "@/src/client/i18n/provider";
import { resolveLocale } from "@/src/client/i18n/messages";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useI18n();
  const label = t("Interface language");
  return (
    <div className="relative">
      <Languages
        aria-hidden="true"
        className="pointer-events-none absolute left-2.5 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <NativeSelect
        aria-label={label}
        title={label}
        value={locale}
        onChange={(event) => setLocale(resolveLocale(event.target.value))}
        className="border-transparent bg-transparent pl-8 hover:border-input"
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
      </NativeSelect>
    </div>
  );
}
