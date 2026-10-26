---
layout: home
hero:
  name: Expo Updates Server
  text: Знайте, що запущено.<br>Вибирайте, хто оновиться.
  tagline: Підписані OTA-оновлення, аналітика встановлень і вибір пристроїв для застосунків Expo. Усе на вашій інфраструктурі.
  actions:
    - theme: brand
      text: Швидкий старт
      link: /uk/getting-started
    - theme: alt
      text: Створити проєкт через NPX
      link: /uk/npm-installer
    - theme: alt
      text: Відкрити GitHub
      link: https://github.com/tonichiga/expo-updates-server
features:
  - icon: 🚀
    title: Керовані OTA-релізи
    details: Публікуйте неактивні оновлення, перевіряйте runtime, канал і платформу, потім активуйте за готовністю.
  - icon: 🔐
    title: Підписані маніфести
    details: Видавайте сумісні з Expo маніфести, захищені власною парою RSA-ключів підпису коду.
  - icon: ↩️
    title: Відкат і повернення до останнього
    details: Під час інциденту закріпіть канал за перевіреним оновленням і відновіть останній реліз після відновлення.
  - icon: 🛟
    title: Аварійні маршрути
    details: Відновіть конкретну вбудовану збірку з помилковим нативним каналом, не перенаправляючи весь runtime.
  - icon: 🗄️
    title: Гнучка інфраструктура
    details: Використовуйте PostgreSQL із S3-сумісним сховищем, Supabase або повний локальний стек Docker і MinIO.
  - icon: 👥
    title: Усе для операторів
    details: Керуйте ролями, токенами автоматизації з обмеженими правами, вбудованими збірками й історією релізів з адмінки.
---

## Від файлів проєкту до першого OTA {#from-project-files-to-the-first-ota}

Почніть зі [швидкого старту](/uk/getting-started). Він охоплює створення проєкту, Docker, ключі підпису, налаштування адміністратора, підключення застосунку Expo, встановлення нативного релізу й публікацію першого OTA.

[npm-ініціалізатор](/uk/npm-installer) створює файли сервера; це також початкова точка для Docker або [розміщеної інфраструктури Supabase](/uk/supabase-setup).

Сервер уже працює? Перейдіть до [налаштування застосунку Expo](/uk/expo-app-setup). Для непідтримуваної структури застосунку див. [ручне підключення клієнта](/uk/ota-client-lifecycle#manual-integration). Для розгортання, резервного копіювання та відновлення використовуйте [посібник з експлуатації](/uk/operations-guide).

## Дії з проєктом {#project-actions}

- [Відкрити репозиторій GitHub](https://github.com/tonichiga/expo-updates-server)
- [Повідомити про помилку](https://github.com/tonichiga/expo-updates-server/issues/new)
- [Поліпшити документацію](https://github.com/tonichiga/expo-updates-server/edit/main/docs/uk/index.md)
