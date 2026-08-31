# Набор публичной документации для open-source проекта на GitHub Pages

> **Контекст.** Исследование посвящено open-source проекту, который размещает
> публичный сайт на GitHub Pages и демонстрирует оформленные кейсы / портфолио.
> Все утверждения подкреплены ссылками на первичные источники.
>
> Дата исследования: 2026-08-28

---

## Содержание

1. [Что такое GitHub Pages и как работает публикация](#1-что-такое-github-pages-и-как-работает-публикация)
2. [Обязательная документация](#2-обязательная-документация)
3. [Рекомендуемые файлы сообщества (community health files)](#3-рекомендуемые-файлы-сообщества-community-health-files)
4. [Выбор генератора статических сайтов](#4-выбор-генератора-статических-сайтов)
5. [Лицензия: MIT против Apache-2.0](#5-лицензия-mit-против-apache-20)
6. [Ограничения GitHub Pages](#6-ограничения-github-pages)
7. [Итоговый чеклист](#7-итоговый-чеклист)
8. [Первичные источники](#8-первичные-источники)

---

## 1. Что такое GitHub Pages и как работает публикация

GitHub Pages — **статический хостинг**, который читает HTML/CSS/JS напрямую из
репозитория (или `/docs`-папки), опционально прогоняет файлы через Jekyll-сборку
и публикует сайт в интернет.

Существуют **два типа сайтов** [[1]]:

| Тип | Репозиторий | URL по умолчанию |
|-----|------------|------------------|
| Пользовательский / организация | `<owner>.github.io` | `https://<owner>.github.io` |
| Проектный | Любой репозиторий | `https://<owner>.github.io/<repo>` |

Для портфолио-проекта подходит **пользовательский сайт** (`<owner>.github.io`) —
он живёт на корневом домене и выглядит профессионально.

**Источники публикации** [[2]]:

- Ветка + корень `/` или папка `/docs` — для простых сайтов без кастомного
  CI/CD.
- **GitHub Actions workflow** — рекомендованный путь, если нужен сторонний SSG
  (Hugo, Astro, Next.js static export) или кастомная сборка.

> ⚠️ GitHub Pages сайты **всегда публично доступны** в интернете, даже если
> репозиторий приватный (при соответствующем плане).
> Источник: [docs.github.com — configuring publishing source][2]

---

## 2. Обязательная документация

Ниже — минимальный набор файлов, без которых open-source проект на GitHub Pages
является неполным с точки зрения GitHub Community Standards [[3]].

### 2.1 `README.md`

**Требование:** GitHub отображает `README.md` на главной странице репозитория
автоматически. Без него потенциальные пользователи и контрибьюторы не понимают,
что делает проект.

**Минимальное содержание для портфолио-сайта:**

- Название и короткое описание проекта
- Скриншот или GIF сайта
- Ссылка на живой сайт (`https://<owner>.github.io`)
- Инструкция по локальному запуску (разработка / превью)
- Описание структуры проекта
- Раздел «Contributing» или ссылка на `CONTRIBUTING.md`
- Значки (badges): лицензия, статус сборки, версия Node.js

> **Источник:** GitHub рекомендует README как первый файл в Community profile
> checklist. [[3]]

### 2.2 `LICENSE` (или `LICENSE.md`)

**Требование:** Без файла лицензии «все права сохранены» по умолчанию —
никто не имеет права использовать, копировать или форкать код. GitHub явно
предупреждает: «without a license, the default copyright laws apply, meaning
that you retain all rights to your source code and no one may reproduce,
distribute, or create derivative works from your work.» [[4]]

GitHub распознаёт лицензию автоматически и показывает её в сайдбаре
репозитория. Рекомендуемое расположение — корень репозитория. [[4]]

### 2.3 `CONTRIBUTING.md`

**Требование:** Когда файл присутствует в корне, `/docs` или `.github/`,
GitHub автоматически показывает ссылку на него при открытии нового PR или issue.
Это снижает нагрузку на мейнтейнера.

> «When someone opens a pull request or creates an issue, they will see a link
> to that file.» [[5]]

**Минимальное содержание:**

- Как запустить проект локально
- Как добавить новый кейс / портфолио-карточку
- Стиль коммитов и PR
- Ссылка на `CODE_OF_CONDUCT.md`

---

## 3. Рекомендуемые файлы сообщества (community health files)

GitHub Community Standards checklist [[3]] отмечает следующие файлы:

| Файл | Расположение | Назначение |
|------|-------------|------------|
| `README.md` | Корень | Описание проекта |
| `LICENSE` | Корень | Лицензирование |
| `CONTRIBUTING.md` | Корень / `docs/` / `.github/` | Руководство для контрибьюторов |
| `CODE_OF_CONDUCT.md` | Корень / `docs/` / `.github/` | Нормы поведения в сообществе |
| `SECURITY.md` | Корень / `docs/` / `.github/` | Политика репортинга уязвимостей |

### 3.1 `CODE_OF_CONDUCT.md`

> «A code of conduct defines standards for how to engage in a community. It
> signals an inclusive environment that respects all contributions.» [[6]]

GitHub предоставляет шаблоны (Contributor Covenant, Citizen Code of Conduct).
При использовании шаблона файл будет отмечен в Community profile как выполненный.

### 3.2 `SECURITY.md`

Файл с инструкцией по ответственному раскрытию уязвимостей. GitHub отображает
его в разделе «Security» репозитория.

### 3.3 Issue & PR templates (`.github/ISSUE_TEMPLATE/`, `.github/pull_request_template.md`)

Шаблоны структурируют сообщения об ошибках и запросы на добавление кейсов.
Для портфолио-проекта рекомендуется минимум:

- `bug_report.md`
- `feature_request.md` (или `case_request.md` — добавить новый кейс)

---

## 4. Выбор генератора статических сайтов

### 4.1 Jekyll (нативная поддержка GitHub Pages)

Jekyll — единственный SSG с **встроенной поддержкой** в GitHub Pages без
дополнительного GitHub Actions workflow [[7]]:

> «Jekyll is a static site generator with built-in support for GitHub Pages
> and a simplified build process.» [[7]]

**Плюсы для портфолио:**

- Нулевой конфиг для публикации из ветки `main`
- Темы (minima и другие) работают «из коробки»
- Поддержка Markdown + Liquid-шаблонов
- Коллекции Jekyll идеально подходят для структурирования кейсов

**Конфигурация:** `_config.yml` в корне репозитория. [[7]]

**Ограничение:** Jekyll не поддерживается официально на Windows [[7]]; для CI
используйте GitHub Actions.

**Необходимая документация проекта при Jekyll:**

```
_config.yml       # конфиг сайта (название, описание, тема)
_cases/           # Jekyll-коллекция с кейсами (Markdown-файлы)
_layouts/         # шаблоны страниц
assets/           # CSS, изображения
```

### 4.2 Альтернативы через GitHub Actions

Если Jekyll недостаточен, GitHub Pages официально поддерживает деплой через
**GitHub Actions workflow** для любого SSG [[2]]:

| SSG | Язык | Особенность |
|-----|------|------------|
| Hugo | Go | Высокая скорость сборки |
| Astro | JS/TS | Контент-коллекции, Islands |
| Next.js (`output: 'export'`) | React | Знакомый стек |
| Docusaurus | React | Ориентирован на документацию |

При использовании GitHub Actions файл лицензии и README остаются теми же — меняется
лишь конфигурация воркфлоу (`.github/workflows/deploy.yml`).

---

## 5. Лицензия: MIT против Apache-2.0

### 5.1 Юридический текст и SPDX-идентификаторы

| Лицензия | SPDX ID | Официальная страница OSI |
|----------|---------|--------------------------|
| MIT License | `MIT` | https://opensource.org/license/mit |
| Apache License 2.0 | `Apache-2.0` | https://opensource.org/license/apache-2-0 |

Оба идентификатора включены в реестр SPDX [[8], [9]] и признаны OSI как
«open source licenses».

### 5.2 Сравнительная таблица (по данным choosealicense.com [[10], [11]])

| Критерий | MIT | Apache-2.0 |
|----------|-----|------------|
| **Коммерческое использование** | ✅ | ✅ |
| **Распространение** | ✅ | ✅ |
| **Модификация** | ✅ | ✅ |
| **Приватное использование** | ✅ | ✅ |
| **Явная патентная лицензия** | ❌ | ✅ — Section 3 [[12]] |
| **Сохранение уведомлений об изменениях** | ❌ | ✅ — «must cause any modified files to carry prominent notices» |
| **Требование сохранить `NOTICE`-файл** | ❌ | ✅ |
| **Ограничение использования товарных знаков** | ❌ (явно не оговорено) | ✅ — явный запрет |
| **Размер текста лицензии** | ~170 слов | ~1 750 слов |
| **Условие включить текст лицензии** | ✅ | ✅ |

### 5.3 Ключевые различия

#### Патентная защита
Apache-2.0 содержит **явную patent grant** (Section 3):

> «each Contributor hereby grants to You a perpetual, worldwide,
> non-exclusive, no-charge, royalty-free, irrevocable … patent license
> to make, have made, use, offer to sell, sell, import, and otherwise
> transfer the Work» [[12]]

MIT не содержит явного патентного разрешения. Для **портфолио-сайта без
патентоспособных изобретений** это различие непринципиально.

#### Условие уведомления об изменениях («State changes»)
Apache-2.0 требует, чтобы модифицированные файлы содержали явное указание
на изменение. Это увеличивает административную нагрузку на контрибьюторов. [[12]]

#### `NOTICE`-файл
Если Apache-2.0 проект содержит `NOTICE`-файл, все производные работы обязаны
его воспроизводить. [[12]]

#### Совместимость с другими лицензиями
MIT совместима практически с любой open-source лицензией. Apache-2.0
**несовместима с GPLv2** (совместима с GPLv3). Для портфолио-сайта это редко
актуально, но стоит учесть, если вы хотите интегрировать GPLv2-компоненты.

### 5.4 Рекомендация

> **Рекомендуется MIT License.**

**Обоснование:**

1. **Простота и минимализм.** MIT — один из самых коротких и понятных текстов;
   пользователи и контрибьюторы не боятся читать его. [[10]]

2. **Нет избыточных требований.** Портфолио-сайт не содержит патентоспособных
   изобретений и не требует защиты от патентных троллей. Явная patent grant
   Apache-2.0 не даёт дополнительных преимуществ.

3. **Нет `NOTICE`-файла.** Apache-2.0 вводит обязательство передавать
   `NOTICE`-файл во всех форках — для небольшого open-source портфолио это
   лишняя административная нагрузка.

4. **Широкое принятие.** MIT — самая популярная лицензия на GitHub по данным
   GitHub. [[4]]

5. **Полная совместимость.** MIT совместима со всеми популярными
   open-source лицензиями, что облегчит интеграцию сторонних тем и компонентов.

**Когда стоит выбрать Apache-2.0 вместо MIT:**
- Если в команде есть корпоративные юристы, которые требуют явной patent grant
- Если код содержит запатентованные алгоритмы
- Если корпоративный бренд нужно защитить через явный trademark disclaimer

---

## 6. Ограничения GitHub Pages

Важно задокументировать в README или в разделе «Deployment» проекта: [[13]]

| Параметр | Значение |
|----------|----------|
| Максимальный размер репозитория | 1 ГБ (рекомендуется) |
| Максимальный размер опубликованного сайта | 1 ГБ |
| Полоса пропускания (soft limit) | 100 ГБ/месяц |
| Лимит сборок (без GitHub Actions) | 10 сборок/час |
| Таймаут деплоя | 10 минут |
| Коммерческое использование | **Запрещено** |

> «GitHub Pages is not intended for or allowed to be used as a free
> web-hosting service to run your online business, e-commerce site, or any
> other website that is primarily directed at either facilitating commercial
> transactions.» [[13]]

Портфолио-сайт с кейсами (некоммерческий) **удовлетворяет** условиям GitHub Pages.

---

## 7. Итоговый чеклист

### Файлы в репозитории

```
/
├── README.md                    # Описание, скриншот, ссылка на сайт, локальный запуск
├── LICENSE                      # MIT License (рекомендуется)
├── CONTRIBUTING.md              # Как добавить кейс, стиль кода
├── CODE_OF_CONDUCT.md           # Contributor Covenant или аналог
├── SECURITY.md                  # Ответственное раскрытие уязвимостей
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── case_request.md
│   └── pull_request_template.md
├── _config.yml                  # (Jekyll) или конфиг выбранного SSG
└── docs/                        # Техническая документация проекта
```

### Страницы самого GitHub Pages сайта

| Страница | Назначение |
|----------|-----------|
| `/` (Главная) | Обзор, hero-section, ссылки на кейсы |
| `/cases/` | Список всех кейсов |
| `/cases/<slug>/` | Детальная страница кейса |
| `/about/` | Информация об авторе / команде |
| `404.html` | Кастомная страница ошибки (GitHub Pages читает `404.html` автоматически) |

### Настройки репозитория

- [ ] GitHub Pages включён (Settings → Pages → Source)
- [ ] Выбрана правильная ветка / папка или GitHub Actions workflow
- [ ] (Опционально) Кастомный домен настроен в `CNAME`-файле
- [ ] Репозиторий публичный
- [ ] Community profile checklist заполнен (Insights → Community)

---

## 8. Первичные источники

| # | Источник | URL |
|---|----------|-----|
| [1] | GitHub Docs — What is GitHub Pages? | https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages |
| [2] | GitHub Docs — Configuring a publishing source | https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site |
| [3] | GitHub Docs — About community profiles for public repositories | https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/about-community-profiles-for-public-repositories |
| [4] | GitHub Docs — Licensing a repository | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository |
| [5] | GitHub Docs — Setting guidelines for repository contributors | https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/setting-guidelines-for-repository-contributors |
| [6] | GitHub Docs — Adding a code of conduct to your project | https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/adding-a-code-of-conduct-to-your-project |
| [7] | GitHub Docs — About GitHub Pages and Jekyll | https://docs.github.com/en/pages/setting-up-a-github-pages-site-with-jekyll/about-github-pages-and-jekyll |
| [8] | SPDX — MIT License | https://spdx.org/licenses/MIT.html |
| [9] | SPDX — Apache License 2.0 | https://spdx.org/licenses/Apache-2.0.html |
| [10] | choosealicense.com — MIT | https://choosealicense.com/licenses/mit/ |
| [11] | choosealicense.com — Apache-2.0 | https://choosealicense.com/licenses/apache-2.0/ |
| [12] | OSI — Apache License 2.0 (полный текст) | https://opensource.org/license/apache-2-0 |
| [13] | GitHub Docs — GitHub Pages limits | https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits |
| [14] | Jekyll Docs — Quickstart | https://jekyllrb.com/docs/ |
