import { describe, it, expect } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { createDeviceIdentity } from '../../templates/expo-app/ota-client/device-identity.js';
const digest = async (v: string) => createHash('sha256').update(v).digest('hex');
function options(platform = 'android', store = new Map<string, string>()) {
  return { platform, scope: 'com.example:https://updates.example.com', androidId: () => 'abc123', digest,
    uuid: randomUUID, readSecure: async (k: string) => store.get(k), writeSecure: async (k: string, v: string) => { store.set(k, v); } };
}
describe('device identity independent of installation state', () => {
  it('recognizes Android reinstalls, isolates app/server and signing identity changes', async () => {
    const o = options(); const first = await createDeviceIdentity(o)();
    expect(await createDeviceIdentity(options())()).toBe(first);
    expect(await createDeviceIdentity({ ...o, scope: 'another-app' })()).not.toBe(first);
    expect(await createDeviceIdentity({ ...o, androidId: () => 'changed-key' })()).not.toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/); expect(first).not.toContain('abc123');
  });
  it('reuses iOS Keychain across reinstall, regenerates only when actually absent', async () => {
    const store = new Map<string, string>(); const o = options('ios', store);
    const first = await createDeviceIdentity(o)();
    expect(await createDeviceIdentity(o)()).toBe(first);
    expect(await createDeviceIdentity(options('ios'))()).not.toBe(first);
  });
  it('single-flights concurrent callers and retries Keychain errors without replacing the existing seed', async () => {
    const store = new Map<string, string>(); const o = options('ios', store); let calls = 0;
    const id = createDeviceIdentity({ ...o, readSecure: async (k: string) => { calls++; if (calls === 1) throw new Error('locked'); return o.readSecure(k); } });
    await expect(id()).rejects.toThrow('locked');
    const [a, b] = await Promise.all([id(), id()]); expect(a).toBe(b); expect(calls).toBe(2); expect(store.size).toBe(1);
  });
});
