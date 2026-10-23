"use client";
import { useI18n } from "@/src/client/i18n/provider";

import { adminLogout } from "@/src/client/admin-api";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LogoutButton() {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogout = async () => {
    setIsLoading(true);
    try {
      await adminLogout();
      router.replace("/login");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isLoading}
      className="rounded-md border border-zinc-300 px-4 py-4 text-sm hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-900"
    >
      {isLoading ? t("Выход...") : t("Выйти")}
    </button>
  );
}
