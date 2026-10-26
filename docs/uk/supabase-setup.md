# Налаштування Supabase {#supabase-setup}

Supabase — найпростіший варіант розміщеного PostgreSQL для OTA-сервера. Це повноцінне встановлення, а не скорочений варіант для розробки: Supabase, окремий PostgreSQL і Docker Compose використовують одну канонічну схему.

## 1. Створіть проєкт {#_1-create-a-project}

Створіть проєкт Supabase і дочекайтеся готовності бази даних.

Збережіть значення для сервера:

- URL проєкту;
- ключ service role;
- рядок прямого підключення PostgreSQL, якщо скрипти підключатимуться через `pg`.

Ніколи не додавайте ключ service role або рядок підключення БД до застосунку Expo.

## 2. Застосуйте повну схему {#_2-apply-the-complete-schema}

Відкрийте **SQL Editor** у панелі Supabase:

1. Виберіть **New query**.
2. Відкрийте [`docs/migrations/schema.sql`](https://github.com/tonichiga/expo-updates-server/blob/main/docs/migrations/schema.sql) із цього репозиторію.
3. Скопіюйте весь файл до редактора.
4. Виберіть **Run**.

Файл ідемпотентний і є канонічною схемою для нового встановлення. Він створює:

| Таблиця | Призначення |
|---|---|
| `ota_updates` | Метадані опублікованих OTA-оновлень |
| `ota_update_channels` | Вказівники останнього й активного оновлення |
| `ota_embedded_updates` | Метадані вбудованих нативних оновлень |
| `ota_served_manifest_log` | Зіставлення виданого маніфесту та оновлення |
| `ota_device_state` | Останній відомий стан кожного встановлення |
| `ota_device_transitions` | Історія зміни середовища виконання та оновлень |
| `ota_admin_users` | Адміністратори й ролі |
| `ota_admin_sessions` | Браузерні сесії, які можна відкликати |
| `ota_access_tokens` | Хеші токенів автоматизації |
| `ota_guard_actions` | Каталог дій Guard для повторного використання |
| `ota_emergency_redirects` | Правила аварійного перенаправлення каналів |

Не використовуйте дамп схеми pgAdmin як інсталяційний скрипт. Дампи містять власників і команди сесії, прив’язані до конкретної БД. `schema.sql` містить лише переносну схему застосунку.

## 3. Налаштуйте сервер {#_3-configure-the-server}

До запуску сервера створіть [пару ключів підпису](./expo-app-setup.md#_2-create-the-code-signing-certificate). Нижче вкажіть реальний шлях до приватного ключа, доступний серверу, а відповідний публічний сертифікат збережіть для застосунку.

Рекомендована конфігурація адаптера Supabase:

```env
DATABASE_PROVIDER=supabase
SUPABASE_PROJECT_URL=https://PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_UPDATES_BUCKET=expo-updates

OTA_PUBLIC_BASE_URL=https://updates.example.com
CODE_SIGNING_PRIVATE_KEY_PATH=/run/secrets/code-signing-private-key.pem
```

Використовуйте **ключ service role**, а не анонімний або публічний браузерний ключ. OTA-сервер — довірений бекенд, якому потрібен доступ до всіх керівних таблиць.

Інший варіант — використовувати Supabase лише як розміщений PostgreSQL та об’єктне сховище, а сервер підключити через адаптер PostgreSQL/S3:

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

Використовуйте точний S3 endpoint та облікові дані зі сторінки налаштування S3 у Supabase Storage.

## 4. Створіть бакет сховища {#_4-create-the-storage-bucket}

Створіть закритий бакет `expo-updates` або виберіть іншу назву й укажіть однакове значення в:

```env
SUPABASE_UPDATES_BUCKET=expo-updates
R2_BUCKET=expo-updates
OTA_STORAGE_BUCKET=expo-updates
```

Під час видачі ресурсів через підписані URL бакет має залишатися закритим.

## 5. Створіть першого адміністратора {#_5-create-the-first-administrator}

Локально задайте оточення сервера, потім виконайте:

```bash
npm ci
npm run create-admin
```

Команда записує bcrypt-хеш пароля в `ota_admin_users`. Пароль у відкритому вигляді не зберігається.

## 6. Перевірте встановлення {#_6-verify-the-installation}

Запустіть сервер і перевірте:

```bash
curl -fsS https://updates.example.com/api/health
```

Потім увійдіть за адресою:

```text
https://updates.example.com/login
```

У **Table Editor** мають відображатися всі одинадцять таблиць OTA зі списку вище.

## 7. Оновлення {#_7-upgrades}

Перед оновленням створіть резервну копію БД, потім застосуйте актуальний `docs/migrations/schema.sql`. Схема ідемпотентна й додає відсутні об’єкти. Будь-які майбутні міграції даних або руйнівні зміни, які не можна безпечно виразити в цьому файлі, мають бути явно описані в примітках до релізу.
