import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/src/server/lib/admin-api";
import { supabase } from "@/src/server/lib/supabase.js";
import { deviceIdPattern } from "@/src/server/devices/audience";

export async function GET(request: NextRequest) {
  const access = await requireAdminSession(request);
  if (access instanceof NextResponse) return access;
  const platform = request.nextUrl.searchParams.get("platform");
  if (platform !== "android" && platform !== "ios")
    return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
  const deviceId = request.nextUrl.searchParams.get("deviceId");
  if (deviceId !== null) {
    if (!deviceIdPattern.test(deviceId))
      return NextResponse.json({ error: "Invalid device ID" }, { status: 400 });
    const { data, error } = await supabase
      .from("ota_named_devices")
      .select("device_id,name")
      .eq("device_id", deviceId)
      .maybeSingle();
    if (error)
      return NextResponse.json({ error: "Device name unavailable" }, { status: 503 });
    return NextResponse.json(
      { deviceId, name: data?.name ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  // Show installations from other runtimes as well: devices can upgrade their binary.
  const [states, names] = await Promise.all([
    supabase
      .from("ota_device_state")
      .select(
        "installation_id,device_id,platform,runtime_version,channel,last_seen_at",
      )
      .eq("platform", platform)
      .order("last_seen_at", { ascending: false })
      .limit(500)
      .execute(),
    supabase.from("ota_named_devices").select("device_id,name").execute(),
  ]);
  if (states.error || names.error)
    return NextResponse.json({ error: "Devices unavailable" }, { status: 503 });
  const labels = new Map<string, string>(
    (names.data || []).map((d: { device_id: string; name: string }) => [
      d.device_id,
      d.name,
    ]),
  );
  return NextResponse.json(
    {
      devices: (states.data || []).map((d: { device_id: string | null }) => ({
        ...d,
        name: d.device_id ? labels.get(d.device_id) || null : null,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
export async function PUT(request: NextRequest) {
  const access = await requireAdminSession(request, ["admin", "operator"]);
  if (access instanceof NextResponse) return access;
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (
    typeof body?.deviceId !== "string" ||
    !deviceIdPattern.test(body.deviceId) ||
    typeof body.name !== "string" ||
    body.name.trim() !== body.name ||
    body.name.length < 1 ||
    body.name.length > 80 ||
    /[\x00-\x1f\x7f]/.test(body.name)
  )
    return NextResponse.json({ error: "Invalid device name" }, { status: 400 });
  const { error } = await supabase
    .from("ota_named_devices")
    .upsert(
      { device_id: body.deviceId, name: body.name },
      { onConflict: "device_id" },
    )
    .execute();
  if (error)
    return NextResponse.json(
      { error: "Failed to name device" },
      { status: 503 },
    );
  return NextResponse.json({ ok: true });
}
