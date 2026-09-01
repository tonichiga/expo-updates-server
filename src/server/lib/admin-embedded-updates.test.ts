import { describe, expect, it } from "vitest";
import {
  buildEmbeddedUpdateUpsertRow,
  mapEmbeddedUpdateRow,
  parseRegisterEmbeddedUpdateInput,
} from "./admin-embedded-updates";

const baseInput = {
  embeddedUpdateId: "55555555-5555-4555-8555-555555555555",
  createdAt: "2026-01-01T00:00:00.000Z",
  channel: "production",
  platform: "ios" as const,
};

describe("embedded update app versions", () => {
  it("normalizes an incoming appVersion and remains compatible when absent", () => {
    expect(
      parseRegisterEmbeddedUpdateInput({
        ...baseInput,
        appVersion: " 2.4.1 ",
      }).appVersion,
    ).toBe("2.4.1");
    expect(parseRegisterEmbeddedUpdateInput(baseInput).appVersion).toBeNull();
  });

  it("does not include a missing appVersion in an upsert", () => {
    const row = buildEmbeddedUpdateUpsertRow({
      ...baseInput,
      appVersion: null,
    });

    expect(row).not.toHaveProperty("app_version");
  });

  it("includes a new non-empty appVersion so an upsert can update it", () => {
    const row = buildEmbeddedUpdateUpsertRow({
      ...baseInput,
      appVersion: "2.4.1",
    });

    expect(row).toHaveProperty("app_version", "2.4.1");
  });

  it("maps missing legacy values to null", () => {
    const item = mapEmbeddedUpdateRow({
      embedded_update_id: baseInput.embeddedUpdateId,
      created_at: baseInput.createdAt,
      channel: baseInput.channel,
      platform: baseInput.platform,
      is_embedded: true,
      inserted_at: baseInput.createdAt,
      modified_at: baseInput.createdAt,
    });

    expect(item.appVersion).toBeNull();
  });
});
