import { getAdminSessionFromServerCookies } from "@/src/server/lib/admin-auth";
import { redirect } from "next/navigation";

export default async function UpdatesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getAdminSessionFromServerCookies();

  if (!session) {
    redirect("/login");
  }

  return <>{children}</>;
}
