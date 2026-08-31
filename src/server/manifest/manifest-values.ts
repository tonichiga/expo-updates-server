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
