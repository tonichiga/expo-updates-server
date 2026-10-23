import { getAdminSessionFromServerCookies } from "@/src/server/lib/admin-auth";
import { AdminShell } from "@/components/admin/admin-shell";
import { redirect } from "next/navigation";

export default async function UpdatesLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getAdminSessionFromServerCookies();

  if (!session) {
    redirect("/login");
  }

  return (
    <AdminShell session={{ username: session.username, role: session.role }}>
      {children}
    </AdminShell>
  );
}
