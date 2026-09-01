export type UpdateItem = {
  key: string;
  encodedKey: string;
  appVersion: string | null;
  comment: string | null;
  runtimeVersion: string;
  platform: "ios" | "android";
  createdAtPath: string;
  channel: string;
  stage: string;
  updateId: string;
  createdAt: string;
  status: "active" | "disabled";
  isLatest: boolean;
  isRollbackActive: boolean;
  autoDeliveryEnabled: boolean;
  isIgnoredByRollback: boolean;
  assetsCount: number;
  deliveryMode: UpdateDeliveryMode;
  guardCount: number;
  policyVersion: number;
  policyPublishedAt: string | null;
  policyEditable: boolean;
};

export type UpdateDeliveryMode = "manual" | "background";
export type UpdatePolicyField =
  | "runtimeVersion"
  | "platform"
  | "channel"
  | "buildId"
  | "updateId"
  | "appVersion"
  | "currentUpdateId"
  | "embeddedUpdateId";
export type UpdatePolicyOperator =
  | "equals"
  | "notEquals"
  | "in"
  | "notIn"
  | "exists"
  | "notExists";
export type UpdatePolicyCondition = {
  field: UpdatePolicyField;
  operator: UpdatePolicyOperator;
  value?: string | string[];
};
export type UpdatePolicyRule = {
  id: string;
  enabled: boolean;
  priority: number;
  action: string;
  payload?: unknown;
  groups: Array<{ conditions: UpdatePolicyCondition[] }>;
};
export type UpdatePolicy = {
  delivery: UpdateDeliveryMode;
  rules: UpdatePolicyRule[];
  policyVersion: number;
  publishedAt: string | null;
  editable: boolean;
};

export type UpdatesListResponse = {
  items: UpdateItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  rollbackLockByScope: Array<{
    scopeKey: string;
    runtimeVersion: string;
    channel: string;
    platform: "ios" | "android";
    rollbackActive: boolean;
    autoDeliveryEnabled: boolean;
    activeUpdateId: string | null;
    latestUpdateId: string | null;
  }>;
};

export interface UpdateDetail extends UpdateItem {
  updateInfo: Record<string, unknown>;
  updateMeta: {
    isActive: boolean;
    updatedAt: string | null;
    disabledAt: string | null;
  };
  metadata: Record<string, unknown> | null;
  channelLatest: Record<string, unknown> | null;
}

export type EmbeddedUpdateItem = {
  embeddedUpdateId: string;
  appVersion: string | null;
  createdAt: string;
  channel: string;
  platform: "ios" | "android";
  isEmbedded: boolean;
  insertedAt: string;
  modifiedAt: string;
};

export type EmbeddedUpdatesListResponse = {
  items: EmbeddedUpdateItem[];
};

export type AdminRole = "admin" | "operator" | "viewer";

export type AdminSessionResponse = {
  authenticated: true;
  username: string;
  role: AdminRole;
};

export type EmergencyRedirectItem = {
  id: string;
  name: string;
  enabled: boolean;
  embeddedUpdateId: string;
  runtimeVersion: string;
  platform: "ios" | "android";
  fromChannel: string;
  toChannel: string;
  targetMode: "pinned" | "follow";
  expectedUpdateId: string | null;
  createdAt: string;
  modifiedAt: string;
};

export type EmergencyRedirectInput = Omit<
  EmergencyRedirectItem,
  "id" | "createdAt" | "modifiedAt"
>;

export type EmergencyRedirectsListResponse = {
  items: EmergencyRedirectItem[];
};
