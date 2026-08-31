import { defineConfig } from "vitepress";

const repository = "https://github.com/tonichiga/expo-updates-server";

export default defineConfig({
  base: "/expo-updates-server/",
  title: "Expo Updates Server",
  description:
    "Self-hosted Expo OTA updates with signed manifests, controlled releases, rollback, and emergency recovery.",
  lastUpdated: true,
  cleanUrls: true,
  srcExclude: ["analytics-implementation-plan.md", "research/**"],
  markdown: {
    languageAlias: {
      env: "dotenv",
    },
  },
  head: [["meta", { name: "theme-color", content: "#635bff" }]],
  themeConfig: {
    nav: [
      { text: "Home", link: "/" },
      {
        text: "Quick Start",
        items: [
          { text: "English", link: "/getting-started" },
          { text: "Русский", link: "/getting-started.ru" },
        ],
      },
      {
        text: "Setup",
        items: [
          { text: "Supabase", link: "/supabase-setup" },
          { text: "Expo Application", link: "/expo-app-setup" },
        ],
      },
      { text: "Operations", link: "/operations-guide" },
    ],
    sidebar: [
      {
        text: "Get started",
        items: [
          { text: "Overview", link: "/" },
          { text: "Quick Start", link: "/getting-started" },
          { text: "Быстрый старт", link: "/getting-started.ru" },
        ],
      },
      {
        text: "Configuration",
        items: [
          { text: "Supabase Setup", link: "/supabase-setup" },
          { text: "Expo Application Setup", link: "/expo-app-setup" },
        ],
      },
      {
        text: "Operate",
        items: [
          { text: "Operations Guide", link: "/operations-guide" },
          {
            text: "OTA Emergency Recovery",
            link: "/ota-emergency-recovery",
          },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: repository }],
    search: {
      provider: "local",
    },
    editLink: {
      pattern: `${repository}/edit/main/docs/:path`,
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2025-present Expo Updates Server contributors",
    },
  },
});
