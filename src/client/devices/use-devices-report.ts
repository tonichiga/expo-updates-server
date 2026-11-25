"use client";

import { useFilteredResults } from "@/src/client/use-filtered-results";
import type { DevicesReport } from "@/src/server/devices/report-types";
export type Filters = {
  days: string;
  platform: string;
  channel: string;
  runtime: string;
  launchKind: string;
  search: string;
};
export const defaultFilters: Filters = {
  days: "7",
  platform: "",
  channel: "",
  runtime: "",
  launchKind: "",
  search: "",
};
const initialQuery = { ...defaultFilters, offset: 0 };

async function loadReport(
  query: typeof initialQuery,
  signal: AbortSignal,
): Promise<DevicesReport> {
  if (!/^[a-f0-9-]{0,36}$/i.test(query.search.trim()))
    throw new Error("Часть UUID: цифры, буквы a–f и дефисы");

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (String(value).trim()) params.set(key, String(value).trim());
  }
  for (;;) {
    signal.throwIfAborted();
    const response = await fetch(`/api/admin/devices?${params}`, {
      signal,
      cache: "no-store",
    });
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Не удалось загрузить статистику");
    const report: DevicesReport = data;
    if (report.offset === 0 || report.offset < report.total) return report;
    // A concurrent removal can make the requested registry page disappear.
    const lastOffset = Math.max(
      0,
      Math.floor((report.total - 1) / report.pageSize) * report.pageSize,
    );
    params.set("offset", String(lastOffset));
  }
}

export function useDevicesReport() {
  const { query, success, error, loading, request } = useFilteredResults(
    initialQuery,
    loadReport,
  );
  const { offset, ...filters } = query;
  const report = success?.data ?? null;
  return {
    filters,
    report,
    error,
    loading,
    update: (key: keyof Filters, value: string) =>
      request(
        { ...query, [key]: value, offset: 0 },
        key === "search" && Boolean(value.trim()),
      ),
    reset: () => request(initialQuery),
    refresh: () =>
      request({
        ...query,
        offset: success?.query === query && report ? report.offset : offset,
      }),
    paginate: (offset: number) => request({ ...query, offset }),
  };
}
