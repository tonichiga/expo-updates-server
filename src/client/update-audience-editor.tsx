"use client";
import type { TranslationMessage } from "@/src/client/i18n/messages";
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
import {
  BookmarkTarget,
  FavoriteList,
  useFavoriteTargets,
} from "@/src/client/devices/favorite-targets";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ChevronDown, Globe2, Users } from "lucide-react";
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
  canWrite,
  onSaved,
}: {
  encodedKey: string;
  platform: string;
  canWrite: boolean;
  onSaved: (mode: Audience["audience_mode"]) => void;
}) {
  const { t } = useI18n();
  const [audience, setAudience] = useState<Audience | null>(null);
  const [devices, setDevices] = useState<Target[]>([]);
  const [mode, setMode] = useState<Audience["audience_mode"]>("all");
  const [targetsError, setTargetsError] = useState("");
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [deviceIds, setDeviceIds] = useState("");
  const [installationIds, setInstallationIds] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<TranslationMessage>("");
  const [revision, setRevision] = useState(0);
  const url = `/api/admin/updates/${encodedKey}/audience`;
  useEffect(() => {
    const abort = new AbortController();
    setAudience(null);
    setError("");
    fetch(url, { signal: abort.signal })
      .then(json)
      .then((a: Audience) => {
        if (abort.signal.aborted) return;
        setAudience(a);
        setMode(a.audience_mode);
        setDeviceIds(a.audience_device_ids.join("\n"));
        setInstallationIds(a.audience_installation_ids.join("\n"));
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [url, revision]);
  useEffect(() => {
    if (mode !== "devices") return;
    const abort = new AbortController();
    setLoadingTargets(true);
    setTargetsError("");
    fetch(`/api/admin/device-targets?platform=${platform}`, {
      signal: abort.signal,
    })
      .then(json)
      .then((data) => {
        if (!abort.signal.aborted) setDevices(data.devices);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setTargetsError(e.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoadingTargets(false);
      });
    return () => abort.abort();
  }, [mode, platform, revision]);
  const selectedDevices = splitIds(deviceIds);
  const selectedInstallations = splitIds(installationIds);
  const dirty =
    audience !== null &&
    (mode !== audience.audience_mode ||
      selectedDevices.join(",") !== audience.audience_device_ids.join(",") ||
      selectedInstallations.join(",") !==
        audience.audience_installation_ids.join(","));
  const favorites = useFavoriteTargets(
    platform,
    mode === "devices" && audience !== null,
    revision,
  );
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
    if (!audience || !canWrite) return;
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
      onSaved(saved.audience_mode);
      setSuccess(
        "Аудитория сохранена. Для черновика отдельно включите распространение.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="shadow-none">
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
        {success && !dirty && (
          <p role="status" className="text-sm text-muted-foreground">
            {t(success)}
          </p>
        )}
        {!audience && !error && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("Загрузка...")}
          </p>
        )}
        {audience && (
          <>
            <fieldset disabled={busy || !canWrite} className="space-y-2">
              <legend className="text-sm font-medium">
                {t("Кому доступен OTA")}
              </legend>
              <RadioGroup
                value={mode}
                disabled={busy || !canWrite}
                aria-label={t("Кому доступен OTA")}
                className="grid gap-2 sm:grid-cols-2"
                onValueChange={(value) => {
                  if (value === "all" || value === "devices") {
                    setMode(value);
                    setSuccess("");
                  }
                }}
              >
                {(["all", "devices"] as const).map((choice) => {
                  const Icon = choice === "all" ? Globe2 : Users;
                  return (
                    <label
                      key={choice}
                      className="flex items-center gap-3 rounded-lg border p-3 text-sm has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5 has-focus-visible:ring-2 has-focus-visible:ring-ring"
                    >
                      <Icon
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="flex-1">
                        {choice === "all"
                          ? t("Все совместимые устройства")
                          : t("Только выбранные устройства / установки")}
                      </span>
                      <RadioGroupItem value={choice} />
                    </label>
                  );
                })}
              </RadioGroup>
            </fieldset>
            {mode === "devices" && (
              <div className="space-y-4">
                <FavoriteList
                  favorites={favorites.favorites}
                  error={favorites.error}
                  platform={platform}
                  canWrite={canWrite}
                  busy={busy}
                  selectedDevices={selectedDevices}
                  selectedInstallations={selectedInstallations}
                  onChanged={favorites.refresh}
                  onAdd={(kind, id) => {
                    const set =
                      kind === "device" ? setDeviceIds : setInstallationIds;
                    set((current) =>
                      [...new Set([...splitIds(current), id])].join("\n"),
                    );
                  }}
                />
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
                {targetsError && (
                  <p role="alert" className="text-sm text-destructive">
                    {t(targetsError)}
                  </p>
                )}
                <div
                  aria-busy={loadingTargets}
                  className="max-h-64 overflow-y-auto rounded-md border divide-y"
                >
                  {options.map((d) => {
                    const id = d.device_id || d.installation_id;
                    const selected = d.device_id
                      ? selectedDevices
                      : selectedInstallations;
                    const set = d.device_id ? setDeviceIds : setInstallationIds;
                    const kind = d.device_id ? t("Устройство") : t("Установка");
                    return (
                      <div
                        key={d.installation_id}
                        className="flex items-start gap-2 p-3"
                      >
                        <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 text-sm">
                          <Checkbox
                            aria-label={d.name || `${kind} ${id}`}
                            className="mt-1"
                            disabled={busy || !canWrite}
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
                        {canWrite && (
                          <BookmarkTarget
                            platform={platform}
                            deviceId={d.device_id}
                            installationId={d.installation_id}
                            displayName={d.name}
                            favorites={favorites.favorites ?? []}
                            onChanged={favorites.refresh}
                          />
                        )}
                      </div>
                    );
                  })}
                  {loadingTargets && (
                    <p className="p-3 text-sm text-muted-foreground">
                      {t("Загрузка...")}
                    </p>
                  )}
                  {!loadingTargets && !targetsError && options.length === 0 && (
                    <p className="p-4 text-sm text-muted-foreground">
                      {t(
                        "Устройства не найдены. Запустите приложение с обновлённым OTA-клиентом или укажите ID ниже.",
                      )}
                    </p>
                  )}
                </div>
                <Collapsible>
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="group"
                    >
                      {t("Выбранные ID и ручное добавление ·")}{" "}
                      {selectedDevices.length + selectedInstallations.length}
                      <ChevronDown className="size-4 group-data-[state=open]:rotate-180" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="space-y-2 text-sm">
                      <span>{t("Device ID (по одному в строке)")}</span>
                      <Textarea
                        aria-label={t("Device IDs")}
                        value={deviceIds}
                        disabled={busy || !canWrite}
                        onChange={(e) => setDeviceIds(e.target.value)}
                      />
                    </label>
                    <label className="space-y-2 text-sm">
                      <span>{t("Installation ID (по одному в строке)")}</span>
                      <Textarea
                        aria-label={t("Installation IDs")}
                        value={installationIds}
                        disabled={busy || !canWrite}
                        onChange={(e) => setInstallationIds(e.target.value)}
                      />
                    </label>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {t(
                "Ограничение влияет на следующие проверки OTA. Уже скачанное обновление нельзя отозвать изменением аудитории. Force update действует только для её участников.",
              )}
            </p>
            {canWrite && (
              <Button
                className="mr-2"
                onClick={save}
                disabled={
                  busy ||
                  !dirty ||
                  (mode === "devices" &&
                    !selectedDevices.length &&
                    !selectedInstallations.length)
                }
              >
                {t("Сохранить аудиторию")}
              </Button>
            )}
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
