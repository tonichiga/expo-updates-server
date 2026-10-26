# Налаштування застосунку Expo {#expo-application-setup}

Цей посібник підключає застосунок Expo до власного OTA-сервера для отримання та публікації оновлень.

## Автоматичне налаштування {#automatic-configuration}

Застосунки зі статичним `app.json` можна налаштувати з репозиторію OTA-сервера. Спочатку встановіть залежності сервера на хості, навіть якщо сам сервер працює в Docker:

```bash
npm ci
npm run configure-app
```

Інтерактивний CLI запитує кожне обов’язкове значення та підтверджує підсумковий план до зміни застосунку.

Для неінтерактивного використання в CI:

```bash
npm run configure-app -- \
  --app /full/path/to/expo-app \
  --certificate /full/path/code-signing-certificate.pem \
  --server-url https://updates.example.com \
  --channel production \
  --runtime-version 1.0.0
```

Команда змінює `app.json` і `package.json`, копіює публічний сертифікат, встановлює `expo-updates` та залежності ідентифікації/телеметрії, додає переносний публікатор і запускає `expo prebuild`. Підтримуються lock-файли npm, pnpm, Yarn і Bun.

Вона також створює `ota-client/` і запускає ідентифікацію та телеметрію встановлень із `ota-entry.js`, зберігаючи початкову точку входу. Для Expo Router конфігуратор розміщує `<OtaUpdates />` поруч із навігацією в `src/app/_layout` (або `app/_layout`). Згенерований компонент TypeScript сам викликає хук; він не обгортає застосунок і не потребує контексту. Підтримуються й стандартні кореневі компоненти `App`, включно з платформними варіантами. Ручне підключення ID встановлення, ID пристрою або сигналів активності не потрібне. Компонент починає з автоматичних перевірок і ручних запитів завантаження/перезапуску; власні налаштування зберігаються під час повторної конфігурації. Режими оновлення та API хука описані в [життєвому циклі OTA-клієнта](./ota-client-lifecycle.md). Якщо генерація недоступна, скористайтеся [ручним підключенням хука](./ota-client-lifecycle.md#manual-integration).

Зміна вихідного коду використовує позиції синтаксичного дерева й зберігає імпорти, коментарі, директиви, код компонента та вкладені обробники. Непідтримувані кореневі експорти (клас, асинхронна функція, HOC або реекспорт) зупиняють налаштування до запису в застосунок. Для автоматичної зміни експортуйте синхронну кореневу функцію або ідентифікатор локальної функції. Власна точка входу з невизначуваним коренем зберігає поведінку запуску й отримує попередження про потребу підключити керування оновленнями вручну; ідентифікація та телеметрія залишаються підключеними через згенероване початкове завантаження. Наявний імпорт `useOtaUpdates` має використовувати відносний шлях до `ota-client`. Нерозв’язані псевдоніми на кшталт `@/ota-client` зупиняють зміну до запису, щоб другий хук непомітно не перевизначив наявну автоматизацію.

Параметри:

```text
--platform all|ios|android
--force
--server-env /full/path/to/server.env
```

CLI навмисно відхиляє проєкти з динамічним `app.config.*` і не замінює згенеровані файли без `--force`. Розділи нижче описують нативну конфігурацію; [ручне підключення хука](./ota-client-lifecycle.md#manual-integration) — клієнтські файли, залежності, корінь та елементи керування. `--force` дозволяє заміну згенерованих файлів, але не обходить непідтримувані динамічні конфігурації або форми кореня. `--server-env` вибирає локальне оточення сервера для підготовки налаштувань публікатора. Для ізольованого стенда явно вкажіть його `.env.ota-test`.

## Перевірка генерації на новому застосунку {#verify-generation-in-a-fresh-application}

Використовуйте окремий застосунок для першої генерації, а наявний збережіть для перевірки оновлень і повторних запусків. Не використовуйте runtime іншого застосунку лише заради появи тестового OTA: новий застосунок має власну межу нативної сумісності.

Створіть сусідній застосунок Expo Router із шаблоном SDK 58, який використовується для інтеграційних перевірок клієнта:

```bash
npx create-expo-app@latest ota-smoke-app --template default@sdk-58
```

Явний шаблон закріплює сімейство SDK; див. офіційний [довідник create-expo-app](https://docs.expo.dev/more/create-expo/). Для іншого SDK використовуйте сумісні пакети й повторіть перевірки релізу на пристрої нижче.

Підготуйте доступний HTTPS OTA-сервер і відповідний публічний сертифікат підпису. Потім із **репозиторію сервера** виконайте команду, виправивши шляхи до застосунку та сертифіката:

```bash
npm run configure-app -- \
  --app /full/path/to/ota-smoke-app \
  --certificate /full/path/code-signing-certificate.pem \
  --server-url https://updates.example.com \
  --channel hook-smoke \
  --runtime-version hook-smoke-sdk58-v1 \
  --platform android
```

Для ізольованого локального стенда додайте `--server-env .env.ota-test` і використовуйте публічний URL тунелю в `--server-url`. Задайте той самий публічний базовий URL серверу, щоб телефон міг завантажувати ресурси. Для встановлення поруч з іншим тестовим застосунком використовуйте окремий Android package/iOS bundle identifier.

До збірки перевірте зміни:

| Файл/зміна | Очікуваний результат |
| --- | --- |
| `app.json` | Правильні HTTPS URL, сертифікат, runtime і канал; нативні автоматичні перевірки вимкнено |
| `package.json` | Клієнтські залежності, `main: "ota-entry.js"`, скрипти публікації та збірки вибраних платформ |
| `ota-client-entry.json` | Початкову точку входу збережено |
| `ota-client/` | Публічний API, вкладені файли моделі/інтерфейсу та публічний `config.json` |
| Кореневий `_layout` / `App` | Один безумовний хук і блокувальний екран; наявну навігацію та провайдери збережено |
| `.env.ota` | Локальні облікові дані публікації/збірки; виключені з Git і ніколи не імпортуються застосунком |

До збірки додайте [приклад ручних елементів керування](./ota-client-lifecycle.md#_3-add-manual-update-controls) на тестовий екран або явно ввімкніть автоматизацію завантаження/перезапуску налаштуваннями хука. За замовчуванням корінь лише перевіряє; стандартний шаблон Expo не має тестових кнопок OTA. Ці елементи або налаштування мають потрапити до встановлюваної збірки, щоб вона отримала перше OTA.

Із **каталогу застосунку** виконайте:

```bash
npx expo lint
npx tsc --noEmit
npm run ota:build:android:apk
```

Команді Android потрібні робочі локальні інструменти Java/Android. До запуску налаштуйте реєстрацію вбудованих оновлень у `.env.ota`: локальний Docker може використовувати згенерований `OTA_DATABASE_URL`; реєстрація HTTP вимагає `OTA_SERVER_URL` і `OTA_ACCESS_TOKEN` з `updates:write`. Згенерований скрипт вважає помилку реєстрації помилкою збірки. Див. [реєстрацію вбудованих оновлень](#_6-register-embedded-updates). Для iOS налаштуйте `--platform ios`/`all` і зберіть підписаний Release/Archive.

Встановіть релізний APK із `android/app/build/outputs/apk/release/app-release.apk`. Після першого запуску перевірте встановлення в `/updates/devices`.

Зробіть помітну зміну JS й оновіть `expo.version` для окремої позначки графіка, зберігши сумісний runtime. Публікуйте **після нативної збірки**:

```bash
npm run ota:publish -- --platform android --message "Fresh app hook smoke test"
```

Реліз з’явиться неактивним у `/updates`. Виберіть аудиторію, активуйте його, потім перевірте, завантажте та перезапустіть. Перевірка або завантаження самі по собі не мають змінювати запущену версію встановлення в аналітиці; це робить наступний сигнал запуску. Переконайтеся, що ID встановлення зберігається після перезапуску OTA.

Нарешті повторіть ту саму команду конфігуратора. Перевірте, що OTA-компонент не дублюється, а збережена початкова точка входу не замінюється. Змініть властивість компонента в корені й повторіть запуск, щоб перевірити збереження налаштування. Використовуйте `--force` лише для навмисної заміни змінених згенерованих файлів; він не обходить непідтримувану форму кореня. Для перевірки ручного варіанта використовуйте окрему чисту копію та виконайте [ручне підключення](./ota-client-lifecycle.md#manual-integration) без генератора. Розділяйте ці перевірки, щоб залишки генерації не приховували пропущені ручні кроки.

## 1. Встановіть клієнтські залежності {#_1-install-client-dependencies}

Для ручного налаштування встановіть сумісні з Expo версії всіх клієнтських залежностей:

```bash
npx expo install expo-updates expo-application expo-crypto expo-secure-store @react-native-async-storage/async-storage
```

Застосунок не надсилає токен адмінки під час перевірки оновлення. `/api/manifest` і `/api/assets` — публічні робочі ендпоїнти. Сесії адмінки та токени доступу потрібні лише операторам, CI й адміністративній автоматизації.

## 2. Створіть сертифікат підпису коду {#_2-create-the-code-signing-certificate}

Створіть один приватний RSA-ключ і самопідписаний публічний сертифікат:

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

Файли мають різних власників і правила розгортання:

| Файл | Розташування | Можна включати до Git |
|---|---|---|
| `code-signing-certificate.pem` | Застосунок Expo | Так, він публічний |
| `code-signing-private-key.pem` | Лише OTA-сервер | Ні |

Для Docker Compose скопіюйте до репозиторію сервера лише приватний ключ:

```bash
mkdir -p secrets
cp /secure/path/code-signing-private-key.pem \
  secrets/code-signing-private-key.pem
chmod 600 secrets/code-signing-private-key.pem
```

Стек Compose монтує `./secrets` лише для читання й читає ключ із `/run/secrets/ota/code-signing-private-key.pem`.

Для розгортання без контейнера задайте:

```env
CODE_SIGNING_PRIVATE_KEY_PATH=/run/secrets/code-signing-private-key.pem
```

або вбудований PEM:

```env
CODE_SIGNING_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
```

Ніколи не змінюйте приватний ключ сервера без випуску нової нативної збірки з відповідним публічним сертифікатом. Наявні збірки відхиляють маніфести з невідомим ключем.

## 3. Налаштуйте застосунок Expo {#_3-configure-the-expo-application}

Автоматичний шлях оновлює статичний `app.json`. За ручного налаштування динамічна конфігурація нижче вимагає явного каналу та runtime для кожної збірки. Поточні конфігуратор і стандартний публікатор читають статичний `app.json` і не обчислюють динамічну конфігурацію. Не використовуйте стандартний публікатор зі суперечливими статичними й обчисленими значеннями.

Приклад `app.config.ts`:

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

Сервер зараз підписує з `keyid="main"`, тому `codeSigningMetadata.keyid` застосунку також має бути `main`.

### Як ізолюються оновлення {#how-updates-are-isolated}

Кожна нативна збірка запитує оновлення за трьома ключами вибору:

```text
runtimeVersion + channel + platform
```

У цій області сервер застосовує правила активації/відкату та аудиторію пристроїв до вибору придатного оновлення. Звичайна доставка не перетинає версії runtime, канали й платформи; явні аварійні маршрути — окремий [механізм відновлення](./ota-emergency-recovery.md).

```mermaid
flowchart TD
  Client[Native binary] --> Headers["runtimeVersion=1.1<br/>channel=production<br/>platform=ios"]
  Headers --> Match["Exact scope:<br/>1.1 / production / ios"]
  Match --> Active[Latest active update]

  Runtime10["1.0 / production / ios"] -. different runtime .-> Rejected[Not eligible]
  Development["1.1 / development / ios"] -. different channel .-> Rejected
  Android["1.1 / production / android"] -. different platform .-> Rejected
```

Приклад історії релізів:

| Подія | Результат |
|---|---|
| Застосунок `1.0.0` зібрано з runtime `1.0` і каналом `production` | Отримує лише активні оновлення `1.0 / production` для своєї платформи |
| Застосунок `1.1.0` зібрано з runtime `1.1` і каналом `production` | Не може отримати оновлення для runtime `1.0` |
| Оновлення runtime `1.1` опубліковано в `development` | Production-збірки його не отримують |
| Те саме оновлення схвалено й опубліковано в `production` | Production-збірки runtime `1.1` можуть його отримати |

Додавання runtime `1.1` не видаляє й не вимикає глобально runtime `1.0`. Старі збірки, як і раніше, повідомляють runtime `1.0` і можуть отримувати його активні оновлення. Якщо підтримку потрібно припинити, явно деактивуйте відповідні оновлення runtime `1.0`.

Не плутайте версію застосунку в магазині з Expo `runtimeVersion`. Сервер використовує `runtimeVersion` для сумісності. Зміна runtime вимагає нової нативної збірки: OTA не може змінити власні runtime, канал або сертифікат підпису.

### Локальна перевірка пристрою через HTTPS {#local-device-testing-through-https}

Фізичний пристрій не може звернутися до комп’ютера через `localhost`. Не використовуйте звичайну HTTP LAN-адресу для перевірки OTA. Віддавайте перевагу тимчасовому HTTPS-перенаправленню порту, наприклад [Microsoft Dev Tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started).

Для Docker перенаправляйте лише порт застосунку:

```bash
devtunnel user login -g
devtunnel host -p 3000 --allow-anonymous
```

Задайте отриманий `https://...devtunnels.ms` як `OTA_PUBLIC_BASE_URL` сервера та `EXPO_OTA_SERVER_URL` застосунку. Після зміни `.env` перестворіть контейнер сервера:

```bash
docker compose up -d --force-recreate app
```

Залиште підключення до БД і сховища локальними. Зокрема, збережіть `R2_ENDPOINT=http://127.0.0.1:9000` для локального публікатора, не спрямовуючи підписані S3-запити через тунель.

Анонімний доступ до тунелю потрібен, коли мобільний застосунок не може пройти вхід Dev Tunnels. Він також відкриває порт застосунку публічно, тому використовуйте тимчасовий тунель, надійні дані адміністратора й зупиняйте його після перевірки.

Приклад профілів EAS:

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

`runtimeVersion` і канал — нативна конфігурація. OTA не може їх змінити. У разі зміни будь-якого із цих значень або сертифіката потрібна нова нативна збірка.

## 4. Згенеруйте та перевірте нативну конфігурацію {#_4-generate-and-verify-native-configuration}

Створіть нативні проєкти або синхронізуйте наявні:

```bash
EXPO_UPDATE_CHANNEL=production \
EXPO_RUNTIME_VERSION=1.0.0 \
EXPO_OTA_SERVER_URL=https://updates.example.com \
npx expo prebuild
```

До збірки перевірте обчислену конфігурацію Expo:

```bash
EXPO_UPDATE_CHANNEL=production \
EXPO_RUNTIME_VERSION=1.0.0 \
EXPO_OTA_SERVER_URL=https://updates.example.com \
npx expo config --type public
```

Якщо проєкт зберігає `ios/` та `android/` у Git, також перевірте згенеровані нативні значення:

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

Не покладайтеся лише на `eas.json`. Підсумкова нативна збірка має містити очікувані URL, runtime, канал і сертифікат.

## 5. Перевіряйте та встановлюйте оновлення в застосунку {#_5-check-and-install-updates-in-the-application}

Розмістіть згенерований `<OtaUpdates />` поруч із навігацією в кореневому layout. `configure-app` додає це підключення автоматично. Якщо файлів або зміни кореня немає, виконайте [ручне підключення](./ota-client-lifecycle.md#manual-integration), включно з повним прикладом Router і ручними елементами керування.

За замовчуванням корінь автоматично перевіряє оновлення, але завантаження й перезапуск ручні:

```tsx
<OtaUpdates autoCheck autoUpdate={false} autoReload={false} />
```

Необов’язкові власні екрани можуть використовувати `useOtaUpdates()` та методи `check()`, `download()`, `reload()`. Ідентифікація, телеметрія й політики оновлення використовують єдиний контролер. Не замінюйте ці дії прямими `Updates.checkForUpdateAsync()`/`fetchUpdateAsync()`: вони обходять керування хуком. Зберігайте нативний `checkAutomatically: "NEVER"`. Примусове оновлення, магазин, фон, помилки та власні обробники Guard описані в [довіднику життєвого циклу](./ota-client-lifecycle.md).

Expo Updates автоматично надсилає використовувані сервером заголовки, зокрема:

- `expo-platform`;
- `expo-runtime-version`;
- `expo-current-update-id`;
- `expo-embedded-update-id`;
- налаштований `expo-channel-name`.

Заголовки забезпечують звичайний вибір, захист відкату й точне зіставлення аварійних маршрутів без власної автентифікації пристроїв.

## 6. Реєструйте вбудовані оновлення {#_6-register-embedded-updates}

Аварійні маршрути та захист від пониження версії найкраще працюють, коли кожна випущена нативна збірка реєструє вбудоване оновлення:

```text
embedded_update_id
app_version
created_at
channel
platform
is_embedded=true
```

Після кожної релізної збірки iOS і Android зареєструйте значення в `ota_embedded_updates`. ID вбудованого оновлення та час створення мають походити зі згенерованого вбудованого маніфесту Expo, а не з випадкового значення, створеного до збірки.

Для `app_version` реєстратор насамперед використовує версію з вбудованого маніфесту. Якщо SDK Expo її не містить, використовується обрізаний по краях рядок `expo.version` зі статичного `app.json`. Відсутня, порожня, некоректна або нечитабельна резервна конфігурація залишає `app_version` рівним null, не блокуючи в іншому коректну реєстрацію.

Конфігуратор встановлює реалізацію з `templates/expo-app/`:

```text
scripts/ota-register-embedded/register-android.sh
scripts/ota-register-embedded/register-ios.sh
plugins/with-ota-embedded-registration.js
```

За повністю ручного налаштування підключіть ці скрипти реєстратора до процесу збірки та задайте URL сервера й токен доступу; одного копіювання клієнтського хука недостатньо для реєстрації нативних збірок.

Реєстрація має бути обов’язковим кроком CI для production. У разі її помилки збірку не можна поширювати.

## 7. Опублікуйте OTA-оновлення {#_7-publish-an-ota-update}

Зараз репозиторій видає оновлення й керує ними, але ще не надає HTTP-ендпоїнта завантаження. Тому публікатор запускається з репозиторію застосунку Expo й потребує облікових даних PostgreSQL та S3-сумісного сховища.

Публікатор виконує кроки:

1. Визначає точні канал і runtime цільової нативної збірки.
2. Запускає `npx expo export --platform ios` та/або `--platform android`.
3. Читає Expo `metadata.json`.
4. Обчислює хеші й типи вмісту стартового ресурсу та всіх інших ресурсів.
5. Завантажує незмінні файли до налаштованого бакета.
6. Додає оновлення до `ota_updates`.
7. Оновлює `ota_update_channels.latest_update_id`.
8. Залишає оновлення неактивним, якщо потрібна ручна активація.
9. Після перевірки виконується активація або відкат з адмінки.

Конфігуратор встановлює переносний публікатор у `scripts/ota-publish/` і додає `ota:publish` до `package.json` застосунку. Для метаданих runtime/каналу використовується статичний `app.json`. Налаштуйте виключений із Git `.env.ota` застосунку за `.env.ota.example`; локальні значення Docker можна підготувати через `--server-env`.

Запустіть із каталогу **застосунку**:

```bash
npm run ota:publish -- --platform android --message "Fix checkout validation"
```

За потреби використовуйте `--platform ios` або `--platform all`. Команда експортує та завантажує OTA і створює неактивний реліз в адмінці; активація виконується окремо. Не використовуйте EAS Update для публікації на цей власний сервер.

Обов’язкові налаштування публікатора включають:

```env
EXPO_UPDATE_CHANNEL=production
OTA_DATABASE_URL=postgresql://...
OTA_DATABASE_SSL=true
R2_ENDPOINT=https://...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=expo-updates
```

Налаштований канал застосунку, експортований runtime, шлях завантажених файлів і записи БД мають використовувати однакові значення. Публікація JavaScript для іншого `runtimeVersion` безпечна, але збірка його не вибере.

Прямі облікові дані БД і сховища припустимі для довіреного локального публікатора. Не поширюйте їх у мобільній збірці. Реєстрація вбудованої збірки може використовувати захищений ендпоїнт:

```text
POST /api/admin/embedded-updates
Authorization: Bearer ota_...
```

Створіть окремий токен через `npm run create-access-token` (або `docker compose exec app npm run create-access-token`) і залиште лише `updates:write`. Задайте `OTA_SERVER_URL` і `OTA_ACCESS_TOKEN` як секрети CI.

Конфігуратор застосунку встановлює:

- команди збірки Android APK/AAB, що викликають `scripts/ota-register-embedded/register-android.sh` після Gradle;
- фазу збірки iOS Xcode, що викликає `scripts/ota-register-embedded/register-ios.sh` для локальних Release/Archive;
- `ci_scripts/ci_post_xcodebuild.sh` — тонкий адаптер Xcode Cloud, що викликає той самий `register-ios.sh`.

Зареєстровані збірки видно в `/updates/embedded`.

## 8. Наскрізна перевірка {#_8-end-to-end-verification}

Перевірте готовність сервера:

```bash
curl -fsS https://updates.example.com/api/health
```

Перевірте відповідь із підписаним маніфестом:

```bash
curl -i \
  -H "expo-protocol-version: 1" \
  -H "expo-platform: ios" \
  -H "expo-runtime-version: 1.0.0" \
  -H "expo-channel-name: production" \
  -H 'expo-expect-signature: sig, keyid="main"' \
  https://updates.example.com/api/manifest
```

Відповідь має мати код `200`, тип `multipart/mixed` і частину `expo-signature` для маніфесту або директиви.

Підсумкова перевірка на пристрої:

1. Встановіть релізну нативну збірку, а не Expo Go.
2. Підтвердьте runtime і нативний канал у діагностиці застосунку.
3. Опублікуйте OTA для тієї самої платформи/runtime/каналу.
4. Активуйте його в `/updates`.
5. Запустіть перевірку оновлень застосунку.
6. Завантажте, перезапустіть і підтвердьте новий ID оновлення.
7. До запуску production перевірте відкат і точний аварійний маршрут.
