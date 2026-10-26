# Настройка Supabase {#supabase-setup}

Supabase — самый простой вариант размещённого PostgreSQL для OTA-сервера. Это полноценная установка, а не сокращённый вариант для разработки: Supabase, отдельный PostgreSQL и Docker Compose используют одну каноническую схему.

## 1. Создайте проект {#_1-create-a-project}

Создайте проект Supabase и дождитесь готовности базы данных.

Сохраните значения для сервера:

- URL проекта;
- ключ service role;
- строку прямого подключения PostgreSQL, если скрипты будут подключаться через `pg`.

Никогда не помещайте ключ service role или строку подключения БД в приложение Expo.

## 2. Примените полную схему {#_2-apply-the-complete-schema}

Откройте **SQL Editor** в панели Supabase:

1. Выберите **New query**.
2. Откройте [`docs/migrations/schema.sql`](https://github.com/tonichiga/expo-updates-server/blob/main/docs/migrations/schema.sql) из этого репозитория.
3. Скопируйте весь файл в редактор.
4. Выберите **Run**.

Файл идемпотентен и является канонической схемой для новой установки. Он создаёт:

| Таблица | Назначение |
|---|---|
| `ota_updates` | Метаданные опубликованных OTA-обновлений |
| `ota_update_channels` | Указатели последнего и активного обновления |
| `ota_embedded_updates` | Метаданные встроенных нативных обновлений |
| `ota_served_manifest_log` | Сопоставление выданного манифеста и обновления |
| `ota_device_state` | Последнее известное состояние каждой установки |
| `ota_device_transitions` | История смены среды выполнения и обновлений |
| `ota_admin_users` | Администраторы и роли |
| `ota_admin_sessions` | Отзываемые браузерные сессии |
| `ota_access_tokens` | Хеши токенов автоматизации |
| `ota_guard_actions` | Каталог повторно используемых действий Guard |
| `ota_emergency_redirects` | Правила аварийного перенаправления каналов |

Не используйте дамп схемы pgAdmin как установочный скрипт. Дампы содержат владельцев и команды сессии, привязанные к конкретной БД. `schema.sql` содержит только переносимую схему приложения.

## 3. Настройте сервер {#_3-configure-the-server}

До запуска сервера создайте [пару ключей подписи](./expo-app-setup.md#_2-create-the-code-signing-certificate). Ниже укажите реальный путь к закрытому ключу, доступный серверу, а соответствующий публичный сертификат сохраните для приложения.

Рекомендуемая конфигурация адаптера Supabase:

```env
DATABASE_PROVIDER=supabase
SUPABASE_PROJECT_URL=https://PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_UPDATES_BUCKET=expo-updates

OTA_PUBLIC_BASE_URL=https://updates.example.com
CODE_SIGNING_PRIVATE_KEY_PATH=/run/secrets/code-signing-private-key.pem
```

Используйте **ключ service role**, а не анонимный или публикуемый браузерный ключ. OTA-сервер — доверенный бэкенд, которому нужен доступ ко всем управляющим таблицам.

Другой вариант — использовать Supabase только как размещённый PostgreSQL и объектное хранилище, а сервер подключить через адаптер PostgreSQL/S3:

```env
DATABASE_PROVIDER=pg
DATABASE_URL=postgresql://...
DATABASE_SSL=true

R2_ENDPOINT=https://PROJECT.supabase.co/storage/v1/s3
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=expo-updates
R2_REGION=...
S3_FORCE_PATH_STYLE=true
```

Используйте точный S3 endpoint и учётные данные со страницы настройки S3 в Supabase Storage.

## 4. Создайте бакет хранилища {#_4-create-the-storage-bucket}

Создайте закрытый бакет `expo-updates` либо выберите другое имя и укажите одинаковое значение в:

```env
SUPABASE_UPDATES_BUCKET=expo-updates
R2_BUCKET=expo-updates
OTA_STORAGE_BUCKET=expo-updates
```

При выдаче ресурсов через подписанные URL бакет должен оставаться закрытым.

## 5. Создайте первого администратора {#_5-create-the-first-administrator}

Локально задайте окружение сервера, затем выполните:

```bash
npm ci
npm run create-admin
```

Команда записывает bcrypt-хеш пароля в `ota_admin_users`. Пароль в открытом виде не сохраняется.

## 6. Проверьте установку {#_6-verify-the-installation}

Запустите сервер и проверьте:

```bash
curl -fsS https://updates.example.com/api/health
```

Затем войдите по адресу:

```text
https://updates.example.com/login
```

В **Table Editor** должны отображаться все одиннадцать таблиц OTA из списка выше.

## 7. Обновление {#_7-upgrades}

Перед обновлением создайте резервную копию БД, затем примените актуальный `docs/migrations/schema.sql`. Схема идемпотентна и добавляет недостающие объекты. Любые будущие миграции данных или разрушительные изменения, которые нельзя безопасно выразить в этом файле, должны быть явно описаны в примечаниях к релизу.
