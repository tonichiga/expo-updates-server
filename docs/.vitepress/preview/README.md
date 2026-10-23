# Refresh the admin screenshots

The home-page carousel uses real admin UI with synthetic API responses from
`fixtures.mjs`. No fixture is inserted into a database. The capture signs in to an
explicit local test server, intercepts every browser API request, rejects writes
and unmocked endpoints, and replaces the visible test operator name/avatar.

Use an existing Playwright installation (optional maintainer dependency):

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs \
OTA_PREVIEW_BROWSER=/absolute/path/to/chromium \
OTA_PREVIEW_URL=http://localhost:3100 \
OTA_PREVIEW_ENV=.env.ota-test \
node docs/.vitepress/preview/capture.mjs
```

If Playwright is already resolvable and its Chromium installed, omit the first two
variables. The explicitly selected env file must contain `OTA_TEST_ADMIN_USER` and
`OTA_TEST_ADMIN_PASSWORD`; credentials are never logged. The generated JPEGs are
written to `docs/public/screenshots/`. Keep viewport dimensions in capture and
`AdminShowcase.vue` aligned. Inspect all four images before committing.

Run `npm run docs:build` after recapturing. Restart `docs:preview` after rebuilding
because its static asset metadata can remain cached. Verify all tabs, arrow-key
navigation, full-size image links, light/dark themes and a 320px-wide viewport.
The capture script and fixtures are documentation tooling and are excluded from
the npm initializer along with the VitePress theme.
