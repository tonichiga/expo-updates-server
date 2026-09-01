"use client";

import {
  deleteUpdate,
  getUpdate,
  promoteUpdate,
  rollbackUpdate,
  setUpdateDisabled,
  updateJsonFile,
} from "@/src/client/admin-api";
import { UpdateDetail } from "@/src/client/admin-types";
import LogoutButton from "@/src/client/logout-button";
import UpdatePolicyEditor from "@/src/client/update-policy-editor";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
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
  const params = useParams<{ encodedKey: string }>();
  const router = useRouter();
  const encodedKey = params.encodedKey;

  const [detail, setDetail] = useState<UpdateDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
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

    const newestUpdateId =
      detail?.channelLatest &&
      typeof detail.channelLatest.newestUpdateId === "string"
        ? detail.channelLatest.newestUpdateId
        : null;

    const currentServedUpdateId = activeUpdateId || latestUpdateId;
    const isNewestInScope = Boolean(
      detail?.updateId && newestUpdateId && detail.updateId === newestUpdateId,
    );

    return {
      latestUpdateId,
      activeUpdateId,
      rollbackActive,
      newestUpdateId,
      currentServedUpdateId,
      isNewestInScope,
    };
  }, [detail]);

  const canPromote = Boolean(
    !distributionBlocked &&
    channelState.isNewestInScope &&
    channelState.rollbackActive,
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
    const loadDetail = async () => {
      setLoading(true);
      setError("");
      setSuccess("");

      try {
        const response = await getUpdate(encodedKey);
        setDetail(response);
      } catch (loadError: unknown) {
        setError((loadError as Error).message || "Не удалось загрузить детали");
      } finally {
        setLoading(false);
      }
    };

    void loadDetail();
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
      setSuccess(`Файл ${selectedFile} обновлён`);
    } catch (saveError: unknown) {
      setError((saveError as Error).message || "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  const handleRollback = async () => {
    const confirmed = window.confirm(
      "Вы действительно хотите начать распространение предыдущей версии обновления?",
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
    const confirmed = window.confirm(
      "Вернуть распространение к последнему апдейту (promote)?",
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

    const confirmed = window.confirm("Удалить апдейт полностью из bucket?");
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
    <main className="min-h-screen bg-zinc-50 p-4 dark:bg-zinc-950 md:p-8">
      <div className="mx-auto max-w-7xl space-y-4">
        <header className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 md:flex-row md:items-center md:justify-between">
          <div>
            <Link
              href="/updates"
              className="text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              ← К списку
            </Link>
            <span className="mx-2 text-zinc-400">|</span>
            <Link
              href="/updates/embedded"
              className="text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              Embedded
            </Link>
            <h1 className="mt-1 text-xl font-semibold">Детали апдейта</h1>
          </div>
          <LogoutButton />
        </header>

        {loading ? (
          <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            Загрузка...
          </div>
        ) : null}

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        ) : null}

        {success ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            {success}
          </div>
        ) : null}

        <DistributionControlBanner
          state={distributionControl.state}
          loading={distributionControl.loading}
          error={distributionControl.error}
        />

        {!loading && detail ? (
          <>
            {channelState.rollbackActive ? (
              <section className="rounded-xl border border-orange-300 bg-orange-50 p-4 dark:border-orange-700 dark:bg-orange-950/30">
                <p className="text-sm font-medium text-orange-900 dark:text-orange-200">
                  ⚠️ Rollback активен в этом канале/платформе.
                </p>
                <p className="mt-1 text-xs text-orange-800 dark:text-orange-300">
                  Сейчас раздаётся updateId: {channelState.activeUpdateId}
                </p>
                <p className="mt-1 text-xs text-orange-800 dark:text-orange-300">
                  Новые апдейты автоматически игнорируются до выполнения
                  Promote.
                </p>
              </section>
            ) : null}

            {detail.isIgnoredByRollback ? (
              <section className="rounded-xl border border-zinc-300 bg-zinc-50 p-4 dark:border-zinc-700 dark:bg-zinc-900/40">
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  Этот апдейт сейчас не доставляется.
                </p>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  Причина: активен rollback, автодоставка новых апдейтов
                  выключена.
                </p>
              </section>
            ) : null}

            <section className="grid gap-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 md:grid-cols-2 lg:grid-cols-4">
              <Info label="Runtime" value={detail.runtimeVersion} />
              <Info label="Platform" value={detail.platform} />
              <Info label="Channel" value={detail.channel} />
              <Info label="Stage" value={detail.stage} />
              <Info
                label="Created"
                value={detail.createdAt || detail.createdAtPath}
              />
              <Info label="Status" value={detail.status} />
              <Info label="Latest" value={detail.isLatest ? "Да" : "Нет"} />
              <Info
                label="Rollback"
                value={detail.isRollbackActive ? "Активен" : "Нет"}
              />
              <Info
                label="Доставка"
                value={
                  detail.isIgnoredByRollback
                    ? "Ignored by rollback"
                    : detail.deliveryMode === "background"
                      ? "Background"
                      : "Manual"
                }
              />
              <Info label="Guard" value={detail.hasGuard ? "Yes" : "None"} />
              <Info
                label="Policy"
                value={`v${detail.policyVersion} · ${detail.policyEditable ? "draft" : "published"}`}
              />
              <Info label="Assets" value={String(detail.assetsCount)} />
              <Info
                label="Update ID"
                value={detail.updateId}
                className="md:col-span-2 lg:col-span-2"
              />
              <Info
                label="Комментарий"
                value={detail.comment || "-"}
                className="md:col-span-2 lg:col-span-2"
              />
              <Info
                label="Активный update ID"
                value={channelState.activeUpdateId || "-"}
                className="md:col-span-2 lg:col-span-2"
              />
            </section>

            <UpdatePolicyEditor
              key={`${encodedKey}-${detail.policyVersion}-${detail.policyPublishedAt || "draft"}`}
              encodedKey={encodedKey}
              onSaved={reload}
            />

            <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap gap-2">
                {canRollback ? (
                  <button
                    type="button"
                    onClick={handleRollback}
                    disabled={saving}
                    className="rounded-md border border-orange-300 bg-orange-50 px-4 py-4 text-sm text-orange-800 hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-orange-700 dark:bg-orange-950/30 dark:text-orange-300 dark:hover:bg-orange-950/50"
                  >
                    Rollback
                  </button>
                ) : null}
                {canPromote ? (
                  <button
                    type="button"
                    onClick={handlePromote}
                    disabled={saving}
                    className="rounded-md border border-emerald-300 bg-emerald-50 px-4 py-4 text-sm text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
                  >
                    Promote
                  </button>
                ) : null}
                {showToggleDisabledButton ? (
                  <button
                    type="button"
                    onClick={handleToggleDisabled}
                    disabled={saving}
                    className="rounded-md border border-amber-300 px-4 py-4 text-sm text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/40"
                  >
                    {detail.status === "disabled"
                      ? "Активировать"
                      : "Деактивировать"}
                  </button>
                ) : null}
                {canDelete ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={saving}
                    className="rounded-md border border-red-300 px-4 py-4 text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-700 dark:text-red-300 dark:hover:bg-red-950/40"
                  >
                    Удалить апдейт
                  </button>
                ) : null}
              </div>
            </section>

            <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-sm">JSON файл</label>
                <select
                  value={selectedFile}
                  onChange={(event) =>
                    setSelectedFile(event.target.value as EditableFile)
                  }
                  aria-label="Выбор JSON файла"
                  className="rounded-md border border-zinc-300 bg-transparent px-2 py-2 text-sm dark:border-zinc-700"
                >
                  <option value="update-info.json">update-info.json</option>
                  <option value="update-meta.json">update-meta.json</option>
                  <option value="metadata.json">metadata.json</option>
                  <option value="channel-latest.json">
                    channel latest.json
                  </option>
                </select>
                <button
                  type="button"
                  onClick={handleSaveJson}
                  disabled={
                    saving ||
                    channelLatestLocked ||
                    updateMetaDistributionLocked
                  }
                  className="rounded-md border border-zinc-300 px-4 py-4 text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
                >
                  Сохранить JSON
                </button>
              </div>
              {channelLatestLocked ? (
                <p className="mt-2 text-xs text-orange-700 dark:text-orange-300">
                  Редактирование channel latest.json заблокировано: активен
                  rollback или глобальный аварийный выключатель.
                </p>
              ) : null}
              {updateMetaDistributionLocked ? (
                <p className="mt-2 text-xs text-red-700 dark:text-red-300">
                  Активация через update-meta.json недоступна при глобальной
                  блокировке. Деактивация с isActive=false остаётся доступна.
                </p>
              ) : null}
              <textarea
                value={editorValue}
                onChange={(event) => setEditorValue(event.target.value)}
                aria-label="Редактор JSON"
                className="mt-3 h-120 w-full rounded-md border border-zinc-300 bg-zinc-50 p-3 font-mono text-xs outline-none ring-blue-500 focus:ring-2 dark:border-zinc-700 dark:bg-zinc-950"
                spellCheck={false}
              />
            </section>
          </>
        ) : null}
      </div>
    </main>
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
      <p className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </p>
      <p className="mt-1 break-all text-sm">{value}</p>
    </div>
  );
}
