import { requireAdminAccess } from "@/src/server/lib/admin-api";
import {
  decodeUpdateKey,
  promoteLatestByKey,
} from "@/src/server/lib/admin-updates";
import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ encodedKey: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const session = await requireAdminAccess(request, "updates:write");
  if (session instanceof NextResponse) {
    return session;
  }

  try {
    const { encodedKey } = await context.params;
    const key = decodeUpdateKey(encodedKey);
    const result = await promoteLatestByKey(key);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to promote latest update" },
      { status: 500 },
    );
  }
}
