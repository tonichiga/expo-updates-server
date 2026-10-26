const repository = "https://github.com/tonichiga/expo-updates-server";

const labels = {
  en: {
    home: "Home", start: "Quick Start", setup: "Setup", initializer: "npm Initializer",
    supabase: "Supabase Setup", expo: "Expo Application Setup", manual: "Manual Hook Integration",
    operations: "Operations Guide", overview: "Overview", configuration: "Configuration",
    policy: "OTA Update Policy", client: "OTA Client Hook", verify: "Fresh App Verification",
    operate: "Operate", doctor: "Setup Diagnostics", telemetry: "Installation Telemetry",
    targeting: "Device Targeting", recovery: "OTA Emergency Recovery", admin: "Admin Panel",
    maintain: "Maintain", publish: "Publish the npm Initializer", language: "Change language",
    outline: "On this page", previous: "Previous page", next: "Next page", updated: "Last updated",
    edit: "Edit this page on GitHub", menu: "Menu", top: "Return to top", skip: "Skip to content",
    appearance: "Appearance", light: "Switch to light theme", dark: "Switch to dark theme",
    license: "Released under the MIT License.", copyright: "Copyright © 2025–present Expo Updates Server contributors",
    notFound: "PAGE NOT FOUND", quote: "This page does not exist or has moved.", back: "Back to home",
    description: "Self-hosted Expo OTA updates with signed manifests, controlled releases, rollback, and emergency recovery.",
  },
  ru: {
    home: "Главная", start: "Быстрый старт", setup: "Настройка", initializer: "Создание проекта через npm",
    supabase: "Настройка Supabase", expo: "Настройка приложения Expo", manual: "Подключение хука вручную",
    operations: "Эксплуатация", overview: "Обзор", configuration: "Конфигурация",
    policy: "Политика OTA-обновлений", client: "Клиентский хук OTA", verify: "Проверка на новом приложении",
    operate: "Эксплуатация", doctor: "Диагностика настройки", telemetry: "Телеметрия установок",
    targeting: "Обновления для выбранных устройств", recovery: "Аварийное восстановление OTA", admin: "Панель управления",
    maintain: "Сопровождение", publish: "Публикация npm-инициализатора", language: "Изменить язык",
    outline: "На этой странице", previous: "Предыдущая страница", next: "Следующая страница", updated: "Обновлено",
    edit: "Редактировать на GitHub", menu: "Меню", top: "Наверх", skip: "К содержимому",
    appearance: "Оформление", light: "Включить светлую тему", dark: "Включить тёмную тему",
    license: "Распространяется по лицензии MIT.", copyright: "© 2025–настоящее время. Участники Expo Updates Server",
    notFound: "СТРАНИЦА НЕ НАЙДЕНА", quote: "Эта страница не существует или была перемещена.", back: "На главную",
    description: "Собственный сервер OTA-обновлений Expo: подписанные манифесты, управляемые релизы, откат и аварийное восстановление.",
  },
  uk: {
    home: "Головна", start: "Швидкий старт", setup: "Налаштування", initializer: "Створення проєкту через npm",
    supabase: "Налаштування Supabase", expo: "Налаштування застосунку Expo", manual: "Підключення хука вручну",
    operations: "Експлуатація", overview: "Огляд", configuration: "Конфігурація",
    policy: "Політика OTA-оновлень", client: "Клієнтський хук OTA", verify: "Перевірка на новому застосунку",
    operate: "Експлуатація", doctor: "Діагностика налаштування", telemetry: "Телеметрія встановлень",
    targeting: "Оновлення для вибраних пристроїв", recovery: "Аварійне відновлення OTA", admin: "Панель керування",
    maintain: "Супровід", publish: "Публікація npm-ініціалізатора", language: "Змінити мову",
    outline: "На цій сторінці", previous: "Попередня сторінка", next: "Наступна сторінка", updated: "Оновлено",
    edit: "Редагувати на GitHub", menu: "Меню", top: "Угору", skip: "До вмісту",
    appearance: "Оформлення", light: "Увімкнути світлу тему", dark: "Увімкнути темну тему",
    license: "Поширюється за ліцензією MIT.", copyright: "© 2025–дотепер. Учасники Expo Updates Server",
    notFound: "СТОРІНКУ НЕ ЗНАЙДЕНО", quote: "Ця сторінка не існує або її переміщено.", back: "На головну",
    description: "Власний сервер OTA-оновлень Expo: підписані маніфести, керовані релізи, відкат та аварійне відновлення.",
  },
};

