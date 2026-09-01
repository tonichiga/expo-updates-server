# Быстрый старт для начинающих

Эта инструкция проведёт вас от пустого компьютера до работающего OTA-сервера
и первого подключения Expo-приложения. Глубокие знания Docker, PostgreSQL или
Supabase не требуются.

## Что получится в конце

Вы сможете:

1. открыть админ-панель OTA-сервера;
2. войти под своим администратором;
3. подключить Expo-приложение;
4. публиковать обновления;
5. вручную активировать нужное обновление;
6. откатывать и аварийно перенаправлять обновления.

## Сначала выберите способ установки

Используйте только один вариант:

- **Docker** — проще всего запустить всё на своём компьютере или сервере;
- **Supabase** — база данных и хранилище находятся в Supabase, OTA-сервер
  запускается отдельно.

Если вы просто хотите проверить проект, начните с Docker.

---

# Вариант A: установка через Docker

## Шаг 1. Установите Docker Desktop

Скачайте Docker Desktop с:

```text
https://www.docker.com/products/docker-desktop/
```

Установите его и запустите. Дождитесь, пока Docker Desktop покажет, что Docker
Engine работает.

## Шаг 2. Откройте папку проекта

Откройте Terminal и перейдите в папку OTA-сервера:

```bash
cd /путь/к/expo-updates-server
```

## Шаг 3. Создайте файл настроек

Выполните:

```bash
cp .env.docker.example .env
```

Откройте появившийся файл `.env` в редакторе.

Замените эти два пароля своими длинными случайными значениями:

```env
POSTGRES_PASSWORD=ваш-надежный-пароль-базы
MINIO_ROOT_PASSWORD=ваш-надежный-пароль-хранилища
```

Пароли не нужно заключать в кавычки. Не публикуйте файл `.env` в GitHub.

Если порт `3000` уже занят, установите:

```env
OTA_HTTP_PORT=3100
OTA_PUBLIC_BASE_URL=http://localhost:3100
```

Если другой проект уже использует PostgreSQL на порту `5432`, установите:

```env
POSTGRES_PORT=5433
```

## Шаг 4. Создайте ключ и сертификат

Private key хранится только на сервере. Public certificate добавляется в
Expo-приложение.

Выполните из папки OTA-сервера:

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

После команды появятся:

- `secrets/code-signing-private-key.pem` — остаётся на сервере;
- `local-certificates/code-signing-certificate.pem` — позже копируется в
  Expo-приложение.

Не меняйте один файл отдельно от второго: они работают только как одна пара.

## Шаг 5. Запустите сервер

Выполните:

```bash
docker compose up -d --build
```

Первый запуск может занять несколько минут. Docker скачивает PostgreSQL, MinIO
и собирает OTA-сервер.

Проверьте состояние:

```bash
docker compose ps
```

У `postgres`, `minio` и `app` должен появиться статус `healthy`.

## Шаг 6. Не устанавливайте схему вручную

При первом Docker-запуске схема устанавливается автоматически из:

```text
docs/migrations/schema.sql
```

Вручную открывать pgAdmin или выполнять SQL не требуется.

## Шаг 7. Создайте администратора

Выполните:

```bash
docker compose exec app npm run create-admin
```

Команда попросит:

1. username;
2. пароль длиной не менее 12 символов;
3. роль.

Для первого пользователя выберите роль `admin`.

## Шаг 8. Откройте админ-панель

Если используется стандартный порт:

```text
http://localhost:3000/login
```

Если вы указали `OTA_HTTP_PORT=3100`:

```text
http://localhost:3100/login
```

Войдите с username и паролем из предыдущего шага.

## Шаг 9. Данные для локальной публикации

Publish script Expo-приложения запускается на вашем компьютере и подключается к
Docker-сервисам через `localhost`.

Используйте значения из `.env`:

```env
OTA_DATABASE_URL=postgresql://expo_updates:ВАШ_POSTGRES_PASSWORD@localhost:ВАШ_POSTGRES_PORT/expo_updates
OTA_DATABASE_SSL=false

R2_ENDPOINT=http://localhost:9000
R2_ACCESS_KEY_ID=expo_updates
R2_SECRET_ACCESS_KEY=ВАШ_MINIO_ROOT_PASSWORD
R2_BUCKET=expo-updates
```

Если `POSTGRES_PORT` не менялся, используйте `5432`. Если в `.env` был указан
`5433`, такой же порт должен быть в `OTA_DATABASE_URL`.

MinIO можно открыть в браузере:

```text
http://localhost:9001
```

Логин — `MINIO_ROOT_USER`, пароль — `MINIO_ROOT_PASSWORD` из `.env`.

