import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn() }));
vi.mock('@/src/server/lib/admin-api', () => ({ requireAdminSession: mocks.session }));
vi.mock('@/src/server/lib/supabase.js', () => ({ supabase: { rpc: mocks.rpc } }));
import { GET } from './route';
describe('installation report authorization', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ role: 'viewer' }); mocks.rpc.mockResolvedValue({ data: [{ report: { total: 0, devices: [], versions: [] } }] }); });
  it('requires an admin session before accessing installation IDs', async () => {
    mocks.session.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    expect((await GET(new NextRequest('http://test/api/admin/devices'))).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('does not use a publisher bearer token instead of the required session', async () => {
    mocks.session.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
    const request = new NextRequest('http://test/api/admin/devices?launchKind=ota&search=abc123', {
      headers: { Authorization: 'Bearer publisher-token' },
    });
    expect((await GET(request)).status).toBe(401);
    expect(mocks.session).toHaveBeenCalledWith(request, ['admin', 'operator', 'viewer']);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('serves a fresh scoped report to viewers', async () => {
    const response = await GET(new NextRequest('http://test/api/admin/devices?days=30&platform=android&channel=production&runtime=1.0&launchKind=embedded&search=ABC123&offset=50'));
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.rpc).toHaveBeenCalledWith('ota_devices_report_v2', { p_days: 30, p_platform: 'android', p_channel: 'production', p_runtime: '1.0', p_offset: 50, p_launch_kind: 'embedded', p_search: 'abc123' });
  });
  it.each(['days=-1', 'launchKind=invalid', 'launchKind=ota&launchKind=embedded', 'search=%25'])('rejects malformed filters without querying the DB: %s', async (query) => {
    expect((await GET(new NextRequest(`http://test/api/admin/devices?${query}`))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('returns a generic unavailable response when analytics storage fails', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'internal database details' } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await GET(new NextRequest('http://test/api/admin/devices'));
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: 'Device report unavailable' });
    } finally { log.mockRestore(); }
  });
});
