"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Globe2,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  deviceIdPattern,
  installationIdPattern,
  maxIdsPerKind,
} from "@/lib/audience-ids";
import {
  BookmarkTarget,
  FavoriteList,
  useFavoriteTargets,
} from "@/src/client/devices/favorite-targets";
import { useI18n } from "@/src/client/i18n/provider";
import type { Audience } from "@/src/server/devices/audience";

type Target = {
  installation_id: string;
  device_id: string | null;
  name: string | null;
  runtime_version: string;
  channel: string;
};
async function json(response: Response) {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Ошибка запроса");
  return value;
}
const recipients = (a: Audience) => [
  ...a.audience_device_ids,
  ...a.audience_installation_ids,
];
const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

export default function UpdateAudienceEditor({
  encodedKey,
  platform,
  runtime,
  channel,
  active,
  canWrite,
  onSaved,
}: {
  encodedKey: string;
  platform: string;
  runtime: string;
  channel: string;
  active: boolean;
  canWrite: boolean;
  onSaved: (mode: Audience["audience_mode"]) => void;
}) {
  const { t } = useI18n();
  const field = useId();
  const manualInput = useRef<HTMLTextAreaElement>(null);
  const [audience, setAudience] = useState<Audience | null>(null);
  const [mode, setMode] = useState<Audience["audience_mode"]>("all");
  const [ids, setIds] = useState<string[]>([]);
  const [source, setSource] = useState("registry");
  const [manual, setManual] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [devices, setDevices] = useState<Target[]>([]);
  const [search, setSearch] = useState("");
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [targetsError, setTargetsError] = useState("");
  const [revision, setRevision] = useState(0);
  const [registryRevision, setRegistryRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const url = `/api/admin/updates/${encodedKey}/audience`;
  const favorites = useFavoriteTargets(
    platform,
    mode === "devices" && !!audience,
    revision,
  );

  function restore(a: Audience) {
    setMode(a.audience_mode);
    setIds(recipients(a));
    setManual("");
    setAttempted(false);
    setError("");
    setNotice("");
  }
  useEffect(() => {
    const abort = new AbortController();
    setAudience(null);
    setError("");
    fetch(url, { signal: abort.signal })
      .then(json)
      .then((a: Audience) => {
        if (!abort.signal.aborted) {
          restore(a);
          setAudience(a);
        }
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
    fetch(
      `/api/admin/device-targets?platform=${encodeURIComponent(platform)}`,
      { signal: abort.signal },
    )
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
  }, [mode, platform, registryRevision]);

  const selectedDevices = ids.filter((id) => deviceIdPattern.test(id));
  const selectedInstallations = ids.filter((id) =>
    installationIdPattern.test(id),
  );
  const dirty =
    !!audience &&
    (mode !== audience.audience_mode ||
      (mode === "devices" && !sameIds(ids, recipients(audience))));
  const pending = mode === "devices" && !!manual.trim();
  const canSave =
    canWrite &&
    !!audience &&
    dirty &&
    !saving &&
    !pending &&
    (mode === "all" || ids.length > 0);

  const tokens = manual
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((s) => s.toLowerCase());
  const invalid = tokens.find(
    (s) => !deviceIdPattern.test(s) && !installationIdPattern.test(s),
  );
  const combined = [...new Set([...ids, ...tokens])];
  const overLimit =
    combined.filter((s) => deviceIdPattern.test(s)).length > maxIdsPerKind ||
    combined.filter((s) => installationIdPattern.test(s)).length >
      maxIdsPerKind;
  const limitMessage = t(
    "Up to {0} device IDs and {0} installation IDs per audience.",
    [maxIdsPerKind],
  );
  const manualError = invalid
    ? t("Unrecognized ID “{0}”.", [invalid])
    : overLimit
      ? limitMessage
      : "";
  function select(next: string[]) {
    setIds(next);
    setError("");
    setNotice("");
  }
  function remove(id: string) {
    select(ids.filter((value) => value !== id));
  }
  function add(id: string) {
    if (ids.includes(id)) return;
    const group = deviceIdPattern.test(id)
      ? selectedDevices
      : selectedInstallations;
    if (group.length >= maxIdsPerKind) {
      setError(limitMessage);
      return;
    }
    select([...ids, id]);
  }
  function addManual() {
    setAttempted(true);
    if (manualError || !tokens.length) {
      manualInput.current?.focus();
      return;
    }
    select(combined);
    setNotice(
      combined.length === ids.length
        ? "These recipients are already selected."
        : "Recipients added to the selection.",
    );
    setManual("");
    setAttempted(false);
  }
  async function save() {
    if (!audience || !canSave) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved: Audience = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...audience,
          audience_mode: mode,
          audience_device_ids: selectedDevices,
          audience_installation_ids: selectedInstallations,
        }),
      }).then(json);
      restore(saved);
      setAudience(saved);
      onSaved(saved.audience_mode);
      setNotice("Audience saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const platformName = platform === "ios" ? "iOS" : "Android";
  const seen = new Set<string>();
  const query = search.trim().toLowerCase();
  const options = devices
    .filter((d) => {
      const id = d.device_id || d.installation_id;
      if (
        seen.has(id) ||
        ![d.name, id, d.installation_id, d.channel, d.runtime_version]
          .join(" ")
          .toLowerCase()
          .includes(query)
      )
        return false;
      seen.add(id);
      return true;
    })
    .slice(0, 50);
  const names = new Map<string, string>();
  for (const d of devices) {
    if (d.name) {
      names.set(d.installation_id, d.name);
      if (d.device_id && !names.has(d.device_id))
        names.set(d.device_id, d.name);
    }
  }
  for (const f of favorites.favorites ?? []) names.set(f.target_id, f.name);
  return (
    <Card className="min-w-0 shadow-none">
      <CardHeader>
        <CardTitle>{t("Who should receive this update?")}</CardTitle>
        <CardDescription className="break-words">
          {t("{0} · Channel {1} · Runtime {2}", [
            platformName,
            channel,
            runtime,
          ])}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!audience && !error && <p role="status">{t("Загрузка...")}</p>}
        {audience && (
          <>
            <RadioGroup
              value={mode}
              disabled={saving || !canWrite}
              aria-label={t("Кому доступен OTA")}
              className="grid gap-2 sm:grid-cols-2"
              onValueChange={(choice) => {
                if (choice === "all" || choice === "devices") {
                  setMode(choice);
                  setNotice("");
                  setError("");
                }
              }}
            >
              {(["all", "devices"] as const).map((choice) => {
                const Icon = choice === "all" ? Globe2 : Users;
                const title =
                  choice === "all"
                    ? t("Все совместимые устройства")
                    : t("Selected recipients");
                return (
                  <label
                    key={choice}
                    className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-3 text-sm has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-muted/50 has-focus-visible:ring-2 has-focus-visible:ring-ring"
                  >
                    <Icon
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="flex-1 font-medium">{title}</span>
                    <RadioGroupItem value={choice} aria-label={title} />
                  </label>
                );
              })}
            </RadioGroup>

            {mode === "devices" && (
              <div
                className={
                  canWrite
                    ? "grid min-w-0 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
                    : ""
                }
              >
                {canWrite && (
                  <section className="min-w-0 space-y-3">
                    <h3 className="text-sm font-semibold">
                      {t("Add recipients")}
                    </h3>
                    <Tabs
                      value={source}
                      onValueChange={setSource}
                      className="min-w-0 gap-3"
                    >
                      <TabsList
                        aria-label={t("Add recipients")}
                        className="max-w-full"
                      >
                        <TabsTrigger value="registry">
                          {t("Registry")}
                        </TabsTrigger>
                        <TabsTrigger value="favorites">
                          {t("Favorites")}
                        </TabsTrigger>
                        <TabsTrigger value="manual">
                          {t("Paste IDs")}
                        </TabsTrigger>
                      </TabsList>
                      <TabsContent value="registry" className="space-y-2">
                        {devices.length > 0 && (
                          <div className="relative">
                            <Search
                              aria-hidden="true"
                              className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"
                            />
                            <Input
                              aria-label={t("Поиск адресата")}
                              placeholder={t("Имя, ID, runtime или канал")}
                              value={search}
                              className="pl-9"
                              onChange={(e) => setSearch(e.target.value)}
                            />
                          </div>
                        )}
                        <div
                          aria-busy={loadingTargets}
                          className="max-h-64 divide-y overflow-y-auto rounded-md border"
                        >
                          {loadingTargets ? (
                            <p role="status" className="p-3 text-sm">
                              {t("Загрузка...")}
                            </p>
                          ) : targetsError ? (
                            <div className="p-3">
                              <p
                                role="alert"
                                className="text-sm text-destructive"
                              >
                                {t(targetsError)}
                              </p>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  setRegistryRevision((n) => n + 1)
                                }
                              >
                                {t("Retry")}
                              </Button>
                            </div>
                          ) : options.length ? (
                            options.map((d) => {
                              const id = d.device_id || d.installation_id;
                              const kind = d.device_id
                                ? t("Устройство")
                                : t("Установка");
                              return (
                                <div
                                  key={id}
                                  className="flex items-center gap-2 p-2.5"
                                >
                                  <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-sm">
                                    <Checkbox
                                      aria-label={d.name || id}
                                      disabled={saving}
                                      checked={ids.includes(id)}
                                      onCheckedChange={(checked) =>
                                        checked === true ? add(id) : remove(id)
                                      }
                                    />
                                    <span className="min-w-0">
                                      <span
                                        className="block truncate font-medium"
                                        title={id}
                                      >
                                        {d.name ||
                                          `${kind} · ${id.slice(0, 12)}…`}
                                      </span>
                                      <span className="block truncate text-xs text-muted-foreground">
                                        {d.channel} ·{" "}
                                        {t("Runtime {0}", [d.runtime_version])}
                                      </span>
                                    </span>
                                  </label>
                                  <BookmarkTarget
                                    platform={platform}
                                    deviceId={d.device_id}
                                    installationId={d.installation_id}
                                    displayName={d.name}
                                    favorites={favorites.favorites ?? []}
                                    onChanged={favorites.refresh}
                                  />
                                </div>
                              );
                            })
                          ) : (
                            <div className="space-y-2 p-3 text-sm">
                              <p>
                                {query
                                  ? t("No recipients match your search.")
                                  : t(
                                      "No installations registered for {0} yet.",
                                      [platformName],
                                    )}
                              </p>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSource("manual")}
                              >
                                {t("Paste IDs")}
                              </Button>
                            </div>
                          )}
                        </div>
                        {options.length > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {t(
                              "Showing up to 50 matches from the latest 500 installations.",
                            )}
                          </p>
                        )}
                      </TabsContent>
                      <TabsContent value="favorites">
                        <FavoriteList
                          favorites={favorites.favorites}
                          error={favorites.error}
                          platform={platform}
                          canWrite={canWrite}
                          busy={saving}
                          selectedDevices={selectedDevices}
                          selectedInstallations={selectedInstallations}
                          onChanged={favorites.refresh}
                          onAdd={(_, id) => add(id)}
                        />
                      </TabsContent>
                      <TabsContent value="manual" className="space-y-2">
                        <label htmlFor={field} className="text-sm font-medium">
                          {t("Device or installation IDs")}
                        </label>
                        <Textarea
                          id={field}
                          ref={manualInput}
                          className="min-h-20 font-mono text-sm"
                          value={manual}
                          disabled={saving}
                          aria-invalid={attempted && !!manualError}
                          aria-describedby={
                            field +
                            "-help" +
                            (attempted && manualError
                              ? " " + field + "-error"
                              : "")
                          }
                          onChange={(e) => {
                            setManual(e.target.value);
                            setAttempted(false);
                            setNotice("");
                          }}
                        />
                        <p
                          id={field + "-help"}
                          className="text-xs text-muted-foreground"
                        >
                          {t(
                            "Device ID (64 hex characters) keeps targeting the device after reinstall. Installation ID (UUID) targets one installation. Separate IDs with a comma, space or new line.",
                          )}
                        </p>
                        {attempted && manualError && (
                          <p
                            role="alert"
                            id={field + "-error"}
                            className="break-all text-sm text-destructive"
                          >
                            {manualError}
                          </p>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={saving || !tokens.length}
                          onClick={addManual}
                        >
                          <Plus />
                          {t("Add to selection")}
                        </Button>
                      </TabsContent>
                    </Tabs>
                  </section>
                )}
                <section
                  aria-label={t("Selected recipients")}
                  className="min-w-0 self-start rounded-md border bg-muted/25"
                >
                  <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                    <h3 className="text-sm font-semibold">
                      {t("Selected recipients")}
                    </h3>
                    <Badge variant={ids.length ? "info" : "neutral"}>
                      {ids.length}
                    </Badge>
                  </div>
                  {ids.length ? (
                    <ul className="max-h-64 divide-y overflow-y-auto border-t">
                      {ids.map((id) => {
                        const kind = deviceIdPattern.test(id)
                          ? t("Устройство")
                          : t("Установка");
                        return (
                          <li
                            key={id}
                            className="flex items-center gap-2 px-3 py-2"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="break-words text-sm font-medium">
                                {names.get(id)
                                  ? `${names.get(id)} · ${kind}`
                                  : kind}
                              </p>
                              <p className="break-all font-mono text-xs text-muted-foreground">
                                {id}
                              </p>
                            </div>
                            {canWrite && (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={t("Remove {0} from selection", [
                                  id,
                                ])}
                                disabled={saving}
                                onClick={() => remove(id)}
                              >
                                <X />
                              </Button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="border-t p-3 text-sm text-muted-foreground">
                      {t("Add at least one recipient to save this audience.")}
                    </p>
                  )}
                </section>
              </div>
            )}

            {active &&
              mode === "all" &&
              audience.audience_mode === "devices" && (
                <p
                  role="status"
                  className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
                >
                  <AlertTriangle
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0"
                  />
                  {t(
                    "Saving makes this the public release for this platform, channel and runtime, replacing any current public release.",
                  )}
                </p>
              )}
            {canWrite && (
              <div className="border-t pt-4 text-sm text-muted-foreground">
                {active
                  ? t(
                      "Changes apply at the next update check. Previously downloaded updates stay on the device.",
                    )
                  : t(
                      "Saving sets the audience. Activate the release when you are ready to distribute it.",
                    )}
              </div>
            )}
          </>
        )}
        {error && (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-destructive">
              {t(error)}
            </p>
            {(!audience ||
              error ===
                "Audience changed or distribution blocked. Refresh and try again.") && (
              <Button
                variant="outline"
                size="sm"
                disabled={saving}
                onClick={() => setRevision((n) => n + 1)}
              >
                {t("Перечитать")}
              </Button>
            )}
          </div>
        )}
        {audience && canWrite && (
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!canSave} onClick={save}>
              {saving ? t("Сохранение…") : t("Сохранить аудиторию")}
            </Button>
            {(dirty || pending) && (
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => restore(audience)}
              >
                {t("Discard changes")}
              </Button>
            )}
            {pending && (
              <button
                className="text-left text-xs text-muted-foreground underline"
                onClick={() => {
                  setSource("manual");
                  requestAnimationFrame(() => manualInput.current?.focus());
                }}
              >
                {t("Add the entered IDs or clear the field before saving.")}
              </button>
            )}
          </div>
        )}
        {notice && (
          <p role="status" className="flex items-center gap-2 text-sm">
            <Check className="size-4 text-emerald-600" />
            {t(notice)}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
