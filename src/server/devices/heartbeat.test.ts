import { beforeEach, describe, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase.js', () => ({ supabase: { rpc }, jsonb: (v: unknown) => v }));
import { parseHeartbeat, recordHeartbeat } from './heartbeat';
import { parseDeviceFilters } from './report';
const event = { installationId: 'b1c01662-c4e1-41a0-8556-a6c2a9dee467', eventId: 'd28a640f-f4c3-47ae-9044-58a950ad6d38', sequence: 1, observedAt: '2026-10-19T12:00:00.000Z', platform: 'android', channel: 'test', runtimeVersion: 'v1', updateId: null, nativeVersion: '1.0', nativeBuild: '1', isEmbeddedLaunch: true, isEmergencyLaunch: false };
function request(body: unknown) { return new Request('http://test/api/device-heartbeat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }
describe('heartbeat boundary', () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: [{ result: 'accepted' }] }); });
  it('normalizes IDs, strips unexpected keys and stores actual launch info', async () => {
    const response = await recordHeartbeat(request({ ...event, installationId: event.installationId.toUpperCase(), token: 'not stored' }));
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('ota_record_heartbeat', { p_event: event });
  });
  it.each([{ sequence: 0 }, { sequence: 1.5 }, { sequence: Number.MAX_SAFE_INTEGER + 1 }, { installationId: 'bad' }, { platform: 'web' }, { platform: ['ios'] }, { nativeVersion: {} }, { isEmbeddedLaunch: 'true' }, { observedAt: 'yesterday' }, { channel: 'BAD' }, { updateId: 'bad' }])('rejects malformed input %j', async (patch) => {
    expect((await recordHeartbeat(request({ ...event, ...patch }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('limits streamed bodies without a content length', async () => {
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(' '.repeat(9000))); c.close(); } });
    const req = new Request('http://test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit);
    expect((await recordHeartbeat(req)).status).toBe(413); expect(rpc).not.toHaveBeenCalled();
  });
  it('rejects non JSON and sequence conflicts', async () => {
    expect((await recordHeartbeat(new Request('http://test', { method: 'POST', body: '{}' }))).status).toBe(415);
    rpc.mockResolvedValue({ error: { message: 'HEARTBEAT_SEQUENCE_CONFLICT' } });
    expect((await recordHeartbeat(request(event))).status).toBe(409);
  });
  it.each([{ data: [] }, { data: [{ result: 'unexpected' }] }])('rejects malformed storage success %j', async ({ data }) => {
    rpc.mockResolvedValue({ data });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try { expect((await recordHeartbeat(request(event))).status).toBe(503); } finally { log.mockRestore(); }
  });
  it('accepts unknown update IDs without inventing a version', () => expect(parseHeartbeat(event).updateId).toBeNull());
  it('validates report filters', () => {
    expect(parseDeviceFilters(new URLSearchParams())).toMatchObject({ p_days: 7, p_offset: 0 });
    for (const query of ['days=0', 'days=365', 'offset=-1', 'offset=1.5', 'platform=web', 'channel=BAD']) expect(() => parseDeviceFilters(new URLSearchParams(query))).toThrow();
  });
});
