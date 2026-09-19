"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ToastMessage {
  message: string;
  error: boolean;
}

/** Timer handles are numbers in the browser and Timeout under @types/node. */
type TimerHandle = ReturnType<typeof setTimeout>;

export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timer = useRef<TimerHandle | undefined>(undefined);

  const show = useCallback((message: string, options?: { error?: boolean; ms?: number }) => {
    const error = options?.error ?? false;
    const ms = options?.ms ?? 4200;
    setToast({ message, error });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), ms);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { toast, show };
}

export function Toast({ toast }: { toast: ToastMessage | null }) {
  if (!toast) return null;
  return (
    <div className={`toast${toast.error ? " error" : ""}`} data-testid="toast">
      {toast.message}
    </div>
  );
}