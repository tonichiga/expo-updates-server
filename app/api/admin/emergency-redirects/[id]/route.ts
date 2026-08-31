import { requireAdminAccess } from "@/src/server/lib/admin-api";
import {
  deleteEmergencyRedirect,
  EmergencyRedirectValidationError,
  updateEmergencyRedirect,
} from "@/src/server/lib/emergency-channel-redirects";
import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  const principal = await requireAdminAccess(request, "redirects:write");
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
    const { id } = await context.params;
    return NextResponse.json(await updateEmergencyRedirect(id, body));
  } catch (error: unknown) {
    if (error instanceof EmergencyRedirectValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("Failed to update emergency redirect:", error);
    return NextResponse.json(
      { error: "Failed to update emergency redirect" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const principal = await requireAdminAccess(request, "redirects:write");
  if (principal instanceof NextResponse) {
    return principal;
  }

  try {
    const { id } = await context.params;
    await deleteEmergencyRedirect(id);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("Failed to delete emergency redirect:", error);
    return NextResponse.json(
      { error: "Failed to delete emergency redirect" },
      { status: 500 },
    );
  }
}
