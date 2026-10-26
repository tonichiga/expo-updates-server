"use client";
import type { TranslationMessage } from "@/src/client/i18n/messages";
import { useI18n } from "@/src/client/i18n/provider";

import { NativeSelect } from "@/components/ui/native-select";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Input as TextInput } from "@/components/ui/input";

import {
  createEmergencyRedirect,
  deleteEmergencyRedirect,
  getAdminSession,
  getEmergencyRedirects,
  updateEmergencyRedirect,
} from "@/src/client/admin-api";
import {
  EmergencyRedirectInput,
  EmergencyRedirectItem,
} from "@/src/client/admin-types";
import { FormEvent, useCallback, useEffect, useState } from "react";

const EMPTY_FORM: EmergencyRedirectInput = {
  name: "",
  enabled: true,
  embeddedUpdateId: "",
  runtimeVersion: "",
  platform: "android",
  fromChannel: "development",
  toChannel: "production",
  targetMode: "pinned",
  expectedUpdateId: null,
};

export default function EmergencyRedirectsPage() {
  const { t } = useI18n();
  const [items, setItems] = useState<EmergencyRedirectItem[]>([]);
  const [form, setForm] = useState<EmergencyRedirectInput>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<TranslationMessage>("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [redirects, session] = await Promise.all([
        getEmergencyRedirects(),
        getAdminSession(),
      ]);
      setItems(redirects.items || []);
      setCanWrite(session.role === "admin" || session.role === "operator");
    } catch (loadError: unknown) {
      setError(
        (loadError as Error).message ||
          "Не удалось загрузить emergency redirects",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const payload = {
        ...form,
        expectedUpdateId: form.expectedUpdateId?.trim() || null,
      };

      if (editingId) {
        await updateEmergencyRedirect(editingId, payload);
        setSuccess("Emergency redirect обновлён");
      } else {
        await createEmergencyRedirect(payload);
        setSuccess("Emergency redirect создан");
      }

      resetForm();
      await load();
    } catch (saveError: unknown) {
      setError(
        (saveError as Error).message ||
          "Не удалось сохранить emergency redirect",
      );
    } finally {
      setSaving(false);
    }
  };

  const edit = (item: EmergencyRedirectItem) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      enabled: item.enabled,
      embeddedUpdateId: item.embeddedUpdateId,
      runtimeVersion: item.runtimeVersion,
      platform: item.platform,
      fromChannel: item.fromChannel,
      toChannel: item.toChannel,
      targetMode: item.targetMode,
      expectedUpdateId: item.expectedUpdateId,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const toggle = async (item: EmergencyRedirectItem) => {
    setError("");
    setSuccess("");
    try {
      await updateEmergencyRedirect(item.id, { enabled: !item.enabled });
      setSuccess(item.enabled ? "Redirect отключён" : "Redirect включён");
      await load();
    } catch (toggleError: unknown) {
      setError(
        (toggleError as Error).message || "Не удалось изменить статус",
      );
    }
  };

  const remove = async (item: EmergencyRedirectItem) => {
    if (
      !window.confirm(t('Удалить emergency redirect "{0}"?', [item.name]))
    ) {
      return;
    }

    setError("");
    setSuccess("");
    try {
      await deleteEmergencyRedirect(item.id);
      setSuccess("Emergency redirect удалён");
      if (editingId === item.id) {
        resetForm();
      }
      await load();
    } catch (deleteError: unknown) {
      setError(
        (deleteError as Error).message || "Не удалось удалить redirect",
      );
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 md:p-8">
      <div className="space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("Emergency redirects")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t(
                "Точечное перенаправление ошибочных embedded builds между каналами.",
              )}
            </p>
          </div>
          <Badge variant="secondary" className="px-3 py-1">
            {t("Rules: {0}", [items.length])}
          </Badge>
        </header>

        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {t(error)}
          </div>
        ) : null}
        {success ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            {t(success)}
          </div>
        ) : null}

        {canWrite ? (
          <form
            onSubmit={handleSubmit}
            className="space-y-4 rounded-xl border border-border bg-card p-5 "
          >
            <div className="flex items-center justify-between">
              <h2 className="font-semibold">
                {editingId
                  ? t("Редактирование правила")
                  : t("Новое правило")}
              </h2>
              {editingId ? (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={resetForm}
                >
                  {t("Отменить")}
                </Button>
              ) : null}
            </div>

            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <Input
                label={t("Название")}
                value={form.name}
                onChange={(value) => setForm({ ...form, name: value })}
              />
              <Input
                label={t("Runtime version")}
                value={form.runtimeVersion}
                onChange={(value) =>
                  setForm({ ...form, runtimeVersion: value })
                }
              />
              <label className="space-y-1 text-sm">
                <span>{t("Platform")}</span>
                <NativeSelect
                  value={form.platform}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      platform: event.target.value as "ios" | "android",
                    })
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-2 "
                >
                  <option value="android">Android</option>
                  <option value="ios">iOS</option>
                </NativeSelect>
              </label>
              <Input
                label={t("Embedded update ID")}
                value={form.embeddedUpdateId}
                onChange={(value) =>
                  setForm({ ...form, embeddedUpdateId: value })
                }
              />
              <Input
                label={t("From channel")}
                value={form.fromChannel}
                onChange={(value) =>
                  setForm({ ...form, fromChannel: value })
                }
              />
              <Input
                label={t("To channel")}
                value={form.toChannel}
                onChange={(value) => setForm({ ...form, toChannel: value })}
              />
              <label className="space-y-1 text-sm">
                <span>{t("Target mode")}</span>
                <NativeSelect
                  value={form.targetMode}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      targetMode: event.target.value as "pinned" | "follow",
                    })
                  }
                  className="w-full rounded-md border border-input bg-background px-3 py-2 "
                >
                  <option value="pinned">{t("Pinned update")}</option>
                  <option value="follow">{t("Follow channel")}</option>
                </NativeSelect>
              </label>
              <Input
                label={
                  form.targetMode === "pinned"
                    ? t("Expected update ID")
                    : t("Expected update ID (optional)")
                }
                value={form.expectedUpdateId || ""}
                required={form.targetMode === "pinned"}
                onChange={(value) =>
                  setForm({ ...form, expectedUpdateId: value || null })
                }
              />
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                className="size-4 rounded border-input accent-primary"
                type="checkbox"
                checked={form.enabled}
                onChange={(event) =>
                  setForm({ ...form, enabled: event.target.checked })
                }
              />
              {t("Включить правило сразу после сохранения")}
            </label>

            <Button
              variant="default"
              size="sm"
              type="submit"
              disabled={saving}
            >
              {saving
                ? t("Сохранение...")
                : editingId
                  ? t("Сохранить изменения")
                  : t("Создать redirect")}
            </Button>
          </form>
        ) : null}

        <Card className="gap-0 overflow-hidden py-0 shadow-none">
          <div className="overflow-x-auto">
            <Table className="min-w-full text-sm">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="px-4 py-3 text-left">
                    {t("Status")}
                  </TableHead>
                  <TableHead className="px-4 py-3 text-left">
                    {t("Name")}
                  </TableHead>
                  <TableHead className="px-4 py-3 text-left">
                    {t("Scope")}
                  </TableHead>
                  <TableHead className="px-4 py-3 text-left">
                    {t("Redirect")}
                  </TableHead>
                  <TableHead className="px-4 py-3 text-left">
                    {t("Target")}
                  </TableHead>
                  <TableHead className="px-4 py-3 text-left">
                    {t("Embedded ID")}
                  </TableHead>
                  <TableHead className="px-4 py-3 text-left">
                    {t("Actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="h-32 px-4 py-3 text-center text-muted-foreground"
                    >
                      {t("Загрузка...")}
                    </TableCell>
                  </TableRow>
                ) : null}
                {!loading && items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="h-32 px-4 py-3 text-center text-muted-foreground"
                    >
                      {t("Emergency redirects не настроены")}
                    </TableCell>
                  </TableRow>
                ) : null}
                {!loading
                  ? items.map((item) => (
                      <TableRow
                        key={item.id}
                        className="border-t border-border "
                      >
                        <TableCell className="px-4 py-3">
                          <Badge
                            variant="secondary"
                            className={
                              item.enabled
                                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                : ""
                            }
                          >
                            {item.enabled ? t("Enabled") : t("Disabled")}
                          </Badge>
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          {item.name}
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          {item.runtimeVersion} / {item.platform}
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          {item.fromChannel} → {item.toChannel}
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          <Badge variant="outline">
                            {item.targetMode === "pinned"
                              ? t("Pinned update")
                              : t("Follow channel")}
                          </Badge>
                          {item.expectedUpdateId ? (
                            <div
                              title={item.expectedUpdateId}
                              className="mt-1.5 max-w-36 truncate font-mono text-xs text-muted-foreground select-all"
                            >
                              {item.expectedUpdateId}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell className="px-4 py-3 font-mono text-xs">
                          <span
                            className="block max-w-40 truncate select-all"
                            title={item.embeddedUpdateId}
                          >
                            {item.embeddedUpdateId}
                          </span>
                        </TableCell>
                        <TableCell className="px-4 py-3">
                          {canWrite ? (
                            <div className="flex gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                type="button"
                                onClick={() => edit(item)}
                              >
                                {t("Edit")}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                type="button"
                                onClick={() => void toggle(item)}
                              >
                                {item.enabled ? t("Disable") : t("Enable")}
                              </Button>
                              <Button
                                variant="destructive"
                                size="sm"
                                type="button"
                                onClick={() => void remove(item)}
                              >
                                {t("Delete")}
                              </Button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              {t("Read only")}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  : null}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Input({
  label,
  value,
  onChange,
  required = true,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="space-y-1 text-sm">
      <span>{label}</span>
      <TextInput
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-md border border-input bg-background px-3 py-2 "
      />
    </label>
  );
}
