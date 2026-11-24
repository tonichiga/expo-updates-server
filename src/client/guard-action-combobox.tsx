"use client";
import { useI18n } from "@/src/client/i18n/provider";

import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";

import {
  filterGuardActionOptions,
  GuardActionOption,
  normalizeCreatableGuardAction,
} from "./guard-action-options";
import { KeyboardEvent, useId, useRef, useState } from "react";

type Props = {
  value: string;
  options: GuardActionOption[];
  selectionDisabled: boolean;
  canMutateCatalog: boolean;
  mutationError?: string;
  onChange: (actionKey: string) => void;
  onCreate: (actionKey: string) => Promise<void>;
  onDelete: (option: GuardActionOption) => Promise<void>;
  onRetry?: () => Promise<void>;
};

export default function GuardActionCombobox({
  value,
  options,
  selectionDisabled,
  canMutateCatalog,
  mutationError,
  onChange,
  onCreate,
  onDelete,
  onRetry,
}: Props) {
  const { t } = useI18n();
  const generatedId = useId();
  const popupId = `${generatedId}-popup`;
  const errorId = `${generatedId}-error`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [draftValue, setDraftValue] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [inputError, setInputError] = useState("");
  const inputValue = draftValue ?? value;
  const filteredOptions = selectionDisabled
    ? options
    : filterGuardActionOptions(options, inputValue);

  let creatableValue: string | null = null;
  try {
    creatableValue = normalizeCreatableGuardAction(inputValue);
  } catch {
    // Validation feedback is shown when the user attempts to create.
  }
  const exactOption = creatableValue
    ? options.find((option) => option.actionKey === creatableValue)
    : undefined;
  const showCreate =
    !selectionDisabled && Boolean(creatableValue) && !exactOption;
  const rowCount = filteredOptions.length + (showCreate ? 1 : 0);

  const choose = (actionKey: string) => {
    onChange(actionKey);
    setDraftValue(null);
    setInputError("");
    setOpen(false);
  };

  const chooseOption = (option: GuardActionOption) => {
    choose(option.actionKey);
    if (!option.persisted) {
      void onCreate(option.actionKey);
    }
  };

  const create = async () => {
    let actionKey: string;
    try {
      actionKey = normalizeCreatableGuardAction(inputValue);
    } catch (error: unknown) {
      setInputError((error as Error).message);
      return;
    }

    choose(actionKey);
    await onCreate(actionKey);
  };

  const activateRow = (index: number) => {
    if (index < filteredOptions.length) {
      chooseOption(filteredOptions[index]);
    } else if (showCreate) {
      void create();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (selectionDisabled) {
      if (event.key === "Escape") setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        if (rowCount === 0) return -1;
        if (current < 0) return direction > 0 ? 0 : rowCount - 1;
        return (current + direction + rowCount) % rowCount;
      });
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (open && activeIndex >= 0) {
        activateRow(activeIndex);
      } else if (exactOption) {
        chooseOption(exactOption);
      } else {
        void create();
      }
      return;
    }
    if (event.key === "Escape") {
      setDraftValue(null);
      setInputError("");
      setOpen(false);
    }
  };

  return (
    <div className="min-w-0 flex-1">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setDraftValue(null);
        }}
      >
        <PopoverAnchor asChild>
          <Input
            ref={inputRef}
            value={inputValue}
            maxLength={100}
            readOnly={selectionDisabled}
            aria-disabled={selectionDisabled}
            role="combobox"
            aria-label={t("Rule action")}
            aria-autocomplete="list"
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-controls={popupId}
            aria-describedby={inputError || mutationError ? errorId : undefined}
            onFocus={() => setOpen(true)}
            onChange={(event) => {
              setDraftValue(event.target.value);
              setInputError("");
              setOpen(true);
              setActiveIndex(-1);
            }}
            onKeyDown={handleKeyDown}
            className="w-full"
            placeholder={t("Action (required)")}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            if (event.target === inputRef.current) event.preventDefault();
          }}
          id={popupId}
          role="dialog"
          aria-label={t("Guard action catalog")}
          className="max-h-60 w-[var(--radix-popover-trigger-width)] overflow-auto p-1"
        >
          {filteredOptions.map((option, index) => (
            <div
              key={`${option.id || "policy"}:${option.actionKey}`}
              className={`flex items-center rounded ${
                activeIndex === index ? "bg-accent" : ""
              }`}
            >
              <Button
                variant="ghost"
                size="sm"
                type="button"
                tabIndex={-1}
                disabled={selectionDisabled}
                aria-current={option.actionKey === value ? "true" : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseOption(option)}
                className="min-w-0 flex-1 justify-start truncate px-3 py-2 text-left text-sm disabled:cursor-default"
                title={option.actionKey}
              >
                {option.actionKey}
              </Button>
              {option.persisted && canMutateCatalog ? (
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  aria-label={t("Delete {0} from action catalog", [
                    option.actionKey,
                  ])}
                  title={t("Delete from catalog")}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onDelete(option);
                  }}
                  className="m-1 rounded p-2 text-destructive hover:bg-destructive/10"
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          ))}
          {showCreate ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void create()}
              className={`w-full rounded px-3 py-2 text-left text-sm font-medium text-primary ${
                activeIndex === filteredOptions.length ? "bg-accent" : ""
              }`}
            >
              {t("Create “{0}”", [creatableValue])}
            </Button>
          ) : null}
          {filteredOptions.length === 0 && !showCreate ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              {t("No matching actions")}
            </p>
          ) : null}
        </PopoverContent>
      </Popover>
      {inputError || mutationError ? (
        <div
          id={errorId}
          role="status"
          className="mt-1 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300"
        >
          <span>{t(inputError || mutationError || "")}</span>
          {mutationError && onRetry ? (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => void onRetry()}
              className="underline"
            >
              {t("Retry")}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
