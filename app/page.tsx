import { getAdminSessionFromServerCookies } from "@/src/server/lib/admin-auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await getAdminSessionFromServerCookies();

  if (session) {
    redirect("/updates");
  }

  redirect("/login");
}
