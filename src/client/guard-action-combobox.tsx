"use client";

import {
  filterGuardActionOptions,
  GuardActionOption,
  normalizeCreatableGuardAction,
} from "./guard-action-options";
import {
  KeyboardEvent,
  useId,
  useRef,
  useState,
} from "react";

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
  const generatedId = useId();
  const popupId = `${generatedId}-popup`;
  const errorId = `${generatedId}-error`;
  const rootRef = useRef<HTMLDivElement>(null);
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
    <div
      ref={rootRef}
      className="relative min-w-56 flex-1"
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) {
          setOpen(false);
          setDraftValue(null);
        }
      }}
    >
      <input
        value={inputValue}
        maxLength={100}
        readOnly={selectionDisabled}
        aria-disabled={selectionDisabled}
        role="combobox"
        aria-label="Rule action"
        aria-autocomplete="list"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popupId}
        aria-describedby={
          inputError || mutationError ? errorId : undefined
        }
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setDraftValue(event.target.value);
          setInputError("");
          setOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        className="w-full rounded border border-zinc-300 bg-transparent p-2 text-sm dark:border-zinc-700"
        placeholder="Action (required)"
      />
      {open ? (
        <div
          id={popupId}
          role="dialog"
          aria-label="Guard action catalog"
          className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-md border border-zinc-300 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {filteredOptions.map((option, index) => (
            <div
              key={`${option.id || "policy"}:${option.actionKey}`}
              className={`flex items-center rounded ${
                activeIndex === index
                  ? "bg-blue-50 dark:bg-blue-950"
                  : ""
              }`}
            >
              <button
                type="button"
                tabIndex={-1}
                disabled={selectionDisabled}
                aria-current={
                  option.actionKey === value ? "true" : undefined
                }
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => chooseOption(option)}
                className="min-w-0 flex-1 truncate px-3 py-2 text-left text-sm disabled:cursor-default"
                title={option.actionKey}
              >
                {option.actionKey}
              </button>
              {option.persisted && canMutateCatalog ? (
                <button
                  type="button"
                  aria-label={`Delete ${option.actionKey} from action catalog`}
                  title="Delete from catalog"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    void onDelete(option);
                  }}
                  className="m-1 rounded p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="16"
                    height="16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14M10 10v6m4-6v6" />
                  </svg>
                </button>
              ) : null}
            </div>
          ))}
          {showCreate ? (
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void create()}
              className={`w-full rounded px-3 py-2 text-left text-sm font-medium text-blue-700 dark:text-blue-300 ${
                activeIndex === filteredOptions.length
                  ? "bg-blue-50 dark:bg-blue-950"
                  : ""
              }`}
            >
              Create “{creatableValue}”
            </button>
          ) : null}
          {filteredOptions.length === 0 && !showCreate ? (
            <p className="px-3 py-2 text-sm text-zinc-500">
              No matching actions
            </p>
          ) : null}
        </div>
      ) : null}
      {inputError || mutationError ? (
        <div
          id={errorId}
          role="status"
          className="mt-1 flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300"
        >
          <span>{inputError || mutationError}</span>
          {mutationError && onRetry ? (
            <button
              type="button"
              onClick={() => void onRetry()}
              className="underline"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
