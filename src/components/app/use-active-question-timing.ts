"use client";

import { useCallback, useEffect, useRef } from "react";

type FlushHandler = (questionId: string, durationSeconds: number) => void;

function seconds(value: number) {
  return Math.max(0, Math.round(value / 1000));
}

export function useActiveQuestionTiming(onFlush?: FlushHandler) {
  const durations = useRef<Record<string, number>>({});
  const currentQuestionId = useRef<string | null>(null);
  const enteredAt = useRef<number | null>(null);
  const onFlushRef = useRef(onFlush);

  useEffect(() => {
    onFlushRef.current = onFlush;
  }, [onFlush]);

  const flushCurrent = useCallback((notify = true) => {
    const id = currentQuestionId.current;
    if (!id || enteredAt.current === null) return null;
    const now = performance.now();
    durations.current[id] =
      (durations.current[id] || 0) + Math.max(0, now - enteredAt.current);
    enteredAt.current = document.hidden ? null : now;
    const durationSeconds = seconds(durations.current[id]);
    if (notify) onFlushRef.current?.(id, durationSeconds);
    return { questionId: id, durationSeconds };
  }, []);

  const activate = useCallback(
    (questionId: string | null) => {
      if (currentQuestionId.current === questionId) {
        if (questionId && enteredAt.current === null && !document.hidden)
          enteredAt.current = performance.now();
        return;
      }
      flushCurrent();
      currentQuestionId.current = questionId;
      enteredAt.current = questionId && !document.hidden ? performance.now() : null;
    },
    [flushCurrent],
  );

  const reset = useCallback((initial: Record<string, number> = {}) => {
    durations.current = Object.fromEntries(
      Object.entries(initial).map(([id, value]) => [
        id,
        Math.max(0, Number(value) || 0) * 1000,
      ]),
    );
    currentQuestionId.current = null;
    enteredAt.current = null;
  }, []);

  const snapshot = useCallback(() => {
    flushCurrent(false);
    return Object.fromEntries(
      Object.entries(durations.current).map(([id, value]) => [id, seconds(value)]),
    );
  }, [flushCurrent]);

  const stop = useCallback(() => {
    flushCurrent();
    currentQuestionId.current = null;
    enteredAt.current = null;
  }, [flushCurrent]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.hidden) flushCurrent();
      else if (currentQuestionId.current && enteredAt.current === null)
        enteredAt.current = performance.now();
    };
    const handlePageHide = () => flushCurrent();
    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      flushCurrent();
    };
  }, [flushCurrent]);

  return { activate, reset, snapshot, stop };
}
