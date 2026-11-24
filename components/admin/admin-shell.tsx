"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useState, type CSSProperties } from "react";
import {
  Boxes,
  ChartNoAxesColumnIncreasing,
  ChevronRight,
  Layers3,
  LogOut,
  Moon,
  RadioTower,
  ShieldAlert,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { adminLogout } from "@/src/client/admin-api";
import { useI18n } from "@/src/client/i18n/provider";
import { LanguageSwitcher } from "@/components/admin/language-switcher";
import { AdminRoleContext } from "@/components/admin/admin-role";
import { Button } from "@/components/ui/button";
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

type Destination = { href: string; label: string; icon: LucideIcon };
const releases = { href: "/updates", label: "Публикации", icon: Layers3 };
const groups = [
  {
    label: "Release workspace",
    links: [
      releases,
      { href: "/updates/embedded", label: "Embedded-сборки", icon: Boxes },
      {
        href: "/updates/emergency-redirects",
        label: "Аварийные маршруты",
        icon: ShieldAlert,
      },
    ],
  },
  {
    label: "Analytics",
    links: [
      {
        href: "/updates/devices",
        label: "Установки",
        icon: ChartNoAxesColumnIncreasing,
      },
    ],
  },
];
const destinations: Destination[] = groups.flatMap((group) => group.links);

function Navigation({ current }: { current: Destination }) {
  const { t } = useI18n();
  const { setOpenMobile } = useSidebar();
  return (
    <nav aria-label={t("Навигация")}>
      {groups.map((group) => (
        <SidebarGroup key={group.label} className="mb-3">
          <SidebarGroupLabel className="h-8 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            {t(group.label)}
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.links.map(({ href, label, icon: Icon }) => (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton
                    asChild
                    isActive={href === current.href}
                    className="min-h-10 gap-3 px-3"
                  >
                    <Link
                      href={href}
                      aria-current={href === current.href ? "page" : undefined}
                      onClick={() => setOpenMobile(false)}
                    >
                      <Icon aria-hidden="true" />
                      <span>{t(label)}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </nav>
  );
}

function ConsoleBrand() {
  const { setOpenMobile } = useSidebar();
  return (
    <Link
      href="/updates"
      onClick={() => setOpenMobile(false)}
      className="flex w-fit items-center gap-3 rounded-md font-semibold tracking-tight text-foreground"
    >
      <span className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground">
        <RadioTower className="size-5" aria-hidden="true" />
      </span>
      OTA Console
    </Link>
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
  const path = usePathname();
  const current = destinations.find(({ href }) => path === href) ?? releases;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setBusy(true);
    setError("");
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
    <SidebarProvider style={{ "--sidebar-width": "15.5rem" } as CSSProperties}>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-card focus:p-3"
      >
        {t("К содержимому")}
      </a>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader className="h-16 justify-center border-b px-5">
          <ConsoleBrand />
        </SidebarHeader>
        <SidebarContent className="p-2 pt-4">
          <Navigation current={current} />
        </SidebarContent>
        <SidebarFooter className="gap-2 border-t p-4">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="grid size-9 shrink-0 place-items-center rounded-lg border bg-muted text-xs font-semibold uppercase text-foreground"
            >
              {session.username.slice(0, 2)}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">
                {session.username}
              </p>
              <p className="text-xs text-muted-foreground">{t(session.role)}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              disabled={busy}
              onClick={logout}
              title={t("Выйти")}
              aria-label={busy ? t("Выход…") : t("Выйти")}
            >
              <LogOut />
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {t(error)}
            </p>
          )}
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="flex min-h-16 items-center justify-between gap-2 border-b px-3 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <SidebarTrigger aria-label={t("Открыть или скрыть навигацию")} />
            <span
              className="mx-1 hidden h-4 w-px bg-border sm:block"
              aria-hidden="true"
            />
            <span className="hidden text-muted-foreground sm:inline">
              OTA Console
            </span>
            <ChevronRight
              className="hidden size-3.5 text-muted-foreground sm:block"
              aria-hidden="true"
            />
            <span className="truncate font-medium">{t(current.label)}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <LanguageSwitcher />
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
        <div
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 outline-none"
        >
          <AdminRoleContext.Provider value={session.role}>
            {children}
          </AdminRoleContext.Provider>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
