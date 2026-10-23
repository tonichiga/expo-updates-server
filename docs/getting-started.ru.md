# Быстрый старт для начинающих

Эта инструкция проведёт вас от пустого компьютера до работающего OTA-сервера
и первого подключения Expo-приложения. Глубокие знания Docker, PostgreSQL или
Supabase не требуются.

## Перед началом

На компьютере нужны Node.js 24 и npm (в том числе при запуске сервера в Docker),
Docker Compose и OpenSSL. Для приложения нужен native toolchain: Java/Android SDK
или macOS/Xcode. Docker-образ сервера не содержит инструменты сборки приложения.

Создайте файлы сервера или используйте существующий checkout репозитория:

```bash
npx create-expo-updates-server@latest my-server
cd my-server
```

NPX создаёт файлы; Docker/Supabase определяют, где запускается сервер. Для первой
проверки используйте Docker ниже. Команды сервера выполняются из этой папки,
пока инструкция явно не переключит вас в папку приложения.

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

Для этого Docker-пути используйте отдельные случайные hex-пароли, например
значения из `openssl rand -hex 32`. Compose вставляет пароль базы в URL, а
конфигуратор переносит storage credentials между env-файлами; спецсимволы пока
требуют дополнительной обработки. Не публикуйте `.env` в GitHub.

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

У `postgres`, `minio` и `app` должен появиться статус `healthy`. `/api/health`
проверяет только базу. Дополнительно проверьте, что приложение может прочитать
корректный ключ подписи:

```bash
docker compose exec app node -e "require('node:crypto').createPrivateKey(require('node:fs').readFileSync('/run/secrets/ota/code-signing-private-key.pem')); console.log('Signing key OK')"
```

На Linux bind mount ключ с `chmod 600`, принадлежащий пользователю хоста, может
быть недоступен UID/GID `1001` контейнера. При `EACCES` разрешите группе чтение
и повторите проверку:

```bash
sudo chgrp 1001 secrets/code-signing-private-key.pem
chmod 640 secrets/code-signing-private-key.pem
```

Директория `secrets` также должна разрешать проход пользователю контейнера.

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

Откройте слева **Table Editor**. Должны появиться 11 таблиц:

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

Сначала создайте [ключ и сертификат](#шаг-4-создаите-ключ-и-сертификат).
В настройках ниже укажите настоящий путь к private key, доступному серверу.
Public certificate понадобится для подключения приложения.

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

## 1. Настройте приложение

Нужны Node.js/npm на компьютере, Expo-проект со статическим `app.json`, public
certificate и HTTPS URL, доступный телефону. Такой же URL укажите в серверном
`OTA_PUBLIC_BASE_URL`. Конфигуратор работает на компьютере, даже если сервер в Docker.

Из **папки сервера**:

```bash
npm ci
npm run configure-app
```

Выберите папку приложения, certificate, публичный URL, channel, runtime и платформу.
CLI установит зависимости, настроит native updates, добавит клиент идентификации
и телеметрии, хук/gate в корень, publisher и регистрацию embedded-сборок, затем
выполнит prebuild. Перед применением проверьте итоговый план.

Флаги, поддерживаемые root-компоненты и повторный запуск описаны в
[настройке приложения](./expo-app-setup.md#automatic-configuration).
Для `app.config.*` потребуется [ручное подключение клиента](./ota-client-lifecycle.md#manual-integration);
встроенный publisher пока читает только статический `app.json`.

## 2. Проверьте credentials публикации и сборки

Перейдите в **папку приложения**. При локальном Docker с URL localhost или
`*.devtunnels.ms` конфигуратор может создать `.env.ota` из серверного `.env`.
Сохраните готовый файл. Только если его нет, создайте один раз:

```bash
cd /полный/путь/к/expo-приложению
[ -f .env.ota ] || cp .env.ota.example .env.ota
```

Заполните отсутствующие настройки базы и storage. Файл должен быть исключён из Git
и не импортироваться приложением. Publisher требует `OTA_DATABASE_URL` и S3
credentials; административный access token их не заменяет.

Для регистрации embedded-сборки локально достаточно того же `OTA_DATABASE_URL`.
Для регистрации через HTTP нужны `OTA_SERVER_URL` и `OTA_ACCESS_TOKEN` со scope
`updates:write`. Токен создаётся из **папки сервера** командой
`docker compose exec app npm run create-access-token` для Docker или
`npm run create-access-token` при запуске сервера напрямую через npm.
Подробнее: [embedded registration](./expo-app-setup.md#_6-register-embedded-updates).

## 3. Соберите и установите native release

До сборки выберите, как приложение будет скачивать и применять обновления.

Созданный root-хук проверяет обновления автоматически, но скачивание и перезапуск
по умолчанию ручные. Добавьте на тестовый экран [пример кнопок](./ota-client-lifecycle.md#_3-add-manual-update-controls)
или явно включите автоматизацию через [параметры хука](./ota-client-lifecycle.md).
Генератор не добавляет тестовые кнопки в интерфейс приложения.

Из **папки приложения**, с установленным Android toolchain:

```bash
npm run ota:build:android:apk
```

Установите на телефон `android/app/build/outputs/apk/release/app-release.apk`.
Для iOS соберите подписанный Release/Archive в Xcode; созданная build phase
зарегистрирует embedded update. Перед продолжением регистрация должна пройти успешно.

URL, runtime, channel, certificate и добавленные native-модули требуют новой
native-сборки. Expo Go и development mode для этой проверки не подходят.
Запустите release и проверьте установку в `/updates/devices`, а embedded update —
в `/updates/embedded`.

## 4. Опубликуйте первую OTA

Сделайте заметное JS-изменение **после сборки binary**. Сохраните совместимый runtime
и channel; измените `expo.version`, если нужна отдельная подпись версии в аналитике.
Из **папки приложения**:

```bash
npm run ota:publish -- --platform android --message "First OTA smoke test"
```

Для iOS используйте `--platform ios`. Команда экспортирует и загрузит неактивный update.
В `/updates` проверьте platform/runtime/channel, выберите аудиторию устройств и
активируйте обновление.

## 5. Скачайте, перезапустите и проверьте

Check → download → restart. Проверьте видимое изменение и новую запущенную версию
в `/updates/devices`. Само скачивание не должно менять статистику запущенной версии.
Installation ID после OTA-перезапуска должен остаться прежним.

Проверка с нуля и повторного запуска конфигуратора описана в
[инструкции для нового приложения](./expo-app-setup.md#verify-generation-in-a-fresh-application).

## Диагностика настройки

Из **папки сервера** выполните `npm run doctor -- --app /полный/путь/к/expo-приложению`.
Команда проверяет работающий Docker-стенд и исходники приложения, ничего не меняя.
Для npm/remote добавьте `--mode remote --server-env .env.local`.
`--offline` проверяет файлы до запуска сервисов. В [руководстве doctor](./doctor.md)
описаны параметры Compose, JSON и проверки, которые остаются за реальным устройством.

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
