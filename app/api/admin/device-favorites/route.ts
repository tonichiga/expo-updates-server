import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/src/server/lib/admin-api";
import {
  deviceIdPattern,
  installationIdPattern,
} from "@/src/server/devices/audience";
import { supabase } from "@/src/server/lib/supabase.js";

const table = "ota_device_favorites";
const error = (message: string, status: number) =>
  NextResponse.json({ error: message }, { status });
const validPlatform = (value: unknown) =>
  value === "android" || value === "ios";

export async function GET(request: NextRequest) {
  const user = await requireAdminSession(request);
  if (user instanceof NextResponse) return user;
  const platform = request.nextUrl.searchParams.get("platform");
  if (!validPlatform(platform)) return error("Invalid platform", 400);
  const result = await supabase.rpc("ota_list_device_favorites", {
    p_user: user.id,
    p_platform: platform,
  });
  if (result.error) return error("Favorites unavailable", 503);
  return NextResponse.json(
    { favorites: result.data },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

async function mutate(request: NextRequest, remove: boolean) {
  const user = await requireAdminSession(request, ["admin", "operator"]);
  if (user instanceof NextResponse) return user;
  const body = await request.json().catch(() => null);
  const { platform, target_kind: kind, target_id: id, name } = body ?? {};
  if (
    !validPlatform(platform) ||
    (kind !== "device" && kind !== "installation") ||
    typeof id !== "string" ||
    !(kind === "device" ? deviceIdPattern : installationIdPattern).test(id)
  )
    return error("Invalid favorite target", 400);
  if (remove) {
    const result = await supabase
      .from(table)
      .delete()
      .eq("user_id", user.id)
      .eq("platform", platform)
      .eq("target_kind", kind)
      .eq("target_id", id)
      .execute();
    if (result.error) return error("Could not remove favorite", 503);
  } else {
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name !== name.trim() ||
      name.length > 80 ||
      /[\x00-\x1f\x7f]/.test(name)
    )
      return error("Invalid favorite name", 400);
    const column = kind === "device" ? "device_id" : "installation_id";
    const state = await supabase
      .from("ota_device_state")
      .select(column)
      .eq("platform", platform)
      .eq(column, id)
      .limit(1)
      .maybeSingle();
    if (state.error) return error("Favorites unavailable", 503);
    if (!state.data) return error("Target is no longer in the registry", 404);
    const result = await supabase
      .from(table)
      .upsert(
        {
          user_id: user.id,
          platform,
          target_kind: kind,
          target_id: id,
          name,
        },
        { onConflict: "user_id,platform,target_kind,target_id" },
      )
      .execute();
    if (result.error) return error("Could not save favorite", 503);
  }
  return NextResponse.json({ ok: true });
}

export const PUT = (request: NextRequest) => mutate(request, false);
export const DELETE = (request: NextRequest) => mutate(request, true);
