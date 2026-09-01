import { requireAdminAccess } from "@/src/server/lib/admin-api";
import {
  deleteGuardAction,
  GuardActionValidationError,
} from "@/src/server/lib/guard-actions";
import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  const principal = await requireAdminAccess(request, "updates:write");
  if (principal instanceof NextResponse) {
    return principal;
  }

  try {
    const { id } = await context.params;
    await deleteGuardAction(id);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof GuardActionValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to delete guard action:", error);
    return NextResponse.json(
      { error: "Failed to delete guard action" },
      { status: 500 },
    );
  }
}
