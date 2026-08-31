import {
  AdminSessionResponse,
  EmbeddedUpdatesListResponse,
  EmergencyRedirectInput,
  EmergencyRedirectItem,
  EmergencyRedirectsListResponse,
  UpdateDetail,
  UpdatesListResponse,
} from "./admin-types";

async function parseJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = (data as { error?: string })?.error || "Request failed";
    throw new Error(message);
  }
  return data as T;
}

export async function adminLogin(username: string, password: string) {
  const response = await fetch("/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  return parseJson<{ ok: boolean }>(response);
}

export async function adminLogout() {
  const response = await fetch("/api/admin/logout", { method: "POST" });
  return parseJson<{ ok: boolean }>(response);
}

export async function getAdminSession() {
  const response = await fetch("/api/admin/session", { cache: "no-store" });
  return parseJson<AdminSessionResponse>(response);
}

export async function getUpdates(params: {
  page: number;
  pageSize: number;
  sortBy: string;
  order: "asc" | "desc";
}) {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    sortBy: params.sortBy,
    order: params.order,
  });

  const response = await fetch(`/api/admin/updates?${query.toString()}`, {
    cache: "no-store",
  });

  return parseJson<UpdatesListResponse>(response);
}

export async function getUpdate(encodedKey: string) {
  const response = await fetch(`/api/admin/updates/${encodedKey}`, {
    cache: "no-store",
  });

  return parseJson<UpdateDetail>(response);
}

export async function deleteUpdate(encodedKey: string) {
  const response = await fetch(`/api/admin/updates/${encodedKey}`, {
    method: "DELETE",
  });

  return parseJson<{ ok: boolean; removedFiles: number }>(response);
}

export async function updateJsonFile(
  encodedKey: string,
  fileName:
    | "update-info.json"
    | "update-meta.json"
    | "metadata.json"
    | "channel-latest.json",
  content: Record<string, unknown>,
) {
  const response = await fetch(`/api/admin/updates/${encodedKey}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName, content }),
  });

  return parseJson<{ ok: boolean; path: string }>(response);
}

export async function rollbackUpdate(encodedKey: string) {
  const response = await fetch(`/api/admin/updates/${encodedKey}/rollback`, {
    method: "POST",
  });

  return parseJson<{ ok: boolean }>(response);
}

export async function promoteUpdate(encodedKey: string) {
  const response = await fetch(`/api/admin/updates/${encodedKey}/promote`, {
    method: "POST",
  });

  return parseJson<{ ok: boolean }>(response);
}

export async function setUpdateDisabled(encodedKey: string, disabled: boolean) {
  const response = await fetch(`/api/admin/updates/${encodedKey}/deactivate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ disabled }),
  });

  return parseJson<{ ok: boolean; fallbackApplied?: boolean }>(response);
}

export async function getEmbeddedUpdates() {
  const response = await fetch("/api/admin/embedded-updates", {
    cache: "no-store",
  });

  return parseJson<EmbeddedUpdatesListResponse>(response);
}

export async function deleteEmbeddedUpdate(embeddedUpdateId: string) {
  const response = await fetch(
    `/api/admin/embedded-updates/${embeddedUpdateId}`,
    {
      method: "DELETE",
    },
  );

  return parseJson<{ ok: boolean; deletedId: string }>(response);
}

export async function getEmergencyRedirects() {
  const response = await fetch("/api/admin/emergency-redirects", {
    cache: "no-store",
  });
  return parseJson<EmergencyRedirectsListResponse>(response);
}

export async function createEmergencyRedirect(
  input: EmergencyRedirectInput,
) {
  const response = await fetch("/api/admin/emergency-redirects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseJson<EmergencyRedirectItem>(response);
}

export async function updateEmergencyRedirect(
  id: string,
  patch: Partial<EmergencyRedirectInput>,
) {
  const response = await fetch(`/api/admin/emergency-redirects/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return parseJson<EmergencyRedirectItem>(response);
}

export async function deleteEmergencyRedirect(id: string) {
  const response = await fetch(`/api/admin/emergency-redirects/${id}`, {
    method: "DELETE",
  });
  return parseJson<{ ok: boolean }>(response);
}
