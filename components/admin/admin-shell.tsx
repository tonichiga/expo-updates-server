"use client";
import { LanguageSwitcher } from "@/components/admin/language-switcher";
import { useI18n } from "@/src/client/i18n/provider";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState, type CSSProperties } from "react";
import {
  Activity,
  ArrowUpToLine,
  Boxes,
  ShieldAlert,
  Smartphone,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";
import { adminLogout } from "@/src/client/admin-api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
function Navigation() {
  const { t } = useI18n();
  const navigation = [
    { href: "/updates/devices", label: t("Установки"), icon: Smartphone },
    { href: "/updates", label: t("OTA-обновления"), icon: ArrowUpToLine },
    { href: "/updates/embedded", label: t("Embedded-сборки"), icon: Boxes },
    {
      href: "/updates/emergency-redirects",
      label: t("Аварийные маршруты"),
      icon: ShieldAlert,
    },
  ];

  const path = usePathname();
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      {navigation.map(({ href, label, icon: Icon }) => (
        <SidebarMenuItem key={href}>
          <SidebarMenuButton
            asChild
            isActive={
              href === "/updates"
                ? path === href ||
                  !navigation
                    .slice(0, 1)
                    .concat(navigation.slice(2))
                    .some((n) => path.startsWith(n.href))
                : path.startsWith(href)
            }
            tooltip={label}
          >
            <Link href={href} onClick={() => setOpenMobile(false)}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ))}
    </SidebarMenu>
  );
}
export function AdminShell({
  children,
  session,
}: {
  children: React.ReactNode;
  session: { username: string; role: string };
}) {
  const { t } = useI18n();
  const { resolvedTheme, setTheme } = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setBusy(true);
    try {
      await adminLogout();
      router.replace("/login");
    } catch {
      setError("Не удалось выйти. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <SidebarProvider
      style={{ "--sidebar-width": "14rem" } as CSSProperties}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-card focus:p-3"
      >
        {t("К содержимому")}
      </a>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader className="h-20 justify-center border-b px-5">
          <Link
            href="/updates/devices"
            className="flex items-center gap-3 font-semibold text-foreground"
          >
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Activity className="size-5" />
            </span>
            <span>
              OTA Console
              <span className="block text-[10px] font-medium uppercase tracking-[.18em] text-muted-foreground">
                {t("Release workspace")}
              </span>
            </span>
          </Link>
        </SidebarHeader>
        <SidebarContent className="p-2">
          <SidebarGroup>
            <SidebarGroupLabel>{t("Управление")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <Navigation />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter className="gap-3 border-t p-4">
          <div className="flex items-center gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-semibold uppercase">
              {session.username.slice(0, 2)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">
                {session.username}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(session.role)}
              </p>
            </div>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {t(error)}
            </p>
          )}
          <Button
            variant="ghost"
            className="justify-start"
            disabled={busy}
            onClick={logout}
          >
            <LogOut />
            {busy ? t("Выход…") : t("Выйти")}
          </Button>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0 bg-background">
        <header className="flex h-16 shrink-0 items-center justify-between gap-4 border-b bg-card/80 px-4 md:px-8">
          <div className="flex items-center gap-3">
            <SidebarTrigger
              aria-label={t("Открыть или скрыть навигацию")}
            />
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {t("Управление обновлениями")}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <Badge variant="outline" className="hidden sm:inline-flex">
              Expo OTA
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("Переключить светлую и тёмную тему")}
              onClick={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
            >
              <Moon className="dark:hidden" />
              <Sun className="hidden dark:block" />
            </Button>
          </div>
        </header>
        <div id="main-content" className="min-w-0 flex-1">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
