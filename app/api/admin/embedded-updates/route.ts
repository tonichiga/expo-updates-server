import { requireAdminAccess } from "@/src/server/lib/admin-api";
import {
  EmbeddedUpdateValidationError,
  listEmbeddedUpdates,
  parseRegisterEmbeddedUpdateInput,
  registerEmbeddedUpdate,
} from "@/src/server/lib/admin-embedded-updates";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const session = await requireAdminAccess(request, "updates:read");
  if (session instanceof NextResponse) {
    return session;
  }

  try {
    const items = await listEmbeddedUpdates();
    return NextResponse.json({ items });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to fetch embedded updates" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const session = await requireAdminAccess(request, "updates:write");
  if (session instanceof NextResponse) {
    return session;
  }

  try {
    const input = parseRegisterEmbeddedUpdateInput(await request.json());
    const item = await registerEmbeddedUpdate(input);
    return NextResponse.json({ item }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof EmbeddedUpdateValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { error: (error as Error).message || "Failed to register embedded update" },
      { status: 500 },
    );
  }
}
