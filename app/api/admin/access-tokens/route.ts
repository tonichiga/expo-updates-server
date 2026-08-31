import {
  createAccessToken,
  isAccessTokenScope,
  listAccessTokens,
} from "@/src/server/lib/admin-access-tokens";
import { requireAdminSession } from "@/src/server/lib/admin-api";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const session = await requireAdminSession(request, ["admin"]);
  if (session instanceof NextResponse) {
    return session;
  }

  try {
    return NextResponse.json({ items: await listAccessTokens() });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to list access tokens" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await requireAdminSession(request, ["admin"]);
  if (session instanceof NextResponse) {
    return session;
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body" },
      { status: 400 },
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const scopes = Array.isArray(body.scopes)
    ? body.scopes.filter(isAccessTokenScope)
    : [];
  const expiresAt =
    typeof body.expiresAt === "string" && body.expiresAt
      ? body.expiresAt
      : null;

  if (!name || name.length > 100) {
    return NextResponse.json(
      { error: "name must contain between 1 and 100 characters" },
      { status: 400 },
    );
  }

  if (
    scopes.length === 0 ||
    !Array.isArray(body.scopes) ||
    scopes.length !== body.scopes.length ||
    new Set(scopes).size !== scopes.length
  ) {
    return NextResponse.json(
      { error: "scopes must contain unique supported access token scopes" },
      { status: 400 },
    );
  }

  if (
    expiresAt &&
    (Number.isNaN(Date.parse(expiresAt)) ||
      Date.parse(expiresAt) <= Date.now())
  ) {
    return NextResponse.json(
      { error: "expiresAt must be a future ISO date" },
      { status: 400 },
    );
  }

  try {
    const result = await createAccessToken({ name, scopes, expiresAt });
    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    console.error("Failed to create access token:", error);
    return NextResponse.json(
      { error: "Failed to create access token" },
      { status: 500 },
    );
  }
}
