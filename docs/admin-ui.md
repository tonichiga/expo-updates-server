# Панель управления

Админка использует общий UI kit shadcn/ui (Radix), Tailwind CSS 4, Lucide и Recharts. Исходники компонентов находятся в `components/ui`, тема — в `app/globals.css`, оболочка — в `components/admin`. Светлая и тёмная темы используют одни семантические токены. Новые страницы должны использовать эти компоненты и токены, сохраняя серверную проверку сессии в `app/updates/layout.tsx`.

## Навигация и данные

- **Установки** (`/updates/devices`): общие серверные фильтры, KPI, дневная активность, распределение версий, когорты и реестр. Часть Installation ID можно использовать для поиска конкретной установки. Полные идентификаторы и диагностика доступны по нажатию на ID.
- **OTA-обновления** (`/updates`): список публикаций, сортировка, пагинация и переход к редактированию. Аварийная остановка распространения находится в раскрываемой панели «Управление».
- **Embedded-сборки** и **Аварийные маршруты** сохраняют существующие ограничения по ролям и действия управления.

Фильтры применяются кнопкой «Применить» ко всей выборке. Ошибка запроса оставляет предыдущий результат с явным сообщением. Если последняя страница исчезла при обновлении, реестр переходит на последнюю существующую страницу. Статистика считает установки, а не уникальных людей.

Подробная семантика дневных данных, когорт, возвращаемости и миграция существующей базы: [Телеметрия установок](./installation-telemetry.md). Для существующей базы нужна миграция `2026-10-22-device-analytics.sql`; новая база получает её из канонического `schema.sql`.

## Проверка интерфейса

При изменениях проверяйте ширины 1440 и 390 px, обе темы, фильтры с пустым результатом, сброс фильтров, раскрытие и копирование ID, клавиатурное закрытие боковых панелей с возвратом фокуса, повтор пагинации после ошибки и уменьшение числа записей на последней странице. Таблицы могут прокручиваться внутри карточки; горизонтальная прокрутка всей страницы не нужна. Историю до начала сбора нельзя заменять нулями или демонстрационными данными.

Команды проверки: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`, `npm run installer:check`. Новые папки UI включены в шаблон npm-инсталлятора, поэтому панель получает тот же интерфейс при установке из коробки.

## Interface language

The admin panel defaults to English, including when the browser prefers another
language. Select **English** or **Русский** on the sign-in screen or in the admin
header. The choice persists in the `ota-locale` cookie for one year and is applied
on the server for the next page load. Unknown locale values fall back to English.
Switching languages preserves filters and unsaved form data; number/date formatting
follows the selected locale. Analytics date boundaries remain UTC.

UI translations live in `src/client/i18n/`. Russian source messages are catalog keys
and `en.json` supplies their English equivalents. Use `useI18n().t` for interface
copy and `useFormatters()` for analytics values. Keep interpolation slots intact.
Do not translate API enum values, IDs, JSON, device names or user-written messages.
Adding a language requires an explicit supported locale, catalog and selector option;
browser language detection is deliberately not used for the default.
