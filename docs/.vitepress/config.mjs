import { defineConfig } from "vitepress";
import { locales, searchLocales } from "./locales.mjs";
import { localizeMarkdown } from "./markdown-i18n.mjs";

export default defineConfig({
  base: "/expo-updates-server/",
  title: "Expo Updates Server",
  lang: "en",
  locales,
  lastUpdated: true,
  cleanUrls: true,
  srcExclude: ["analytics-implementation-plan.md", "research/**"],
  markdown: { languageAlias: { env: "dotenv" }, config: localizeMarkdown },
  head: [["meta", { name: "theme-color", content: "#635bff" }]],
  themeConfig: {
    socialLinks: [{ icon: "github", link: "https://github.com/tonichiga/expo-updates-server" }],
    search: { provider: "local", options: { locales: searchLocales } },
  },
});
