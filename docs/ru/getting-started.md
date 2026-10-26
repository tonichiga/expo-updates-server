# Быстрый старт для начинающих {#beginner-quick-start}

Это руководство проведёт вас от пустого компьютера до работающего OTA-сервера и подключённого приложения Expo. Глубокие знания Docker, PostgreSQL или Supabase не нужны.

## Перед началом {#before-you-start}

Используйте Node.js 24 и npm на хосте (в том числе при настройке через Docker), Docker Compose и OpenSSL. Для сборки приложения также нужны нативные инструменты платформы: Java/Android SDK или macOS/Xcode. Docker-образ сервера не содержит инструменты мобильной разработки.

Создайте файлы сервера или используйте существующую копию исходников:

```bash
npx create-expo-updates-server@latest my-server
cd my-server
```

NPX только создаёт файлы; Docker и Supabase определяют, где они работают. Для первой проверки следуйте пути Docker ниже. Выполняйте серверные команды из этого каталога, пока руководство явно не попросит перейти в каталог приложения.

## Что вы получите {#what-you-will-have}

В результате вы сможете:

1. открыть панель управления OTA;
2. войти как администратор;
3. подключить приложение Expo;
4. публиковать обновления;
5. вручную активировать обновление;
6. выполнять откат или настраивать аварийный маршрут.

## Выберите один способ установки {#choose-one-installation-path}

- **Docker** запускает сервер, PostgreSQL и MinIO вместе.
- **Supabase** размещает БД и хранилище; OTA-сервер развёртывается отдельно.

Для самой быстрой локальной проверки используйте Docker.

---

# Вариант A: Docker {#option-a-docker}

## Шаг 1. Установите и запустите Docker Desktop {#step-1-install-and-start-docker-desktop}

Скачайте Docker Desktop:

```text
https://www.docker.com/products/docker-desktop/
```

Откройте его и дождитесь запуска Docker Engine.

## Шаг 2. Откройте каталог проекта {#step-2-open-the-project-folder}

В терминале:

```bash
cd /path/to/expo-updates-server
```

## Шаг 3. Создайте файл настроек {#step-3-create-the-settings-file}

```bash
cp .env.docker.example .env
```

Откройте `.env` и замените:

```env
POSTGRES_PASSWORD=choose-a-long-random-password
MINIO_ROOT_PASSWORD=choose-another-long-random-password
```

Для этой конфигурации Docker используйте разные случайные шестнадцатеричные пароли, например значения из `openssl rand -hex 32`. Compose включает пароль БД в URL, а конфигуратор копирует параметры хранилища между env-файлами; специальные символы пока требуют дополнительной обработки. Не публикуйте `.env` в GitHub.

Если порт `3000` занят:

```env
OTA_HTTP_PORT=3100
OTA_PUBLIC_BASE_URL=http://localhost:3100
```

Если другой проект уже использует порт PostgreSQL `5432`, задайте:

```env
POSTGRES_PORT=5433
```

## Шаг 4. Создайте пару ключей подписи {#step-4-create-the-signing-key-pair}

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

Оставьте `secrets/code-signing-private-key.pem` на сервере. Скопируйте `local-certificates/code-signing-certificate.pem` в приложение Expo. Эти файлы должны оставаться соответствующей друг другу парой.

## Шаг 5. Запустите всё {#step-5-start-everything}

```bash
docker compose up -d --build
docker compose ps
```

Первая сборка компилирует закреплённую версию MinIO из исходников и может занять несколько минут. Go работает внутри Docker; устанавливать его на хост не нужно. Следующие запуски используют собранный образ. Бакет создаётся автоматически; образ `minio/mc` не нужен.

Дождитесь состояния `healthy` у `postgres`, `minio` и `app`. `/api/health` пока проверяет только БД. Убедитесь, что приложение также может прочитать корректный ключ подписи:

```bash
docker compose exec app node -e "require('node:crypto').createPrivateKey(require('node:fs').readFileSync('/run/secrets/ota/code-signing-private-key.pem')); console.log('Signing key OK')"
```

При bind-монтировании Linux ключ хоста с `chmod 600` может быть недоступен UID/GID `1001` контейнера. Если проверка сообщает `EACCES`, дайте этой группе право чтения и повторите проверку:

