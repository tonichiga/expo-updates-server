"use client";
import { useMemo } from "react";
import { useI18n } from "./provider";

export function useFormatters() {
  const { formatLocale } = useI18n();
  return useMemo(
    () => ({
      number: (value: number) =>
        new Intl.NumberFormat(formatLocale).format(value),
      date: (value: string) =>
        new Intl.DateTimeFormat(formatLocale, {
          day: "2-digit",
          month: "short",
          timeZone: "UTC",
        }).format(new Date(value)),
      calendarDate: (value: string) =>
        new Intl.DateTimeFormat(formatLocale, {
          dateStyle: "medium",
          timeZone: "UTC",
        }).format(new Date(value)),
      fullDate: (value: string | null) =>
        value
          ? new Intl.DateTimeFormat(formatLocale, {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "UTC",
            }).format(new Date(value)) + " UTC"
          : "—",
      share: (count: number, total: number) => {
        if (!total) return "—";
        const formatter = new Intl.NumberFormat(formatLocale, {
          style: "percent",
          maximumFractionDigits: 1,
        });
        if (count > 0 && count / total < 0.001)
          return "<" + formatter.format(0.001);
        return formatter.format(count / total);
      },
    }),
    [formatLocale],
  );
}
