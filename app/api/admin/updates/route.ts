import { requireAdminAccess } from "@/src/server/lib/admin-api";
import {
  getUpdatesPage,
  normalizePage,
  normalizePageSize,
  normalizeSortBy,
  normalizeSortOrder,
} from "@/src/server/lib/admin-updates";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const session = await requireAdminAccess(request, "updates:read");
  if (session instanceof NextResponse) {
    return session;
  }

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = normalizePage(searchParams.get("page"));
    const pageSize = normalizePageSize(searchParams.get("pageSize"));
    const sortBy = normalizeSortBy(searchParams.get("sortBy"));
    const order = normalizeSortOrder(searchParams.get("order"));

    const result = await getUpdatesPage({ page, pageSize, sortBy, order });
    return NextResponse.json(result);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to fetch updates" },
      { status: 500 },
    );
  }
}
