import { requireAdminAccess } from "@/src/server/lib/admin-api";
import {
  decodeUpdateKey,
  setUpdateDisabledByKey,
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

    const body = await request.json().catch(() => ({}));
    const disabled = body?.disabled !== false;

    const result = await setUpdateDisabledByKey(key, disabled);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to deactivate update" },
      {
        status: error instanceof OtaDistributionBlockedError ? 409 : 500,
      },
    );
  }
}
