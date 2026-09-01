# Аварийное восстановление OTA

## Глобальная аварийная остановка

Если необходимо немедленно прекратить **любую** OTA-раздачу, используйте
глобальный переключатель `ACTIVE/BLOCKED` на `/updates`. Он имеет приоритет над
всеми emergency redirects: manifest вернёт `noUpdateAvailable`, а уже выданные
ссылки `/api/assets` перестанут отдавать bytes и ответят `503 no-store`.

Укажите причину/номер инцидента, подтвердите включение и проверьте manifest и
asset URL. После исправления проверьте pointers каналов, подтвердите выключение
блокировки и повторите проверки для iOS и Android.

RPC переключателя и DB-триггеры mutations используют одну transaction advisory
lock. Поэтому конкурентная activation/channel mutation либо завершится до
включения `BLOCKED`, либо дождётся его и будет отклонена PostgreSQL с SQLSTATE
`P0OTA` и сообщением `OTA_DISTRIBUTION_BLOCKED`. Deactivation, inactive draft
insert и безопасные metadata edits остаются доступны. Не отключайте guard
triggers во время инцидента.

Новые manifest используют gated server-proxy URL `/api/assets`. Уже выданные
старыми версиями сервера immutable storage/CDN URL отозвать этим switch
невозможно; это ограничение legacy URL должно учитываться в incident response.

Emergency redirect используется, когда опубликованный binary build запрашивает
неправильный нативный Expo channel. JavaScript OTA не может изменить channel,
записанный в Android Manifest или iOS Expo.plist, поэтому сервер точечно
перенаправляет affected build.

Правило применяется только при точном совпадении:

- `expo-embedded-update-id`;
- runtime version;
- platform;
- исходного channel.

Нельзя перенаправлять весь runtime: development и production builds могут
использовать одинаковую runtime version.

## Подготовка БД

```bash
psql "$DATABASE_URL" -f docs/migrations/schema.sql
```

Если раньше правила хранились в
`config/ota-emergency-channel-redirects.json`, импортируйте их до deploy:

```bash
npm run emergency:import
```

После успешного импорта JSON больше не используется сервером.

## Управление

Откройте:

```text
/updates/emergency-redirects
```

Роли `admin` и `operator` могут:

- создавать и редактировать правила;
- включать и отключать redirect;
- переключать `pinned` и `follow`;
- удалять правила.

Роль `viewer` имеет read-only доступ.

## Режимы

### Pinned

Сервер разрешает только `expectedUpdateId`. Если target channel указывает на
другой update, устройство получает `noUpdateAvailable`.

Используйте `pinned` во время первичного восстановления, чтобы affected build
получил только проверенный recovery OTA.

### Follow

Сервер использует актуальный active/latest update целевого channel. После
успешной установки recovery OTA правило можно переключить в `follow`, чтобы
старый binary продолжил получать обычные обновления.

## Пример инцидента

Android build может быть опубликован с:

```text
runtime: 1.1.20
native channel: development
expected environment: production
```

Экран приложения при этом способен показывать `production`, если читает
JavaScript-конфигурацию. Expo Updates всё равно отправит:

```text
expo-channel-name: development
```

Для affected embedded update создайте правило:

```text
platform: android
runtimeVersion: 1.1.20
fromChannel: development
toChannel: production
targetMode: pinned
expectedUpdateId: <verified-recovery-update-id>
```

После подтверждения recovery переключите правило в `follow`.

## Проверка

```bash
curl -fsS \
  'https://updates.example.com/api/manifest' \
  -H 'expo-protocol-version: 1' \
  -H 'expo-platform: android' \
  -H 'expo-runtime-version: 1.1.20' \
  -H 'expo-channel-name: development' \
  -H 'expo-embedded-update-id: <affected-embedded-update-id>'
```

Проверьте, что multipart manifest содержит ожидаемый update и asset URLs
целевого channel.
