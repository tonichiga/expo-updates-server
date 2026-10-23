import { h } from "vue";
import DefaultTheme from "vitepress/theme";
import AdminShowcase from "./components/AdminShowcase.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      "home-hero-after": () => h(AdminShowcase),
    });
  },
};
