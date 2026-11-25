import { NextRequest, NextResponse } from "next/server";
import { requireAdminAccess } from "@/src/server/lib/admin-api";
import { getDistributionHistory } from "@/src/server/lib/distribution-history";

export async function GET(request: NextRequest) {
  const principal = await requireAdminAccess(request, "updates:read");
  if (principal instanceof NextResponse) return principal;
  const canWrite =
    principal.type === "session"
      ? principal.role !== "viewer"
      : principal.scopes.includes("updates:write");
  try {
    return NextResponse.json({
      canWrite,
      scopes: await getDistributionHistory(),
    });
  } catch (error) {
    console.error("Failed to read public distribution history", error);
    return NextResponse.json(
      { error: "Failed to read distribution history." },
      { status: 500 },
    );
  }
}
