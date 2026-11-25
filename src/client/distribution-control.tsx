"use client";
import { useConfirmAction } from "@/components/admin/confirm-action";
import type { TranslationMessage } from "@/src/client/i18n/messages";
import { useI18n } from "@/src/client/i18n/provider";

import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Field, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

import { statusTones } from "@/components/ui/status-tones";
import { cn } from "@/lib/utils";
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

  return { state, setState, loading, error, setError, refresh };
}

function formatChangedBy(
  state: DistributionControlResponse,
  t: ReturnType<typeof useI18n>["t"],
): string {
  const role = state.changedBy.role ? ` (${t(state.changedBy.role)})` : "";
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
      <Skeleton className="h-12" role="status">
        <span className="sr-only">
          {t("Проверка глобального статуса OTA…")}
        </span>
      </Skeleton>
    );
  }
  if (error || !state) {
    return (
      <Alert variant="destructive">
        <ShieldAlert />
        <AlertTitle>
          {t(
            "Глобальный статус OTA недоступен. Распространяющие действия отключены до восстановления связи.",
          )}
        </AlertTitle>
        {error && <AlertDescription>{t(error)}</AlertDescription>}
      </Alert>
    );
  }
  if (!state.blocked) {
    return null;
  }

  return (
    <Alert variant="destructive">
      <ShieldAlert />
      <AlertTitle>{t("Распространение OTA остановлено")}</AlertTitle>
      <AlertDescription>
        <p>{state.reason}</p>
        <p>
          {new Date(state.changedAt).toLocaleString(formatLocale)} ·{" "}
          {formatChangedBy(state, t)}
        </p>
      </AlertDescription>
    </Alert>
  );
}

export default function DistributionControl({
  onAvailabilityChange,
}: {
  onAvailabilityChange?: (blocked: boolean) => void;
}) {
  const confirmAction = useConfirmAction();
  const { t, formatLocale } = useI18n();
  const { state, setState, loading, error, refresh } =
    useDistributionControlState();
  const [actionError, setActionError] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<TranslationMessage>("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    onAvailabilityChange?.(loading || !!error || !state || state.blocked);
  }, [loading, error, state, onAvailabilityChange]);

  const changeState = async (blocked: boolean) => {
    if (!state) {
      return;
    }

    const normalizedReason = reason.trim();
    if (blocked && !normalizedReason) {
      setActionError("Укажите причину аварийной блокировки.");
      return;
    }

    const confirmed = await confirmAction(
      blocked ? t("Остановить все OTA") : t("Возобновить OTA"),
      blocked
        ? t(
            "Немедленно остановить выдачу manifest и всех OTA assets для всех клиентов?",
          )
        : t("Возобновить глобальное OTA-распространение?"),
      blocked,
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setActionError("");
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
          ? "OTA-распространение остановлено."
          : "OTA-распространение возобновлено.",
      );
    } catch (saveError: unknown) {
      if (saveError instanceof AdminApiError && saveError.status === 409) {
        await refresh();
        setActionError(
          "Состояние уже изменил другой оператор. Данные обновлены; проверьте их и повторите действие.",
        );
      } else {
        setActionError(
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
    <Card
      className={cn(
        "gap-0 overflow-hidden py-0 shadow-none",
        (state?.blocked || error) && "border-l-4 border-l-destructive",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-4 p-4">
        <div className="flex items-start gap-3">
          <div
            className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${state?.blocked || error ? statusTones.destructive : state && !loading ? statusTones.positive : "bg-muted text-muted-foreground"}`}
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
                variant={
                  loading
                    ? "neutral"
                    : state?.blocked || error || !state
                      ? "destructive"
                      : "positive"
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
          <Badge variant="neutral">{t("Read only · updates:write")}</Badge>
        ) : null}
      </div>
      {expanded && state?.canWrite && (
        <div
          id="distribution-controls"
          className={cn(
            "space-y-3 border-t p-4",
            state.blocked ? "bg-muted/20" : statusTones.destructive,
          )}
        >
          <p className="text-xs text-muted-foreground">
            {t("Изменено: ")}
            {new Date(state.changedAt).toLocaleString(formatLocale)} ·{" "}
            {formatChangedBy(state, t)} {t(" · version {0}", [state.version])}
          </p>
          {!state.blocked && (
            <Field>
              <FieldLabel htmlFor="stop-reason">
                {t("Причина остановки")}
              </FieldLabel>
              <Textarea
                id="stop-reason"
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setActionError("");
                }}
                maxLength={500}
                aria-label={t("Причина аварийной блокировки OTA")}
                placeholder={t(
                  "Обязательная причина остановки (до 500 символов)",
                )}
                className="min-h-20 max-w-2xl bg-background text-foreground"
              />
            </Field>
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
      {(error || actionError) && (
        <p
          role="alert"
          className={cn("border-t px-4 py-3 text-sm", statusTones.destructive)}
        >
          {t(error || actionError)}
        </p>
      )}
      {message && (
        <p
          role="status"
          className={cn(
            "border-t px-4 py-3 text-sm",
            state?.blocked ? statusTones.destructive : statusTones.positive,
          )}
        >
          {t(message)}
        </p>
      )}
    </Card>
  );
}
