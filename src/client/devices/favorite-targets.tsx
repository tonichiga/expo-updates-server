"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Bookmark, BookmarkPlus, Check, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { useFormatters } from "@/src/client/i18n/use-formatters";
import { useI18n } from "@/src/client/i18n/provider";

type Kind = "device" | "installation";
type Favorite = {
  target_kind: Kind;
  target_id: string;
  name: string;
  last_seen_at: string | null;
};
const endpoint = "/api/admin/device-favorites";

async function changeFavorite(method: "PUT" | "DELETE", payload: object) {
  const response = await fetch(endpoint, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const data = await response.json();
    throw new Error(data.error || "Favorites unavailable");
  }
}

export function useFavoriteTargets(
  platform: string,
  enabled: boolean,
  revision: number,
) {
  const [favorites, setFavorites] = useState<Favorite[] | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    setError("");
    setFavorites(null);
    async function load() {
      try {
        const response = await fetch(
          endpoint + "?platform=" + encodeURIComponent(platform),
          { signal: abort.signal },
        );
        if (!response.ok) throw new Error("Favorites unavailable");
        const { favorites } = await response.json();
        if (!abort.signal.aborted) setFavorites(favorites);
      } catch {
        if (!abort.signal.aborted) setError("Favorites unavailable");
      }
    }
    void load();
    return () => abort.abort();
  }, [platform, enabled, version, revision]);
  return { favorites, error, refresh: () => setVersion((v) => v + 1) };
}

export function FavoriteList({
  favorites,
  error,
  platform,
  canWrite,
  busy,
  selectedDevices,
  selectedInstallations,
  onAdd,
  onChanged,
}: {
  favorites: Favorite[] | null;
  error: string;
  platform: string;
  canWrite: boolean;
  busy: boolean;
  selectedDevices: string[];
  selectedInstallations: string[];
  onAdd: (kind: Kind, id: string) => void;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const { fullDate } = useFormatters();
  const title = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [removing, setRemoving] = useState(false);
  const [failure, setFailure] = useState("");
  async function remove(favorite: Favorite) {
    setFailure("");
    setRemoving(true);
    try {
      await changeFavorite("DELETE", {
        platform,
        target_kind: favorite.target_kind,
        target_id: favorite.target_id,
      });
      heading.current?.focus();
      onChanged();
    } catch (e) {
      setFailure(
        e instanceof TypeError
          ? "Could not remove favorite"
          : (e as Error).message,
      );
    } finally {
      setRemoving(false);
    }
  }
  return (
    <section
      aria-labelledby={title}
      className="space-y-2 rounded-lg border p-3"
    >
      <h3
        id={title}
        ref={heading}
        tabIndex={-1}
        className="flex items-center gap-2 text-sm font-medium"
      >
        <Bookmark aria-hidden="true" className="size-4 text-primary" />
        {t("My favorites")}
      </h3>
      {(error || failure) && (
        <p role="alert" className="text-sm text-destructive">
          {t(error || failure)}
        </p>
      )}
      {!error && !favorites && (
        <p role="status" className="text-sm text-muted-foreground">
          {t("Загрузка...")}
        </p>
      )}
      {favorites?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("Bookmark a recipient below to reuse it across releases.")}
        </p>
      )}
      {Boolean(favorites?.length) && (
        <ul className="max-h-64 divide-y overflow-y-auto">
          {favorites?.map((favorite) => {
            const device = favorite.target_kind === "device";
            const selected = (
              device ? selectedDevices : selectedInstallations
            ).includes(favorite.target_id);
            return (
              <li
                key={favorite.target_kind + favorite.target_id}
                className="flex items-center gap-2 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium">
                    {favorite.name}
                  </p>
                  <p className="break-all text-xs text-muted-foreground">
                    {device ? t("Устройство") : t("Установка")} ·{" "}
                    {favorite.target_id}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {favorite.last_seen_at ? (
                      <>
                        {t("Последний heartbeat")} ·{" "}
                        <time dateTime={favorite.last_seen_at}>
                          {fullDate(favorite.last_seen_at)}
                        </time>
                      </>
                    ) : (
                      t("Target is no longer in the registry")
                    )}
                  </p>
                </div>
                {canWrite && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy || !favorite.last_seen_at || selected}
                      aria-label={
                        selected
                          ? t("{0} is selected", [favorite.name])
                          : t("Add {0} to audience", [favorite.name])
                      }
                      onClick={() =>
                        onAdd(favorite.target_kind, favorite.target_id)
                      }
                    >
                      {selected ? (
                        <Check aria-hidden="true" />
                      ) : (
                        <Plus aria-hidden="true" />
                      )}
                      {selected ? t("Selected") : t("Add")}
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={removing}
                      aria-label={t("Remove {0} from favorites", [
                        favorite.name,
                      ])}
                      onClick={() => remove(favorite)}
                    >
                      <X aria-hidden="true" />
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function BookmarkTarget({
  platform,
  deviceId,
  installationId,
  displayName,
  showLabel = false,
  favorites,
  onChanged,
}: {
  platform: string;
  deviceId: string | null;
  installationId: string;
  displayName: string | null;
  showLabel?: boolean;
  favorites: Favorite[];
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const nameId = useId();
  const kindId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>(deviceId ? "device" : "installation");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const targetId = kind === "device" && deviceId ? deviceId : installationId;
  function chooseKind(nextKind: Kind) {
    setKind(nextKind);
    const id = nextKind === "device" ? deviceId : installationId;
    const existing = favorites.find(
      (f) => f.target_kind === nextKind && f.target_id === id,
    );
    setName(existing?.name || displayName || "");
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true);
    setError("");
    try {
      await changeFavorite("PUT", {
        platform,
        target_kind: kind,
        target_id: targetId,
        name: name.trim(),
      });
      setOpen(false);
      onChanged();
    } catch (e) {
      setError(
        e instanceof TypeError
          ? "Could not save favorite"
          : (e as Error).message,
      );
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        if (next) {
          chooseKind(deviceId ? "device" : "installation");
          setError("");
        }
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant={showLabel ? "outline" : "ghost"}
          size={showLabel ? "sm" : "icon"}
          aria-label={t("Bookmark {0}", [displayName || installationId])}
          title={t("Save favorite")}
        >
          <BookmarkPlus aria-hidden="true" />
          {showLabel && t("Save favorite")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Save favorite")}</DialogTitle>
          <DialogDescription>
            {t("Only your account sees this name.")}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          {deviceId && (
            <div className="space-y-2">
              <Label htmlFor={kindId}>{t("Bookmark target")}</Label>
              <NativeSelect
                id={kindId}
                value={kind}
                disabled={saving}
                onChange={(e) =>
                  chooseKind(
                    e.target.value === "device" ? "device" : "installation",
                  )
                }
              >
                <NativeSelectOption value="device">
                  {t("Устройство")}
                </NativeSelectOption>
                <NativeSelectOption value="installation">
                  {t("Установка")}
                </NativeSelectOption>
              </NativeSelect>
            </div>
          )}
          <p className="break-all text-xs text-muted-foreground">
            {kind === "device" ? t("Устройство") : t("Установка")} · {targetId}
          </p>
          <div className="space-y-2">
            <Label htmlFor={nameId}>{t("Favorite name")}</Label>
            <Input
              id={nameId}
              value={name}
              required
              maxLength={80}
              disabled={saving}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {t(error)}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={saving}>
                {t("Отменить")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={saving || !name.trim()}>
              {t("Save favorite")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
