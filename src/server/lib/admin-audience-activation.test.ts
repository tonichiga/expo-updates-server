import { beforeEach, expect, it, vi } from 'vitest';
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ updates: [] as Row[], channels: [] as Row[], blocked: false }));
vi.mock('./distribution-control', () => ({ assertOtaDistributionAllowed: async () => undefined }));
vi.mock('./supabase.js', () => {
  class Query {
    filters: Array<(r: Row) => boolean> = [];
    patch: Row | null = null;
    limitCount = Infinity;
    upsertRow: Row | null = null;
    orderFields: string[] = [];
    constructor(private table: string) {}
    select() { return this; }
    eq(k: string, v: unknown) { this.filters.push(r => r[k] === v); return this; }
    neq(k: string, v: unknown) { this.filters.push(r => r[k] !== v); return this; }
    not(k: string, op: string, v: unknown) { void op; this.filters.push(r => r[k] !== v); return this; }
    order(k: string) { this.orderFields.push(k); return this; }
    limit(n: number) { this.limitCount = n; return this; }
    update(p: Row) { this.patch = p; return this; }
    upsert(p: Row) { this.upsertRow = p; return this; }
    async execute() {
      const rows = this.table === 'ota_updates' ? db.updates : db.channels;
      if (this.upsertRow) {
        if (this.table === 'ota_update_channels' && db.blocked) return { data: [], error: { message: 'OTA_DISTRIBUTION_BLOCKED: INSERT guard runs before ON CONFLICT' } };
        const row = rows.find(r => r.runtime_version === this.upsertRow!.runtime_version && r.channel === this.upsertRow!.channel && r.platform === this.upsertRow!.platform);
        if (row) Object.assign(row, this.upsertRow); else rows.push(this.upsertRow);
        return { data: [row || this.upsertRow], error: null };
      }
      let found = rows.filter(r => this.filters.every(f => f(r)));
      if (this.orderFields.length) found = found.sort((a, b) => {
        for (const field of this.orderFields) {
          const compared = String(b[field]).localeCompare(String(a[field]));
          if (compared) return compared;
        }
        return 0;
      });
      found = found.slice(0, this.limitCount);
      if (this.patch) found.forEach(r => {
        // Mirror the activation trigger here; its atomic/concurrent behavior is
        // exercised against PostgreSQL by device-targeting-activation.mjs.
        if (this.table === 'ota_updates' && this.patch!.is_active === true && r.audience_mode === 'all') {
          rows.filter(other => other !== r && other.runtime_version === r.runtime_version && other.channel === r.channel && other.platform === r.platform)
            .forEach(other => Object.assign(other, { is_active: false, disabled_at: 'now' }));
        }
        Object.assign(r, this.patch);
      });
      return { data: found, error: null };
    }
    async maybeSingle() { const r = await this.execute(); return { ...r, data: r.data[0] || null }; }
    single() { return this.maybeSingle(); }
    then(resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) { return this.execute().then(resolve, reject); }
  }
  return { supabase: { from: (table: string) => new Query(table) }, jsonb: (v: unknown) => v, SUPABASE_BUCKET: 'test' };
});
import { setUpdateDisabledByKey, promoteLatestByKey, rollbackToUpdateByKey } from './admin-updates';
const older = '11111111-1111-4111-8111-111111111111', newer = '22222222-2222-4222-8222-222222222222';
const scope = { runtime_version: 'r1', channel: 'test', platform: 'android' };
beforeEach(() => {
  db.blocked = false;
  db.updates = [
    { ...scope, update_id: older, created_at: '2026-10-20', created_at_path: 'old', is_active: true, audience_mode: 'all' },
    { ...scope, update_id: newer, created_at: '2026-10-21', created_at_path: 'new', is_active: false, audience_mode: 'devices' },
  ];
  db.channels = [{ ...scope, latest_update_id: newer, active_update_id: null, latest_created_at: '2026-10-21' }];
});
it('preserves public fallback on targeted activation and removes it on normal public activation', async () => {
  await setUpdateDisabledByKey(newer, false);
  expect(db.updates.map(r => r.is_active)).toEqual([true, true]);
  db.updates[1].audience_mode = 'all';
  await setUpdateDisabledByKey(newer, false);
  expect(db.updates.map(r => r.is_active)).toEqual([false, true]);
});
it('promotes targeted latest out of rollback without disabling the public fallback', async () => {
  db.channels[0].active_update_id = older;
  await promoteLatestByKey(newer);
  expect(db.updates.map(r => r.is_active)).toEqual([true, true]);
  expect(db.channels[0].active_update_id).toBeNull();
});
it('keeps other audiences live when rolling back selected devices', async () => {
  Object.assign(db.updates[0], { audience_mode: 'devices', is_active: false });
  Object.assign(db.updates[1], { audience_mode: 'all', is_active: true });
  await rollbackToUpdateByKey(older);
  expect(db.updates.map(r => r.is_active)).toEqual([true, true]);
  expect(db.channels[0].active_update_id).toBe(older);
});

it('repairs an existing channel with UPDATE when deactivating under the global stop', async () => {
  db.updates[1].is_active = true;
  db.blocked = true;
  const result = await setUpdateDisabledByKey(newer, true);
  expect(db.updates.map(r => r.is_active)).toEqual([true, false]);
  expect(result.disabled).toBe(true);
  expect(db.channels[0].latest_update_id).toBe(older);
});
