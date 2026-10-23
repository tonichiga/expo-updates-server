"use client";
import { ThemeProvider as Provider } from "next-themes";
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <Provider
      attribute="class"
      defaultTheme="dark"
      storageKey="ota-console-theme"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </Provider>
  );
}
