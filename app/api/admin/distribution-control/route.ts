import {
  requireAdminAccess,
  type AdminPrincipal,
} from "@/src/server/lib/admin-api";
import {
  DistributionControlConflictError,
  DistributionControlValidationError,
  getDistributionControlState,
  setDistributionControlState,
  type DistributionControlPrincipal,
} from "@/src/server/lib/distribution-control";
import { NextRequest, NextResponse } from "next/server";

function toDistributionPrincipal(
  principal: AdminPrincipal,
): DistributionControlPrincipal {
  if (principal.type === "session") {
    return {
      type: "session",
      id: principal.id,
      label: principal.username,
      role: principal.role,
    };
  }

  return {
    type: "access-token",
    id: principal.id,
    label: principal.name,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function canWrite(principal: AdminPrincipal): boolean {
  return principal.type === "session"
    ? principal.role !== "viewer"
    : principal.scopes.includes("updates:write");
}

export async function GET(request: NextRequest) {
  const principal = await requireAdminAccess(request, "updates:read");
  if (principal instanceof NextResponse) {
    return principal;
  }

  try {
    return NextResponse.json({
      ...(await getDistributionControlState()),
      canWrite: canWrite(principal),
    });
  } catch (error: unknown) {
    console.error("Failed to read OTA distribution control:", error);
    return NextResponse.json(
      { error: "Failed to read OTA distribution control." },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest) {
  const principal = await requireAdminAccess(request, "updates:write");
  if (principal instanceof NextResponse) {
    return principal;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body." },
      { status: 400 },
    );
  }

  if (!isRecord(body)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object." },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(
      await setDistributionControlState({
        blocked: body.blocked,
        reason: body.reason,
        expectedVersion: body.expectedVersion,
        principal: toDistributionPrincipal(principal),
      }),
    );
  } catch (error: unknown) {
    if (
      error instanceof DistributionControlValidationError ||
      error instanceof DistributionControlConflictError
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("Failed to update OTA distribution control:", error);
    return NextResponse.json(
      { error: "Failed to update OTA distribution control." },
      { status: 500 },
    );
  }
}
