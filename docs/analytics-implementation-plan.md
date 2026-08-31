# Analytics Implementation Plan

## 1. Миграция БД

Применить: `docs/migrations/schema.sql`

---

## 2. Мобильное приложение

Генерировать стабильный UUID при первом запуске и хранить в `SecureStore`.
Прокидывать его в каждый запрос к OTA-серверу через кастомный заголовок.

```ts
// hooks/useInstallationId.ts
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";

const KEY = "ota_installation_id";

export async function getInstallationId(): Promise<string> {
  let id = await SecureStore.getItemAsync(KEY);
  if (!id) {
    id = Crypto.randomUUID();
    await SecureStore.setItemAsync(KEY, id);
  }
  return id;
}
```

Передавать в expo-updates через `requestHeaders` в `app.config.ts`:

```ts
// В app.config.ts / app.json нельзя использовать динамические значения.
// Используй expo-updates hooks: UpdatesProvider или setExtraParamsAsync.
import * as Updates from "expo-updates";

await Updates.setExtraParamsAsync({
  "x-installation-id": await getInstallationId(),
});
```

> `setExtraParamsAsync` добавляет параметры в URL manifest-запроса как query-параметры.
> Сервер будет читать их из `req.nextUrl.searchParams.get('x-installation-id')`.

---

## 3. Сервер: `upsertChannelRow` в `admin-updates.ts`

После апсерта в `ota_update_channels`, если `served_manifest_id` изменился — писать в `ota_served_manifest_log`.

```ts
// В функции upsertChannelRow, после получения результата:

const prevRow = await getChannelRow(scope); // до апсерта (вызывать до upsert)
const result = await supabase.from('ota_update_channels').upsert(...).select('*').single();

if (result.data.served_manifest_id !== prevRow?.served_manifest_id) {
  const updateId = payload.active_update_id || payload.latest_update_id;
  if (updateId) {
    await supabase.from('ota_served_manifest_log').upsert({
      served_manifest_id: result.data.served_manifest_id,
      update_id: updateId,
      runtime_version: scope.runtimeVersion,
      channel: scope.channel,
      platform: scope.platform,
      reason: payload._reason ?? null, // передавать reason явно из вызывающего кода
    }, { onConflict: 'served_manifest_id' });
  }
}
```

Добавить поле `_reason` (не сохраняется в БД) в `payload` или передавать отдельным аргументом.
Примеры reason: `'deploy'`, `'rollback'`, `'promote'`, `'deactivate'`.

---

## 4. Сервер: `manifest.ts`

Читать `x-installation-id` из query params и upsert device state.
Делать после принятия решения об апдейте, **не блокируя ответ** (fire-and-forget).

```ts
const installationId =
  req.nextUrl.searchParams.get("x-installation-id") ?? null;

// После определения currentUpdateId и selectedUpdateId — fire & forget:
if (installationId) {
  trackDeviceState({
    installationId,
    platform,
    runtimeVersion,
    channel,
    embeddedUpdateId: embeddedUpdateId ?? null,
    servedManifestId: normalizeId(rawCurrentUpdateId),
    // resolved real update_id через lookup в ota_served_manifest_log
  }).catch((err) => console.warn("[analytics] trackDeviceState failed:", err));
}
```

Функция `trackDeviceState`:

1. Lookup `served_manifest_id` → `update_id` через `ota_served_manifest_log`
2. Получить предыдущий `ota_device_state` для этого `installation_id`
3. Upsert `ota_device_state` с актуальными данными
4. Если `runtime_version` или `update_id` изменился — INSERT в `ota_device_transitions`

---

## 5. Примерные аналитические запросы

```sql
-- Когорты: сколько устройств на каком update_id
SELECT
  ds.runtime_version,
  sml.update_id,
  count(*) AS device_count
FROM ota_device_state ds
LEFT JOIN ota_served_manifest_log sml
  ON ds.served_manifest_id = sml.served_manifest_id
GROUP BY ds.runtime_version, sml.update_id
ORDER BY ds.runtime_version, sml.update_id;

-- История переходов конкретного устройства
SELECT *
FROM ota_device_transitions
WHERE installation_id = '<uuid>'
ORDER BY occurred_at;

-- Устройства зависшие на старом runtime
SELECT installation_id, runtime_version, last_seen_at
FROM ota_device_state
WHERE runtime_version != '1.1.3'
ORDER BY last_seen_at DESC;
```
