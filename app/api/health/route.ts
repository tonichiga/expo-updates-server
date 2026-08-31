import { supabase } from "@/src/server/lib/supabase.js";
import { NextResponse } from "next/server";

export async function GET() {
  const checkedAt = new Date().toISOString();

  try {
    const { error } = await supabase
      .from("ota_updates")
      .select("id")
      .limit(1)
      .execute();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json(
      {
        status: "ok",
        checkedAt,
        checks: { database: "ok" },
      },
      {
        headers: { "cache-control": "no-store" },
      },
    );
  } catch (error: unknown) {
    console.error("Health check failed:", error);
    return NextResponse.json(
      {
        status: "unavailable",
        checkedAt,
        checks: { database: "unavailable" },
      },
      {
        status: 503,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
