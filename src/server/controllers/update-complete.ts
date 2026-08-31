import { NextRequest } from "next/server.js";

function getClientIp(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const firstIp = forwarded.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  return req.headers.get("x-real-ip") || "unknown";
}

const updateCompleteController = async (req: NextRequest) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Expected POST." }, { status: 405 });
  }

  let runtimeVersion: string | null = null;
  try {
    const body = await req.json();
    runtimeVersion =
      typeof body?.runtimeVersion === "string" ? body.runtimeVersion : null;
  } catch {
    runtimeVersion = null;
  }

  const clientIp = getClientIp(req);
  console.log(
    `[${new Date().toLocaleTimeString()}] ✅ Update completed successfully (IP: ${clientIp}, Runtime: ${runtimeVersion || "unknown"})`,
  );
  return Response.json({ success: true });
};

export default updateCompleteController;
