# Швидкий старт для початківців {#beginner-quick-start}

Цей посібник проведе вас від порожнього комп’ютера до робочого OTA-сервера та підключеного застосунку Expo. Глибокі знання Docker, PostgreSQL або Supabase не потрібні.

## Перед початком {#before-you-start}

Використовуйте Node.js 24 і npm на хості (зокрема під час налаштування через Docker), Docker Compose та OpenSSL. Для збірки застосунку також потрібні нативні інструменти платформи: Java/Android SDK або macOS/Xcode. Docker-образ сервера не містить інструментів мобільної розробки.

Створіть файли сервера або використовуйте наявну копію вихідного коду:

```bash
npx create-expo-updates-server@latest my-server
cd my-server
```

NPX лише створює файли; Docker і Supabase визначають, де вони працюють. Для першої перевірки дотримуйтеся шляху Docker нижче. Виконуйте серверні команди з цього каталогу, доки посібник явно не попросить перейти до каталогу застосунку.

## Що ви отримаєте {#what-you-will-have}

У результаті ви зможете:

1. відкрити панель керування OTA;
2. увійти як адміністратор;
3. підключити застосунок Expo;
4. публікувати оновлення;
5. вручну активувати оновлення;
6. виконувати відкат або налаштовувати аварійний маршрут.

## Виберіть один спосіб встановлення {#choose-one-installation-path}

- **Docker** запускає сервер, PostgreSQL і MinIO разом.
- **Supabase** розміщує БД і сховище; OTA-сервер розгортається окремо.

Для найшвидшої локальної перевірки використовуйте Docker.

---

# Варіант A: Docker {#option-a-docker}

## Крок 1. Встановіть і запустіть Docker Desktop {#step-1-install-and-start-docker-desktop}

Завантажте Docker Desktop:

```text
https://www.docker.com/products/docker-desktop/
```

Відкрийте його й дочекайтеся запуску Docker Engine.

## Крок 2. Відкрийте каталог проєкту {#step-2-open-the-project-folder}

У терміналі:

```bash
cd /path/to/expo-updates-server
```

## Крок 3. Створіть файл налаштувань {#step-3-create-the-settings-file}

```bash
cp .env.docker.example .env
```

Відкрийте `.env` і замініть:

```env
POSTGRES_PASSWORD=choose-a-long-random-password
MINIO_ROOT_PASSWORD=choose-another-long-random-password
```

Для цієї конфігурації Docker використовуйте різні випадкові шістнадцяткові паролі, наприклад значення з `openssl rand -hex 32`. Compose включає пароль БД до URL, а конфігуратор копіює параметри сховища між env-файлами; спеціальні символи поки потребують додаткової обробки. Не публікуйте `.env` у GitHub.

Якщо порт `3000` зайнятий:

```env
OTA_HTTP_PORT=3100
OTA_PUBLIC_BASE_URL=http://localhost:3100
```

Якщо інший проєкт уже використовує порт PostgreSQL `5432`, задайте:

```env
POSTGRES_PORT=5433
```

## Крок 4. Створіть пару ключів підпису {#step-4-create-the-signing-key-pair}

```bash
mkdir -p secrets local-certificates

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
  -keyout secrets/code-signing-private-key.pem \
  -out local-certificates/code-signing-certificate.pem

chmod 600 secrets/code-signing-private-key.pem
```

Залиште `secrets/code-signing-private-key.pem` на сервері. Скопіюйте `local-certificates/code-signing-certificate.pem` до застосунку Expo. Ці файли мають залишатися відповідною один одному парою.

## Крок 5. Запустіть усе {#step-5-start-everything}

```bash
docker compose up -d --build
docker compose ps
```

Перша збірка компілює закріплену версію MinIO з вихідного коду й може зайняти кілька хвилин. Go працює всередині Docker; встановлювати його на хості не потрібно. Наступні запуски використовують зібраний образ. Бакет створюється автоматично; образ `minio/mc` не потрібен.

Дочекайтеся стану `healthy` у `postgres`, `minio` та `app`. `/api/health` поки перевіряє лише БД. Переконайтеся, що застосунок також може прочитати коректний ключ підпису:

```bash
docker compose exec app node -e "require('node:crypto').createPrivateKey(require('node:fs').readFileSync('/run/secrets/ota/code-signing-private-key.pem')); console.log('Signing key OK')"
```

Під час bind-монтування Linux ключ хоста з `chmod 600` може бути недоступним UID/GID `1001` контейнера. Якщо перевірка повідомляє `EACCES`, надайте цій групі право читання й повторіть перевірку:

