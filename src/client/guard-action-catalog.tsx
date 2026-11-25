"use client";

import { useState, type FormEvent } from "react";
import { ChevronDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useConfirmAction } from "@/components/admin/confirm-action";
import { createGuardAction, deleteGuardAction } from "./admin-api";
import type { GuardActionItem } from "./admin-types";
import {
  filterGuardActionOptions,
  normalizeCreatableGuardAction,
} from "./guard-action-options";
import { useI18n } from "./i18n/provider";

export default function GuardActionCatalog({
  items,
  writable,
  onAdd,
  onDelete,
}: {
  items: GuardActionItem[];
  writable: boolean;
  onAdd: (item: GuardActionItem) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirmAction();
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const filtered = filterGuardActionOptions(items, query);
  async function add(event: FormEvent) {
    event.preventDefault();
    if (!writable || busy) return;
    setError("");
    setBusy(true);
    setQuery("");
    try {
      onAdd(await createGuardAction(normalizeCreatableGuardAction(name)));
      setName("");
    } catch (cause) {
      setError(
        (cause as Error).message || "Failed to add action to the catalog.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function remove(item: GuardActionItem) {
    if (
      !writable ||
      busy ||
      !(await confirm(
        t("Delete from catalog"),
        t(
          'Delete "{0}" from the action catalog? Existing policies are unaffected.',
          [item.actionKey],
        ),
        true,
      ))
    )
      return;
    setError("");
    setBusy(true);
    try {
      await deleteGuardAction(item.id);
      onDelete(item.id);
    } catch (cause) {
      setError(
        (cause as Error).message || "Failed to delete action from catalog",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Collapsible className="border-t px-5 py-3">
      <CollapsibleTrigger asChild>
        <Button type="button" size="sm" variant="ghost" className="group -ml-2">
          {t("Action catalog")}
          <ChevronDown className="group-data-[state=open]:rotate-180" />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 grid gap-4">
        {writable && (
          <form onSubmit={add}>
            <Field className="gap-1.5">
              <FieldLabel htmlFor="policy-catalog-new">
                {t("Add action to catalog")}
              </FieldLabel>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="policy-catalog-new"
                  className="min-w-32 flex-1"
                  maxLength={100}
                  value={name}
                  disabled={busy}
                  aria-describedby="policy-catalog-help"
                  onChange={(e) => {
                    setName(e.target.value);
                    setError("");
                  }}
                  placeholder={t("Reusable action name")}
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  disabled={busy || !name.trim()}
                >
                  {t("Add to catalog")}
                </Button>
              </div>
              <FieldDescription id="policy-catalog-help">
                {t(
                  "Adds a reusable catalog item without changing this policy.",
                )}
              </FieldDescription>
            </Field>
          </form>
        )}
        {items.length > 0 && (
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={t("Search action catalog")}
            placeholder={t("Search action catalog")}
          />
        )}
        {filtered.length > 0 ? (
          <ul
            aria-label={t("Guard action catalog entries")}
            className="max-h-44 divide-y overflow-auto rounded-md border"
          >
            {filtered.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 break-all font-mono text-xs">
                  {item.actionKey}
                </span>
                {writable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={busy}
                    aria-label={t("Delete {0} from action catalog", [
                      item.actionKey,
                    ])}
                    onClick={() => void remove(item)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(query ? "No matching actions" : "No catalog actions found.")}
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {t(error)}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
