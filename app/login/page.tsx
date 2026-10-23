"use client";
import { LanguageSwitcher } from "@/components/admin/language-switcher";
import { useI18n } from "@/src/client/i18n/provider";

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
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="absolute right-4 top-4">
        <LanguageSwitcher />
      </div>
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-sm"
      >
        <h1 className="text-2xl font-semibold">OTA Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Вход в панель управления обновлениями")}
        </p>

        <div className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1 block text-sm">{t("Логин")}</span>
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}

              autoComplete="username"
              required
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm">{t("Пароль")}</span>
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}

              autoComplete="current-password"
              required
            />
          </label>
        </div>

        {error ? <p className="mt-4 text-sm text-red-600">{t(error)}</p> : null}

        <Button type="submit" disabled={loading} className="mt-6 w-full">
          {loading ? t("Вход...") : t("Войти")}
        </Button>
      </form>
    </main>
  );
}
