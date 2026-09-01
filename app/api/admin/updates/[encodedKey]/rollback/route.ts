import { requireAdminAccess } from "@/src/server/lib/admin-api";
import {
  decodeUpdateKey,
  rollbackToUpdateByKey,
} from "@/src/server/lib/admin-updates";
import { NextRequest, NextResponse } from "next/server";
import { OtaDistributionBlockedError } from "@/src/server/lib/distribution-control";

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
    const latest = await rollbackToUpdateByKey(key);
    return NextResponse.json({ ok: true, latest });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to rollback update" },
      {
        status: error instanceof OtaDistributionBlockedError ? 409 : 500,
      },
    );
  }
}
