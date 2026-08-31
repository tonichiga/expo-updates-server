import {
  createAdminSession,
  getSessionCookieMaxAge,
  getSessionCookieName,
  validateAdminCredentials,
} from "@/src/server/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const username =
    typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  try {
    const user = await validateAdminCredentials(username, password);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }

    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: getSessionCookieName(),
      value: await createAdminSession(user),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: getSessionCookieMaxAge(),
    });

    return response;
  } catch (error: unknown) {
    console.error("Admin login failed:", error);
    return NextResponse.json(
      { error: "Login is temporarily unavailable" },
      { status: 500 },
    );
  }
}
