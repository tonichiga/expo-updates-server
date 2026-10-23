import { describe, expect, it, vi } from 'vitest';
import { createInstallationClient } from '../../templates/expo-app/ota-client/controller';
function fixture() {
  let stored: string | null = null;
  let counter = 0;
  const send = vi.fn(async (event: { eventId: string; sequence: number }) => { void event; });
  const write = vi.fn(async (value: string) => { stored = value; });
  const deps = { read: async () => stored, write, uuid: () => `uuid-${++counter}`, snapshot: () => ({ updateId: 'launched' }), send, setIdentity: vi.fn(async (id: string) => { void id; }), now: () => '2026-10-19T12:00:00.000Z' };
  return { deps, send, write, state: () => JSON.parse(stored!), client: createInstallationClient(deps) };
}
describe('durable installation client', () => {
  it('keeps identity across controller restarts and increments sequence', async () => {
    const f = fixture(); const id = await f.client.ready(); await f.client.observe();
    const restarted = createInstallationClient(f.deps);
    expect(await restarted.ready()).toBe(id); await restarted.observe();
    expect(f.send.mock.calls.map(([e]) => e.sequence)).toEqual([1, 2]);
    expect(f.state().pending).toBeNull();
  });
  it('retries the identical durable event after offline/restart', async () => {
    const f = fixture(); f.send.mockRejectedValueOnce(new Error('offline'));
    await expect(f.client.observe()).rejects.toThrow('offline');
    const pending = f.state().pending;
    await createInstallationClient(f.deps).flush();
    expect(f.send.mock.calls[1][0]).toEqual(pending);
    expect(f.state().pending).toBeNull();
  });
  it('does not send or expose ephemeral identity when storage fails', async () => {
    const f = fixture(); f.write.mockRejectedValueOnce(new Error('disk'));
    await expect(f.client.observe()).rejects.toThrow('disk'); expect(f.send).not.toHaveBeenCalled();
    expect(f.deps.setIdentity).not.toHaveBeenCalled();
    await f.client.observe(); expect(f.send).toHaveBeenCalledOnce();
  });
  it('never clears a newer pending event when an old request completes', async () => {
    const f = fixture(); let resolve!: () => void;
    f.send.mockImplementationOnce(() => new Promise<void>((r) => { resolve = r; }));
    const first = f.client.observe();
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
    const second = f.client.observe();
    await vi.waitFor(() => expect(f.state().sequence).toBe(2));
    resolve(); await Promise.all([first, second]);
    expect(f.state().pending.sequence).toBe(2);
    await f.client.flush(); expect(f.send.mock.calls[1][0].sequence).toBe(2);
  });
  it('serializes concurrent observations with unique sequences', async () => {
    const f = fixture(); await Promise.all(Array.from({ length: 10 }, () => f.client.observe()));
    expect(f.state().sequence).toBe(10); await f.client.flush();
    expect(f.state().pending).toBeNull();
  });
  it('does not lose the outbox when acknowledgement cannot persist', async () => {
    const g = fixture(); let writes = 0; const original = g.deps.write;
    const c = createInstallationClient({ ...g.deps, write: async (v: string) => { if (++writes === 3) throw new Error('ack disk'); await original(v); } });
    await expect(c.observe()).rejects.toThrow('ack disk'); expect(g.state().pending.sequence).toBe(1);
    await c.flush(); expect(g.send.mock.calls[0][0]).toEqual(g.send.mock.calls[1][0]);
  });
});
