---
layout: home
hero:
  name: Expo Updates Server
  text: Знайте, что запущено.<br>Выбирайте, кто обновится.
  tagline: Подписанные OTA-обновления, аналитика установок и выбор устройств для приложений Expo. Всё на вашей инфраструктуре.
  actions:
    - theme: brand
      text: Быстрый старт
      link: /ru/getting-started
    - theme: alt
      text: Создать проект через NPX
      link: /ru/npm-installer
    - theme: alt
      text: Открыть GitHub
      link: https://github.com/tonichiga/expo-updates-server
features:
  - icon: 🚀
    title: Управляемые OTA-релизы
    details: Публикуйте неактивные обновления, проверяйте runtime, канал и платформу, затем активируйте по готовности.
  - icon: 🔐
    title: Подписанные манифесты
    details: Выдавайте совместимые с Expo манифесты, защищённые собственной парой RSA-ключей подписи кода.
  - icon: ↩️
    title: Откат и возврат к последнему
    details: Во время инцидента закрепите канал за проверенным обновлением и возобновите последний релиз после восстановления.
  - icon: 🛟
    title: Аварийные маршруты
    details: Восстановите конкретную встроенную сборку с ошибочным нативным каналом, не перенаправляя весь runtime.
  - icon: 🗄️
    title: Гибкая инфраструктура
    details: Используйте PostgreSQL с S3-совместимым хранилищем, Supabase или полный локальный стек Docker и MinIO.
  - icon: 👥
    title: Всё для операторов
    details: Управляйте ролями, токенами автоматизации с ограниченными правами, встроенными сборками и историей релизов из админки.
---

## От файлов проекта до первого OTA {#from-project-files-to-the-first-ota}

Начните с [быстрого старта](/ru/getting-started). Он охватывает создание проекта, Docker, ключи подписи, настройку администратора, подключение приложения Expo, установку нативного релиза и публикацию первого OTA.

[npm-инициализатор](/ru/npm-installer) создаёт файлы сервера; это также отправная точка для Docker или [размещённой инфраструктуры Supabase](/ru/supabase-setup).

Сервер уже работает? Перейдите к [настройке приложения Expo](/ru/expo-app-setup). Для неподдерживаемой структуры приложения см. [ручное подключение клиента](/ru/ota-client-lifecycle#manual-integration). Для развёртывания, резервного копирования и восстановления используйте [руководство по эксплуатации](/ru/operations-guide).

## Действия с проектом {#project-actions}

- [Открыть репозиторий GitHub](https://github.com/tonichiga/expo-updates-server)
- [Сообщить об ошибке](https://github.com/tonichiga/expo-updates-server/issues/new)
- [Улучшить документацию](https://github.com/tonichiga/expo-updates-server/edit/main/docs/ru/index.md)
