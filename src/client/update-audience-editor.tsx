"use client";
import { useI18n } from "@/src/client/i18n/provider";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import type { Audience } from "@/src/server/devices/audience";

type Target = {
  installation_id: string;
  device_id: string | null;
  name: string | null;
  platform: string;
  runtime_version: string;
  channel: string;
};
async function json(response: Response) {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Ошибка запроса");
  return value;
}
const splitIds = (value: string) => [
  ...new Set(value.split(/[\s,]+/).filter(Boolean)),
];
export default function UpdateAudienceEditor({
  encodedKey,
  platform,
}: {
  encodedKey: string;
  platform: string;
}) {
  const { t } = useI18n();
  const [audience, setAudience] = useState<Audience | null>(null);
  const [devices, setDevices] = useState<Target[]>([]);
  const [mode, setMode] = useState("all");
  const [deviceIds, setDeviceIds] = useState("");
  const [installationIds, setInstallationIds] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [revision, setRevision] = useState(0);
  const url = `/api/admin/updates/${encodedKey}/audience`;
  useEffect(() => {
    const abort = new AbortController();
    Promise.all([
      fetch(url, { signal: abort.signal }).then(json),
      fetch(`/api/admin/device-targets?platform=${platform}`, {
        signal: abort.signal,
      }).then(json),
    ])
      .then(([a, d]) => {
        setAudience(a);
        setMode(a.audience_mode);
        setDeviceIds(a.audience_device_ids.join("\n"));
        setInstallationIds(a.audience_installation_ids.join("\n"));
        setDevices(d.devices);
        setError("");
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [url, platform, revision]);
  const selectedDevices = splitIds(deviceIds);
  const selectedInstallations = splitIds(installationIds);
  const seen = new Set<string>();
  const options = devices
    .filter((d) => {
      const key = d.device_id || d.installation_id;
      if (seen.has(key)) return false;
      const matches = [
        d.name,
        key,
        d.installation_id,
        d.channel,
        d.runtime_version,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase());
      if (matches) seen.add(key);
      return matches;
    })
    .slice(0, 50);
  async function save() {
    if (!audience) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const saved = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience_mode: mode,
          audience_device_ids: selectedDevices,
          audience_installation_ids: selectedInstallations,
          audience_version: audience.audience_version,
        }),
      }).then(json);
      setAudience(saved);
      setSuccess(
        t(
          "Аудитория сохранена. Для черновика отдельно включите распространение.",
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Аудитория обновления")}</CardTitle>
        <CardDescription>
          {t(
            "Сначала ограничьте аудиторию черновика, затем активируйте OTA. После smoke-теста выберите «Все» и сохраните. Runtime, канал и платформа по-прежнему должны совпадать.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {t(error)}
          </p>
        )}
        {success && (
          <p role="status" className="text-sm text-muted-foreground">
            {success}
          </p>
        )}
        {audience && (
          <>
            <label className="block space-y-2 text-sm">
              <span>{t("Кому доступен OTA")}</span>
              <NativeSelect
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value);
                  setSuccess("");
                }}
                disabled={busy}
              >
                <option value="all">{t("Все совместимые устройства")}</option>
                <option value="devices">
                  {t("Только выбранные устройства / установки")}
                </option>
              </NativeSelect>
            </label>
            {mode === "devices" && (
              <div className="space-y-4">
                <Input
                  aria-label={t("Поиск адресата")}
                  placeholder={t("Имя, ID, runtime или канал")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t("Последние 500 установок ")}
                  {platform}
                  {t(
                    ", до 50 совпадений. Device ID сохраняет адресата при переустановке; Installation ID относится к одной установке.",
                  )}
                </p>
                <div className="max-h-64 overflow-y-auto rounded-md border divide-y">
                  {options.map((d) => {
                    const id = d.device_id || d.installation_id;
                    const selected = d.device_id
                      ? selectedDevices
                      : selectedInstallations;
                    const set = d.device_id ? setDeviceIds : setInstallationIds;
                    const kind = d.device_id ? t("Устройство") : t("Установка");
                    return (
                      <label
                        key={id}
                        className="flex cursor-pointer items-start gap-3 p-3 text-sm"
                      >
                        <Checkbox
                          aria-label={d.name || `${kind} ${id}`}
                          className="mt-1"
                          disabled={busy}
                          checked={selected.includes(id)}
                          onCheckedChange={(checked) =>
                            set(
                              (checked === true
                                ? [...selected, id]
                                : selected.filter((x) => x !== id)
                              ).join("\n"),
                            )
                          }
                        />
                        <span className="min-w-0">
                          <span className="font-medium">
                            {d.name || `${kind} ${id.slice(0, 12)}…`}
                          </span>
                          <span className="block text-xs text-muted-foreground break-all">
                            {d.runtime_version} · {d.channel} ·{" "}
                            {d.installation_id}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                  {options.length === 0 && (
                    <p className="p-4 text-sm text-muted-foreground">
                      {t(
                        "Устройства не найдены. Запустите приложение с обновлённым OTA-клиентом или укажите ID ниже.",
                      )}
                    </p>
                  )}
                </div>
                <details>
                  <summary className="cursor-pointer text-sm">
                    {t("Выбранные ID и ручное добавление ·")}{" "}
                    {selectedDevices.length + selectedInstallations.length}
                  </summary>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="space-y-2 text-sm">
                      <span>{t("Device ID (по одному в строке)")}</span>
                      <Textarea
                        aria-label="Device IDs"
                        value={deviceIds}
                        disabled={busy}
                        onChange={(e) => setDeviceIds(e.target.value)}
                      />
                    </label>
                    <label className="space-y-2 text-sm">
                      <span>{t("Installation ID (по одному в строке)")}</span>
                      <Textarea
                        aria-label="Installation IDs"
                        value={installationIds}
                        disabled={busy}
                        onChange={(e) => setInstallationIds(e.target.value)}
                      />
                    </label>
                  </div>
                </details>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t(
                "Ограничение влияет на следующие проверки OTA. Уже скачанное обновление нельзя отозвать изменением аудитории. Force update действует только для её участников.",
              )}
            </p>
            <Button
              className="mr-2"
              onClick={save}
              disabled={
                busy ||
                (mode === "devices" &&
                  !selectedDevices.length &&
                  !selectedInstallations.length)
              }
            >
              {t("Сохранить аудиторию")}
            </Button>
          </>
        )}
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setSuccess("");
            setRevision((n) => n + 1);
          }}
        >
          {t("Перечитать")}
        </Button>
      </CardContent>
    </Card>
  );
}
