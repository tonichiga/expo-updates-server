"use client";
import { useI18n } from "@/src/client/i18n/provider";

import { Textarea } from "@/components/ui/textarea";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ShieldCheck, ShieldAlert, ChevronDown, RefreshCw } from "lucide-react";

import {
  AdminApiError,
  getDistributionControl,
  setDistributionControl,
} from "./admin-api";
import type { DistributionControlResponse } from "./admin-types";
import { useCallback, useEffect, useState } from "react";

export function useDistributionControlState() {
  const { t } = useI18n();
  const [state, setState] = useState<DistributionControlResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setState(await getDistributionControl());
      setError("");
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Не удалось загрузить глобальный статус OTA",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refresh();
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [refresh]);

  return { state, setState, loading, error: t(error), setError, refresh };
}

function formatChangedBy(state: DistributionControlResponse): string {
  const role = state.changedBy.role ? ` (${state.changedBy.role})` : "";
  return `${state.changedBy.label}${role}`;
}

export function DistributionControlBanner({
  state,
  loading,
  error,
}: {
  state: DistributionControlResponse | null;
  loading: boolean;
  error: string;
}) {
  const { t, formatLocale } = useI18n();
  if (loading) {
    return (
      <section className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground">
        {t("Проверка глобального статуса OTA…")}
      </section>
    );
  }

  if (error || !state) {
    return (
      <section className="rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive">
        {t(
          "Глобальный статус OTA недоступен. Распространяющие действия отключены до восстановления связи.",
        )}
        {error ? <p className="mt-1 text-xs">{t(error)}</p> : null}
      </section>
    );
  }

  if (!state.blocked) {
    return null;
  }

  return (
    <section className="rounded-lg border border-destructive/25 bg-destructive/5 p-4 text-destructive">
      <p className="font-semibold">{t("Распространение OTA остановлено")}</p>
      <p className="mt-1 text-sm">{state.reason}</p>
      <p className="mt-2 text-xs">
        {new Date(state.changedAt).toLocaleString(formatLocale)} ·{" "}
        {formatChangedBy(state)}
      </p>
    </section>
  );
}

export default function DistributionControl() {
  const { t, formatLocale } = useI18n();
  const { state, setState, loading, error, setError, refresh } =
    useDistributionControlState();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(false);

  const changeState = async (blocked: boolean) => {
    if (!state) {
      return;
    }

    const normalizedReason = reason.trim();
    if (blocked && !normalizedReason) {
      setError("Укажите причину аварийной блокировки.");
      return;
    }

    const confirmed = window.confirm(
      blocked
        ? t(
            "Немедленно остановить выдачу manifest и всех OTA assets для всех клиентов?",
          )
        : t("Возобновить глобальное OTA-распространение?"),
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const updated = await setDistributionControl({
        blocked,
        ...(blocked ? { reason: normalizedReason } : {}),
        expectedVersion: state.version,
      });
      setState({ ...updated, canWrite: state.canWrite });
      setReason("");
      setMessage(
        blocked
          ? t("OTA-распространение остановлено.")
          : t("OTA-распространение возобновлено."),
      );
    } catch (saveError: unknown) {
      if (saveError instanceof AdminApiError && saveError.status === 409) {
        await refresh();
        setError(
          "Состояние уже изменил другой оператор. Данные обновлены; проверьте их и повторите действие.",
        );
      } else {
        setError(
          saveError instanceof Error
            ? saveError.message
            : "Не удалось изменить глобальный статус OTA",
        );
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="gap-0 overflow-hidden py-0 shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-start gap-3">
          <div
            className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${state?.blocked || error ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}
          >
            {loading ? (
              <RefreshCw className="size-4 animate-spin" />
            ) : state?.blocked || error ? (
              <ShieldAlert className="size-4" />
            ) : (
              <ShieldCheck className="size-4" />
            )}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">
                {t("Распространение OTA")}
              </h2>
              <Badge
                variant="secondary"
                className={
                  state?.blocked || error
                    ? "bg-destructive/10 text-destructive"
                    : ""
                }
              >
                {loading
                  ? t("Проверка…")
                  : error || !state
                    ? t("Недоступно")
                    : state.blocked
                      ? t("Остановлено")
                      : t("Работает")}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {state?.blocked
                ? state.reason
                : t("Глобальное управление выдачей manifest и assets.")}
            </p>
          </div>
        </div>
        {state?.canWrite ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-controls="distribution-controls"
          >
            {t("Управление")}
            <ChevronDown
              className={`transition-transform ${expanded ? "rotate-180" : ""}`}
            />
          </Button>
        ) : state ? (
          <Badge variant="outline">Read only · updates:write</Badge>
        ) : null}
      </div>
      {expanded && state?.canWrite && (
        <div
          id="distribution-controls"
          className="space-y-3 border-t bg-muted/20 p-4"
        >
          <p className="text-xs text-muted-foreground">
            {t("Изменено: ")}
            {new Date(state.changedAt).toLocaleString(formatLocale)} ·{" "}
            {formatChangedBy(state)} · version {state.version}
          </p>
          {!state.blocked && (
            <label className="block space-y-2 text-sm font-medium">
              {t("Причина остановки")}
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={500}
                aria-label={t("Причина аварийной блокировки OTA")}
                placeholder={t(
                  "Обязательная причина остановки (до 500 символов)",
                )}
                className="block min-h-20 w-full max-w-2xl rounded-md border border-input bg-background p-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          )}
          <Button
            variant={state.blocked ? "default" : "destructive"}
            size="sm"
            disabled={saving || loading}
            onClick={() => void changeState(!state.blocked)}
          >
            {saving
              ? t("Сохранение…")
              : state.blocked
                ? t("Возобновить OTA")
                : t("Остановить все OTA")}
          </Button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="border-t bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {t(error)}
        </p>
      )}
      {message && (
        <p
          role="status"
          className="border-t px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400"
        >
          {message}
        </p>
      )}
    </Card>
  );
}
