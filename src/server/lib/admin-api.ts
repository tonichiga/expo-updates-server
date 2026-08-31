import {
  AdminRole,
  getAdminSessionFromRequest,
} from "@/src/server/lib/admin-auth";
import {
  AccessTokenScope,
  authenticateAccessToken,
} from "@/src/server/lib/admin-access-tokens";
import { NextRequest, NextResponse } from "next/server";

export type AdminPrincipal =
  | { type: "session"; id: string; username: string; role: AdminRole }
  | { type: "access-token"; id: string; name: string; scopes: string[] };

function getBearerToken(request: NextRequest): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization) {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

const ROLE_SCOPES: Record<AdminRole, AccessTokenScope[]> = {
  admin: [
    "updates:read",
    "updates:write",
    "redirects:read",
    "redirects:write",
  ],
  operator: [
    "updates:read",
    "updates:write",
    "redirects:read",
    "redirects:write",
  ],
  viewer: ["updates:read", "redirects:read"],
};

export async function requireAdminSession(
  request: NextRequest,
  allowedRoles: AdminRole[] = ["admin", "operator", "viewer"],
): Promise<{ id: string; username: string; role: AdminRole } | NextResponse> {
  const session = await getAdminSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!allowedRoles.includes(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return session;
}

export async function requireAdminAccess(
  request: NextRequest,
  requiredScope: AccessTokenScope,
): Promise<AdminPrincipal | NextResponse> {
  const session = await getAdminSessionFromRequest(request);
  if (session) {
    if (!ROLE_SCOPES[session.role].includes(requiredScope)) {
      return NextResponse.json(
        { error: `Missing required scope: ${requiredScope}` },
        { status: 403 },
      );
    }

    return {
      type: "session",
      id: session.id,
      username: session.username,
      role: session.role,
    };
  }

  const bearerToken = getBearerToken(request);
  if (!bearerToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accessToken = await authenticateAccessToken(bearerToken);
  if (!accessToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!accessToken.scopes.includes(requiredScope)) {
    return NextResponse.json(
      { error: `Missing required scope: ${requiredScope}` },
      { status: 403 },
    );
  }

  return {
    type: "access-token",
    id: accessToken.id,
    name: accessToken.name,
    scopes: accessToken.scopes,
  };
}
