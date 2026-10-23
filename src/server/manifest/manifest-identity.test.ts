import { describe, expect, it } from "vitest";
import { createServedManifestId } from "./manifest-identity";

const epoch = "33333333-3333-4333-8333-333333333333";
const artifact = "11111111-1111-4111-8111-111111111111";

describe("served manifest identity", () => {
  it("matches UUID v5 independently computed with Python uuid.uuid5", () => {
    expect(createServedManifestId(epoch, artifact)).toBe(
      "07ca31ab-9fad-5b74-a12b-1b6ae48a17d8",
    );
  });

  it("distinguishes artifacts and repeated publications of the same artifact", () => {
    const id = createServedManifestId(epoch, artifact);
    expect(createServedManifestId(epoch, "22222222-2222-4222-8222-222222222222")).not.toBe(id);
    expect(createServedManifestId("44444444-4444-4444-8444-444444444444", artifact)).not.toBe(id);
  });

  it("normalizes UUID casing", () => {
    const mixed = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
    expect(createServedManifestId(mixed.toUpperCase(), mixed.toUpperCase())).toBe(
      createServedManifestId(mixed, mixed),
    );
  });

  it.each([null, undefined, "", "invalid"])("rejects missing or corrupt epoch %s", (value) => {
    expect(() => createServedManifestId(value, artifact)).toThrow("valid channel epoch");
  });
});
