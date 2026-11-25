"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Cancel as soon as input changes, including while a text search is waiting
// for its debounce. Keep the last successful result and its matching query.
export function useFilteredResults<Q, R>(
  initial: Q,
  load: (query: Q, signal: AbortSignal) => Promise<R>,
) {
  const [query, setQuery] = useState(initial);
  const [success, setSuccess] = useState<{ query: Q; data: R } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const current = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    current.current?.abort();
  }, []);

  const start = useCallback(
    async (next: Q) => {
      const controller = new AbortController();
      current.current = controller;
      try {
        const data = await load(next, controller.signal);
        if (!controller.signal.aborted) setSuccess({ query: next, data });
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    void start(initial);
    return cancel;
  }, [cancel, initial, start]);

  function request(next: Q, delayText = false) {
    cancel();
    setQuery(next);
    setError("");
    setLoading(true);
    if (delayText) timer.current = setTimeout(() => void start(next), 300);
    else void start(next);
  }

  return { query, success, loading, error, request };
}