## Рекомендуется: HTTPS-туннель для проверки на устройстве

Оставьте `http://localhost` для админ-панели и локального publish script. Для
физического устройства не используйте обычный `http://` адрес компьютера в
локальной сети. Предпочтительнее временный HTTPS port forwarding, например
[Microsoft Dev Tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/get-started).

На macOS:

```bash
brew install --cask devtunnel
devtunnel user login -g
devtunnel host -p 3000 --allow-anonymous
```

Если `OTA_HTTP_PORT` отличается от `3000`, пробросьте указанный порт. Скопируйте
полученный адрес `https://...devtunnels.ms` в `.env`:

```env
OTA_PUBLIC_BASE_URL=https://YOUR-TUNNEL.devtunnels.ms
```

Пересоздайте контейнер приложения, чтобы применить новое значение:

```bash
docker compose up -d --force-recreate app
```

Этот же HTTPS URL укажите как адрес сервера в `npm run configure-app`.
Конфигуратор распознаёт `*.devtunnels.ms` как доступ к локальному Docker и
оставляет publish script подключённым напрямую к MinIO через
`R2_ENDPOINT=http://127.0.0.1:9000`.

Не открывайте PostgreSQL и MinIO в интернет. Signed S3-запросы не следует
отправлять через обычный HTTP tunnel: изменение host может сделать подпись
недействительной.

Параметр `--allow-anonymous` нужен, чтобы Expo-приложение могло обратиться к
OTA endpoint без интерактивного входа в Dev Tunnels. При этом порт становится
доступен из интернета. Используйте временный tunnel, надёжные данные
администратора и остановите tunnel сразу после проверки.

---

# Вариант B: установка через Supabase

Supabase заменяет PostgreSQL и MinIO из Docker. Он не запускает сам
OTA-сервер — приложение сервера всё равно нужно развернуть отдельно.

## Шаг 1. Создайте Supabase project

1. Откройте `https://supabase.com`.
2. Войдите или создайте аккаунт.
3. Нажмите **New project**.
4. Укажите название проекта.
5. Создайте надёжный database password и сохраните его.
6. Выберите ближайший регион.
7. Нажмите **Create new project**.
8. Дождитесь завершения создания.

## Шаг 2. Установите схему

1. В левом меню Supabase откройте **SQL Editor**.
2. Нажмите **New query**.
3. На компьютере откройте файл:

   ```text
   docs/migrations/schema.sql
   ```

4. Выделите всё содержимое файла и скопируйте.
5. Вставьте SQL в окно Supabase.
6. Нажмите зелёную кнопку **Run**.
7. Дождитесь сообщения об успешном выполнении.

Никакие отдельные migration-файлы запускать не нужно.

## Шаг 3. Проверьте таблицы

Откройте слева **Table Editor**. Должны появиться 10 таблиц:

```text
ota_access_tokens
ota_admin_sessions
ota_admin_users
ota_device_state
ota_device_transitions
ota_embedded_updates
ota_emergency_redirects
ota_served_manifest_log
ota_update_channels
ota_updates
```

Если таблицы появились, схема установлена.

## Шаг 4. Создайте bucket

1. Откройте слева **Storage**.
2. Нажмите **New bucket**.
3. Введите имя `expo-updates`.
4. Не делайте bucket публичным.
5. Нажмите **Create bucket**.

## Шаг 5. Получите настройки Supabase

В настройках проекта найдите:

- **Project URL**;
- **service_role key**.

Service role key является секретом. Его нельзя добавлять в Expo-приложение,
публиковать в GitHub или показывать пользователям.

## Шаг 6. Создайте `.env.local` сервера

В папке OTA-сервера создайте `.env.local`:

```env
DATABASE_PROVIDER=supabase
SUPABASE_PROJECT_URL=https://ВАШ-ПРОЕКТ.supabase.co
SUPABASE_SERVICE_ROLE_KEY=ВАШ_SERVICE_ROLE_KEY
SUPABASE_UPDATES_BUCKET=expo-updates

OTA_PUBLIC_BASE_URL=https://updates.example.com
CODE_SIGNING_PRIVATE_KEY_PATH=/полный/путь/code-signing-private-key.pem
```

Замените примеры своими значениями.

## Шаг 7. Запустите сервер

```bash
npm ci
npm run build
npm run start
```

Откройте:

```text
http://localhost:3000/api/health
```

Если отображается `"status":"ok"`, сервер подключился к Supabase.

## Шаг 8. Создайте администратора

Остановите сервер при необходимости и выполните:

```bash
npm run create-admin
```

Для первого пользователя выберите роль `admin`.

---

# Подключение Expo-приложения

Эти шаги одинаковы для Docker и Supabase.

