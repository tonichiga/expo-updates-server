import { revokeAccessToken } from "@/src/server/lib/admin-access-tokens";
import { requireAdminSession } from "@/src/server/lib/admin-api";
import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  const session = await requireAdminSession(request, ["admin"]);
  if (session instanceof NextResponse) {
    return session;
  }

  try {
    const { id } = await context.params;
    await revokeAccessToken(id);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to revoke access token" },
      { status: 500 },
    );
  }
}
