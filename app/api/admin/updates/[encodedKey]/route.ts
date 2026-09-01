import { requireAdminAccess } from "@/src/server/lib/admin-api";
import {
  decodeUpdateKey,
  deleteUpdateByKey,
  getUpdateDetailByKey,
  updateJsonFileByKey,
} from "@/src/server/lib/admin-updates";
import { NextRequest, NextResponse } from "next/server";
import { OtaDistributionBlockedError } from "@/src/server/lib/distribution-control";

type RouteContext = {
  params: Promise<{ encodedKey: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const session = await requireAdminAccess(request, "updates:read");
  if (session instanceof NextResponse) {
    return session;
  }

  try {
    const { encodedKey } = await context.params;
    const key = decodeUpdateKey(encodedKey);
    const detail = await getUpdateDetailByKey(key);
    return NextResponse.json(detail);
  } catch (error: unknown) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to fetch update" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const session = await requireAdminAccess(request, "updates:write");
  if (session instanceof NextResponse) {
    return session;
  }

  try {
    const { encodedKey } = await context.params;
    const key = decodeUpdateKey(encodedKey);
    const result = await deleteUpdateByKey(key);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to delete update" },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const session = await requireAdminAccess(request, "updates:write");
  if (session instanceof NextResponse) {
    return session;
  }

  try {
    const { encodedKey } = await context.params;
    const key = decodeUpdateKey(encodedKey);

    const body = await request.json();
    const fileName = body?.fileName;
    const content = body?.content;

    if (
      fileName !== "update-info.json" &&
      fileName !== "update-meta.json" &&
      fileName !== "metadata.json" &&
      fileName !== "channel-latest.json"
    ) {
      return NextResponse.json(
        {
          error:
            "Unsupported fileName. Use update-info.json, update-meta.json, metadata.json or channel-latest.json",
        },
        { status: 400 },
      );
    }

    if (!content || typeof content !== "object") {
      return NextResponse.json(
        { error: "content must be a JSON object" },
        { status: 400 },
      );
    }

    const result = await updateJsonFileByKey(key, fileName, content);
    return NextResponse.json({ ok: true, ...result });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to update JSON" },
      {
        status: error instanceof OtaDistributionBlockedError ? 409 : 500,
      },
    );
  }
}
