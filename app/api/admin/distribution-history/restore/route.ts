import { NextRequest, NextResponse } from "next/server";
import { requireAdminAccess } from "@/src/server/lib/admin-api";
import {
  changeDistribution,
  DistributionHistoryConflictError,
} from "@/src/server/lib/distribution-history";
import { OtaDistributionBlockedError } from "@/src/server/lib/distribution-control";

export async function POST(request: NextRequest) {
  const principal = await requireAdminAccess(request, "updates:write");
  if (principal instanceof NextResponse) return principal;
  const body = await request.json().catch(() => null);
  if (
    typeof body?.updateId !== "string" ||
    !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(body.updateId) ||
    typeof body.expectedRevision !== "string" ||
    !/^\d{1,20}$/.test(body.expectedRevision)
  ) {
    return NextResponse.json(
      { error: "A release ID and expected revision are required." },
      { status: 400 },
    );
  }
  try {
    await changeDistribution(body.updateId, "restore", body.expectedRevision);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (
      error instanceof DistributionHistoryConflictError ||
      error instanceof OtaDistributionBlockedError
    )
      return NextResponse.json({ error: error.message }, { status: 409 });
    console.error("Failed to restore public release", error);
    return NextResponse.json(
      { error: "Failed to restore public release." },
      { status: 500 },
    );
  }
}
