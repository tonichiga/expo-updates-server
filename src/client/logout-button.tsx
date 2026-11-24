"use client";
import { Button } from "@/components/ui/button";
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
    <Button variant="outline"
      type="button"
      onClick={handleLogout}
      disabled={isLoading}
    >
      {isLoading ? t("Выход...") : t("Выйти")}
    </Button>
  );
}
