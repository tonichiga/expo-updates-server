import { requireAdminAccess } from "@/src/server/lib/admin-api";
import {
  createEmergencyRedirect,
  EmergencyRedirectValidationError,
  listEmergencyRedirects,
} from "@/src/server/lib/emergency-channel-redirects";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const principal = await requireAdminAccess(request, "redirects:read");
  if (principal instanceof NextResponse) {
    return principal;
  }

  try {
    return NextResponse.json({ items: await listEmergencyRedirects() });
  } catch (error: unknown) {
    console.error("Failed to list emergency redirects:", error);
    return NextResponse.json(
      { error: "Failed to list emergency redirects" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const principal = await requireAdminAccess(request, "redirects:write");
  if (principal instanceof NextResponse) {
    return principal;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body" },
      { status: 400 },
    );
  }

  try {
    const redirect = await createEmergencyRedirect(body);
    return NextResponse.json(redirect, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof EmergencyRedirectValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("Failed to create emergency redirect:", error);
    return NextResponse.json(
      { error: "Failed to create emergency redirect" },
      { status: 500 },
    );
  }
}
