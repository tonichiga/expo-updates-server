"use client";
import { LanguageSwitcher } from "@/components/admin/language-switcher";
import { useI18n } from "@/src/client/i18n/provider";

import { ArrowRight, RadioTower } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminLogin } from "@/src/client/admin-api";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      await adminLogin(username, password);
      router.replace("/updates");
    } catch (submitError: unknown) {
      setError((submitError as Error).message || "Ошибка входа");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-svh flex-col bg-background">
      <header className="flex items-center justify-between gap-4 border-b px-5 py-3 md:px-8">
        <div className="flex items-center gap-2.5 font-semibold tracking-tight">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <RadioTower aria-hidden="true" className="size-[18px]" />
          </span>
          OTA Console
        </div>
        <LanguageSwitcher />
      </header>
      <div className="grid flex-1 place-items-center px-4 py-12">
        <Card className="w-full max-w-sm gap-5">
          <CardHeader>
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("Войти")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("Вход в панель управления обновлениями")}
            </p>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={handleSubmit}
              className="grid gap-4"
              aria-busy={loading}
            >
              <label className="grid gap-2 text-sm font-medium">
                {t("Логин")}
                <Input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  name="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
              </label>
              <label className="grid gap-2 text-sm font-medium">
                {t("Пароль")}
                <Input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  name="password"
                  required
                />
              </label>
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{t(error)}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" disabled={loading} className="mt-1 w-full">
                {loading ? t("Вход...") : t("Войти")}{" "}
                <ArrowRight aria-hidden="true" />
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
