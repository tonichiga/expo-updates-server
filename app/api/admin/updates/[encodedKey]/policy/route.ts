import { requireAdminAccess } from "@/src/server/lib/admin-api";
import {
  decodeUpdateKey,
  getUpdatePolicyByKey,
  replaceUpdatePolicyByKey,
  UpdatePolicyConflictError,
  UpdatePolicyPublishedError,
} from "@/src/server/lib/admin-updates";
import { UpdatePolicyValidationError } from "@/src/server/lib/update-policy";
import { NextRequest, NextResponse } from "next/server";

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
    return NextResponse.json(
      await getUpdatePolicyByKey(decodeUpdateKey(encodedKey)),
    );
  } catch (error: unknown) {
    return NextResponse.json(
      { error: (error as Error).message || "Failed to fetch update policy" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const session = await requireAdminAccess(request, "updates:write");
  if (session instanceof NextResponse) {
    return session;
  }
  try {
    const { encodedKey } = await context.params;
    const body = await request.json();
    if (
      !Number.isInteger(body?.expectedPolicyVersion) ||
      body.expectedPolicyVersion < 1
    ) {
      return NextResponse.json(
        { error: "expectedPolicyVersion must be a positive integer." },
        { status: 400 },
      );
    }
    const policy = await replaceUpdatePolicyByKey(
      decodeUpdateKey(encodedKey),
      { delivery: body?.delivery, guard: body?.guard },
      body?.expectedPolicyVersion,
    );
    return NextResponse.json(policy);
  } catch (error: unknown) {
    if (
      error instanceof UpdatePolicyConflictError ||
      error instanceof UpdatePolicyPublishedError
    ) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (
      error instanceof UpdatePolicyValidationError ||
      error instanceof SyntaxError
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: (error as Error).message || "Failed to update policy" },
      { status: 500 },
    );
  }
}
