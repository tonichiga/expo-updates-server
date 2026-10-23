"use client";
import { useI18n } from "@/src/client/i18n/provider";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
export function DeviceName({
  deviceId,
  platform,
}: {
  deviceId: string;
  platform: string;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    fetch(
      `/api/admin/device-targets?platform=${platform}&deviceId=${deviceId}`,
      {
        signal: abort.signal,
      },
    )
      .then(async (r) => {
        if (!r.ok) throw new Error("Не удалось загрузить имя");
        const data = await r.json();
        if (abort.signal.aborted) return;
        setName(data.name || "");
        setLoaded(true);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setStatus(e.message);
      });
    return () => abort.abort();
  }, [deviceId, platform]);
  async function save() {
    setBusy(true);
    setStatus("");
    try {
      const r = await fetch("/api/admin/device-targets", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, name: name.trim() }),
      });
      if (!r.ok)
        throw new Error((await r.json()).error || "Не удалось сохранить");
      setStatus(t("Имя сохранено — устройство можно выбрать в аудитории OTA."));
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2 px-6 pb-6">
      <label htmlFor="ota-device-name" className="text-sm font-medium">
        {t("Имя устройства")}
      </label>
      <Input
        id="ota-device-name"
        maxLength={80}
        placeholder={t("Мой телефон")}
        value={name}
        disabled={!loaded || busy}
        onChange={(e) => setName(e.target.value)}
      />
      <Button
        variant="outline"
        onClick={save}
        disabled={!loaded || busy || !name.trim()}
      >
        {t("Сохранить имя")}
      </Button>
      <p className="text-xs text-muted-foreground" role="status">
        {t(status)}
      </p>
    </div>
  );
}
