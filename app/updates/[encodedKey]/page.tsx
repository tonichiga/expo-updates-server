"use client";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useConfirmAction } from "@/components/admin/confirm-action";
import type { TranslationMessage } from "@/src/client/i18n/messages";
import { useI18n } from "@/src/client/i18n/provider";
import { useFormatters } from "@/src/client/i18n/use-formatters";

import { Textarea } from "@/components/ui/textarea";

import { NativeSelect } from "@/components/ui/native-select";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

import {
  deleteUpdate,
  getUpdate,
  promoteUpdate,
  rollbackUpdate,
  setUpdateDisabled,
  updateJsonFile,
} from "@/src/client/admin-api";
import { UpdateDetail } from "@/src/client/admin-types";
import UpdateAudienceEditor from "@/src/client/update-audience-editor";
import UpdatePolicyEditor from "@/src/client/update-policy-editor";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useContext, useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileJson, Radio, Users } from "lucide-react";
import { AdminRoleContext } from "@/components/admin/admin-role";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsContent, TabsTrigger } from "@/components/ui/tabs";
import {
  DistributionControlBanner,
  useDistributionControlState,
} from "@/src/client/distribution-control";

type EditableFile =
  | "update-info.json"
  | "update-meta.json"
  | "metadata.json"
  | "channel-latest.json";