## Автоматическая настройка через CLI

Если Expo-приложение использует статический `app.json`, выполните из папки
OTA-сервера:

```bash
npm run configure-app
```

CLI по очереди спросит:

1. язык вопросов;
2. путь к Expo-приложению;
3. путь к public certificate;
4. URL OTA-сервера;
5. channel;
6. runtime version;
7. платформу;
8. можно ли заменять существующие CLI-файлы.

Перед изменением файлов CLI покажет итоговые значения и попросит
подтверждение.

Для CI или опытных пользователей те же значения можно передать одной командой:

```bash
npm run configure-app -- \
  --app /полный/путь/к/expo-приложению \
  --certificate /полный/путь/code-signing-certificate.pem \
  --server-url https://updates.example.com \
  --channel production \
  --runtime-version 1.0.0
```

CLI автоматически:

1. проверит, что путь ведёт к Expo-проекту;
2. установит совместимую версию `expo-updates`;
3. настроит URL, channel, runtime и code signing в `app.json`;
4. скопирует public certificate в приложение;
5. добавит portable publish script;
6. создаст `.env.ota.example`;
7. добавит команду `npm run ota:publish`;
8. установит зависимости publisher;
9. добавит регистрацию embedded update для Android и iOS;
10. запустит `expo prebuild` и обновит native-проекты.

Для настройки только одной платформы добавьте:

```bash
--platform ios
```

или:

```bash
--platform android
```

CLI не перезаписывает существующий publisher или другой certificate. Если вы
осознанно хотите заменить их, добавьте `--force`.

Если в приложении есть `app.config.ts`, `app.config.js`, `app.config.mjs` или
`app.config.cjs`, CLI остановится: динамический config имеет приоритет над
`app.json`, поэтому автоматический static patch был бы ненадёжным.

После выполнения скопируйте `.env.ota.example` в `.env.ota` и заполните
credentials:

```bash
cd /полный/путь/к/expo-приложению
cp .env.ota.example .env.ota
```

При локальном Docker и `localhost` CLI делает это автоматически: он безопасно
создаёт игнорируемый `.env.ota` из `.env` OTA-сервера. Ручное копирование нужно
только для внешнего сервера, Supabase или другого storage. Если OTA-сервер
открыт наружу через Microsoft Dev Tunnel (`*.devtunnels.ms`), CLI также
распознает локальный Docker: публичный tunnel будет записан в
`OTA_SERVER_URL`, а MinIO останется на `R2_ENDPOINT=http://127.0.0.1:9000`.

Затем можно публиковать:

```bash
npm run ota:publish -- --message "Описание изменения"
```

Update будет загружен неактивным. Активируйте его после проверки в
админ-панели.

## Регистрация update, встроенного в binary

Каждая release-сборка содержит embedded update. Серверу нужен его ID, чтобы
правильно выполнять rollback и emergency redirect. CLI настраивает этот flow
автоматически.

Для локального Docker используется уже созданный `.env.ota`. Android APK
собирайте командой:

```bash
npm run ota:build:android:apk
```

Для Android App Bundle:

```bash
npm run ota:build:android:aab
```

После успешной Gradle-сборки
`scripts/ota-register-embedded/register-android.sh` найдёт `app.manifest` и
зарегистрирует embedded update. Для iOS CLI добавляет Xcode Build Phase,
который вызывает `scripts/ota-register-embedded/register-ios.sh`, поэтому
достаточно собрать Release/Archive в Xcode.

Для удалённого CI или Xcode Cloud не передавайте пароль PostgreSQL. Создайте
отдельный access token:

```bash
docker compose exec app npm run create-access-token
```

Оставьте scope `updates:write`, скопируйте показанный token и добавьте в secrets
CI:

```env
OTA_SERVER_URL=https://updates.example.com
OTA_ACCESS_TOKEN=ota_...
```

CLI также создаёт `ci_scripts/ci_post_xcodebuild.sh` — тонкий lifecycle-адаптер
Xcode Cloud, который вызывает тот же `register-ios.sh`. Xcode Cloud
автоматически запустит его после сборки. Token показывается только один раз и
не должен попадать в Git или в mobile binary.

Зарегистрированные binary можно проверить в админ-панели на странице
`/updates/embedded`.

Ниже описан тот же процесс вручную.

## Шаг 1. Установите expo-updates

В папке Expo-приложения выполните:

```bash
npx expo install expo-updates
```

## Шаг 2. Скопируйте public certificate

Создайте в Expo-приложении папку `certificates` и скопируйте туда:

```text
code-signing-certificate.pem
```

Private key в Expo-приложение копировать нельзя.

## Шаг 3. Настройте Expo config

