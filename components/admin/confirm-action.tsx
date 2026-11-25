"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { statusTones } from "@/components/ui/status-tones";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useI18n } from "@/src/client/i18n/provider";

type Confirm = (
  action: string,
  description: string,
  destructive?: boolean,
) => Promise<boolean>;
const ConfirmContext = createContext<Confirm>(async () => false);

export const useConfirmAction = () => useContext(ConfirmContext);

export function ConfirmActionProvider({ children }: { children: ReactNode }) {
  const path = usePathname();
  return <PageConfirmations key={path}>{children}</PageConfirmations>;
}

function PageConfirmations({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState<{
    action: string;
    description: string;
    destructive: boolean;
  } | null>(null);
  const pending = useRef<((value: boolean) => void) | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => () => pending.current?.(false), []);

  const confirm: Confirm = (action, description, destructive = false) => {
    if (pending.current) return Promise.resolve(false);
    trigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setPrompt({ action, description, destructive });
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
    });
  };

  function finish(accepted: boolean) {
    const resolve = pending.current;
    pending.current = null;
    setPrompt(null);
    resolve?.(accepted);
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={Boolean(prompt)}
        onOpenChange={(open) => {
          if (!open) finish(false);
        }}
      >
        <DialogContent
          showCloseButton={false}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancel.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogHeader>
            {prompt?.destructive && (
              <span
                className={`mb-1 inline-flex size-10 items-center justify-center self-center rounded-lg border sm:self-start ${statusTones.destructive}`}
              >
                <TriangleAlert className="size-5" aria-hidden="true" />
              </span>
            )}
            <DialogTitle>{prompt?.action}</DialogTitle>
            <DialogDescription className="break-words">
              {prompt?.description}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              ref={cancel}
              variant="outline"
              onClick={() => finish(false)}
            >
              {t("Отменить")}
            </Button>
            <Button
              variant={prompt?.destructive ? "destructive" : "default"}
              onClick={() => finish(true)}
            >
              {prompt?.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