function prettyJson(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

export default function UpdateDetailsPage() {
  const confirmAction = useConfirmAction();
  const { t } = useI18n();
  const { fullDate } = useFormatters();
  const role = useContext(AdminRoleContext);
  const canWrite = role === "operator" || role === "admin";
  const params = useParams<{ encodedKey: string }>();
  const router = useRouter();
  const encodedKey = params.encodedKey;

  const [detail, setDetail] = useState<UpdateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<TranslationMessage>("");
  const [selectedFile, setSelectedFile] =
    useState<EditableFile>("update-info.json");
  const [editorValue, setEditorValue] = useState("{}");
  const distributionControl = useDistributionControlState();
  const distributionUnavailable =
    distributionControl.loading ||
    Boolean(distributionControl.error) ||
    !distributionControl.state;
  const distributionBlocked =
    distributionControl.state?.blocked === true || distributionUnavailable;

  const channelState = useMemo(() => {
    const latestUpdateId =
      detail?.channelLatest &&
      typeof detail.channelLatest.latestUpdateId === "string"
        ? detail.channelLatest.latestUpdateId
        : null;
    const activeUpdateId =
      detail?.channelLatest &&
      typeof detail.channelLatest.activeUpdateId === "string"
        ? detail.channelLatest.activeUpdateId
        : null;

    const rollbackActive =
      Boolean(activeUpdateId) && activeUpdateId !== latestUpdateId;

    const currentServedUpdateId = activeUpdateId || latestUpdateId;

    return {
      latestUpdateId,
      activeUpdateId,
      rollbackActive,
      currentServedUpdateId,
      isNewestInScope:
        detail?.isNewestInScope ??
        (Boolean(detail?.updateId) &&
          detail?.channelLatest?.newestUpdateId === detail?.updateId),
    };
  }, [detail]);

  const canPromote = Boolean(
    !distributionBlocked && detail?.isLatest && channelState.rollbackActive,
  );
  const canRollback = Boolean(
    detail &&
      !distributionBlocked &&
      !channelState.isNewestInScope &&
      channelState.currentServedUpdateId &&
      detail.updateId !== channelState.currentServedUpdateId,
  );
  const canToggleDisabled = Boolean(
    detail && !(channelState.rollbackActive && channelState.isNewestInScope),
  );
  const canDirectActivate = Boolean(
    detail &&
      !distributionBlocked &&
      detail.status === "disabled" &&
      channelState.isNewestInScope &&
      !channelState.rollbackActive,
  );
  const canDirectDeactivate = Boolean(
    detail && detail.status !== "disabled" && canToggleDisabled,
  );
  const showToggleDisabledButton = canDirectActivate || canDirectDeactivate;
  const canDelete = Boolean(detail && detail.status !== "active");
  const channelLatestLocked =
    selectedFile === "channel-latest.json" &&
    (channelState.rollbackActive || distributionBlocked);

  const updateMetaDistributionLocked = useMemo(() => {
    if (selectedFile !== "update-meta.json" || !distributionBlocked) {
      return false;
    }
    try {
      const value: unknown = JSON.parse(editorValue);
      return (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        !("isActive" in value) ||
        value.isActive !== false
      );
    } catch {
      return true;
    }
  }, [distributionBlocked, editorValue, selectedFile]);

  const fileContent = useMemo(() => {
    if (!detail) {
      return "{}";
    }

    if (selectedFile === "update-info.json") {
      return prettyJson(detail.updateInfo);
    }

    if (selectedFile === "update-meta.json") {
      return prettyJson(detail.updateMeta || {});
    }

    if (selectedFile === "metadata.json") {
      return prettyJson(detail.metadata || {});
    }

    return prettyJson(detail.channelLatest || {});
  }, [detail, selectedFile]);

  useEffect(() => {
    setEditorValue(fileContent);
  }, [fileContent]);

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setLoading(true);
    setError("");
    setSuccess("");
    getUpdate(encodedKey, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setDetail(next);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted)
          setError(e.message || "Не удалось загрузить детали");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [encodedKey]);

  const reload = async () => {
    const response = await getUpdate(encodedKey);
    setDetail(response);
  };

  const handleSaveJson = async () => {
    setError("");
    setSuccess("");

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(editorValue) as Record<string, unknown>;
    } catch {
      setError("Некорректный JSON");
      return;
    }

    setSaving(true);
    try {
      await updateJsonFile(encodedKey, selectedFile, parsed);
      await reload();
      setSuccess({ key: "Файл {0} обновлён", values: [selectedFile] });
    } catch (saveError: unknown) {
      setError((saveError as Error).message || "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleRollback = async () => {
    const confirmed = await confirmAction(
      t("Rollback"),
      t(
        "Вы действительно хотите начать распространение предыдущей версии обновления?",
      ),
    );
    if (!confirmed) {
      return;
    }

    setError("");
    setSuccess("");
    setSaving(true);
    try {
      await rollbackUpdate(encodedKey);
      await reload();
      setSuccess("Rollback активирован");
    } catch (rollbackError: unknown) {
      setError((rollbackError as Error).message || "Rollback не выполнен");
    } finally {
      setSaving(false);
    }
  };

  const handlePromote = async () => {
    const confirmed = await confirmAction(
      t("Promote"),
      t("Вернуть распространение к последнему апдейту (promote)?"),
    );
    if (!confirmed) {
      return;
    }

    setError("");
    setSuccess("");
    setSaving(true);
    try {
      await promoteUpdate(encodedKey);
      await reload();
      setSuccess("Promote выполнен: распространение возвращено к latest");
    } catch (promoteError: unknown) {
      setError((promoteError as Error).message || "Promote не выполнен");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleDisabled = async () => {
    if (!detail) {
      return;
    }

    setError("");
    setSuccess("");
    setSaving(true);
    try {
      const disabled = detail.status !== "disabled";
      await setUpdateDisabled(encodedKey, disabled);
      await reload();
      setSuccess(disabled ? "Апдейт деактивирован" : "Апдейт активирован");
    } catch (toggleError: unknown) {
      setError((toggleError as Error).message || "Не удалось изменить статус");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (detail?.status === "active") {
      setError("Нельзя удалить активный апдейт");
      return;
    }

    const confirmed = await confirmAction(
      t("Удалить апдейт"),
      t("Удалить апдейт полностью из bucket?"),
      true,
    );
    if (!confirmed) {
      return;
    }

    setError("");
    setSuccess("");
    setSaving(true);

    try {
      await deleteUpdate(encodedKey);
      router.replace("/updates");
    } catch (deleteError: unknown) {
      setError((deleteError as Error).message || "Не удалось удалить апдейт");
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 p-4 sm:p-6 lg:p-8">
      <div className="space-y-5">
        <header className="space-y-3">
          <Link
            href="/updates"
            className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {t("Публикации")}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="break-words text-3xl font-semibold tracking-tight">
              {detail?.comment ||
                (detail?.appVersion
                  ? t("Version {0}", [detail.appVersion])
                  : t("Детали обновления"))}
            </h1>
            {detail && (
              <Badge
                variant={detail.status === "active" ? "default" : "secondary"}
              >
                {detail.policyEditable ? t("draft") : t(detail.status)}
              </Badge>
            )}
            {detail?.isLatest && <Badge variant="outline">{t("Latest")}</Badge>}
            {!canWrite && <Badge variant="outline">{t("Read only")}</Badge>}
          </div>
          {detail && (
            <p className="break-words text-sm text-muted-foreground">
              {detail.platform === "ios" ? "iOS" : "Android"} · {detail.channel}{" "}
              · {t("Runtime {0}", [detail.runtimeVersion])} ·{" "}
              {fullDate(detail.createdAt)}
            </p>
          )}
        </header>

        {loading ? (
          <Skeleton className="h-16" role="status">
            <span className="sr-only">{t("Загрузка...")}</span>
          </Skeleton>
        ) : null}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{t(error)}</AlertDescription>
          </Alert>
        ) : null}

        {success ? (
          <Alert role="status">
            <AlertDescription>{t(success)}</AlertDescription>
          </Alert>
        ) : null}

        <DistributionControlBanner
          state={distributionControl.state}
          loading={distributionControl.loading}
          error={distributionControl.error}
        />

        {!loading && detail ? (
          <>
            {channelState.rollbackActive ? (
              <Alert role="status">
                <AlertTitle>
                  {t("⚠️ Rollback активен в этом канале/платформе.")}
                </AlertTitle>
                <AlertDescription>
                  {t("Сейчас раздаётся updateId: ")}
                  {channelState.activeUpdateId}
                </AlertDescription>
                <AlertDescription>
                  {t(
                    "Новые апдейты автоматически игнорируются до выполнения Promote.",
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            {detail.isIgnoredByRollback ? (
              <Alert role="status">
                <AlertTitle>
                  {t("Этот апдейт сейчас не доставляется.")}
                </AlertTitle>
                <AlertDescription>
                  {t(
                    "Причина: активен rollback, автодоставка новых апдейтов выключена.",
                  )}
                </AlertDescription>
              </Alert>
            ) : null}

            <Card className="gap-4 py-0 shadow-none">
              <div className="grid gap-4 p-4 sm:grid-cols-3 sm:p-5">
                <Info
                  label={t("Audience")}
                  value={
                    detail.audienceMode === "devices"
                      ? t("Выбранные устройства")
                      : t("Все совместимые устройства")
                  }
                />
                <Info
                  label={t("Доставка")}
                  value={
                    detail.isIgnoredByRollback
                      ? t("Ignored by rollback")
                      : detail.deliveryMode === "background"
                        ? t("Background")
                        : t("Manual")
                  }
                />
                <Info label={t("Update ID")} value={detail.updateId} />
              </div>
              {canWrite &&
                (canRollback || canPromote || showToggleDisabledButton) && (
                  <div className="flex flex-wrap items-center gap-2 border-t bg-muted/20 px-4 py-3 sm:px-5">
                    {canRollback ? (
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={handleRollback}
                        disabled={saving}
                      >
                        {t("Rollback")}
                      </Button>
                    ) : null}
                    {canPromote ? (
                      <Button
                        variant="default"
                        size="sm"
                        type="button"
                        onClick={handlePromote}
                        disabled={saving}
                      >
                        {t("Promote")}
                      </Button>
                    ) : null}
                    {showToggleDisabledButton ? (
                      <Button
                        variant={
                          detail.status === "disabled" ? "default" : "outline"
                        }
                        size="sm"
                        type="button"
                        onClick={handleToggleDisabled}
                        disabled={saving}
                      >
                        {detail.status === "disabled"
                          ? t("Активировать")
                          : t("Деактивировать")}
                      </Button>
                    ) : null}
                  </div>
                )}
            </Card>
            <Tabs
              defaultValue="audience"
              key={encodedKey}
              className="min-w-0 gap-4"
            >
              <TabsList
                aria-label={t("Release sections")}
                className="max-w-full"
              >
                <TabsTrigger value="audience">
                  <Users className="hidden size-4 sm:block" />
                  {t("Audience")}
                </TabsTrigger>
                <TabsTrigger value="policy">
                  <Radio className="hidden size-4 sm:block" />
                  {t("Policy")}
                </TabsTrigger>
                <TabsTrigger value="metadata">
                  <FileJson className="hidden size-4 sm:block" />
                  {t("Metadata")}
                </TabsTrigger>
              </TabsList>
              <TabsContent
                value="audience"
                forceMount
                className="data-[state=inactive]:hidden"
              >
                <UpdateAudienceEditor
                  encodedKey={encodedKey}
                  platform={detail.platform}
                  canWrite={canWrite}
                  onSaved={(mode) =>
                    setDetail(
                      (current) =>
                        current && { ...current, audienceMode: mode },
                    )
                  }
                />
              </TabsContent>
              <TabsContent
                value="policy"
                forceMount
                className="data-[state=inactive]:hidden"
              >
                <UpdatePolicyEditor
                  key={`${encodedKey}-${detail.policyPublishedAt || "draft"}`}
                  platform={detail.platform}
                  encodedKey={encodedKey}
                  onSaved={reload}
                />
              </TabsContent>
              <TabsContent value="metadata" className="space-y-4">
                <Card className="grid gap-4 p-5 shadow-none sm:grid-cols-2 lg:grid-cols-4">
                  <Info label={t("Runtime")} value={detail.runtimeVersion} />
                  <Info label={t("Platform")} value={detail.platform} />
                  <Info label={t("Channel")} value={detail.channel} />
                  <Info
                    label={t("Created")}
                    value={
                      detail.createdAt
                        ? fullDate(detail.createdAt)
                        : detail.createdAtPath
                    }
                  />
                  <Info label={t("Status")} value={t(detail.status)} />
                  <Info
                    label={t("Latest")}
                    value={detail.isLatest ? t("Да") : t("Нет")}
                  />
                  <Info
                    label={t("Rollback")}
                    value={detail.isRollbackActive ? t("Активен") : t("Нет")}
                  />
                  <Info
                    label={t("Доставка")}
                    value={
                      detail.isIgnoredByRollback
                        ? t("Ignored by rollback")
                        : detail.deliveryMode === "background"
                          ? t("Background")
                          : t("Manual")
                    }
                  />
                  <Info
                    label={t("Guard")}
                    value={detail.hasGuard ? t("Yes") : t("None")}
                  />
                  <Info
                    label={t("Policy")}
                    value={`v${detail.policyVersion} · ${detail.policyEditable ? t("draft") : t("published")}`}
                  />
                  <Info
                    label={t("Assets")}
                    value={String(detail.assetsCount)}
                  />
                  <Info
                    label={t("Update ID")}
                    value={detail.updateId}
                    className="md:col-span-2 lg:col-span-2"
                  />
                  <Info
                    label={t("Комментарий")}
                    value={detail.comment || "-"}
                    className="md:col-span-2 lg:col-span-2"
                  />
                  <Info
                    label={t("Активный update ID")}
                    value={channelState.activeUpdateId || "-"}
                    className="md:col-span-2 lg:col-span-2"
                  />
                </Card>
                <Card className="gap-3 p-5 shadow-none">
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-sm">{t("JSON файл")}</label>
                    <NativeSelect
                      value={selectedFile}
                      onChange={(event) =>
                        setSelectedFile(event.target.value as EditableFile)
                      }
                      aria-label={t("Выбор JSON файла")}
                      className="rounded-md border border-input bg-background px-2 py-2 text-sm "
                    >
                      <option value="update-info.json">update-info.json</option>
                      <option value="update-meta.json">update-meta.json</option>
                      <option value="metadata.json">metadata.json</option>
                      <option value="channel-latest.json">
                        channel latest.json
                      </option>
                    </NativeSelect>
                    {canWrite && (
                      <Button
                        variant="outline"
                        size="sm"
                        type="button"
                        onClick={handleSaveJson}
                        disabled={
                          saving ||
                          channelLatestLocked ||
                          updateMetaDistributionLocked
                        }
                      >
                        {t("Сохранить JSON")}
                      </Button>
                    )}
                  </div>
                  {channelLatestLocked ? (
                    <p className="mt-2 text-xs text-orange-700 dark:text-orange-300">
                      {t(
                        "Редактирование channel latest.json заблокировано: активен rollback или глобальный аварийный выключатель.",
                      )}
                    </p>
                  ) : null}
                  {updateMetaDistributionLocked ? (
                    <p className="mt-2 text-xs text-red-700 dark:text-red-300">
                      {t(
                        "Активация через update-meta.json недоступна при глобальной блокировке. Деактивация с isActive=false остаётся доступна.",
                      )}
                    </p>
                  ) : null}
                  <Textarea
                    value={editorValue}
                    readOnly={!canWrite}
                    onChange={(event) => setEditorValue(event.target.value)}
                    aria-label={t("Редактор JSON")}
                    className="mt-3 h-120 w-full rounded-md border border-border bg-muted/30 p-3 font-mono text-xs outline-none ring-blue-500 focus:ring-2 "
                    spellCheck={false}
                  />
                </Card>
                {canWrite && canDelete ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    type="button"
                    onClick={handleDelete}
                    disabled={saving}
                  >
                    {t("Удалить апдейт")}
                  </Button>
                ) : null}
              </TabsContent>
            </Tabs>
          </>
        ) : null}
      </div>
    </div>
  );
}

function Info({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1.5 break-all text-sm font-medium">{value}</p>
    </div>
  );
}