Откройте
[инструкцию по настройке Expo-приложения](https://github.com/tonichiga/expo-updates-server/blob/main/docs/expo-app-setup.md)
и скопируйте пример `app.config.ts`.

Укажите:

- `EXPO_OTA_SERVER_URL` — адрес OTA-сервера;
- `EXPO_UPDATE_CHANNEL` — например `development` или `production`;
- `EXPO_RUNTIME_VERSION` — версия native runtime.

Для production используйте публичный HTTPS URL. `localhost` на физическом
телефоне указывает на сам телефон, а не на компьютер. Для локальной проверки
используйте
[HTTPS Dev Tunnel](#рекомендуется-https-туннель-для-проверки-на-устройстве),
а не обычный HTTP-адрес компьютера в локальной сети.

## Шаг 4. Соберите новый native binary

URL, channel, runtime и certificate записываются в нативное приложение.
Обычный JavaScript reload их не меняет.

После изменения конфигурации выполните локальную или CI Android/iOS сборку.

## Шаг 5. Опубликуйте update

После автоматической настройки используется:

```bash
npm run ota:publish -- --message "Описание изменения"
```

Publish script экспортирует JavaScript, загружает файлы в storage и добавляет
запись в базу. Новый update остаётся неактивным, пока вы сами его не проверите.

## Шаг 6. Активируйте update

1. Откройте `/updates` в админ-панели.
2. Найдите новый update.
3. Проверьте channel, runtime и platform.
4. Активируйте update вручную.

## Шаг 7. Проверьте на устройстве

Перед проверкой полностью пройдите
[инструкцию по настройке Expo-приложения](https://github.com/tonichiga/expo-updates-server/blob/main/docs/expo-app-setup.md).
Особенно важен раздел с реализацией
[`checkForUpdateAsync`, `fetchUpdateAsync` и `reloadAsync`](https://github.com/tonichiga/expo-updates-server/blob/main/docs/expo-app-setup.md#5-check-and-install-updates-in-the-application):
добавьте этот сценарий на экран приложения или запускайте его при старте.

Затем:

1. Соберите и установите release-сборку с URL OTA-сервера, runtime, channel и
   public certificate.
2. Опубликуйте update с заметным тестовым изменением.
3. Активируйте update в админ-панели.
4. Откройте release-сборку и запустите проверку обновлений.
5. Скачайте update, перезапустите приложение и убедитесь, что тестовое
   изменение появилось.

Expo Go и development mode для этой проверки не подходят: приложение должно
использовать нативную OTA-конфигурацию, встроенную в release binary.

## Если что-то не работает

- Сервер не запускается: `docker compose logs app`.
- Контейнеры не healthy: `docker compose ps`.
- Порт занят: измените соответствующий `*_PORT` в `.env`.
- Ошибка `password authentication failed for user "expo_updates"` после
  изменения `.env`: существующий PostgreSQL volume сохранил старый пароль.
  Выполните:

  ```bash
  npm run docker:sync-db-password
  docker compose restart app
  ```

- Таблиц нет в Supabase: повторно выполните весь `schema.sql`.
- Update не находится: сравните platform, runtime и channel.
- Ошибка подписи: private key сервера не соответствует certificate приложения.
- `SignatureDoesNotMatch`: credentials storage в `.env.ota` не совпадают с
  MinIO/R2. Для локального Docker повторно запустите `npm run configure-app` и
  разрешите замену CLI-файлов — `.env.ota` будет синхронизирован из серверного
  `.env`. Если OTA-сервер открыт через Dev Tunnel, tunnel URL указывается в
  `OTA_SERVER_URL`, но локальный publisher всё равно должен использовать
  `R2_ENDPOINT=http://127.0.0.1:9000`. S3-запросы нельзя отправлять в MinIO
  через обычный HTTP tunnel: изменение host ломает AWS signature.
- `unknown or unexpected option: --platform`: publisher был создан старой
  версией CLI. Повторно запустите `npm run configure-app`, подтвердите то же
  приложение и разрешите замену CLI-файлов, либо обновите проект с последней
  версией OTA-сервера.
- Embedded update не появился: убедитесь, что собиралась Release-конфигурация,
  а CI содержит `OTA_SERVER_URL` и `OTA_ACCESS_TOKEN` со scope
  `updates:write`.

Технические детали находятся в:

- [Operations guide](https://github.com/tonichiga/expo-updates-server/blob/main/docs/operations-guide.md);
- [Supabase setup](https://github.com/tonichiga/expo-updates-server/blob/main/docs/supabase-setup.md);
- [Expo application setup](https://github.com/tonichiga/expo-updates-server/blob/main/docs/expo-app-setup.md).
