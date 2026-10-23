import { requireAdminSession } from "@/src/server/lib/admin-api";
import { getDevicesReport, parseDeviceFilters } from "@/src/server/devices/report";
import { NextRequest, NextResponse } from "next/server";
export async function GET(request: NextRequest) {
  const session = await requireAdminSession(request, ["admin", "operator", "viewer"]);
  if (session instanceof NextResponse) return session;
  let filters;
  try { filters = parseDeviceFilters(request.nextUrl.searchParams); }
  catch { return NextResponse.json({ error: "Invalid filters" }, { status: 400 }); }
  try { return NextResponse.json(await getDevicesReport(filters), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) {
    console.error("Device report failed", error);
    return NextResponse.json({ error: "Device report unavailable" }, { status: 503 });
  }
}
