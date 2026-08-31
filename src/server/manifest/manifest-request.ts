import { NextRequest } from "next/server";

function normalizeChannel(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

export function getRequestedChannel(request: NextRequest): string {
  const channel = normalizeChannel(
    request.headers.get("expo-channel-name"),
  );

  if (!channel) {
    console.warn(
      `[${new Date().toLocaleTimeString()}] ⚠️ Missing or invalid expo-channel-name header. Returning "production" channel.`,
    );
    return "production";
  }

  return channel;
}
