import type { OtaClientAdapter } from "./types";

type Storage = OtaClientAdapter["storage"];

/** Run before initializing the new adapter, while the previous store is available. */
export async function migrateOtaStorage(previous: Storage, next: Storage) {
  if (previous === next) return;
  for (const key of ["@ota-client/installation-v1", "@ota-client/postponed-update"]) {
    const oldValue = await previous.getItem(key);
    if (oldValue === null) continue;
    if (await next.getItem(key) === null) await next.setItem(key, oldValue);
    await previous.removeItem(key);
  }
}
