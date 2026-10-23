import { NextRequest, NextResponse } from "next/server";
import { requireAdminAccess } from "@/src/server/lib/admin-api";
import {
  decodeUpdateKey,
  parseUpdateKey,
} from "@/src/server/lib/admin-updates";
import { jsonb, supabase } from "@/src/server/lib/supabase.js";
import { parseAudience } from "@/src/server/devices/audience";

type Context = { params: Promise<{ encodedKey: string }> };
const columns =
  "audience_mode,audience_installation_ids,audience_device_ids,audience_version";
export async function GET(request: NextRequest, context: Context) {
  const access = await requireAdminAccess(request, "updates:read");
  if (access instanceof NextResponse) return access;
  const { updateId } = parseUpdateKey(
    decodeUpdateKey((await context.params).encodedKey),
  );
  const { data, error } = await supabase
    .from("ota_updates")
    .select(columns)
    .eq("update_id", updateId)
    .maybeSingle();
  if (error)
    return NextResponse.json(
      { error: "Audience unavailable" },
      { status: 503 },
    );
  if (!data)
    return NextResponse.json({ error: "Update not found" }, { status: 404 });
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
export async function PUT(request: NextRequest, context: Context) {
  const access = await requireAdminAccess(request, "updates:write");
  if (access instanceof NextResponse) return access;
  let audience;
  try {
    audience = parseAudience(await request.json());
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
  const { updateId } = parseUpdateKey(
    decodeUpdateKey((await context.params).encodedKey),
  );
  const { data, error } = await supabase.rpc("ota_replace_audience", {
    p_update: updateId,
    p_mode: audience.audience_mode,
    p_installations: jsonb(audience.audience_installation_ids),
    p_devices: jsonb(audience.audience_device_ids),
    p_version: audience.audience_version,
  });
  if (error) {
    const conflict = /AUDIENCE_CONFLICT|OTA_DISTRIBUTION_BLOCKED/.test(
      error.message,
    );
    return NextResponse.json(
      {
        error: conflict
          ? "Audience changed or distribution blocked. Refresh and try again."
          : "Failed to save audience",
      },
      { status: conflict ? 409 : 503 },
    );
  }
  const row = data[0];
  return NextResponse.json({
    audience_mode: row.audience_mode,
    audience_installation_ids: row.audience_installation_ids,
    audience_device_ids: row.audience_device_ids,
    audience_version: row.audience_version,
  });
}
