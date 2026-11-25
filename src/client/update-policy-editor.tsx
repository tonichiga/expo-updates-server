"use client";
import { AdminRoleContext } from "@/components/admin/admin-role";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import {
  ChevronDown,
  Download,
  ShieldCheck,
  MousePointer2,
  Store,
  Braces,
  LockKeyhole,
} from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  behaviors,
  chooseBehavior,
  draftFromPolicy,
  policyFromDraft,
  setStoreLink,
  storePayloadObject,
  validStoreLink,
  type PolicyDraft,
  type PolicyBehavior,
} from "./policy-draft";
import GuardActionCatalog from "./guard-action-catalog";
import type { TranslationMessage } from "@/src/client/i18n/messages";
import { useI18n } from "@/src/client/i18n/provider";

import { Textarea } from "@/components/ui/textarea";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input as TextInput } from "@/components/ui/input";

import {
  createGuardAction,
  getGuardActions,
  getUpdatePolicy,
  putUpdatePolicy,
} from "@/src/client/admin-api";
import { GuardActionItem, UpdatePolicy } from "@/src/client/admin-types";
import GuardActionPicker from "@/src/client/guard-action-combobox";
import {
  beginCatalogAttempt,
  isCurrentCatalogAttempt,
  mergeGuardActionOptions,
} from "@/src/client/guard-action-options";
import { useContext, useEffect, useRef, useState } from "react";

const profiles = {
  manual: {
    label: "Optional update",
    description:
      "Users can download the update, restart to apply it, or continue with their current version.",
    icon: MousePointer2,
  },
  background: {
    label: "Background update",
    description:
      "The app downloads the update silently and applies it on the next launch.",
    icon: Download,
  },
  required: {
    label: "Required OTA update",
    description:
      "The app blocks access and downloads this update. Users restart to continue.",
    icon: ShieldCheck,
  },
  store: {
    label: "Require a store update",
    description:
      "The app blocks access and opens the configured store link when the user chooses to upgrade.",
    icon: Store,
  },
  custom: {
    label: "Custom guard",
    description:
      "The app runs the selected action. Access stays blocked unless the app’s handler allows it.",
    icon: Braces,
  },
};