```bash
sudo chgrp 1001 secrets/code-signing-private-key.pem
chmod 640 secrets/code-signing-private-key.pem
```

Каталог `secrets` также должен разрешать пользователю контейнера проход к файлу.

## Шаг 6. База данных настраивается автоматически {#step-6-database-setup-is-automatic}

Docker автоматически применяет:

```text
docs/migrations/schema.sql
```

Для новой установки Docker pgAdmin и ручные SQL-команды не нужны.

## Шаг 7. Создайте первого администратора {#step-7-create-the-first-administrator}

```bash
docker compose exec app npm run create-admin
```

Введите имя пользователя, пароль минимум из 12 символов и выберите `admin`.

## Шаг 8. Откройте панель управления {#step-8-open-the-admin-panel}

```text
http://localhost:3000/login
```

Используйте `3100`, если изменили `OTA_HTTP_PORT`.

## Шаг 9. Локальные настройки публикатора {#step-9-local-publisher-settings}

Публикатор Expo может обращаться к сервисам Docker через порты, доступные только по loopback:

```env
OTA_DATABASE_URL=postgresql://expo_updates:YOUR_POSTGRES_PASSWORD@localhost:YOUR_POSTGRES_PORT/expo_updates
OTA_DATABASE_SSL=false

R2_ENDPOINT=http://localhost:9000
R2_ACCESS_KEY_ID=expo_updates
R2_SECRET_ACCESS_KEY=YOUR_MINIO_ROOT_PASSWORD
R2_BUCKET=expo-updates
```

Используйте `5432`, если `POSTGRES_PORT` не менялся. Если в `.env` задано `POSTGRES_PORT=5433`, укажите `5433` и в `OTA_DATABASE_URL`.

MinIO Console доступна по адресу `http://localhost:9001`.

## Рекомендуется: HTTPS-туннель для проверки на устройстве {#recommended-use-an-https-tunnel-for-device-testing}

Оставьте `http://localhost` для админки и локальных подключений публикатора. Для физического устройства не используйте обычный LAN-адрес `http://`. Лучше временно пробросить порт через HTTPS, например с [Microsoft Dev Tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started).

На macOS:

```bash
brew install --cask devtunnel
devtunnel user login -g
devtunnel host -p 3000 --allow-anonymous
```

Если `OTA_HTTP_PORT` не равен `3000`, пробросьте свой порт. Скопируйте полученный URL `https://...devtunnels.ms` в `.env`:

```env
OTA_PUBLIC_BASE_URL=https://YOUR-TUNNEL.devtunnels.ms
```

Примените изменённую переменную окружения:

```bash
docker compose up -d --force-recreate app
```

Передайте тот же HTTPS URL в `npm run configure-app` как URL сервера. Конфигуратор распознаёт `*.devtunnels.ms` как внешний доступ к локальному Docker и сохраняет прямое подключение публикатора к MinIO через `R2_ENDPOINT=http://127.0.0.1:9000`.

Не открывайте PostgreSQL или MinIO в интернет. Подписанные S3-запросы не должны проходить через обычный HTTP-туннель: изменение хоста может нарушить подпись.

`--allow-anonymous` позволяет приложению Expo обращаться к OTA без интерактивного входа в Dev Tunnels, но одновременно делает проброшенный порт публично доступным. Используйте временный туннель, надёжные данные администратора и сразу останавливайте туннель после проверки.

---

# Вариант B: Supabase {#option-b-supabase}

Supabase заменяет PostgreSQL и MinIO. Он не запускает веб-сервер OTA.

## Шаг 1. Создайте проект {#step-1-create-a-project}

1. Откройте `https://supabase.com`.
2. Выберите **New project**.
3. Введите имя проекта.
4. Создайте и сохраните надёжный пароль БД.
5. Выберите ближайший регион.
6. Дождитесь готовности проекта.

## Шаг 2. Установите схему {#step-2-install-the-schema}

1. Откройте **SQL Editor** слева.
2. Выберите **New query**.
3. Откройте `docs/migrations/schema.sql` на компьютере.
4. Скопируйте весь файл.
5. Вставьте его в Supabase SQL Editor.
6. Выберите **Run**.
7. Дождитесь сообщения об успехе.

Другие файлы миграций не нужны.

## Шаг 3. Проверьте таблицы {#step-3-confirm-the-tables}

Откройте **Table Editor**. Должны появиться:

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

