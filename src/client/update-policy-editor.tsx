"use client";

import {
  getUpdatePolicy,
  putUpdatePolicy,
} from "@/src/client/admin-api";
import {
  UpdatePolicy,
  UpdatePolicyCondition,
  UpdatePolicyField,
  UpdatePolicyOperator,
  UpdatePolicyRule,
} from "@/src/client/admin-types";
import { useEffect, useState } from "react";

const FIELDS: UpdatePolicyField[] = [
  "runtimeVersion",
  "platform",
  "channel",
  "buildId",
  "updateId",
  "appVersion",
  "currentUpdateId",
  "embeddedUpdateId",
];
const OPERATORS: UpdatePolicyOperator[] = [
  "equals",
  "notEquals",
  "in",
  "notIn",
  "exists",
  "notExists",
];

function newCondition(): UpdatePolicyCondition {
  return { field: "platform", operator: "equals", value: "" };
}

function newRule(index: number): UpdatePolicyRule {
  return {
    id: globalThis.crypto?.randomUUID?.() || `rule-${Date.now()}-${index}`,
    enabled: true,
    priority: index + 1,
    action: "",
    groups: [{ conditions: [newCondition()] }],
  };
}

export default function UpdatePolicyEditor({
  encodedKey,
  onSaved,
}: {
  encodedKey: string;
  onSaved: () => Promise<void>;
}) {
  const [policy, setPolicy] = useState<UpdatePolicy | null>(null);
  const [payloads, setPayloads] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getUpdatePolicy(encodedKey)
      .then((loaded) => {
        setPolicy(loaded);
        setPayloads(
          Object.fromEntries(
            loaded.rules.map((rule) => [
              rule.id,
              rule.payload === undefined
                ? ""
                : JSON.stringify(rule.payload, null, 2),
            ]),
          ),
        );
      })
      .catch((loadError: unknown) =>
        setError((loadError as Error).message || "Failed to load policy"),
      );
  }, [encodedKey]);

  if (!policy) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
        {error || "Loading update policy…"}
      </section>
    );
  }

  const readOnly = !policy.editable;
  const editingDisabled = readOnly || saving;
  const updateRule = (
    ruleIndex: number,
    update: (rule: UpdatePolicyRule) => UpdatePolicyRule,
  ) =>
    setPolicy((current) =>
      current
        ? {
            ...current,
            rules: current.rules.map((rule, index) =>
              index === ruleIndex ? update(rule) : rule,
            ),
          }
        : current,
    );

  const save = async () => {
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const rules = policy.rules.map((rule) => {
        const payloadText = payloads[rule.id]?.trim();
        if (!payloadText) {
          const withoutPayload = { ...rule };
          delete withoutPayload.payload;
          return withoutPayload;
        }
        try {
          return { ...rule, payload: JSON.parse(payloadText) };
        } catch {
          throw new Error(`Rule "${rule.id}" has invalid payload JSON.`);
        }
      });
      const saved = await putUpdatePolicy(
        encodedKey,
        { delivery: policy.delivery, rules },
        policy.policyVersion,
      );
      setPolicy(saved);
      setMessage(`Policy saved as version ${saved.policyVersion}.`);
      await onSaved();
    } catch (saveError: unknown) {
      setError((saveError as Error).message || "Failed to save policy");
    } finally {
      setSaving(false);
    }
  };

  const enabledCount = policy.rules.filter((rule) => rule.enabled).length;

  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Update policy</h2>
          <p className="text-xs text-zinc-500">
            Version {policy.policyVersion}
            {policy.publishedAt
              ? ` · published ${new Date(policy.publishedAt).toLocaleString()}`
              : " · draft"}
          </p>
        </div>
        <label className="text-sm">
          Delivery{" "}
          <select
            value={policy.delivery}
            disabled={editingDisabled}
            onChange={(event) =>
              setPolicy({
                ...policy,
                delivery: event.target.value as UpdatePolicy["delivery"],
              })
            }
            className="rounded-md border border-zinc-300 bg-transparent px-2 py-2 dark:border-zinc-700"
          >
            <option value="manual">Manual</option>
            <option value="background">Background</option>
          </select>
        </label>
      </div>

      {readOnly ? (
        <div className="rounded-md border border-zinc-300 bg-zinc-50 p-3 text-sm dark:border-zinc-700 dark:bg-zinc-950">
          Published policies are read-only. Publish a new update ID to change
          policy.
        </div>
      ) : null}
      {enabledCount > 0 && policy.delivery === "manual" ? (
        <div className="rounded-md border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200">
          <strong>Note:</strong> enabled guard rules are usually paired with
          Background delivery so the candidate can fetch silently. Activation
          is still allowed.
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-600">{message}</p> : null}

      {policy.rules.map((rule, ruleIndex) => (
        <fieldset
          key={rule.id}
          disabled={editingDisabled}
          className="space-y-3 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700"
        >
          <div className="flex flex-wrap items-center gap-2">
            <code className="max-w-48 truncate text-xs" title={rule.id}>
              {rule.id}
            </code>
            <label className="text-sm">
              <input
                type="checkbox"
                checked={rule.enabled}
                disabled={editingDisabled}
                onChange={(event) =>
                  updateRule(ruleIndex, (current) => ({
                    ...current,
                    enabled: event.target.checked,
                  }))
                }
                className="mr-1"
              />
              Enabled
            </label>
            <label className="flex items-center gap-2 text-sm">
              Priority
              <input
                type="number"
                min={0}
                value={rule.priority}
                disabled={editingDisabled}
                onChange={(event) =>
                  updateRule(ruleIndex, (current) => ({
                    ...current,
                    priority: Number(event.target.value),
                  }))
                }
                aria-describedby={`rule-priority-help-${ruleIndex}`}
                className="w-24 rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700"
              />
            </label>
            <input
              value={rule.action}
              maxLength={100}
              disabled={editingDisabled}
              onChange={(event) =>
                updateRule(ruleIndex, (current) => ({
                  ...current,
                  action: event.target.value,
                }))
              }
              aria-label="Rule action"
              className="min-w-56 flex-1 rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700"
              placeholder="Action (required)"
            />
            <button
              type="button"
              disabled={editingDisabled}
              onClick={() =>
                setPolicy({
                  ...policy,
                  rules: policy.rules.filter((_, index) => index !== ruleIndex),
                })
              }
              className="rounded border border-red-300 px-3 py-2 text-sm text-red-600"
            >
              Remove rule
            </button>
          </div>
          <p
            id={`rule-priority-help-${ruleIndex}`}
            className="text-xs text-zinc-500"
          >
            Lower numbers run first. Compared only among Guard rules attached
            to this update—not across OTA updates or versions.
          </p>
          <label className="block text-xs text-zinc-500">
            Optional payload JSON
            <textarea
              value={payloads[rule.id] || ""}
              disabled={editingDisabled}
              onChange={(event) =>
                setPayloads((current) => ({
                  ...current,
                  [rule.id]: event.target.value,
                }))
              }
              className="mt-1 h-20 w-full rounded border border-zinc-300 bg-transparent p-2 font-mono text-xs dark:border-zinc-700"
              placeholder='{"message":"Optional"}'
            />
          </label>

          {rule.groups.map((group, groupIndex) => (
            <div
              key={`${rule.id}-group-${groupIndex}`}
              className="space-y-2 rounded border border-dashed border-zinc-300 p-2 dark:border-zinc-700"
            >
              <div className="flex justify-between text-xs font-medium">
                <span>OR group {groupIndex + 1} (all rows are AND)</span>
                <button
                  type="button"
                  onClick={() =>
                    updateRule(ruleIndex, (current) => ({
                      ...current,
                      groups: current.groups.filter(
                        (_, index) => index !== groupIndex,
                      ),
                    }))
                  }
                  disabled={editingDisabled || rule.groups.length === 1}
                  className="text-red-600 disabled:opacity-40"
                >
                  Remove group
                </button>
              </div>
              {group.conditions.map((condition, conditionIndex) => (
                <div
                  key={`${rule.id}-${groupIndex}-${conditionIndex}`}
                  className="flex flex-wrap gap-2"
                >
                  <select
                    value={condition.field}
                    disabled={editingDisabled}
                    onChange={(event) =>
                      updateRule(ruleIndex, (current) => ({
                        ...current,
                        groups: current.groups.map((item, index) =>
                          index === groupIndex
                            ? {
                                conditions: item.conditions.map((row, rowIndex) =>
                                  rowIndex === conditionIndex
                                    ? {
                                        ...row,
                                        field: event.target
                                          .value as UpdatePolicyField,
                                      }
                                    : row,
                                ),
                              }
                            : item,
                        ),
                      }))
                    }
                    className="rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700"
                  >
                    {FIELDS.map((field) => (
                      <option key={field}>{field}</option>
                    ))}
                  </select>
                  <select
                    value={condition.operator}
                    disabled={editingDisabled}
                    onChange={(event) => {
                      const operator = event.target
                        .value as UpdatePolicyOperator;
                      updateRule(ruleIndex, (current) => ({
                        ...current,
                        groups: current.groups.map((item, index) =>
                          index === groupIndex
                            ? {
                                conditions: item.conditions.map((row, rowIndex) =>
                                  rowIndex === conditionIndex
                                    ? {
                                        field: row.field,
                                        operator,
                                        ...(!["exists", "notExists"].includes(
                                          operator,
                                        )
                                          ? {
                                              value: ["in", "notIn"].includes(
                                                operator,
                                              )
                                                ? []
                                                : "",
                                            }
                                          : {}),
                                      }
                                    : row,
                                ),
                              }
                            : item,
                        ),
                      }));
                    }}
                    className="rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700"
                  >
                    {OPERATORS.map((operator) => (
                      <option key={operator}>{operator}</option>
                    ))}
                  </select>
                  {!["exists", "notExists"].includes(condition.operator) ? (
                    <input
                      disabled={editingDisabled}
                      value={
                        Array.isArray(condition.value)
                          ? condition.value.join(", ")
                          : condition.value || ""
                      }
                      onChange={(event) =>
                        updateRule(ruleIndex, (current) => ({
                          ...current,
                          groups: current.groups.map((item, index) =>
                            index === groupIndex
                              ? {
                                  conditions: item.conditions.map(
                                    (row, rowIndex) =>
                                      rowIndex === conditionIndex
                                        ? {
                                            ...row,
                                            value: ["in", "notIn"].includes(
                                              row.operator,
                                            )
                                              ? event.target.value.split(",")
                                              : event.target.value,
                                          }
                                        : row,
                                  ),
                                }
                              : item,
                          ),
                        }))
                      }
                      className="min-w-48 flex-1 rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700"
                      placeholder={
                        ["in", "notIn"].includes(condition.operator)
                          ? "comma, separated, values"
                          : "value"
                      }
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={() =>
                      updateRule(ruleIndex, (current) => ({
                        ...current,
                        groups: current.groups.map((item, index) =>
                          index === groupIndex
                            ? {
                                conditions: item.conditions.filter(
                                  (_, rowIndex) =>
                                    rowIndex !== conditionIndex,
                                ),
                              }
                            : item,
                        ),
                      }))
                    }
                    disabled={
                      editingDisabled || group.conditions.length === 1
                    }
                    className="rounded border px-2 text-sm disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  updateRule(ruleIndex, (current) => ({
                    ...current,
                    groups: current.groups.map((item, index) =>
                      index === groupIndex
                        ? {
                            conditions: [
                              ...item.conditions,
                              newCondition(),
                            ],
                          }
                        : item,
                    ),
                  }))
                }
                disabled={
                  editingDisabled || group.conditions.length >= 20
                }
                className="rounded border px-3 py-2 text-xs"
              >
                Add AND condition
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              updateRule(ruleIndex, (current) => ({
                ...current,
                groups: [
                  ...current.groups,
                  { conditions: [newCondition()] },
                ],
              }))
            }
            disabled={editingDisabled || rule.groups.length >= 10}
            className="rounded border px-3 py-2 text-xs"
          >
            Add OR group
          </button>
        </fieldset>
      ))}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={editingDisabled || policy.rules.length >= 50}
          onClick={() =>
            setPolicy({
              ...policy,
              rules: [
                ...policy.rules,
                newRule(
                  Math.max(
                    0,
                    ...policy.rules.map((rule) => rule.priority),
                  ),
                ),
              ],
            })
          }
          className="rounded border border-zinc-300 px-4 py-2 text-sm disabled:opacity-40"
        >
          Add rule
        </button>
        <button
          type="button"
          disabled={editingDisabled}
          onClick={() => void save()}
          className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-40"
        >
          Save complete policy
        </button>
      </div>
    </section>
  );
}