export default function UpdatePolicyEditor({
  encodedKey,
  platform,
  onSaved,
}: {
  encodedKey: string;
  platform?: string;
  onSaved: () => Promise<void>;
}) {
  const isViewer = useContext(AdminRoleContext) === "viewer";
  const { t, formatLocale } = useI18n();
  const [policy, setPolicy] = useState<UpdatePolicy | null>(null);
  const [draftState, setDraft] = useState<PolicyDraft | null>(null);
  const previousDrafts = useRef<Partial<Record<PolicyBehavior, PolicyDraft>>>(
    {},
  );
  const [loadSequence, setLoadSequence] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState<TranslationMessage>("");
  const [saving, setSaving] = useState(false);
  const [guardActions, setGuardActions] = useState<GuardActionItem[]>([]);
  const [canWriteGuardActions, setCanWriteGuardActions] = useState(false);
  const [catalogError, setCatalogError] = useState("");
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
    let active = true;
    void getUpdatePolicy(encodedKey)
      .then((loaded) => {
        if (!active) return;
        beginCatalogAttempt(actionAttempt.current);
        setActionError("");
        setPolicy(loaded);
        previousDrafts.current = {};
        setDraft(draftFromPolicy(loaded));
        setError("");
      })
      .catch(
        (loadError: unknown) =>
          active &&
          setError((loadError as Error).message || "Failed to load policy"),
      );
    return () => {
      active = false;
    };
  }, [encodedKey, loadSequence]);

  useEffect(() => {
    void loadGuardActions();
  }, []);

  if (!policy || !draftState) {
    return (
      <Card className="gap-3 p-5 shadow-none">
        {error ? (
          <>
            <p role="alert">{t(error)}</p>
            <Button
              className="w-fit"
              variant="outline"
              size="sm"
              onClick={() => setLoadSequence((n) => n + 1)}
            >
              {t("Retry")}
            </Button>
          </>
        ) : (
          <>
            <span role="status" className="text-sm text-muted-foreground">
              {t("Loading update policy…")}
            </span>
            <Skeleton className="h-16 w-full" />
          </>
        )}
      </Card>
    );
  }
  const draft = draftState;
  const readOnly = !policy.editable || isViewer;
  const editingDisabled = readOnly || saving;
  const catalogWritable = canWriteGuardActions && !isViewer;
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(draftFromPolicy(policy));
  const guarded =
    draft.behavior !== "manual" && draft.behavior !== "background";
  const storeFields = storePayloadObject(draft.payload);
  const profile = profiles[draft.behavior];
  const guardActionOptions = mergeGuardActionOptions(guardActions, [
    draft.action,
    policy.guard?.action || "",
  ]);
  const edit = (next: PolicyDraft) => {
    if (next.action !== draft.action || next.behavior !== draft.behavior) {
      beginCatalogAttempt(actionAttempt.current);
      setActionError("");
    }
    setMessage("");
    setError("");
    setDraft(next);
  };

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

  const save = async () => {
    setError("");
    setMessage("");
    setSaving(true);
    try {
      const input = policyFromDraft(draft);
      const original = draftFromPolicy(policy);
      if (
        draft.behavior === "store" &&
        (original.behavior !== "store" || draft.payload !== original.payload) &&
        !validStoreLink(draft.payload, platform)
      ) {
        throw new Error(
          "Enter a valid store link for this platform or a default store link.",
        );
      }
      const saved = await putUpdatePolicy(
        encodedKey,
        input,
        policy.policyVersion,
      );
      previousDrafts.current = {};
      setPolicy(saved);
      setDraft(draftFromPolicy(saved));
      setMessage({
        key: "Policy saved as version {0}.",
        values: [saved.policyVersion],
      });
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
    <Card className="gap-0 overflow-hidden py-0 shadow-none">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 className="font-semibold">{t("Update policy")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Choose how this release reaches users.")}
          </p>
        </div>
        <Badge variant="outline" className="font-normal">
          {t("Version {0}", [policy.policyVersion])}
          {policy.publishedAt
            ? t(" · published {0}", [
                new Date(policy.publishedAt).toLocaleString(formatLocale),
              ])
            : t(" · draft")}
        </Badge>
      </div>
      {readOnly && (
        <div className="flex items-start gap-2 border-b bg-muted/40 px-5 py-3 text-sm text-muted-foreground">
          <LockKeyhole className="mt-0.5 size-4 shrink-0" />
          {t(
            !policy.editable
              ? "Published policies are read-only. Publish a new update ID to change policy."
              : "Your role has read-only access to this policy.",
          )}
        </div>
      )}
      <div className="grid gap-6 p-5 md:grid-cols-[minmax(13rem,0.8fr)_minmax(0,1.4fr)]">
        <section className="min-w-0">
          <h3 id="policy-behavior" className="mb-3 text-sm font-medium">
            {t("Update behavior")}
          </h3>
          <RadioGroup
            value={draft.behavior}
            disabled={editingDisabled}
            aria-labelledby="policy-behavior"
            className="gap-1.5"
            onValueChange={(v) => {
              const mode = v as PolicyBehavior;
              previousDrafts.current[draft.behavior] = draft;
              edit(previousDrafts.current[mode] ?? chooseBehavior(draft, mode));
            }}
          >
            {behaviors.map((mode) => {
              const Icon = profiles[mode].icon;
              return (
                <Label
                  key={mode}
                  htmlFor={`behavior-${mode}`}
                  className="flex min-h-10 cursor-pointer gap-2.5 rounded-md border px-3 py-2.5 text-sm font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent has-[[data-state=checked]]:font-medium has-[:disabled]:cursor-default"
                >
                  <Icon
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="flex-1">{t(profiles[mode].label)}</span>
                  <RadioGroupItem id={`behavior-${mode}`} value={mode} />
                </Label>
              );
            })}
          </RadioGroup>
        </section>
        <section className="min-w-0 space-y-4 border-t pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-6">
          <div>
            <h3 className="font-semibold">{t(profile.label)}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(profile.description)}
            </p>
          </div>
          {draft.behavior === "custom" && (
            <GuardActionPicker
              value={draft.action}
              options={guardActionOptions}
              disabled={editingDisabled}
              onChange={(action) => edit({ ...draft, action })}
              onCreate={persistSelectedAction}
            />
          )}
          {draft.behavior === "store" &&
            (storeFields ? (
              <div className="grid gap-3">
                {(
                  [
                    ["url", "Default store link"],
                    ["iosUrl", "iOS store link"],
                    ["androidUrl", "Android store link"],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} className="gap-1.5">
                    <FieldLabel htmlFor={`policy-store-${key}`}>
                      {t(label)}
                    </FieldLabel>
                    <TextInput
                      id={`policy-store-${key}`}
                      inputMode="url"
                      autoCapitalize="off"
                      spellCheck={false}
                      readOnly={editingDisabled}
                      value={String(storeFields[key] ?? "")}
                      onChange={(e) =>
                        edit({
                          ...draft,
                          payload: setStoreLink(
                            storeFields,
                            key,
                            e.target.value,
                          ),
                        })
                      }
                    />
                  </Field>
                ))}
                <FieldDescription>
                  {t(
                    "The app uses its platform link first, then the default link. Use https, market or itms-apps links.",
                  )}
                </FieldDescription>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t(
                  "Edit the existing store payload in advanced settings to preserve its structure.",
                )}
              </p>
            ))}
          {guarded && (
            <Collapsible
              key={draft.behavior}
              defaultOpen={
                draft.behavior === "custom" ||
                draft.delivery === "background" ||
                Boolean(draft.payload && draft.behavior !== "store") ||
                (draft.behavior === "store" && !storeFields)
              }
            >
              <CollapsibleTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="group"
                >
                  {t("Advanced settings")}
                  <ChevronDown className="group-data-[state=open]:rotate-180" />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <div className="space-y-4 rounded-md border bg-muted/20 p-3">
                  <div className="grid gap-1.5">
                    <Label htmlFor="policy-delivery">{t("Delivery")}</Label>
                    <Select
                      value={draft.delivery}
                      disabled={editingDisabled}
                      onValueChange={(v) =>
                        edit({
                          ...draft,
                          delivery: v as UpdatePolicy["delivery"],
                        })
                      }
                    >
                      <SelectTrigger id="policy-delivery" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">{t("Manual")}</SelectItem>
                        <SelectItem value="background">
                          {t("Background")}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {t("The guard takes priority while access is blocked.")}
                    </p>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="policy-payload">
                      {t("Optional custom JSON payload")}
                    </Label>
                    <Textarea
                      id="policy-payload"
                      spellCheck={false}
                      value={draft.payload}
                      readOnly={editingDisabled}
                      className="min-h-24 font-mono text-xs"
                      onChange={(e) =>
                        edit({ ...draft, payload: e.target.value })
                      }
                    />
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
          {actionError && (
            <div role="status" className="text-sm text-destructive">
              {t(actionError)}{" "}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void persistSelectedAction(draft.action)}
              >
                {t("Retry")}
              </Button>
            </div>
          )}
        </section>
      </div>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2 border-t bg-muted/20 px-5 py-3">
          <div
            className="min-w-0 flex-1 text-sm text-muted-foreground"
            role="status"
          >
            {message ? t(message) : dirty ? t("Unsaved changes") : null}
          </div>
          {dirty && (
            <Button
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => {
                previousDrafts.current = {};
                edit(draftFromPolicy(policy));
              }}
            >
              {t("Discard changes")}
            </Button>
          )}
          <Button
            size="sm"
            disabled={saving || !dirty}
            onClick={() => void save()}
          >
            {saving ? t("Saving…") : t("Save policy")}
          </Button>
        </div>
      )}
      {error && (
        <Alert variant="destructive" className="mx-5 my-3 w-auto">
          <AlertDescription>
            {t(error)}
            <Button
              type="button"
              variant="link"
              className="h-auto px-0"
              onClick={() => setLoadSequence((n) => n + 1)}
            >
              {t("Reload saved policy")}
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {catalogError && (
        <div
          role="status"
          className="flex items-center gap-2 px-5 py-3 text-sm"
        >
          {t(catalogError)}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadGuardActions()}
          >
            {t("Retry")}
          </Button>
        </div>
      )}
      <GuardActionCatalog
        items={guardActions}
        writable={catalogWritable}
        onAdd={addGuardAction}
        onDelete={(id) =>
          setGuardActions((items) => items.filter((item) => item.id !== id))
        }
      />
    </Card>
  );
}
