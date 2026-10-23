"use client";

import { Textarea } from "@/components/ui/textarea";

import { NativeSelect } from "@/components/ui/native-select";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input as TextInput } from "@/components/ui/input";

import {
  createGuardAction,
  deleteGuardAction,
  getGuardActions,
  getUpdatePolicy,
  putUpdatePolicy,
} from "@/src/client/admin-api";
import {
  GuardActionItem,
  UpdatePolicy,
  UpdatePolicyGuard,
} from "@/src/client/admin-types";
import GuardActionCombobox from "@/src/client/guard-action-combobox";
import {
  beginCatalogAttempt,
  GuardActionOption,
  isCurrentCatalogAttempt,
  mergeGuardActionOptions,
  normalizeCreatableGuardAction,
} from "@/src/client/guard-action-options";
import { FormEvent, useEffect, useRef, useState } from "react";

function payloadText(guard: UpdatePolicyGuard | null): string {
  return guard?.payload === undefined
    ? ""
    : JSON.stringify(guard.payload, null, 2);
}

export default function UpdatePolicyEditor({
  encodedKey,
  onSaved,
}: {
  encodedKey: string;
  onSaved: () => Promise<void>;
}) {
  const [policy, setPolicy] = useState<UpdatePolicy | null>(null);
  const [payload, setPayload] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [guardActions, setGuardActions] = useState<GuardActionItem[]>([]);
  const [canWriteGuardActions, setCanWriteGuardActions] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [catalogCreateValue, setCatalogCreateValue] = useState("");
  const [catalogCreateError, setCatalogCreateError] = useState("");
  const [catalogCreatePending, setCatalogCreatePending] = useState(false);
  const [actionError, setActionError] = useState("");
  const actionAttempt = useRef({ current: 0 });

  const loadGuardActions = async () => {
    try {
      const result = await getGuardActions();
      setGuardActions(result.items);
      setCanWriteGuardActions(result.canWrite);
      setCatalogError("");
    } catch (loadError: unknown) {
      setCatalogError(
        (loadError as Error).message || "Failed to load action catalog",
      );
    }
  };

  useEffect(() => {
    void getUpdatePolicy(encodedKey)
      .then((loaded) => {
        beginCatalogAttempt(actionAttempt.current);
        setActionError("");
        setPolicy(loaded);
        setPayload(payloadText(loaded.guard));
      })
      .catch((loadError: unknown) =>
        setError((loadError as Error).message || "Failed to load policy"),
      );
  }, [encodedKey]);

  useEffect(() => {
    void loadGuardActions();
  }, []);

  if (!policy) {
    return (
      <Card className="rounded-xl border border-border bg-card p-5 text-sm  shadow-none">
        {error || "Loading update policy…"}
      </Card>
    );
  }

  const readOnly = !policy.editable;
  const editingDisabled = readOnly || saving;
  const guardActionOptions = mergeGuardActionOptions(
    guardActions,
    policy.guard ? [policy.guard.action] : [],
  );

  const addGuardAction = (item: GuardActionItem) => {
    setGuardActions((current) => {
      const withoutDuplicate = current.filter(
        (candidate) => candidate.actionKey !== item.actionKey,
      );
      return [...withoutDuplicate, item].sort((left, right) =>
        left.actionKey.localeCompare(right.actionKey, "en"),
      );
    });
  };

  const changeGuardAction = (action: string) => {
    beginCatalogAttempt(actionAttempt.current);
    setActionError("");
    setPolicy((current) =>
      current?.guard
        ? { ...current, guard: { ...current.guard, action } }
        : current,
    );
  };

  const persistSelectedAction = async (action: string) => {
    const attempt = beginCatalogAttempt(actionAttempt.current);
    try {
      addGuardAction(await createGuardAction(action));
      if (isCurrentCatalogAttempt(actionAttempt.current, attempt)) {
        setActionError("");
      }
    } catch (createError: unknown) {
      if (isCurrentCatalogAttempt(actionAttempt.current, attempt)) {
        setActionError(
          (createError as Error).message ||
            "Action remains selected but was not saved to the catalog.",
        );
      }
    }
  };

  const createCatalogOnlyAction = async (event: FormEvent) => {
    event.preventDefault();
    let action: string;
    try {
      action = normalizeCreatableGuardAction(catalogCreateValue);
    } catch (validationError: unknown) {
      setCatalogCreateError((validationError as Error).message);
      return;
    }

    setCatalogCreatePending(true);
    setCatalogCreateError("");
    try {
      addGuardAction(await createGuardAction(action));
      setCatalogCreateValue("");
    } catch (createError: unknown) {
      setCatalogCreateError(
        (createError as Error).message ||
          "Failed to add action to the catalog.",
      );
    } finally {
      setCatalogCreatePending(false);
    }
  };

  const removeGuardAction = async (option: GuardActionOption) => {
    if (
      !option.id ||
      !window.confirm(
        `Delete "${option.actionKey}" from the action catalog? Existing policies are unaffected.`,
      )
    ) {
      return;
    }
    try {
      await deleteGuardAction(option.id);
      setGuardActions((current) =>
        current.filter((item) => item.id !== option.id),
      );
      setCatalogError("");
    } catch (deleteError: unknown) {
      setCatalogError(
        (deleteError as Error).message ||
          "Failed to delete action from catalog",
      );
    }
  };

  const save = async () => {
    setError("");
    setMessage("");
    setSaving(true);
    try {
      let guard: UpdatePolicyGuard | null = null;
      if (policy.guard) {
        if (!policy.guard.action) {
          throw new Error("Select or create a Guard action.");
        }
        const trimmedPayload = payload.trim();
        guard = {
          action: policy.guard.action,
          ...(trimmedPayload ? { payload: JSON.parse(trimmedPayload) } : {}),
        };
      }
      const saved = await putUpdatePolicy(
        encodedKey,
        { delivery: policy.delivery, guard },
        policy.policyVersion,
      );
      setPolicy(saved);
      setPayload(payloadText(saved.guard));
      setMessage(`Policy saved as version ${saved.policyVersion}.`);
      await onSaved();
    } catch (saveError: unknown) {
      setError(
        saveError instanceof SyntaxError
          ? "Guard payload must be valid JSON."
          : (saveError as Error).message || "Failed to save policy",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="gap-4 p-5 shadow-none">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Update policy</h2>
          <p className="text-xs text-muted-foreground">
            Version {policy.policyVersion}
            {policy.publishedAt
              ? ` · published ${new Date(policy.publishedAt).toLocaleString()}`
              : " · draft"}
          </p>
        </div>
        <label className="text-sm">
          Delivery{" "}
          <NativeSelect
            value={policy.delivery}
            disabled={editingDisabled}
            onChange={(event) =>
              setPolicy({
                ...policy,
                delivery: event.target.value as UpdatePolicy["delivery"],
              })
            }
            className="rounded-md border border-input bg-background px-2 py-2 "
          >
            <option value="manual">Manual</option>
            <option value="background">Background</option>
          </NativeSelect>
        </label>
      </div>

      {readOnly ? (
        <div className="rounded-md border border-border bg-muted/30 p-3 text-sm ">
          Published policies are read-only. Publish a new update ID to change
          policy.
        </div>
      ) : null}
      {policy.guard && policy.delivery === "manual" ? (
        <div className="rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
          <strong>Note:</strong> a Guard is usually paired with Background
          delivery so the candidate can fetch silently. Activation is still
          allowed.
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-600">{message}</p> : null}
      {catalogError ? (
        <div
          role="status"
          className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300"
        >
          <span>Action catalog: {catalogError}</span>
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => void loadGuardActions()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      {canWriteGuardActions ? (
        <form
          onSubmit={(event) => void createCatalogOnlyAction(event)}
          className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3 "
        >
          <label className="min-w-56 flex-1 text-xs text-muted-foreground">
            Add action to catalog
            <TextInput
              value={catalogCreateValue}
              maxLength={100}
              disabled={catalogCreatePending}
              onChange={(event) => {
                setCatalogCreateValue(event.target.value);
                setCatalogCreateError("");
              }}
              aria-describedby="guard-action-catalog-create-help"
              className="mt-1 w-full rounded border border-input bg-background p-2 text-sm "
              placeholder="Reusable action name"
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            type="submit"
            disabled={catalogCreatePending}
          >
            {catalogCreatePending ? "Adding…" : "Add to catalog"}
          </Button>
          <p
            id="guard-action-catalog-create-help"
            className="w-full text-xs text-muted-foreground"
          >
            Adds a reusable catalog item without changing this policy.
          </p>
          {catalogCreateError ? (
            <div
              role="status"
              className="flex w-full items-center gap-2 text-xs text-amber-700 dark:text-amber-300"
            >
              <span>{catalogCreateError}</span>
              <Button variant="outline" size="sm" type="submit">
                Retry
              </Button>
            </div>
          ) : null}
        </form>
      ) : null}
      <div className="space-y-2 rounded-md border border-border p-3 ">
        <h3 className="text-sm font-medium">Action catalog</h3>
        {guardActions.length > 0 ? (
          <ul
            aria-label="Guard action catalog entries"
            className="max-h-40 space-y-1 overflow-auto"
          >
            {guardActions.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2 rounded bg-muted/30 px-2 py-1 text-sm dark:bg-muted/20"
              >
                <span className="min-w-0 truncate" title={item.actionKey}>
                  {item.actionKey}
                </span>
                {canWriteGuardActions ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    type="button"
                    aria-label={`Delete ${item.actionKey} from action catalog`}
                    onClick={() =>
                      void removeGuardAction({
                        id: item.id,
                        actionKey: item.actionKey,
                        persisted: true,
                      })
                    }
                  >
                    Delete
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            No catalog actions found.
          </p>
        )}
      </div>

      <div className="space-y-3 rounded-lg border border-input p-3 ">
        <label className="flex items-center gap-2 text-sm font-medium">
          <input className="size-4 rounded border-input accent-primary"
            type="checkbox"
            checked={policy.guard !== null}
            disabled={editingDisabled}
            onChange={(event) => {
              beginCatalogAttempt(actionAttempt.current);
              setActionError("");
              setPolicy({
                ...policy,
                guard: event.target.checked
                  ? { action: guardActions[0]?.actionKey || "" }
                  : null,
              });
              if (!event.target.checked) setPayload("");
            }}
          />
          Guard enabled
        </label>
        <p className="text-xs text-muted-foreground">
          When enabled, this Guard applies unconditionally whenever this OTA is
          selected for a client.
        </p>
        {policy.guard ? (
          <>
            <GuardActionCombobox
              value={policy.guard.action}
              options={guardActionOptions}
              selectionDisabled={editingDisabled}
              canMutateCatalog={canWriteGuardActions}
              mutationError={actionError}
              onChange={changeGuardAction}
              onCreate={persistSelectedAction}
              onDelete={removeGuardAction}
              onRetry={
                actionError
                  ? () => persistSelectedAction(policy.guard?.action || "")
                  : undefined
              }
            />
            <label className="block text-xs text-muted-foreground">
              Optional custom JSON payload
              <Textarea
                value={payload}
                disabled={editingDisabled}
                onChange={(event) => setPayload(event.target.value)}
                className="mt-1 h-24 w-full rounded border border-input bg-background p-2 font-mono text-xs "
                placeholder='{"message":"Optional"}'
              />
            </label>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            No Guard will be emitted in the update manifest.
          </p>
        )}
      </div>

      <Button
        variant="default"
        size="sm"
        type="button"
        disabled={editingDisabled}
        onClick={() => void save()}
      >
        Save policy
      </Button>
    </Card>
  );
}
