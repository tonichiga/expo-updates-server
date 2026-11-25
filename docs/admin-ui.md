# Admin panel {#панель-управления}

The admin panel uses a shared shadcn/ui (Radix) UI kit, Tailwind CSS 4, Lucide and Recharts. Component sources live in `components/ui`, the theme in `app/globals.css`, and the shell in `components/admin`. Light and dark themes share semantic tokens. New pages must use these components and tokens while preserving server-side session validation in `app/updates/layout.tsx`.

## Navigation and data {#навигация-и-данные}

- **Releases** (`/updates`) opens after sign-in. Search all releases by ID, comment, channel or version. Combine platform, channel, runtime, status and audience filters before paging. Open a release to review its delivery scope, edit the audience and policy, activate, roll back or promote. Metadata has its own tab. The global distribution switch appears above the list.
- **Installations** (`/updates/devices`) has Overview, Versions, Cohorts and Registry tabs. Shared filters apply across tabs. Daily values distinguish missing history, zero activity and a partial UTC day. Version shares use the installations in each displayed platform and channel.
- **Embedded builds** and **Emergency redirects** retain the existing role restrictions and management actions.

Changing a selection or resetting filters updates results immediately. Text search updates after a short pause in typing. A failed request keeps the previous result with an explicit message. If the last page disappears after a refresh, the registry moves to the last available page. Analytics count installations, not unique people.

For daily data, cohort and retention semantics and database migration, see [installation telemetry](./installation-telemetry.md). Existing databases require `2026-10-22-device-analytics.sql`; new databases receive it from the canonical `schema.sql`.

Publication creates an inactive draft. Choose an audience and a delivery policy before manually activating the release. In **Selected devices**, save an installation or device to your personal favorites to reuse it for smoke tests. **Public delivery** shows current and previous public releases for each runtime, channel and platform. Restore requires confirmation. On an existing database, apply `2026-11-25-device-favorites.sql` and `2026-11-25-public-distribution-history.sql` after the device-targeting migrations. Public history starts with the current public release at installation. Older activation dates and predecessors are unknown.

## Interface verification {#проверка-интерфеиса}

When making changes, check 1440px and 390px widths, both themes, empty filter results and reset, expanding and copying IDs, keyboard dismissal of side panels with focus restoration, pagination retry after failure, and a shrinking last page. Tables may scroll within their cards; the whole page should not scroll horizontally. Never replace history before collection with zeroes or demo data.

Verification commands: `npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run build`, `npm run installer:check`. New UI directories are included in the npm initializer template, so generated installations receive the same interface.

## Interface language {#interface-language}

The admin panel defaults to English regardless of browser language. Select **English**, **Русский** or **Українська** on the sign-in screen or in the header. The choice persists in the `ota-locale` cookie for a year and is applied on the server on the next load. Unknown locale values fall back to English.

Switching languages preserves filters and unsaved form data, and immediately translates existing notifications. Numbers and dates follow the selected locale. Analytics date boundaries remain UTC. All admin screens, including emergency recovery, delivery policies and the Guard catalog, use the same language.

Translations live in `src/client/i18n/`: `en.json`, `ru.json` and `uk.json` must have identical keys and interpolation slots. Existing keys are Russian or English source messages; English equivalents are also accepted for API errors and labels. Use `useI18n().t` for interface text and `useFormatters()` for analytics. Store notifications as a source key or a `TranslationMessage` with interpolation values, and translate when rendering so they follow language changes.

Translate enum display labels while preserving their API values. Do not translate IDs, JSON, device or channel names, or user-written messages. Unknown technical errors are displayed verbatim. Catalog and switching tests cover completeness, interpolation, saved preferences, forms and notifications. Adding a language requires an explicit supported value, catalog and selector option; browser language deliberately does not determine the default.
