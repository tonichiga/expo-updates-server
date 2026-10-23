// Synthetic data only. Nothing here is written to a server/database.
const id = (n) => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const date = (day) => `2026-10-${day}T10:30:00.000Z`;
export const devices = ['Release owner · Pixel 9', 'QA · Galaxy S24', 'QA · Pixel 8', 'Beta tester · OnePlus 12'].map((name, n) => ({
  name, installation_id: id(100 + n), device_id: String(n + 1).repeat(64), platform: 'android', runtime_version: '2.4.0', channel: 'production',
}));
export const updates = Array.from({ length: 8 }, (_, n) => ({
  key: id(n + 1), encodedKey: Buffer.from(id(n + 1)).toString('base64url'), updateId: id(n + 1),
  appVersion: ['2.4.3', '2.4.3', '2.4.2', '2.4.2', '2.4.1', '2.4.1', '2.3.4', '2.3.4'][n],
  comment: ['Checkout polish · smoke test', 'Checkout polish · smoke test', 'Faster app startup', 'Faster app startup', 'New search experience', 'New search experience', 'Navigation improvements', 'Navigation improvements'][n],
  runtimeVersion: n < 6 ? '2.4.0' : '2.3.0', platform: n % 2 ? 'ios' : 'android',
  createdAtPath: '202610231030', channel: 'production', stage: 'production', createdAt: date(23 - n),
  status: n === 2 || n === 3 ? 'active' : 'disabled', audienceMode: n < 2 ? 'devices' : 'all',
  isLatest: n < 2, isRollbackActive: false, autoDeliveryEnabled: true, isIgnoredByRollback: false,
  assetsCount: 24 + n, deliveryMode: 'background', hasGuard: false, policyVersion: 1,
  policyPublishedAt: n < 2 ? null : date(23 - n), policyEditable: n < 2,
}));
const versions = [8240, 2560, 1680].map((installations, n) => ({
  app_version: ['2.4.2', '2.4.1', '2.4.0'][n], platform: 'android', channel: 'production', runtime_version: '2.4.0',
  native_version: '2.4.0', native_build: '42', launch_kind: n === 2 ? 'embedded' : 'ota',
  update_id: id(n + 3), update_label: null, installations,
}));
const populations = [800, 1440, 2240, 2480, 2720, 2800];
const ota = [640, 1152, 1960, 2232, 2448, 2368];
const weeks = ['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19'];
export function report(url) {
  const snapshot = {
    total: 12480, pageSize: 50, offset: 0,
    filters: { days: Number(url.searchParams.get('days') || 7), platform: url.searchParams.get('platform'), channel: url.searchParams.get('channel'), runtime: url.searchParams.get('runtime'), launchKind: null, search: null },
    options: { platforms: ['android', 'ios'], channels: ['production', 'beta'], runtimes: ['2.4.0', '2.3.0'], launchKinds: ['ota', 'embedded'] },
    summary: { activeInstallations: 12480, newInstallations: 920, otaInstallations: 10800, embeddedInstallations: 1680, unknownInstallations: 0, emergencyInstallations: 0, reportedVersions: 3 },
    versions,
    devices: Array.from({ length: 12 }, (_, n) => ({ ...devices[n % 4], installation_id: id(100 + n), native_version: '2.4.0', native_build: '42', launch_kind: n < 10 ? 'ota' : 'embedded', reported_update_id: id(n < 10 ? 3 : 5), resolved_update_id: id(n < 10 ? 3 : 5), update_label: n < 10 ? '2.4.2' : '2.4.0', emergency_launch: false, observed_at: date(23), first_seen_at: '2026-09-21T12:00:00Z', last_seen_at: date(23) })),
    activity: [8420, 9120, 8960, 10240, 10940, 11480, 12480].map((activeInstallations, n) => ({ date: `2026-10-${17 + n}`, activeInstallations, newInstallations: [110, 130, 120, 140, 124, 146, 150][n], coverage: n === 6 ? 'partial' : 'complete' })),
    adoptionCohorts: weeks.map((weekStart, n) => ({ weekStart, installations: populations[n], otaInstallations: ota[n], embeddedInstallations: populations[n] - ota[n], unknownInstallations: 0 })),
    cohorts: weeks.map((weekStart, n) => ({ weekStart, installations: populations[n], cells: [0, 1, 7, 14, 30].map((day, i) => { const mature = day <= 39 - n * 7; const rate = [1, .82, .69, .62, .54][i]; return { day, eligibleInstallations: mature ? populations[n] : 0, retainedInstallations: mature ? Math.round(populations[n] * rate) : null, rate: mature ? rate : null }; }) })),
    coverage: { collectionStartedAt: '2026-08-01T00:00:00Z', retainedFrom: '2026-08-01', timezone: 'UTC', retentionDays: 90, cohortWindowDays: 90, activityBasis: 'accepted-heartbeat-receipt', cohortBasis: 'first-recorded-heartbeat', cohortFilters: 'entry-state', todayIsPartial: true, generatedAt: date(23), windowStartedAt: date(17) },
  };
  const countKeys = new Set(['total', 'installations', 'activeInstallations', 'newInstallations', 'otaInstallations', 'embeddedInstallations', 'unknownInstallations', 'emergencyInstallations', 'eligibleInstallations', 'retainedInstallations']);
  function scale(value, key) {
    if (typeof value === 'number' && countKeys.has(key)) return Math.round(value / 2);
    if (Array.isArray(value)) return value.map((item) => scale(item));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scale(v, k)]));
    return value;
  }
  return scale(snapshot);
}
export function responseFor(url) {
  const pathname = url.pathname;
  if (pathname === '/api/admin/session') return { authenticated: true, username: 'demo.operator', role: 'admin' };
  if (pathname === '/api/admin/distribution-control') return { blocked: false, canWrite: true, version: 1, reason: null, changedAt: date(23), changedBy: { type: 'session', id: 'demo', label: 'demo.operator', role: 'admin' } };
  if (pathname === '/api/admin/devices') return report(url);
  if (pathname === '/api/admin/device-targets') return { devices };
  if (pathname === '/api/admin/guard-actions') return { items: [{ id: id(50), actionKey: 'ota-force-update' }, { id: id(51), actionKey: 'ota-force-store-update' }], canWrite: true };
  if (pathname === '/api/admin/updates') return { items: updates, total: updates.length, totalPages: 1, page: 1, pageSize: 20, rollbackLockByScope: [] };
  if (pathname.endsWith('/audience')) return { audience_mode: 'devices', audience_device_ids: devices.slice(0, 2).map((d) => d.device_id), audience_installation_ids: [], audience_version: 1 };
  if (pathname.endsWith('/policy')) return { delivery: 'background', guard: null, policyVersion: 1, publishedAt: null, editable: true };
  if (pathname.startsWith('/api/admin/updates/')) return { ...updates[0], updateInfo: { version: '2.4.3', message: updates[0].comment }, updateMeta: { isActive: false, updatedAt: date(23), disabledAt: null }, metadata: { platform: 'android' }, channelLatest: null };
  return undefined;
}
