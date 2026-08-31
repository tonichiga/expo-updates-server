import { createHash, randomBytes, randomUUID } from "node:crypto";
import { supabase } from "./supabase.js";

export const ACCESS_TOKEN_SCOPES = [
  "updates:read",
  "updates:write",
  "redirects:read",
  "redirects:write",
] as const;

export type AccessTokenScope = (typeof ACCESS_TOKEN_SCOPES)[number];

export type AuthenticatedAccessToken = {
  id: string;
  name: string;
  scopes: AccessTokenScope[];
};

type AccessTokenRow = {
  id: string;
  name: string;
  token_prefix: string;
  token_hash: string;
  scopes: AccessTokenScope[];
  expires_at: string | null;
  revoked_at: string | null;
  last_used_at: string | null;
  created_at: string;
};

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export type AccessTokenRecord = {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: AccessTokenScope[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

function mapAccessToken(row: AccessTokenRow): AccessTokenRecord {
  return {
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scopes: row.scopes,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  };
}

export function isAccessTokenScope(value: unknown): value is AccessTokenScope {
  return (
    typeof value === "string" &&
    ACCESS_TOKEN_SCOPES.includes(value as AccessTokenScope)
  );
}

export async function createAccessToken(input: {
  name: string;
  scopes: AccessTokenScope[];
  expiresAt?: string | null;
}): Promise<{ token: string; tokenRecord: AccessTokenRecord }> {
  const token = `ota_${randomBytes(32).toString("base64url")}`;
  const now = new Date().toISOString();
  const row: AccessTokenRow = {
    id: randomUUID(),
    name: input.name,
    token_prefix: token.slice(0, 12),
    token_hash: hashToken(token),
    scopes: input.scopes,
    expires_at: input.expiresAt || null,
    revoked_at: null,
    last_used_at: null,
    created_at: now,
  };

  const { data, error } = await supabase
    .from("ota_access_tokens")
    .upsert(row, { onConflict: "id" })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create access token: ${error?.message}`);
  }

  return {
    token,
    tokenRecord: mapAccessToken(data as AccessTokenRow),
  };
}

export async function listAccessTokens(): Promise<AccessTokenRecord[]> {
  const { data, error } = await supabase
    .from("ota_access_tokens")
    .select(
      "id,name,token_prefix,scopes,expires_at,revoked_at,last_used_at,created_at",
    )
    .order("created_at", { ascending: false })
    .execute();

  if (error) {
    throw new Error(`Failed to list access tokens: ${error.message}`);
  }

  return ((data || []) as AccessTokenRow[]).map(mapAccessToken);
}

export async function revokeAccessToken(id: string): Promise<void> {
  const { error } = await supabase
    .from("ota_access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .execute();

  if (error) {
    throw new Error(`Failed to revoke access token: ${error.message}`);
  }
}

export async function authenticateAccessToken(
  token: string,
): Promise<AuthenticatedAccessToken | null> {
  if (!token.startsWith("ota_")) {
    return null;
  }

  const { data, error } = await supabase
    .from("ota_access_tokens")
    .select(
      "id,name,token_prefix,token_hash,scopes,expires_at,revoked_at,last_used_at,created_at",
    )
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  const row = data as AccessTokenRow;
  if (row.revoked_at) {
    return null;
  }

  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    return null;
  }

  const lastUsedUpdate = supabase
    .from("ota_access_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .execute();
  void Promise.resolve(lastUsedUpdate).catch(() => undefined);

  return {
    id: row.id,
    name: row.name,
    scopes: row.scopes,
  };
}
