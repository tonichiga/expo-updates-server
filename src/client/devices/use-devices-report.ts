"use client";
import { useI18n } from "@/src/client/i18n/provider";

import { useEffect, useState } from "react";
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
export function useDevicesReport() {
  const { t } = useI18n();
  const [filters, setFilters] = useState(defaultFilters);
  const [applied, setApplied] = useState(defaultFilters);
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [report, setReport] = useState<DevicesReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ offset: String(offset) });
    Object.entries(applied).forEach(([key, value]) => {
      if (value.trim()) params.set(key, value.trim());
    });
    fetch(`/api/admin/devices?${params}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Не удалось загрузить статистику");
        return data as DevicesReport;
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          if (data.offset > 0 && data.offset >= data.total) {
            setOffset(
              Math.max(
                0,
                Math.floor((data.total - 1) / data.pageSize) * data.pageSize,
              ),
            );
            return;
          }
          setReport(data);
          setError("");
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, [applied, offset, revision]);
  const refresh = () => {
    setLoading(true);
    setError("");
    setRevision((n) => n + 1);
  };
  const apply = () => {
    setLoading(true);
    setError("");
    setApplied({ ...filters });
    setOffset(0);
  };
  const reset = () => {
    setFilters(defaultFilters);
    setApplied({ ...defaultFilters });
    setOffset(0);
    setLoading(true);
    setError("");
  };
  const paginate = (next: number) => {
    setLoading(true);
    setError("");
    setOffset(next);
    setRevision((n) => n + 1);
  };
  return {
    filters,
    setFilters,
    applied,
    report,
    error: t(error),
    loading,
    offset,
    apply,
    reset,
    refresh,
    paginate,
  };
}
