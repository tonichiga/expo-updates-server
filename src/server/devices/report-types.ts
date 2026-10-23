export type DevicePlatform = "ios" | "android";
export type DeviceLaunchKind = "ota" | "embedded" | "unknown";
export type DeviceReportDays = 1 | 7 | 30;

export type DeviceReportFilters = {
  days: DeviceReportDays;
  platform: DevicePlatform | null;
  channel: string | null;
  runtime: string | null;
  launchKind: DeviceLaunchKind | null;
  search: string | null;
};

export type DeviceInstallation = {
  device_id?: string | null;
  installation_id: string;
  platform: DevicePlatform;
  runtime_version: string;
  channel: string;
  native_version: string | null;
  native_build: string | null;
  launch_kind: DeviceLaunchKind;
  reported_update_id: string | null;
  resolved_update_id: string | null;
  update_label: string | null;
  emergency_launch: boolean;
  observed_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
};

export type DeviceVersion = {
  /** Published app version; null when artifact metadata is unavailable. */
  app_version: string | null;
  platform: DevicePlatform;
  channel: string;
  runtime_version: string;
  native_version: string | null;
  native_build: string | null;
  launch_kind: DeviceLaunchKind;
  update_id: string | null;
  update_label: string | null;
  installations: number;
};

export type DeviceActivityDay = {
  date: string;
  activeInstallations: number | null;
  newInstallations: number | null;
  coverage: "complete" | "partial" | "unavailable";
};

export type DeviceRetentionCell = {
  day: 0 | 1 | 7 | 14 | 30;
  eligibleInstallations: number;
  retainedInstallations: number | null;
  /** Fraction from 0 to 1; null means no fully observed eligible day yet. */
  rate: number | null;
};

export type DeviceRetentionCohort = {
  weekStart: string;
  installations: number;
  cells: DeviceRetentionCell[];
};

/** Current composition of the selected recently active population, not retention. */
export type DeviceAdoptionCohort = {
  weekStart: string;
  installations: number;
  otaInstallations: number;
  embeddedInstallations: number;
  unknownInstallations: number;
};

export type DevicesReport = {
  total: number;
  pageSize: number;
  offset: number;
  devices: DeviceInstallation[];
  versions: DeviceVersion[];
  filters: DeviceReportFilters;
  options: {
    platforms: DevicePlatform[];
    channels: string[];
    runtimes: string[];
    launchKinds: DeviceLaunchKind[];
  };
  summary: {
    activeInstallations: number;
    newInstallations: number;
    otaInstallations: number;
    embeddedInstallations: number;
    unknownInstallations: number;
    emergencyInstallations: number;
    reportedVersions: number;
  };
  activity: DeviceActivityDay[];
  adoptionCohorts: DeviceAdoptionCohort[];
  cohorts: DeviceRetentionCohort[];
  coverage: {
    collectionStartedAt: string;
    retainedFrom: string;
    timezone: "UTC";
    retentionDays: 90;
    cohortWindowDays: 90;
    activityBasis: "accepted-heartbeat-receipt";
    cohortBasis: "first-recorded-heartbeat";
    cohortFilters: "entry-state";
    todayIsPartial: true;
    generatedAt: string;
    windowStartedAt: string;
  };
};
