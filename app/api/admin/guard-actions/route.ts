import {
  AdminPrincipal,
  requireAdminAccess,
} from "@/src/server/lib/admin-api";
import {
  createGuardAction,
  GuardActionValidationError,
  listGuardActions,
} from "@/src/server/lib/guard-actions";
import { NextRequest, NextResponse } from "next/server";

function canWrite(principal: AdminPrincipal): boolean {
  return principal.type === "session"
    ? principal.role !== "viewer"
    : principal.scopes.includes("updates:write");
}

export async function GET(request: NextRequest) {
  const principal = await requireAdminAccess(request, "updates:read");
  if (principal instanceof NextResponse) {
    return principal;
  }

  try {
    return NextResponse.json({
      items: await listGuardActions(),
      canWrite: canWrite(principal),
    });
  } catch (error: unknown) {
    console.error("Failed to list guard actions:", error);
    return NextResponse.json(
      { error: "Failed to list guard actions" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const principal = await requireAdminAccess(request, "updates:write");
  if (principal instanceof NextResponse) {
    return principal;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await createGuardAction(body), { status: 201 });
  } catch (error: unknown) {
    if (error instanceof GuardActionValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to create guard action:", error);
    return NextResponse.json(
      { error: "Failed to create guard action" },
      { status: 500 },
    );
  }
}