```bash
sudo chgrp 1001 secrets/code-signing-private-key.pem
chmod 640 secrets/code-signing-private-key.pem
```

Каталог `secrets` також має дозволяти користувачеві контейнера прохід до файла.

## Крок 6. База даних налаштовується автоматично {#step-6-database-setup-is-automatic}

Docker автоматично застосовує:

```text
docs/migrations/schema.sql
```

Для нового встановлення Docker pgAdmin і ручні SQL-команди не потрібні.

## Крок 7. Створіть першого адміністратора {#step-7-create-the-first-administrator}

```bash
docker compose exec app npm run create-admin
```

Введіть ім’я користувача, пароль щонайменше з 12 символів і виберіть `admin`.

## Крок 8. Відкрийте панель керування {#step-8-open-the-admin-panel}

```text
http://localhost:3000/login
```

Використовуйте `3100`, якщо змінили `OTA_HTTP_PORT`.

## Крок 9. Локальні налаштування публікатора {#step-9-local-publisher-settings}

Публікатор Expo може звертатися до сервісів Docker через порти, доступні лише через loopback:

```env
OTA_DATABASE_URL=postgresql://expo_updates:YOUR_POSTGRES_PASSWORD@localhost:YOUR_POSTGRES_PORT/expo_updates
OTA_DATABASE_SSL=false

R2_ENDPOINT=http://localhost:9000
R2_ACCESS_KEY_ID=expo_updates
R2_SECRET_ACCESS_KEY=YOUR_MINIO_ROOT_PASSWORD
R2_BUCKET=expo-updates
```

Використовуйте `5432`, якщо `POSTGRES_PORT` не змінювався. Якщо в `.env` задано `POSTGRES_PORT=5433`, укажіть `5433` і в `OTA_DATABASE_URL`.

MinIO Console доступна за адресою `http://localhost:9001`.

## Рекомендовано: HTTPS-тунель для перевірки на пристрої {#recommended-use-an-https-tunnel-for-device-testing}

Залиште `http://localhost` для адмінки та локальних підключень публікатора. Для фізичного пристрою не використовуйте звичайну LAN-адресу `http://`. Краще тимчасово перенаправити порт через HTTPS, наприклад за допомогою [Microsoft Dev Tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started).

На macOS:

```bash
brew install --cask devtunnel
devtunnel user login -g
devtunnel host -p 3000 --allow-anonymous
```

Якщо `OTA_HTTP_PORT` не дорівнює `3000`, перенаправте свій порт. Скопіюйте отриманий URL `https://...devtunnels.ms` до `.env`:

```env
OTA_PUBLIC_BASE_URL=https://YOUR-TUNNEL.devtunnels.ms
```

Застосуйте змінену змінну оточення:

```bash
docker compose up -d --force-recreate app
```

Передайте той самий HTTPS URL до `npm run configure-app` як URL сервера. Конфігуратор розпізнає `*.devtunnels.ms` як зовнішній доступ до локального Docker і зберігає пряме підключення публікатора до MinIO через `R2_ENDPOINT=http://127.0.0.1:9000`.

Не відкривайте PostgreSQL або MinIO в інтернет. Підписані S3-запити не мають проходити через звичайний HTTP-тунель: зміна хоста може порушити підпис.

`--allow-anonymous` дозволяє застосунку Expo звертатися до OTA без інтерактивного входу в Dev Tunnels, але водночас робить перенаправлений порт публічно доступним. Використовуйте тимчасовий тунель, надійні дані адміністратора й одразу зупиняйте тунель після перевірки.

---

# Варіант B: Supabase {#option-b-supabase}

Supabase замінює PostgreSQL і MinIO. Він не запускає вебсервер OTA.

## Крок 1. Створіть проєкт {#step-1-create-a-project}

1. Відкрийте `https://supabase.com`.
2. Виберіть **New project**.
3. Введіть назву проєкту.
4. Створіть і збережіть надійний пароль БД.
5. Виберіть найближчий регіон.
6. Дочекайтеся готовності проєкту.

## Крок 2. Встановіть схему {#step-2-install-the-schema}

1. Відкрийте **SQL Editor** ліворуч.
2. Виберіть **New query**.
3. Відкрийте `docs/migrations/schema.sql` на комп’ютері.
4. Скопіюйте весь файл.
5. Вставте його до Supabase SQL Editor.
6. Виберіть **Run**.
7. Дочекайтеся повідомлення про успіх.

Інші файли міграцій не потрібні.

## Крок 3. Перевірте таблиці {#step-3-confirm-the-tables}

Відкрийте **Table Editor**. Мають з’явитися:

