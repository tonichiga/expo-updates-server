import { GuardActionItem } from "./admin-types";

export type GuardActionOption = {
  id: string | null;
  actionKey: string;
  persisted: boolean;
};

export type CatalogAttempt = { current: number };

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/;

export function normalizeCreatableGuardAction(input: string): string {
  const actionKey = input.trim();
  if (actionKey.length < 1 || actionKey.length > 100) {
    throw new Error("Action must contain between 1 and 100 characters.");
  }
  if (CONTROL_CHARACTER_PATTERN.test(actionKey)) {
    throw new Error("Action must not contain control characters.");
  }
  return actionKey;
}

export function mergeGuardActionOptions(
  catalog: GuardActionItem[],
  currentPolicyValues: string[],
): GuardActionOption[] {
  const options: GuardActionOption[] = catalog
    .map((item) => ({
      id: item.id,
      actionKey: item.actionKey,
      persisted: true,
    }))
    .sort((left, right) =>
      left.actionKey.localeCompare(right.actionKey, "en"),
    );
  const exactValues = new Set(options.map((option) => option.actionKey));

  for (const actionKey of currentPolicyValues) {
    if (actionKey.length === 0 || exactValues.has(actionKey)) {
      continue;
    }
    exactValues.add(actionKey);
    options.push({ id: null, actionKey, persisted: false });
  }

  return options;
}

export function filterGuardActionOptions(
  options: GuardActionOption[],
  query: string,
): GuardActionOption[] {
  const normalizedQuery = query.toLocaleLowerCase();
  return options.filter((option) =>
    option.actionKey.toLocaleLowerCase().includes(normalizedQuery),
  );
}

export function beginCatalogAttempt(attempt: CatalogAttempt): number {
  attempt.current += 1;
  return attempt.current;
}

export function isCurrentCatalogAttempt(
  state: CatalogAttempt,
  attempt: number,
): boolean {
  return state.current === attempt;
}
