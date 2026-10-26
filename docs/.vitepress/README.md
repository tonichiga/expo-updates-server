# Documentation languages

The public documentation has three parallel sets of pages: English in `docs/`,
Russian in `docs/ru/`, and Ukrainian in `docs/uk/`. Internal research and the
analytics implementation plan remain excluded from the site.

When adding or changing a page, update all three versions. Preserve executable
code examples and API identifiers. Give translated headings explicit IDs matching
the English page (`## Перевод {#original-section}`), so VitePress's language menu
can keep both the current page and its section. Emergency recovery and admin UI
retain their original Russian anchor IDs for compatibility with existing links.

Use relative links between guide pages and locale-prefixed absolute links for
home-page actions. Navigation, theme UI, and search labels live in `locales.mjs`;
home-page showcase captions live in `theme/showcase-locales.mjs`. The Markdown
plugin localizes code-copy and permalink labels by each page's path.

The former `getting-started.ru` URL redirects to `/ru/getting-started` and is
excluded from search. The npm initializer's template policy includes both
translated directories so its bundled guides keep working.

Run `npm run docs:test` to check page coverage, matching heading IDs, unchanged
code examples, content/navigation links, and localized controls. Run
`npm run docs:build` to verify the production site and local search indexes.
