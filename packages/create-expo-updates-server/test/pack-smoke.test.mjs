import assert from "node:assert/strict";
import { test } from "node:test";

import {
  maximumPackedFileSize,
  maximumPackedSize,
  maximumUnpackedSize,
  validatePackResult,
} from "../scripts/pack-smoke.mjs";

test("pack metadata enforces compressed, unpacked, and per-file limits", () => {
  assert.doesNotThrow(() =>
    validatePackResult({
      size: maximumPackedSize,
      unpackedSize: maximumUnpackedSize,
      files: [{ path: "dist/template/file", size: maximumPackedFileSize }],
    }),
  );

  for (const packResult of [
    {
      size: maximumPackedSize + 1,
      unpackedSize: 1,
      files: [],
    },
    {
      size: 1,
      unpackedSize: maximumUnpackedSize + 1,
      files: [],
    },
    {
      size: 1,
      unpackedSize: 1,
      files: [
        {
          path: "dist/template/oversized",
          size: maximumPackedFileSize + 1,
        },
      ],
    },
  ]) {
    assert.throws(() => validatePackResult(packResult), /exceeds/);
  }
});
