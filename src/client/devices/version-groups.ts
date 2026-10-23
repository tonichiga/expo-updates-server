import type { DeviceVersion } from "@/src/server/devices/report-types";
export type ChartVersion = {
  key: string;
  appVersion: string | null;
  updateId: string | null;
  kind: DeviceVersion["launch_kind"];
  installations: number;
  nativeBuilds: string[];
};
export type VersionScope = {
  key: string;
  channel: string;
  platform: DeviceVersion["platform"];
  total: number;
  versions: ChartVersion[];
};
export type RuntimeGroup = {
  runtime: string;
  total: number;
  scopes: VersionScope[];
};
export function groupVersions(versions: DeviceVersion[]): RuntimeGroup[] {
  const runtimes = new Map<
    string,
    {
      total: number;
      scopes: Map<
        string,
        { scope: VersionScope; versions: Map<string, ChartVersion> }
      >;
    }
  >();
  for (const version of versions) {
    let runtime = runtimes.get(version.runtime_version);
    if (!runtime) {
      runtime = { total: 0, scopes: new Map() };
      runtimes.set(version.runtime_version, runtime);
    }
    const scopeKey = JSON.stringify([version.channel, version.platform]);
    let group = runtime.scopes.get(scopeKey);
    if (!group) {
      group = {
        scope: {
          key: scopeKey,
          channel: version.channel,
          platform: version.platform,
          total: 0,
          versions: [],
        },
        versions: new Map(),
      };
      runtime.scopes.set(scopeKey, group);
    }
    // Same OTA can run on several native builds; it remains one version bar.
    // Without an artifact ID, keep native builds separate instead of inventing identity.
    const key = JSON.stringify([
      version.launch_kind,
      version.update_id,
      version.app_version ?? null,
      ...(version.update_id
        ? []
        : [version.native_version, version.native_build]),
    ]);
    let row = group.versions.get(key);
    if (!row) {
      row = {
        key,
        appVersion: version.app_version ?? null,
        updateId: version.update_id,
        kind: version.launch_kind,
        installations: 0,
        nativeBuilds: [],
      };
      group.versions.set(key, row);
    }
    const native = `${version.native_version || "—"} (${version.native_build || "—"})`;
    if (!row.nativeBuilds.includes(native)) row.nativeBuilds.push(native);
    row.installations += version.installations;
    group.scope.total += version.installations;
    runtime.total += version.installations;
  }
  return [...runtimes]
    .map(([runtime, data]) => ({
      runtime,
      total: data.total,
      scopes: [...data.scopes.values()]
        .map(({ scope, versions }) => ({
          ...scope,
          versions: [...versions.values()].sort(
            (a, b) =>
              b.installations - a.installations || a.key.localeCompare(b.key),
          ),
        }))
        .sort(
          (a, b) =>
            a.channel.localeCompare(b.channel) ||
            a.platform.localeCompare(b.platform),
        ),
    }))
    .sort((a, b) => b.total - a.total || a.runtime.localeCompare(b.runtime));
}
