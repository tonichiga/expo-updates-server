"use client";
import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useI18n } from "./i18n/provider";
import {
  normalizeCreatableGuardAction,
  type GuardActionOption,
} from "./guard-action-options";
import { isBuiltInAction } from "./policy-draft";

export default function GuardActionPicker({
  value,
  options,
  disabled,
  onChange,
  onCreate,
}: {
  value: string;
  options: GuardActionOption[];
  disabled: boolean;
  onChange: (value: string) => void;
  onCreate: (value: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const selectRef = useRef<HTMLButtonElement>(null);
  const newActionRef = useRef<HTMLButtonElement>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const choices = options.filter(
    (option) => !isBuiltInAction(option.actionKey),
  );
  function cancelCreation() {
    setCreating(false);
    requestAnimationFrame(() => newActionRef.current?.focus());
  }
  function add() {
    let key: string;
    try {
      key = normalizeCreatableGuardAction(name);
      if (isBuiltInAction(key))
        throw new Error(
          "Choose the corresponding built-in behavior for this action.",
        );
    } catch (e) {
      setError((e as Error).message);
      return;
    }
    onChange(key);
    setCreating(false);
    setName("");
    requestAnimationFrame(() => selectRef.current?.focus());
    if (!choices.some((o) => o.actionKey === key && o.persisted))
      void onCreate(key);
  }
  return (
    <div className="grid gap-2">
      <Label htmlFor="policy-guard-action">{t("Rule action")}</Label>
      <div className="flex flex-wrap gap-2">
        <Select
          value={value}
          disabled={disabled || !choices.length}
          onValueChange={(action) => {
            onChange(action);
            if (
              !choices.some(
                (option) => option.actionKey === action && option.persisted,
              )
            )
              void onCreate(action);
          }}
        >
          <SelectTrigger
            ref={selectRef}
            id="policy-guard-action"
            className="min-w-40 flex-1"
          >
            <SelectValue placeholder={t("Select an action")} />
          </SelectTrigger>
          <SelectContent>
            {choices.map((o) => (
              <SelectItem key={o.actionKey} value={o.actionKey}>
                {o.actionKey}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!disabled && !creating && (
          <Button
            ref={newActionRef}
            variant="outline"
            size="sm"
            onClick={() => {
              setCreating(true);
              setError("");
            }}
          >
            <Plus />
            {t("New action")}
          </Button>
        )}
      </div>
      {creating && !disabled && (
        <div className="grid gap-2 rounded-md border p-3">
          <Label htmlFor="policy-new-action">{t("Reusable action name")}</Label>
          <Input
            id="policy-new-action"
            autoFocus
            value={name}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "policy-action-error" : undefined}
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              } else if (e.key === "Escape") {
                cancelCreation();
              }
            }}
          />
          {error && (
            <p
              id="policy-action-error"
              role="alert"
              className="text-sm text-destructive"
            >
              {t(error)}
            </p>
          )}
          <div className="flex gap-2">
            <Button size="sm" onClick={add}>
              {t("Use action")}
            </Button>
            <Button size="sm" variant="ghost" onClick={cancelCreation}>
              {t("Cancel")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