function localeConfig(locale, label) {
  const text = labels[locale];
  const prefix = locale === "en" ? "/" : `/${locale}/`;
  const item = (key, path) => ({ text: text[key], link: prefix + path });
  return {
    label, lang: locale, description: text.description,
    themeConfig: {
      nav: [item("home", ""), item("start", "getting-started"), {
        text: text.setup, items: [item("initializer", "npm-installer"), item("supabase", "supabase-setup"),
          item("expo", "expo-app-setup"), item("manual", "ota-client-lifecycle#manual-integration")],
      }, item("operations", "operations-guide")],
      sidebar: [
        { text: text.start, items: [item("overview", ""), item("start", "getting-started"), item("initializer", "npm-installer")] },
        { text: text.configuration, items: [item("supabase", "supabase-setup"), item("expo", "expo-app-setup"),
          item("policy", "ota-update-policy"), item("client", "ota-client-lifecycle"),
          item("manual", "ota-client-lifecycle#manual-integration"), item("verify", "expo-app-setup#verify-generation-in-a-fresh-application")] },
        { text: text.operate, items: [item("operations", "operations-guide"), item("doctor", "doctor"),
          item("admin", "admin-ui"), item("telemetry", "installation-telemetry"), item("targeting", "device-targeting"), item("recovery", "ota-emergency-recovery")] },
        { text: text.maintain, items: [item("publish", "publishing-npm-installer")] },
      ],
      outline: { label: text.outline }, docFooter: { prev: text.previous, next: text.next },
      lastUpdated: { text: text.updated, formatOptions: { dateStyle: "medium", timeStyle: "short" } },
      editLink: { pattern: `${repository}/edit/main/docs/:path`, text: text.edit },
      footer: { message: text.license, copyright: text.copyright },
      langMenuLabel: text.language, sidebarMenuLabel: text.menu, returnToTopLabel: text.top,
      skipToContentLabel: text.skip, darkModeSwitchLabel: text.appearance,
      lightModeSwitchTitle: text.light, darkModeSwitchTitle: text.dark,
      notFound: { title: text.notFound, quote: text.quote, linkLabel: text.back, linkText: text.back },
    },
  };
}

export const locales = {
  root: localeConfig("en", "English"),
  ru: localeConfig("ru", "Русский"),
  uk: localeConfig("uk", "Українська"),
};

function searchTranslations(words) {
  const [search, details, reset, back, none, select, navigate, close, enter, up, down, escape] = words;
  return { translations: {
    button: { buttonText: search, buttonAriaLabel: search },
    modal: { displayDetails: details, resetButtonTitle: reset, backButtonTitle: back, noResultsText: none,
      footer: { selectText: select, navigateText: navigate, closeText: close,
        selectKeyAriaLabel: enter, navigateUpKeyAriaLabel: up, navigateDownKeyAriaLabel: down, closeKeyAriaLabel: escape } },
  } };
}
export const searchLocales = {
  ru: searchTranslations(["Поиск", "Показать подробности", "Очистить поиск", "Закрыть поиск", "Ничего не найдено", "выбрать", "перемещение", "закрыть", "Ввод", "Стрелка вверх", "Стрелка вниз", "Escape"]),
  uk: searchTranslations(["Пошук", "Показати подробиці", "Очистити пошук", "Закрити пошук", "Нічого не знайдено", "вибрати", "переміщення", "закрити", "Ввід", "Стрілка вгору", "Стрілка вниз", "Escape"]),
};
