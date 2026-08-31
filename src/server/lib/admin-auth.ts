import { compare } from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { supabase } from "./supabase.js";

export type AdminRole = "admin" | "operator" | "viewer";

export type AdminSession = {
  id: string;
  username: string;
  role: AdminRole;
};

type AdminUserRow = {
  id: string;
  username: string;
  password_hash: string;
  role: AdminRole;
  is_active: boolean;
};

type AdminSessionRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at: string | null;
};

const SESSION_COOKIE_NAME = "ota_admin_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

async function getActiveUserById(id: string): Promise<AdminUserRow | null> {
  const { data, error } = await supabase
    .from("ota_admin_users")
    .select("id,username,password_hash,role,is_active")
    .eq("id", id)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load admin user: ${error.message}`);
  }

  return (data as AdminUserRow | null) || null;
}

export async function validateAdminCredentials(
  username: string,
  password: string,
): Promise<AdminSession | null> {
  if (!username || !password) {
    return null;
  }

  const { data, error } = await supabase
    .from("ota_admin_users")
    .select("id,username,password_hash,role,is_active")
    .eq("username", normalizeUsername(username))
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to validate admin credentials: ${error.message}`);
  }

  const user = data as AdminUserRow | null;
  if (!user || !(await compare(password, user.password_hash))) {
    return null;
  }

  const lastLoginUpdate = supabase
    .from("ota_admin_users")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", user.id)
    .execute();
  void Promise.resolve(lastLoginUpdate).catch(() => undefined);

  return {
    id: user.id,
    username: user.username,
    role: user.role,
  };
}

export async function createAdminSession(
  user: AdminSession,
): Promise<string> {
  const token = `otas_${randomBytes(32).toString("base64url")}`;
  const now = Date.now();
  const row: AdminSessionRow & {
    created_at: string;
    last_used_at: string;
  } = {
    id: randomUUID(),
    user_id: user.id,
    token_hash: hashToken(token),
    expires_at: new Date(now + SESSION_TTL_SECONDS * 1000).toISOString(),
    revoked_at: null,
    created_at: new Date(now).toISOString(),
    last_used_at: new Date(now).toISOString(),
  };

  const { error } = await supabase
    .from("ota_admin_sessions")
    .upsert(row, { onConflict: "id" })
    .execute();

  if (error) {
    throw new Error(`Failed to create admin session: ${error.message}`);
  }

  return token;
}

async function authenticateSessionToken(
  token: string | undefined,
): Promise<AdminSession | null> {
  if (!token?.startsWith("otas_")) {
    return null;
  }

  const { data, error } = await supabase
    .from("ota_admin_sessions")
    .select("id,user_id,token_hash,expires_at,revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to validate admin session: ${error.message}`);
  }

  const session = data as AdminSessionRow | null;
  if (
    !session ||
    session.revoked_at ||
    Date.parse(session.expires_at) <= Date.now()
  ) {
    return null;
  }

  const user = await getActiveUserById(session.user_id);
  if (!user) {
    return null;
  }

  const lastUsedUpdate = supabase
    .from("ota_admin_sessions")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", session.id)
    .execute();
  void Promise.resolve(lastUsedUpdate).catch(() => undefined);

  return {
    id: user.id,
    username: user.username,
    role: user.role,
  };
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

export function getSessionCookieMaxAge(): number {
  return SESSION_TTL_SECONDS;
}

export async function getAdminSessionFromRequest(
  request: NextRequest,
): Promise<AdminSession | null> {
  return authenticateSessionToken(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  );
}

export async function getAdminSessionFromServerCookies(): Promise<AdminSession | null> {
  const cookieStore = await cookies();
  return authenticateSessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
}

export async function revokeAdminSessionFromRequest(
  request: NextRequest,
): Promise<void> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token?.startsWith("otas_")) {
    return;
  }

  const { error } = await supabase
    .from("ota_admin_sessions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("token_hash", hashToken(token))
    .execute();

  if (error) {
    throw new Error(`Failed to revoke admin session: ${error.message}`);
  }
}
