# Настройка приложения Expo {#expo-application-setup}

Это руководство подключает приложение Expo к собственному OTA-серверу для получения и публикации обновлений.

## Автоматическая настройка {#automatic-configuration}

Приложения со статическим `app.json` можно настроить из репозитория OTA-сервера. Сначала установите зависимости сервера на хосте, даже если сам сервер работает в Docker:

```bash
npm ci
npm run configure-app
```

Интерактивный CLI спрашивает каждое обязательное значение и подтверждает итоговый план до изменения приложения.

Для неинтерактивного использования в CI:

```bash
npm run configure-app -- \
  --app /full/path/to/expo-app \
  --certificate /full/path/code-signing-certificate.pem \
  --server-url https://updates.example.com \
  --channel production \
  --runtime-version 1.0.0
```

Команда изменяет `app.json` и `package.json`, копирует публичный сертификат, устанавливает `expo-updates` и зависимости идентификации/телеметрии, добавляет переносимый публикатор и запускает `expo prebuild`. Поддерживаются lock-файлы npm, pnpm, Yarn и Bun.

Она также создаёт `ota-client/` и запускает идентификацию и телеметрию установок из `ota-entry.js`, сохраняя исходную точку входа. Для Expo Router конфигуратор размещает `<OtaUpdates />` рядом с навигацией в `src/app/_layout` (или `app/_layout`). Сгенерированный компонент TypeScript сам вызывает хук; он не оборачивает приложение и не требует контекста. Поддерживаются и стандартные корневые компоненты `App`, включая платформенные варианты. Ручное подключение ID установки, ID устройства или сигналов активности не нужно. Компонент начинает с автоматических проверок и ручных запросов скачивания/перезапуска; пользовательские настройки сохраняются при повторной конфигурации. Режимы обновления и API хука описаны в [жизненном цикле OTA-клиента](./ota-client-lifecycle.md). Если генерация недоступна, используйте [ручное подключение хука](./ota-client-lifecycle.md#manual-integration).

Изменение исходников использует позиции синтаксического дерева и сохраняет импорты, комментарии, директивы, код компонента и вложенные обработчики. Неподдерживаемые корневые экспорты (класс, асинхронная функция, HOC или реэкспорт) останавливают настройку до записи в приложение. Для автоматического изменения экспортируйте синхронную корневую функцию или идентификатор локальной функции. Пользовательская точка входа с неопределимым корнем сохраняет поведение запуска и получает предупреждение о необходимости подключить управление обновлениями вручную; идентификация и телеметрия остаются подключены через сгенерированную начальную загрузку. Существующий импорт `useOtaUpdates` должен использовать относительный путь к `ota-client`. Неразрешённые псевдонимы вроде `@/ota-client` останавливают изменение до записи, чтобы второй хук незаметно не переопределил существующую автоматизацию.

Параметры:

```text
--platform all|ios|android
--force
--server-env /full/path/to/server.env
```

CLI намеренно отклоняет проекты с динамическим `app.config.*` и не заменяет сгенерированные файлы без `--force`. Разделы ниже описывают нативную конфигурацию; [ручное подключение хука](./ota-client-lifecycle.md#manual-integration) — клиентские файлы, зависимости, корень и элементы управления. `--force` разрешает замену сгенерированных файлов, но не обходит неподдерживаемые динамические конфигурации или формы корня. `--server-env` выбирает локальное окружение сервера для подготовки настроек публикатора. Для изолированного стенда явно укажите его `.env.ota-test`.

## Проверка генерации на новом приложении {#verify-generation-in-a-fresh-application}

Используйте отдельное приложение для первой генерации, а существующее сохраните для проверки обновлений и повторных запусков. Не используйте runtime другого приложения только ради появления тестового OTA: у нового приложения собственная граница нативной совместимости.

Создайте соседнее приложение Expo Router с шаблоном SDK 58, используемым для интеграционных проверок клиента:

```bash
npx create-expo-app@latest ota-smoke-app --template default@sdk-58
```

Явный шаблон закрепляет семейство SDK; см. официальный [справочник create-expo-app](https://docs.expo.dev/more/create-expo/). Для другого SDK используйте совместимые пакеты и повторите проверки релиза на устройстве ниже.

Подготовьте доступный HTTPS OTA-сервер и соответствующий публичный сертификат подписи. Затем из **репозитория сервера** выполните команду, исправив пути к приложению и сертификату:

```bash
npm run configure-app -- \
  --app /full/path/to/ota-smoke-app \
  --certificate /full/path/code-signing-certificate.pem \
  --server-url https://updates.example.com \
  --channel hook-smoke \
  --runtime-version hook-smoke-sdk58-v1 \
  --platform android
```

Для изолированного локального стенда добавьте `--server-env .env.ota-test` и используйте публичный URL туннеля в `--server-url`. Задайте тот же публичный базовый URL серверу, чтобы телефон мог скачивать ресурсы. Для установки рядом с другим тестовым приложением используйте отдельный Android package/iOS bundle identifier.

До сборки проверьте изменения:

| Файл/изменение | Ожидаемый результат |
| --- | --- |
| `app.json` | Верные HTTPS URL, сертификат, runtime и канал; нативные автоматические проверки отключены |
| `package.json` | Клиентские зависимости, `main: "ota-entry.js"`, скрипты публикации и сборки выбранных платформ |
| `ota-client-entry.json` | Исходная точка входа сохранена |
| `ota-client/` | Публичный API, вложенные файлы модели/интерфейса и публичный `config.json` |
| Корневой `_layout` / `App` | Один безусловный хук и блокирующий экран; существующая навигация и провайдеры сохранены |
| `.env.ota` | Локальные учётные данные публикации/сборки; исключены из Git и никогда не импортируются приложением |

До сборки добавьте [пример ручных элементов управления](./ota-client-lifecycle.md#_3-add-manual-update-controls) на тестовый экран либо явно включите автоматизацию скачивания/перезапуска настройками хука. По умолчанию корень только проверяет; в стандартном шаблоне Expo нет тестовых кнопок OTA. Эти элементы или настройки должны попасть в устанавливаемую сборку, чтобы она получила первое OTA.

Из **каталога приложения** выполните:

```bash
npx expo lint
npx tsc --noEmit
npm run ota:build:android:apk
```

Команде Android нужны рабочие локальные инструменты Java/Android. До запуска настройте регистрацию встроенных обновлений в `.env.ota`: локальный Docker может использовать сгенерированный `OTA_DATABASE_URL`; регистрация HTTP требует `OTA_SERVER_URL` и `OTA_ACCESS_TOKEN` с `updates:write`. Сгенерированный скрипт считает ошибку регистрации ошибкой сборки. См. [регистрацию встроенных обновлений](#_6-register-embedded-updates). Для iOS настройте `--platform ios`/`all` и соберите подписанный Release/Archive.

Установите релизный APK из `android/app/build/outputs/apk/release/app-release.apk`. После первого запуска проверьте установку в `/updates/devices`.

Сделайте заметное изменение JS и обновите `expo.version` для отдельной метки графика, сохранив совместимый runtime. Публикуйте **после нативной сборки**:

```bash
npm run ota:publish -- --platform android --message "Fresh app hook smoke test"
```

Релиз появится неактивным в `/updates`. Выберите аудиторию, активируйте его, затем проверьте, скачайте и перезапустите. Проверка или скачивание сами по себе не должны менять запущенную версию установки в аналитике; это делает следующий сигнал запуска. Убедитесь, что ID установки сохраняется после перезапуска OTA.

Наконец повторите ту же команду конфигуратора. Проверьте, что OTA-компонент не дублируется и сохранённая исходная точка входа не заменяется. Измените свойство компонента в корне и повторите запуск, чтобы проверить сохранение настройки. Используйте `--force` только для намеренной замены изменённых сгенерированных файлов; он не обходит неподдерживаемую форму корня. Для проверки ручного варианта используйте отдельную чистую копию и выполните [ручное подключение](./ota-client-lifecycle.md#manual-integration) без генератора. Разделяйте эти проверки, чтобы остатки генерации не скрывали пропущенные ручные шаги.

## 1. Установите клиентские зависимости {#_1-install-client-dependencies}

Для ручной настройки установите совместимые с Expo версии всех клиентских зависимостей:

```bash
npx expo install expo-updates expo-application expo-crypto expo-secure-store @react-native-async-storage/async-storage
```

Приложение не отправляет токен админки при проверке обновления. `/api/manifest` и `/api/assets` — публичные рабочие эндпоинты. Сессии админки и токены доступа нужны только операторам, CI и административной автоматизации.

## 2. Создайте сертификат подписи кода {#_2-create-the-code-signing-certificate}

Создайте один закрытый RSA-ключ и самоподписанный публичный сертификат:

```bash
mkdir -p certificates

openssl req \
  -x509 \
  -newkey rsa:2048 \
  -nodes \
  -sha256 \
  -days 3650 \
  -subj "/CN=expo-updates" \
  -addext "basicConstraints=critical,CA:FALSE" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=codeSigning" \
  -keyout certificates/code-signing-private-key.pem \
  -out certificates/code-signing-certificate.pem
```

У файлов разные владельцы и правила развёртывания:

| Файл | Расположение | Можно включать в Git |
|---|---|---|
| `code-signing-certificate.pem` | Приложение Expo | Да, он публичный |
| `code-signing-private-key.pem` | Только OTA-сервер | Нет |

Для Docker Compose скопируйте в репозиторий сервера только закрытый ключ:

```bash
mkdir -p secrets
cp /secure/path/code-signing-private-key.pem \
  secrets/code-signing-private-key.pem
chmod 600 secrets/code-signing-private-key.pem
```

Стек Compose монтирует `./secrets` только для чтения и читает ключ из `/run/secrets/ota/code-signing-private-key.pem`.

Для развёртывания без контейнера задайте:

```env
CODE_SIGNING_PRIVATE_KEY_PATH=/run/secrets/code-signing-private-key.pem
```

либо встроенный PEM:

```env
CODE_SIGNING_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

Никогда не меняйте закрытый ключ сервера без выпуска новой нативной сборки с соответствующим публичным сертификатом. Существующие сборки отклоняют манифесты с неизвестным ключом.

## 3. Настройте приложение Expo {#_3-configure-the-expo-application}

Автоматический путь обновляет статический `app.json`. При ручной настройке динамическая конфигурация ниже требует явного канала и runtime для каждой сборки. Текущие конфигуратор и стандартный публикатор читают статический `app.json` и не вычисляют динамическую конфигурацию. Не используйте стандартный публикатор с противоречащими друг другу статическими и вычисленными значениями.

Пример `app.config.ts`:

```ts
import type { ConfigContext, ExpoConfig } from "expo/config";

const CHANNELS = ["development", "preview", "production"] as const;
type UpdateChannel = (typeof CHANNELS)[number];

function getUpdateChannel(): UpdateChannel {
  const value = process.env.EXPO_UPDATE_CHANNEL?.trim().toLowerCase();

  if (!CHANNELS.includes(value as UpdateChannel)) {
    throw new Error(
      `EXPO_UPDATE_CHANNEL must be one of: ${CHANNELS.join(", ")}`,
    );
  }

  return value as UpdateChannel;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const channel = getUpdateChannel();
  const runtimeVersion = process.env.EXPO_RUNTIME_VERSION?.trim();
  const otaServerUrl = process.env.EXPO_OTA_SERVER_URL?.trim();

  if (!runtimeVersion) {
    throw new Error("EXPO_RUNTIME_VERSION is required");
  }

  if (!otaServerUrl) {
    throw new Error("EXPO_OTA_SERVER_URL is required");
  }

  return {
    ...config,
    name: config.name ?? "My App",
    slug: config.slug ?? "my-app",
    runtimeVersion,
    updates: {
      enabled: true,
      url: `${otaServerUrl.replace(/\/$/, "")}/api/manifest`,
      checkAutomatically: "NEVER",
      fallbackToCacheTimeout: 0,
      codeSigningCertificate:
        "./certificates/code-signing-certificate.pem",
      codeSigningMetadata: {
        alg: "rsa-v1_5-sha256",
        keyid: "main",
      },
      requestHeaders: {
        "expo-channel-name": channel,
      },
    },
    extra: {
      ...config.extra,
      updateChannel: channel,
    },
  };
};
```

Сервер сейчас подписывает с `keyid="main"`, поэтому `codeSigningMetadata.keyid` приложения также должен быть `main`.

### Как изолируются обновления {#how-updates-are-isolated}

Каждая нативная сборка запрашивает обновление по трём ключам выбора:

```text
runtimeVersion + channel + platform
```

В этой области сервер применяет правила активации/отката и аудиторию устройств до выбора подходящего обновления. Обычная доставка не пересекает версии runtime, каналы и платформы; явные аварийные маршруты — отдельный [механизм восстановления](./ota-emergency-recovery.md).

```mermaid
flowchart TD
  Client[Native binary] --> Headers["runtimeVersion=1.1<br/>channel=production<br/>platform=ios"]
  Headers --> Match["Exact scope:<br/>1.1 / production / ios"]
  Match --> Active[Latest active update]

  Runtime10["1.0 / production / ios"] -. different runtime .-> Rejected[Not eligible]
  Development["1.1 / development / ios"] -. different channel .-> Rejected
  Android["1.1 / production / android"] -. different platform .-> Rejected
```

Пример истории релизов:

| Событие | Результат |
|---|---|
| Приложение `1.0.0` собрано с runtime `1.0` и каналом `production` | Получает только активные обновления `1.0 / production` для своей платформы |
| Приложение `1.1.0` собрано с runtime `1.1` и каналом `production` | Не может получить обновление для runtime `1.0` |
| Обновление runtime `1.1` опубликовано в `development` | Production-сборки его не получают |
| То же обновление одобрено и опубликовано в `production` | Production-сборки runtime `1.1` могут его получить |

Добавление runtime `1.1` не удаляет и не отключает глобально runtime `1.0`. Старые сборки по-прежнему сообщают runtime `1.0` и могут получать его активные обновления. Если поддержку нужно прекратить, явно деактивируйте соответствующие обновления runtime `1.0`.

Не путайте версию приложения в магазине с Expo `runtimeVersion`. Сервер использует `runtimeVersion` для совместимости. Изменение runtime требует новой нативной сборки: OTA не может изменить собственные runtime, канал или сертификат подписи.

### Локальная проверка устройства через HTTPS {#local-device-testing-through-https}

Физическое устройство не может обратиться к компьютеру через `localhost`. Не используйте обычный HTTP LAN-адрес для проверки OTA. Предпочитайте временный HTTPS-проброс порта, например [Microsoft Dev Tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started).

Для Docker пробрасывайте только порт приложения:

```bash
devtunnel user login -g
devtunnel host -p 3000 --allow-anonymous
```

Задайте полученный `https://...devtunnels.ms` как `OTA_PUBLIC_BASE_URL` сервера и `EXPO_OTA_SERVER_URL` приложения. После изменения `.env` пересоздайте контейнер сервера:

```bash
docker compose up -d --force-recreate app
```

Оставьте подключения к БД и хранилищу локальными. В частности, сохраните `R2_ENDPOINT=http://127.0.0.1:9000` для локального публикатора, не направляя подписанные S3-запросы через туннель.

Анонимный доступ к туннелю нужен, когда мобильное приложение не может пройти вход Dev Tunnels. Он также открывает порт приложения публично, поэтому используйте временный туннель, надёжные данные администратора и останавливайте его после проверки.

Пример профилей EAS:

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": {
        "EXPO_UPDATE_CHANNEL": "development",
        "EXPO_RUNTIME_VERSION": "1.0.0",
        "EXPO_OTA_SERVER_URL": "https://updates.example.com"
      }
    },
    "preview": {
      "distribution": "internal",
      "env": {
        "EXPO_UPDATE_CHANNEL": "preview",
        "EXPO_RUNTIME_VERSION": "1.0.0",
        "EXPO_OTA_SERVER_URL": "https://updates.example.com"
      }
    },
    "production": {
      "env": {
        "EXPO_UPDATE_CHANNEL": "production",
        "EXPO_RUNTIME_VERSION": "1.0.0",
        "EXPO_OTA_SERVER_URL": "https://updates.example.com"
      }
    }
  }
}
```

`runtimeVersion` и канал — нативная конфигурация. OTA не может их изменить. При смене любого из этих значений или сертификата нужна новая нативная сборка.

## 4. Сгенерируйте и проверьте нативную конфигурацию {#_4-generate-and-verify-native-configuration}

Создайте нативные проекты или синхронизируйте существующие:

```bash
EXPO_UPDATE_CHANNEL=production \
EXPO_RUNTIME_VERSION=1.0.0 \
EXPO_OTA_SERVER_URL=https://updates.example.com \
npx expo prebuild
```

До сборки проверьте вычисленную конфигурацию Expo:

```bash
EXPO_UPDATE_CHANNEL=production \
EXPO_RUNTIME_VERSION=1.0.0 \
EXPO_OTA_SERVER_URL=https://updates.example.com \
npx expo config --type public
```

Если проект хранит `ios/` и `android/` в Git, также проверьте сгенерированные нативные значения:

- iOS `Expo.plist`:
  - `EXUpdatesURL`;
  - `EXUpdatesRuntimeVersion`;
  - `EXUpdatesRequestHeaders`;
  - `EXUpdatesCodeSigningCertificate`.
- Android manifest/resources:
  - `expo.modules.updates.EXPO_UPDATE_URL`;
  - `expo.modules.updates.EXPO_RUNTIME_VERSION`;
  - `expo.modules.updates.UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY`;
  - `expo.modules.updates.CODE_SIGNING_CERTIFICATE`.

Не полагайтесь только на `eas.json`. Итоговая нативная сборка должна содержать ожидаемые URL, runtime, канал и сертификат.

## 5. Проверяйте и устанавливайте обновления в приложении {#_5-check-and-install-updates-in-the-application}

Разместите сгенерированный `<OtaUpdates />` рядом с навигацией в корневом layout. `configure-app` добавляет это подключение автоматически. Если файлов или изменения корня нет, выполните [ручное подключение](./ota-client-lifecycle.md#manual-integration), включая полный пример Router и ручные элементы управления.

По умолчанию корень автоматически проверяет обновления, но скачивание и перезапуск ручные:

```tsx
<OtaUpdates autoCheck autoUpdate={false} autoReload={false} />
```

Необязательные собственные экраны могут использовать `useOtaUpdates()` и методы `check()`, `download()`, `reload()`. Идентификация, телеметрия и политики обновления используют единый контроллер. Не заменяйте эти действия прямыми `Updates.checkForUpdateAsync()`/`fetchUpdateAsync()`: они обходят управление хуком. Сохраняйте нативный `checkAutomatically: "NEVER"`. Принудительное обновление, магазин, фон, ошибки и собственные обработчики Guard описаны в [справочнике жизненного цикла](./ota-client-lifecycle.md).

Expo Updates автоматически отправляет используемые сервером заголовки, включая:

- `expo-platform`;
- `expo-runtime-version`;
- `expo-current-update-id`;
- `expo-embedded-update-id`;
- настроенный `expo-channel-name`.

Заголовки обеспечивают обычный выбор, защиту отката и точное сопоставление аварийных маршрутов без собственной аутентификации устройств.

## 6. Регистрируйте встроенные обновления {#_6-register-embedded-updates}

Аварийные маршруты и защита от понижения версии лучше всего работают, когда каждая выпущенная нативная сборка регистрирует встроенное обновление:

```text
embedded_update_id
app_version
created_at
channel
platform
is_embedded=true
```

После каждой релизной сборки iOS и Android зарегистрируйте значение в `ota_embedded_updates`. ID встроенного обновления и время создания должны происходить из сгенерированного встроенного манифеста Expo, а не из случайного значения, созданного до сборки.

Для `app_version` регистратор прежде всего использует версию из встроенного манифеста. Если SDK Expo её не содержит, используется обрезанная по краям строка `expo.version` из статического `app.json`. Отсутствующая, пустая, некорректная или нечитаемая резервная конфигурация оставляет `app_version` равным null, не блокируя в остальном корректную регистрацию.

Конфигуратор устанавливает реализацию из `templates/expo-app/`:

```text
scripts/ota-register-embedded/register-android.sh
scripts/ota-register-embedded/register-ios.sh
plugins/with-ota-embedded-registration.js
```

При полностью ручной настройке подключите эти скрипты регистратора к процессу сборки и задайте URL сервера и токен доступа; одного копирования клиентского хука недостаточно для регистрации нативных сборок.

Регистрация должна быть обязательным шагом CI для production. При её ошибке сборку нельзя распространять.

## 7. Опубликуйте OTA-обновление {#_7-publish-an-ota-update}

Сейчас репозиторий выдаёт обновления и управляет ими, но ещё не предоставляет HTTP-эндпоинт загрузки. Поэтому публикатор запускается из репозитория приложения Expo и требует учётные данные PostgreSQL и S3-совместимого хранилища.

Публикатор выполняет шаги:

1. Определяет точные канал и runtime целевой нативной сборки.
2. Запускает `npx expo export --platform ios` и/или `--platform android`.
3. Читает Expo `metadata.json`.
4. Вычисляет хеши и типы содержимого стартового ресурса и всех остальных ресурсов.
5. Загружает неизменяемые файлы в настроенный бакет.
6. Добавляет обновление в `ota_updates`.
7. Обновляет `ota_update_channels.latest_update_id`.
8. Оставляет обновление неактивным, если нужна ручная активация.
9. После проверки выполняется активация или откат из админки.

Конфигуратор устанавливает переносимый публикатор в `scripts/ota-publish/` и добавляет `ota:publish` в `package.json` приложения. Для метаданных runtime/канала используется статический `app.json`. Настройте исключённый из Git `.env.ota` приложения по `.env.ota.example`; локальные значения Docker можно подготовить через `--server-env`.

Запустите из каталога **приложения**:

```bash
npm run ota:publish -- --platform android --message "Fix checkout validation"
```

При необходимости используйте `--platform ios` или `--platform all`. Команда экспортирует и загружает OTA и создаёт неактивный релиз в админке; активация выполняется отдельно. Не используйте EAS Update для публикации на этот собственный сервер.

Обязательные настройки публикатора включают:

```env
EXPO_UPDATE_CHANNEL=production
OTA_DATABASE_URL=postgresql://...
OTA_DATABASE_SSL=true
R2_ENDPOINT=https://...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=expo-updates
```

Настроенный канал приложения, экспортируемый runtime, путь загружаемых файлов и записи БД должны использовать одни значения. Публикация JavaScript для другого `runtimeVersion` безопасна, но сборка его не выберет.

Прямые учётные данные БД и хранилища допустимы для доверенного локального публикатора. Не распространяйте их в мобильной сборке. Регистрация встроенной сборки может использовать защищённый эндпоинт:

```text
POST /api/admin/embedded-updates
Authorization: Bearer ota_...
```

Создайте отдельный токен через `npm run create-access-token` (или `docker compose exec app npm run create-access-token`) и оставьте только `updates:write`. Задайте `OTA_SERVER_URL` и `OTA_ACCESS_TOKEN` как секреты CI.

Конфигуратор приложения устанавливает:

- команды сборки Android APK/AAB, вызывающие `scripts/ota-register-embedded/register-android.sh` после Gradle;
- фазу сборки iOS Xcode, вызывающую `scripts/ota-register-embedded/register-ios.sh` для локальных Release/Archive;
- `ci_scripts/ci_post_xcodebuild.sh` — тонкий адаптер Xcode Cloud, вызывающий тот же `register-ios.sh`.

Зарегистрированные сборки видны в `/updates/embedded`.

## 8. Сквозная проверка {#_8-end-to-end-verification}

Проверьте готовность сервера:

```bash
curl -fsS https://updates.example.com/api/health
```

Проверьте ответ с подписанным манифестом:

```bash
curl -i \
  -H "expo-protocol-version: 1" \
  -H "expo-platform: ios" \
  -H "expo-runtime-version: 1.0.0" \
  -H "expo-channel-name: production" \
  -H 'expo-expect-signature: sig, keyid="main"' \
  https://updates.example.com/api/manifest
```

Ответ должен иметь код `200`, тип `multipart/mixed` и часть `expo-signature` для манифеста или директивы.

Итоговая проверка на устройстве:

1. Установите релизную нативную сборку, а не Expo Go.
2. Подтвердите runtime и нативный канал в диагностике приложения.
3. Опубликуйте OTA для той же платформы/runtime/канала.
4. Активируйте его в `/updates`.
5. Запустите проверку обновлений приложения.
6. Скачайте, перезапустите и подтвердите новый ID обновления.
7. До запуска production проверьте откат и точный аварийный маршрут.
