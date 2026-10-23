import { describe, expect, it, vi } from 'vitest';
import { createUpdateController } from '../../templates/expo-app/ota-client/model/update-controller.js';

function manifest(id = 'update-a', delivery = 'manual', action?: string) {
  return { id, extra: { updatePolicy: { schemaVersion: 1, policyVersion: 1, delivery,
    ...(action ? { guard: { action, payload: { message: 'Please update' } } } : {}) } } };
}
function fixture() {
  let clock = 0;
  const deps = {
    enabled: true, start: vi.fn(),
    identity: vi.fn(async () => ({ installationId: 'installation', deviceId: 'device' })),
    check: vi.fn(async (): Promise<unknown> => ({ isAvailable: true, manifest: manifest() })),
    fetch: vi.fn(async (): Promise<unknown> => ({ isNew: true, manifest: manifest() })),
    reload: vi.fn(async () => undefined), openStore: vi.fn(async () => undefined),
    isActive: vi.fn(() => true), now: () => clock,
  };
  const client = createUpdateController(deps);
  const owner = Symbol('root');
  const configure = (value: Record<string, unknown> = {}) => client.configure(owner, value);
  return { deps, client, configure, owner, advance: () => { clock += 60000; } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

describe('OTA lifecycle policy and operations', () => {
  it('keeps manual checks separate from download and reload, initializing identity first', async () => {
    const f = fixture();
    const identity = deferred<{ installationId: string; deviceId: string }>();
    f.deps.identity.mockReturnValue(identity.promise);
    const checking = f.client.check();
    await vi.waitFor(() => expect(f.deps.identity).toHaveBeenCalledOnce());
    expect(f.deps.check).not.toHaveBeenCalled();
    identity.resolve({ installationId: 'installation', deviceId: 'device' });
    await checking;
    expect(f.client.getSnapshot()).toMatchObject({ available: true, pending: false, status: 'idle' });
    expect(f.deps.fetch).not.toHaveBeenCalled();
    await f.client.download();
    expect(f.client.getSnapshot()).toMatchObject({ pending: true });
    expect(f.deps.reload).not.toHaveBeenCalled();
    await f.client.reload();
    expect(f.deps.reload).toHaveBeenCalledOnce();
  });
  it('automatically downloads and reloads manual candidates only with the requested flags', async () => {
    const f = fixture(); f.configure({ autoUpdate: true, autoReload: true });
    await f.client.check();
    expect(f.deps.fetch).toHaveBeenCalledOnce(); expect(f.deps.reload).toHaveBeenCalledOnce();
  });
  it('does not repeat a manual fetch when the server withdrew the candidate', async () => {
    const f = fixture();
    await f.client.check();
    f.configure({ autoUpdate: true, autoReload: true });
    f.deps.fetch.mockResolvedValue({ isNew: false, isRollBackToEmbedded: false });
    await f.client.download();
    expect(f.deps.fetch).toHaveBeenCalledOnce();
    expect(f.deps.reload).not.toHaveBeenCalled();
    expect(f.client.getSnapshot().pending).toBe(false);
  });
  it('keeps legacy manifests without policy usable through the manual workflow', async () => {
    const f = fixture(); f.configure({ autoReload: true });
    f.deps.check.mockResolvedValue({ isAvailable: true, manifest: { id: 'legacy' } });
    f.deps.fetch.mockResolvedValue({ isNew: true, manifest: { id: 'legacy' } });
    await f.client.check();
    expect(f.client.getSnapshot()).toMatchObject({ blocked: false, policy: null, available: true });
    expect(f.deps.fetch).not.toHaveBeenCalled();
    await f.client.download(); expect(f.deps.reload).toHaveBeenCalledOnce();
  });
  it('does not guess how to apply a future policy schema', async () => {
    const f = fixture(); f.configure({ autoUpdate: true, autoReload: true });
    const candidate = manifest(); candidate.extra.updatePolicy.schemaVersion = 2;
    f.deps.check.mockResolvedValue({ isAvailable: true, manifest: candidate });
    await f.client.check();
    expect(f.client.getSnapshot()).toMatchObject({ blocked: true, blockReason: 'unsupported-policy' });
    expect(f.deps.fetch).not.toHaveBeenCalled();
  });
  it('honors server background delivery even when autoUpdate is false and never auto-reloads it', async () => {
    const f = fixture(); f.configure({ autoUpdate: false, autoReload: true });
    f.deps.check.mockResolvedValue({ isAvailable: true, manifest: manifest('background', 'background') });
    f.deps.fetch.mockResolvedValue({ isNew: true, manifest: manifest('background', 'background') });
    await f.client.check();
    expect(f.deps.fetch).toHaveBeenCalledOnce(); expect(f.deps.reload).not.toHaveBeenCalled();
    expect(f.client.getSnapshot()).toMatchObject({ pending: true, blocked: false });
  });
  it('automatically downloads forced OTA but keeps a gate until explicitly applied', async () => {
    const f = fixture();
    f.deps.check.mockResolvedValue({ isAvailable: true, manifest: manifest('force', 'manual', 'ota-force-update') });
    f.deps.fetch.mockResolvedValue({ isNew: true, manifest: manifest('force', 'manual', 'ota-force-update') });
    await f.client.check();
    expect(f.client.getSnapshot()).toMatchObject({ blocked: true, blockReason: 'ota-force-update', pending: true });
    expect(f.deps.reload).not.toHaveBeenCalled();
    await f.client.reload(); expect(f.deps.reload).toHaveBeenCalledOnce();
  });
  it('force-store guard cannot be bypassed by download, reload or automatic flags', async () => {
    const f = fixture(); f.configure({ autoUpdate: true, autoReload: true });
    f.deps.check.mockResolvedValue({ isAvailable: true, manifest: manifest('store', 'background', 'ota-force-store-update') });
    await f.client.check();
    expect(f.client.getSnapshot()).toMatchObject({ blocked: true, blockReason: 'ota-force-store-update' });
    expect(f.deps.fetch).not.toHaveBeenCalled();
    await expect(f.client.download()).rejects.toThrow('guard');
    await expect(f.client.reload()).rejects.toThrow();
    await f.client.openStore(); expect(f.deps.openStore).toHaveBeenCalledWith({ message: 'Please update' });
  });
  it('keeps unknown guards closed until an asynchronous handler explicitly allows the candidate', async () => {
    const f = fixture(); f.configure({ autoUpdate: true });
    f.deps.check.mockResolvedValue({ isAvailable: true, manifest: manifest('custom', 'manual', 'login') });
    await f.client.check();
    expect(f.client.getSnapshot()).toMatchObject({ blocked: true }); expect(f.deps.fetch).not.toHaveBeenCalled();
    const decision = deferred<string>();
    f.configure({ guardHandlers: { login: () => decision.promise } });
    const checking = f.client.retry();
    await vi.waitFor(() => expect(f.deps.check).toHaveBeenCalledTimes(2));
    expect(f.client.getSnapshot()).toMatchObject({ blocked: true });
    decision.resolve('allow'); await checking;
    expect(f.client.getSnapshot()).toMatchObject({ blocked: false });
  });
  it('rechecks the fetched manifest guard if delivery changed between check and fetch', async () => {
    const f = fixture(); f.configure({ autoUpdate: true, autoReload: true });
    f.deps.fetch.mockResolvedValue({ isNew: true, manifest: manifest('different', 'manual', 'ota-force-store-update') });
    await f.client.check();
    expect(f.client.getSnapshot()).toMatchObject({ pending: true, blocked: true, blockReason: 'ota-force-store-update', candidate: { manifest: { id: 'different' } } });
    expect(f.deps.reload).not.toHaveBeenCalled();
    await expect(f.client.reload()).rejects.toThrow('guard');
  });
  it('supports rollback to embedded without expecting a manifest', async () => {
    const f = fixture();
    f.deps.check.mockResolvedValue({ isAvailable: false, isRollBackToEmbedded: true });
    f.deps.fetch.mockResolvedValue({ isNew: false, isRollBackToEmbedded: true });
    await f.client.check(); await f.client.download(); await f.client.reload();
    expect(f.client.getSnapshot()).toMatchObject({ candidate: { type: 'rollback', manifest: null }, pending: true });
    expect(f.deps.reload).toHaveBeenCalledOnce();
  });
  it('retries identity failure without performing an anonymous update check', async () => {
    const f = fixture(); f.deps.identity.mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(f.client.check()).rejects.toThrow('storage unavailable');
    expect(f.deps.check).not.toHaveBeenCalled();
    await f.client.retry(); expect(f.deps.identity).toHaveBeenCalledTimes(2); expect(f.deps.check).toHaveBeenCalledOnce();
  });
  it('single-flights identical operations and rejects conflicting operations', async () => {
    const f = fixture(); const response = deferred<unknown>(); f.deps.check.mockReturnValue(response.promise);
    const first = f.client.check(); const second = f.client.check();
    expect(first).toBe(second);
    await expect(f.client.download()).rejects.toThrow('in progress');
    response.resolve({ isAvailable: true, manifest: manifest() }); await first;
    expect(f.deps.check).toHaveBeenCalledOnce();
  });
  it('does not mark a failed download pending and supports retry', async () => {
    const f = fixture(); await f.client.check(); f.deps.fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(f.client.download()).rejects.toThrow('offline');
    expect(f.client.getSnapshot()).toMatchObject({ pending: false, status: 'idle' });
    await f.client.download(); expect(f.client.getSnapshot()).toMatchObject({ pending: true, error: null });
  });
  it('never reloads while the native app is inactive', async () => {
    const f = fixture(); await f.client.check(); await f.client.download(); f.deps.isActive.mockReturnValue(false);
    await expect(f.client.reload()).rejects.toThrow('active'); expect(f.deps.reload).not.toHaveBeenCalled();
  });
  it('automatic checks require an active owner and obey the foreground throttle', async () => {
    const f = fixture(); f.client.automaticCheck(); expect(f.deps.check).not.toHaveBeenCalled();
    f.configure({ autoCheck: true }); f.client.automaticCheck();
    await vi.waitFor(() => expect(f.client.getSnapshot().status).toBe('idle'));
    expect(f.deps.check).toHaveBeenCalledOnce();
    f.client.automaticCheck(); expect(f.deps.check).toHaveBeenCalledOnce();
    f.advance(); f.deps.isActive.mockReturnValue(false); f.client.automaticCheck(); expect(f.deps.check).toHaveBeenCalledOnce();
    f.deps.isActive.mockReturnValue(true); f.client.automaticCheck();
    await vi.waitFor(() => expect(f.deps.check).toHaveBeenCalledTimes(2));
    f.client.removeOwner(f.owner); f.advance(); f.client.automaticCheck(); expect(f.deps.check).toHaveBeenCalledTimes(2);
  });
  it('disabled builds never initialize native update operations', async () => {
    const f = fixture(); const client = createUpdateController({ ...f.deps, enabled: false });
    await client.initialize(); await expect(client.check()).rejects.toThrow('unavailable');
    expect(f.deps.identity).not.toHaveBeenCalled(); expect(f.deps.check).not.toHaveBeenCalled();
  });
  it('preserves pending candidate policy when a later check returns another update', async () => {
    const f = fixture(); await f.client.syncPending({ type: 'new', manifest: manifest('cached', 'manual', 'ota-force-store-update') });
    await f.client.check();
    expect(f.client.getSnapshot()).toMatchObject({ candidate: { manifest: { id: 'cached' } }, blocked: true });
  });
  it('re-evaluates a pending guard on retry after application conditions change', async () => {
    const f = fixture();
    await f.client.syncPending({ type: 'new', manifest: manifest('cached', 'manual', 'login') });
    f.configure({ guardHandlers: { login: async () => 'allow' } });
    await f.client.retry();
    expect(f.client.getSnapshot()).toMatchObject({ candidate: { manifest: { id: 'cached' } }, pending: true, blocked: false });
  });
  it('ignores an old native pending snapshot queued while a newer download completes', async () => {
    const f = fixture(); await f.client.check();
    const fetched = deferred<unknown>(); f.deps.fetch.mockReturnValue(fetched.promise);
    const downloading = f.client.download();
    await vi.waitFor(() => expect(f.deps.fetch).toHaveBeenCalledOnce());
    const syncing = f.client.syncPending({ type: 'new', manifest: manifest('old') });
    fetched.resolve({ isNew: true, manifest: manifest('latest', 'manual', 'ota-force-store-update') });
    await Promise.all([downloading, syncing]);
    expect(f.client.getSnapshot()).toMatchObject({ candidate: { manifest: { id: 'latest' } }, blocked: true, blockReason: 'ota-force-store-update' });
  });
  it('preserves force-store policy after the cached bundle cold-starts with no new update', async () => {
    const f = fixture(); f.deps.check.mockResolvedValue({ isAvailable: false });
    const client = createUpdateController({ ...f.deps, runningCandidate: () => ({ type: 'new', manifest: manifest('running', 'manual', 'ota-force-store-update') }) });
    await client.initialize();
    expect(client.getSnapshot()).toMatchObject({ blocked: true, blockReason: 'ota-force-store-update', pending: false });
    await client.check();
    expect(client.getSnapshot()).toMatchObject({ blocked: true, blockReason: 'ota-force-store-update', available: false });
    expect(f.deps.fetch).not.toHaveBeenCalled();
  });
  it('updates policy when a later native download replaces the pending bundle outside this controller', async () => {
    const f = fixture();
    await f.client.syncPending({ type: 'new', manifest: manifest('old') });
    await f.client.syncPending({ type: 'new', manifest: manifest('new-native-download', 'manual', 'ota-force-store-update') });
    expect(f.client.getSnapshot()).toMatchObject({ candidate: { manifest: { id: 'new-native-download' } }, blocked: true, blockReason: 'ota-force-store-update' });
    await expect(f.client.reload()).rejects.toThrow('guard');
    expect(f.deps.reload).not.toHaveBeenCalled();
  });
  it('does not force a second OTA installation for an already running force-OTA bundle', async () => {
    const f = fixture(); f.deps.check.mockResolvedValue({ isAvailable: false });
    const client = createUpdateController({ ...f.deps, runningCandidate: () => ({ type: 'new', manifest: manifest('running', 'manual', 'ota-force-update') }) });
    await client.initialize(); await client.check();
    expect(client.getSnapshot()).toMatchObject({ blocked: false, pending: false, available: false });
    expect(f.deps.fetch).not.toHaveBeenCalled();
  });
  it('evaluates a running custom guard using the application handler', async () => {
    const f = fixture(); f.deps.check.mockResolvedValue({ isAvailable: false });
    const client = createUpdateController({ ...f.deps, runningCandidate: () => ({ type: 'new', manifest: manifest('running', 'manual', 'login') }) });
    await client.initialize(); expect(client.getSnapshot()).toMatchObject({ blocked: true, blockReason: 'login' });
    const handler = vi.fn(async () => 'allow');
    client.configure(f.owner, { guardHandlers: { login: handler } });
    await client.check();
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ action: 'login', manifest: expect.objectContaining({ id: 'running' }) }));
    expect(client.getSnapshot()).toMatchObject({ blocked: false, available: false });
  });
});