```text
ota_access_tokens
ota_admin_sessions
ota_admin_users
ota_device_state
ota_device_transitions
ota_embedded_updates
ota_emergency_redirects
ota_guard_actions
ota_served_manifest_log
ota_update_channels
ota_updates
```

## Крок 4. Створіть сховище {#step-4-create-storage}

1. Відкрийте **Storage**.
2. Виберіть **New bucket**.
3. Назвіть його `expo-updates`.
4. Залиште бакет закритим.
5. Виберіть **Create bucket**.

## Крок 5. Отримайте серверні облікові дані {#step-5-get-server-credentials}

Знайдіть URL проєкту та ключ `service_role` в налаштуваннях проєкту. Ключ service role — секрет бекенда. Ніколи не додавайте його до застосунку Expo.

## Крок 6. Налаштуйте OTA-сервер {#step-6-configure-the-ota-server}

Спочатку створіть відповідну [пару ключів підпису](#step-4-create-the-signing-key-pair). Укажіть нижче справжній шлях до приватного ключа, доступного серверу; публічний сертифікат збережіть для налаштування застосунку.

Створіть `.env.local`:

```env
DATABASE_PROVIDER=supabase
SUPABASE_PROJECT_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
SUPABASE_UPDATES_BUCKET=expo-updates

OTA_PUBLIC_BASE_URL=https://updates.example.com
CODE_SIGNING_PRIVATE_KEY_PATH=/full/path/code-signing-private-key.pem
```

## Крок 7. Запустіть і перевірте сервер {#step-7-start-and-check-the-server}

```bash
npm ci
npm run build
npm run start
```

Відкрийте `http://localhost:3000/api/health`. Відповідь із `"status":"ok"` означає, що підключення до БД працює.

## Крок 8. Створіть адміністратора {#step-8-create-the-administrator}

```bash
npm run create-admin
```

Для першого користувача виберіть роль `admin`.

---

# Підключення застосунку Expo {#connect-the-expo-application}

Ці кроки однакові для Docker і Supabase.

## 1. Налаштуйте застосунок {#_1-configure-the-application}

Потрібні Node.js/npm на хості, проєкт Expo зі статичним `app.json`, публічний сертифікат підпису та HTTPS URL сервера, доступний телефону. Цей самий URL задайте в `OTA_PUBLIC_BASE_URL` сервера. Конфігуратор працює на хості, навіть коли сервер запущений у Docker.

Із **каталогу сервера**:

```bash
npm ci
npm run configure-app
```

Виберіть каталог застосунку, сертифікат, публічний URL, канал, runtime і платформу. CLI встановлює залежності, налаштовує нативні оновлення, генерує клієнт ідентифікації та телеметрії, додає самостійний кореневий компонент, встановлює скрипти публікації й реєстрації та запускає prebuild. Перевірте зведення перед застосуванням змін.

Прапорці, підтримувані кореневі компоненти та повторні запуски описані в [автоматичному налаштуванні](./expo-app-setup.md#automatic-configuration). Проєктам із динамічним `app.config.*` потрібне [ручне підключення клієнта](./ota-client-lifecycle.md#manual-integration); вбудований публікатор поки читає лише статичний `app.json`.

## 2. Перевірте облікові дані публікації та збірки {#_2-check-publisher-and-build-credentials}

Перейдіть до **каталогу застосунку**. Для локального Docker, доступного через localhost або `*.devtunnels.ms`, конфігуратор може створити `.env.ota` із серверного `.env`. Збережіть цей згенерований файл. Якщо його немає, створіть один раз:

```bash
cd /full/path/to/expo-application
[ -f .env.ota ] || cp .env.ota.example .env.ota
```

Заповніть відсутні облікові дані БД і сховища з налаштувань сервера. Виключіть файл із Git і не імпортуйте його до застосунку. Публікатору потрібні `OTA_DATABASE_URL` та облікові дані S3; токен доступу адмінки їх не замінює.

Для реєстрації вбудованих збірок можна використовувати той самий локальний `OTA_DATABASE_URL`. Для реєстрації через HTTP задайте `OTA_SERVER_URL` і `OTA_ACCESS_TOKEN` з `updates:write`; створіть його командою `docker compose exec app npm run create-access-token` із **каталогу сервера** для Docker або `npm run create-access-token`, якщо сервер працює через npm. Див. [реєстрацію вбудованих оновлень](./expo-app-setup.md#_6-register-embedded-updates).

## 3. Зберіть і встановіть нативний реліз {#_3-build-and-install-a-native-release}

До збірки виберіть, як застосунок завантажуватиме й застосовуватиме оновлення.

Згенерований `<OtaUpdates />` автоматично перевіряє оновлення та пропонує завантаження, перезапуск і дію «Пізніше». Щоб завантажувати звичайні оновлення автоматично, увімкніть `autoUpdate`; використовуйте `autoReload`, лише якщо автоматичні перезапуски підходять застосунку. Власні екранні елементи керування необов’язкові. Див. [налаштування хука](./ota-client-lifecycle.md).

Із **каталогу застосунку** зі встановленими інструментами Android:

```bash
npm run ota:build:android:apk
```

Встановіть `android/app/build/outputs/apk/release/app-release.apk` на телефон. Для iOS зберіть підписаний Release/Archive в Xcode; згенерована фаза збірки реєструє вбудоване оновлення. Реєстрація має успішно завершитися до продовження.

Зміна URL, runtime, каналу, сертифіката та додавання нативних модулів потребують нової нативної збірки. Expo Go і режим розробки не перевіряють цей життєвий цикл. Запустіть реліз і підтвердьте його появу в `/updates/devices`, а вбудованого оновлення — у `/updates/embedded`.

## 4. Опублікуйте перше OTA {#_4-publish-the-first-ota}

Зробіть помітну зміну JavaScript **після збірки нативного застосунку**. Збережіть сумісні runtime і канал; змініть `expo.version`, якщо потрібна окрема позначка версії. Із **каталогу застосунку**:

```bash
npm run ota:publish -- --platform android --message "First OTA smoke test"
```

Для iOS використовуйте `--platform ios`. Команда експортує та завантажує оновлення як неактивне. У `/updates` перевірте платформу, runtime і канал, виберіть потрібну аудиторію пристроїв, а потім активуйте оновлення.

## 5. Завантажте, перезапустіть і перевірте {#_5-download-restart-and-verify}

Перевірка → завантаження → перезапуск. Переконайтеся у видимій зміні та новій запущеній версії в `/updates/devices`. Саме завантаження не має змінювати повідомлену запущену версію. ID встановлення має зберігатися після перезапуску OTA.

Для окремої перевірки першого встановлення та ідемпотентних повторних запусків конфігуратора використовуйте [перевірку на новому застосунку](./expo-app-setup.md#verify-generation-in-a-fresh-application).

## Діагностика налаштування {#diagnose-the-setup}

Із **каталогу сервера** виконайте `npm run doctor -- --app /full/path/to/expo-application`. Команда перевіряє робочий стек Docker і вихідний код застосунку без змін. Для npm/віддаленого розгортання додайте `--mode remote --server-env .env.local`. До запуску сервісів використовуйте `--offline`. Див. [doctor](./doctor.md) для власних проєктів Compose, JSON-виводу та перевірок, яким усе ще потрібен реальний пристрій.

## Усунення несправностей {#troubleshooting}

- Помилка сервера: `docker compose logs app`.
- Стан контейнерів: `docker compose ps`.
- Конфлікт портів: змініть відповідний `*_PORT` у `.env`.
- `password authentication failed for user "expo_updates"` після редагування `.env`: наявний том PostgreSQL зберігає початковий пароль. Виконайте:

  ```bash
  npm run docker:sync-db-password
  docker compose restart app
  ```

- Немає таблиць Supabase: повторно виконайте весь `schema.sql`.
- Немає оновлення: порівняйте платформу, runtime і канал.
- Помилка підпису: приватний ключ сервера не відповідає сертифікату застосунку.
- `SignatureDoesNotMatch`: облікові дані сховища в `.env.ota` не збігаються з MinIO або R2. Для локального Docker повторно запустіть `npm run configure-app` і дозвольте заміну згенерованих файлів, щоб синхронізувати `.env.ota` із серверним `.env`. Якщо сервер OTA використовує Dev Tunnel, укажіть URL тунелю в `OTA_SERVER_URL`, але залиште `R2_ENDPOINT=http://127.0.0.1:9000` для локального публікатора. Надсилання підписаних S3-запитів через звичайний HTTP-тунель може змінити хост і порушити AWS-підпис.
- `unknown or unexpected option: --platform`: публікатор створений старою версією CLI. Повторно запустіть `npm run configure-app` і дозвольте заміну згенерованих файлів.
- Немає вбудованого оновлення: переконайтеся, що зібрано конфігурацію Release, а в CI є `OTA_SERVER_URL` і `OTA_ACCESS_TOKEN` з `updates:write`.

Технічний довідник:

- [Експлуатація](./operations-guide.md);
- [Налаштування Supabase](./supabase-setup.md);
- [Налаштування застосунку Expo](./expo-app-setup.md).
