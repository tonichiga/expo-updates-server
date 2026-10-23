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
          { text: "npm Initializer", link: "/npm-installer" },
          { text: "Supabase", link: "/supabase-setup" },
          { text: "Expo Application", link: "/expo-app-setup" },
          { text: "Manual Hook Integration", link: "/ota-client-lifecycle#manual-integration" },
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
          { text: "npm Initializer", link: "/npm-installer" },
        ],
      },
      {
        text: "Configuration",
        items: [
          { text: "Supabase Setup", link: "/supabase-setup" },
          { text: "Expo Application Setup", link: "/expo-app-setup" },
          { text: "OTA Update Policy", link: "/ota-update-policy" },
          { text: "OTA Client Hook", link: "/ota-client-lifecycle" },
          { text: "Manual Hook Integration", link: "/ota-client-lifecycle#manual-integration" },
          { text: "Fresh App Verification", link: "/expo-app-setup#verify-generation-in-a-fresh-application" },
        ],
      },
      {
        text: "Operate",
        items: [
          { text: "Operations Guide", link: "/operations-guide" },
          { text: "Setup Diagnostics", link: "/doctor" },
          { text: "Installation Telemetry", link: "/installation-telemetry" },
          { text: "Device targeting", link: "/device-targeting" },
          {
            text: "OTA Emergency Recovery",
            link: "/ota-emergency-recovery",
          },
        ],
      },
      {
        text: "Maintain",
        items: [
          {
            text: "Publish the npm Initializer",
            link: "/publishing-npm-installer",
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
