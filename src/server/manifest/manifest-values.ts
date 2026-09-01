export function normalizeId(
  value: string | null | undefined,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

export function debugString(value: string | null | undefined): string {
  return normalizeId(value) || "none";
}

export function getManifestAppVersion(manifest: unknown): string | null {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return null;
  }

  const manifestRecord = manifest as Record<string, unknown>;
  const extra =
    manifestRecord.extra &&
    typeof manifestRecord.extra === "object" &&
    !Array.isArray(manifestRecord.extra)
      ? (manifestRecord.extra as Record<string, unknown>)
      : null;
  for (const expoClient of [extra?.expoClient, manifestRecord.expoClient]) {
    if (
      expoClient &&
      typeof expoClient === "object" &&
      !Array.isArray(expoClient)
    ) {
      const version = (expoClient as Record<string, unknown>).version;
      if (typeof version === "string" && version.trim()) {
        return version.trim();
      }
    }
  }

  return null;
}

type ParsedAppVersion = {
  core: string[];
  prerelease: string[] | null;
};

function parseAppVersion(value: string): ParsedAppVersion | null {
  const normalized = value.trim();
  const match =
    /^(0|[1-9]\d*(?:\.(?:0|[1-9]\d*))*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      normalized,
    );
  if (!match) {
    return null;
  }

  const prerelease = match[2]?.split(".") ?? null;
  if (
    prerelease?.some(
      (identifier) =>
        /^\d+$/.test(identifier) &&
        identifier.length > 1 &&
        identifier.startsWith("0"),
    )
  ) {
    return null;
  }

  return {
    core: match[1].split("."),
    prerelease,
  };
}

function compareNumericIdentifiers(left: string, right: string): -1 | 0 | 1 {
  if (left.length !== right.length) {
    return left.length < right.length ? -1 : 1;
  }
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
}

/**
 * Compares semver-style numeric app versions without coercing numeric
 * identifiers to JavaScript numbers. Build metadata is ignored.
 *
 * Returns null when either value is malformed and cannot be compared safely.
 */
export function compareAppVersions(
  left: string | null | undefined,
  right: string | null | undefined,
): -1 | 0 | 1 | null {
  if (typeof left !== "string" || typeof right !== "string") {
    return null;
  }

  const parsedLeft = parseAppVersion(left);
  const parsedRight = parseAppVersion(right);
  if (!parsedLeft || !parsedRight) {
    return null;
  }

  const coreLength = Math.max(parsedLeft.core.length, parsedRight.core.length);
  for (let index = 0; index < coreLength; index += 1) {
    const comparison = compareNumericIdentifiers(
      parsedLeft.core[index] ?? "0",
      parsedRight.core[index] ?? "0",
    );
    if (comparison !== 0) {
      return comparison;
    }
  }

  const leftPrerelease = parsedLeft.prerelease;
  const rightPrerelease = parsedRight.prerelease;
  if (!leftPrerelease && !rightPrerelease) {
    return 0;
  }
  if (!leftPrerelease) {
    return 1;
  }
  if (!rightPrerelease) {
    return -1;
  }

  const prereleaseLength = Math.max(
    leftPrerelease.length,
    rightPrerelease.length,
  );
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftIdentifier = leftPrerelease[index];
    const rightIdentifier = rightPrerelease[index];
    if (leftIdentifier === undefined) {
      return -1;
    }
    if (rightIdentifier === undefined) {
      return 1;
    }
    if (leftIdentifier === rightIdentifier) {
      continue;
    }

    const leftIsNumeric = /^\d+$/.test(leftIdentifier);
    const rightIsNumeric = /^\d+$/.test(rightIdentifier);
    if (leftIsNumeric && rightIsNumeric) {
      return compareNumericIdentifiers(leftIdentifier, rightIdentifier);
    }
    if (leftIsNumeric !== rightIsNumeric) {
      return leftIsNumeric ? -1 : 1;
    }
    return leftIdentifier > rightIdentifier ? 1 : -1;
  }

  return 0;
}

export function normalizeExpoManifestDate(
  value: string | Date | null | undefined,
): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

export function latestExpoManifestDate(
  ...values: Array<string | Date | null | undefined>
): string | null {
  const normalized = values
    .map(normalizeExpoManifestDate)
    .filter((value): value is string => value !== null);

  if (normalized.length === 0) {
    return null;
  }

  return normalized.reduce((latest, value) =>
    Date.parse(value) > Date.parse(latest) ? value : latest,
  );
}

export function isSameOrNewerDate(
  candidate: string | null | undefined,
  baseline: string | null | undefined,
): boolean {
  if (!candidate || !baseline) {
    return false;
  }

  const candidateTs = Date.parse(candidate);
  const baselineTs = Date.parse(baseline);
  if (Number.isNaN(candidateTs) || Number.isNaN(baselineTs)) {
    return false;
  }

  return candidateTs >= baselineTs;
}