## Шаг 4. Создайте хранилище {#step-4-create-storage}

1. Откройте **Storage**.
2. Выберите **New bucket**.
3. Назовите его `expo-updates`.
4. Оставьте бакет закрытым.
5. Выберите **Create bucket**.

## Шаг 5. Получите серверные учётные данные {#step-5-get-server-credentials}

Найдите URL проекта и ключ `service_role` в настройках проекта. Ключ service role — секрет бэкенда. Никогда не помещайте его в приложение Expo.

## Шаг 6. Настройте OTA-сервер {#step-6-configure-the-ota-server}

Сначала создайте соответствующую [пару ключей подписи](#step-4-create-the-signing-key-pair). Укажите ниже настоящий путь к закрытому ключу, доступному серверу; публичный сертификат сохраните для настройки приложения.

Создайте `.env.local`:

```env
DATABASE_PROVIDER=supabase
SUPABASE_PROJECT_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
SUPABASE_UPDATES_BUCKET=expo-updates

OTA_PUBLIC_BASE_URL=https://updates.example.com
CODE_SIGNING_PRIVATE_KEY_PATH=/full/path/code-signing-private-key.pem
```

## Шаг 7. Запустите и проверьте сервер {#step-7-start-and-check-the-server}

```bash
npm ci
npm run build
npm run start
```

Откройте `http://localhost:3000/api/health`. Ответ с `"status":"ok"` означает, что подключение к БД работает.

## Шаг 8. Создайте администратора {#step-8-create-the-administrator}

```bash
npm run create-admin
```

Для первого пользователя выберите роль `admin`.

---

# Подключение приложения Expo {#connect-the-expo-application}

Эти шаги одинаковы для Docker и Supabase.

## 1. Настройте приложение {#_1-configure-the-application}

Понадобятся Node.js/npm на хосте, проект Expo со статическим `app.json`, публичный сертификат подписи и HTTPS URL сервера, доступный телефону. Этот же URL задайте в `OTA_PUBLIC_BASE_URL` сервера. Конфигуратор работает на хосте, даже когда сервер запущен в Docker.

Из **каталога сервера**:

```bash
npm ci
npm run configure-app
```

Выберите каталог приложения, сертификат, публичный URL, канал, runtime и платформу. CLI устанавливает зависимости, настраивает нативные обновления, генерирует клиент идентификации и телеметрии, добавляет самостоятельный корневой компонент, устанавливает скрипты публикации и регистрации и запускает prebuild. Проверьте сводку перед применением изменений.

Флаги, поддерживаемые корневые компоненты и повторные запуски описаны в [автоматической настройке](./expo-app-setup.md#automatic-configuration). Проектам с динамическим `app.config.*` нужно [ручное подключение клиента](./ota-client-lifecycle.md#manual-integration); встроенный публикатор пока читает только статический `app.json`.

## 2. Проверьте учётные данные публикации и сборки {#_2-check-publisher-and-build-credentials}

Перейдите в **каталог приложения**. Для локального Docker, доступного через localhost или `*.devtunnels.ms`, конфигуратор может создать `.env.ota` из серверного `.env`. Сохраните этот сгенерированный файл. Если его нет, создайте один раз:

```bash
cd /full/path/to/expo-application
[ -f .env.ota ] || cp .env.ota.example .env.ota
```

Заполните недостающие учётные данные БД и хранилища из настроек сервера. Исключите файл из Git и не импортируйте его в приложение. Публикатору нужны `OTA_DATABASE_URL` и учётные данные S3; токен доступа админки их не заменяет.

Для регистрации встроенных сборок можно использовать тот же локальный `OTA_DATABASE_URL`. При регистрации по HTTP задайте `OTA_SERVER_URL` и `OTA_ACCESS_TOKEN` с `updates:write`; создайте его командой `docker compose exec app npm run create-access-token` из **каталога сервера** для Docker либо `npm run create-access-token`, если сервер работает через npm. См. [регистрацию встроенных обновлений](./expo-app-setup.md#_6-register-embedded-updates).

## 3. Соберите и установите нативный релиз {#_3-build-and-install-a-native-release}

До сборки выберите, как приложение будет скачивать и применять обновления.

Сгенерированный `<OtaUpdates />` автоматически проверяет обновления и предлагает скачивание, перезапуск и действие «Позже». Чтобы скачивать обычные обновления автоматически, включите `autoUpdate`; используйте `autoReload`, только если автоматические перезапуски подходят приложению. Собственные экранные элементы управления необязательны. См. [настройки хука](./ota-client-lifecycle.md).

Из **каталога приложения** с установленными инструментами Android:

```bash
npm run ota:build:android:apk
```

Установите `android/app/build/outputs/apk/release/app-release.apk` на телефон. Для iOS соберите подписанный Release/Archive в Xcode; сгенерированная фаза сборки регистрирует встроенное обновление. Регистрация должна успешно завершиться до продолжения.

Смена URL, runtime, канала, сертификата и добавление нативных модулей требуют новой нативной сборки. Expo Go и режим разработки не проверяют этот жизненный цикл. Запустите релиз и подтвердите его появление в `/updates/devices`, а встроенного обновления — в `/updates/embedded`.

## 4. Опубликуйте первое OTA {#_4-publish-the-first-ota}

Сделайте заметное изменение JavaScript **после сборки нативного приложения**. Сохраните совместимые runtime и канал; измените `expo.version`, если нужна отдельная метка версии. Из **каталога приложения**:

```bash
npm run ota:publish -- --platform android --message "First OTA smoke test"
```

Для iOS используйте `--platform ios`. Команда экспортирует и загружает обновление как неактивное. В `/updates` проверьте платформу, runtime и канал, выберите нужную аудиторию устройств и затем активируйте обновление.

## 5. Скачайте, перезапустите и проверьте {#_5-download-restart-and-verify}

Проверка → скачивание → перезапуск. Убедитесь в видимом изменении и новой запущенной версии в `/updates/devices`. Одно скачивание не должно менять сообщаемую запущенную версию. ID установки должен сохраняться после перезапуска OTA.

Для отдельной проверки первой установки и идемпотентных повторных запусков конфигуратора используйте [проверку на новом приложении](./expo-app-setup.md#verify-generation-in-a-fresh-application).

## Диагностика настройки {#diagnose-the-setup}

Из **каталога сервера** выполните `npm run doctor -- --app /full/path/to/expo-application`. Команда проверяет работающий стек Docker и исходники приложения без изменений. Для npm/удалённого развёртывания добавьте `--mode remote --server-env .env.local`. До запуска сервисов используйте `--offline`. См. [doctor](./doctor.md) для собственных проектов Compose, JSON-вывода и проверок, которым всё ещё нужно реальное устройство.

## Устранение неполадок {#troubleshooting}

- Ошибка сервера: `docker compose logs app`.
- Состояние контейнеров: `docker compose ps`.
- Конфликт портов: измените соответствующий `*_PORT` в `.env`.
- `password authentication failed for user "expo_updates"` после редактирования `.env`: существующий том PostgreSQL сохраняет исходный пароль. Выполните:

  ```bash
  npm run docker:sync-db-password
  docker compose restart app
  ```

- Нет таблиц Supabase: повторно выполните весь `schema.sql`.
- Нет обновления: сравните платформу, runtime и канал.
- Ошибка подписи: закрытый ключ сервера не соответствует сертификату приложения.
- `SignatureDoesNotMatch`: учётные данные хранилища в `.env.ota` не совпадают с MinIO или R2. Для локального Docker повторно запустите `npm run configure-app` и разрешите замену сгенерированных файлов, чтобы синхронизировать `.env.ota` с серверным `.env`. Если сервер OTA использует Dev Tunnel, укажите URL туннеля в `OTA_SERVER_URL`, но оставьте `R2_ENDPOINT=http://127.0.0.1:9000` для локального публикатора. Отправка подписанных S3-запросов через обычный HTTP-туннель может изменить хост и нарушить AWS-подпись.
- `unknown or unexpected option: --platform`: публикатор создан старой версией CLI. Повторно запустите `npm run configure-app` и разрешите замену сгенерированных файлов.
- Нет встроенного обновления: убедитесь, что собрана конфигурация Release, а в CI есть `OTA_SERVER_URL` и `OTA_ACCESS_TOKEN` с `updates:write`.

Технический справочник:

- [Эксплуатация](./operations-guide.md);
- [Настройка Supabase](./supabase-setup.md);
- [Настройка приложения Expo](./expo-app-setup.md).
