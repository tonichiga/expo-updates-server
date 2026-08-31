import { requireAdminAccess } from "@/src/server/lib/admin-api";
import { deleteEmbeddedUpdateById } from "@/src/server/lib/admin-embedded-updates";
import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ embeddedUpdateId: string }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  const session = await requireAdminAccess(request, "updates:write");
  if (session instanceof NextResponse) {
    return session;
  }

  try {
    const { embeddedUpdateId } = await context.params;
    const result = await deleteEmbeddedUpdateById(embeddedUpdateId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to delete embedded update" },
      { status: 500 },
    );
  }
}
