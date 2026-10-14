'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { AlertTriangleIcon, CheckCircleIcon, SparklesIcon, XIcon } from './Icons';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  message: string;
}

const DISMISS_AFTER_MS = 5000;

/**
 * Toast state with a hard cap, so a burst of failures can't fill the screen.
 * Timers are cleared on unmount.
 */
export function useToasts(max = 3) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = (nextId.current += 1);
      setToasts((prev) => [...prev, { id, tone, message }].slice(-max));
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), DISMISS_AFTER_MS)
      );
      return id;
    },
    [dismiss, max]
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((timer) => clearTimeout(timer));
      pending.clear();
    };
  }, []);

  return { toasts, push, dismiss };
}

const TONE_CLASSES: Record<ToastTone, string> = {
  success: 'border-emerald-500/40 text-emerald-100',
  error: 'border-red-500/40 text-red-100',
  info: 'border-slate-600 text-slate-100',
};

const TONE_ICONS: Record<ToastTone, typeof CheckCircleIcon> = {
  success: CheckCircleIcon,
  error: AlertTriangleIcon,
  info: SparklesIcon,
};

/**
 * Bottom-right so it never covers the header actions, and announced politely so
 * the result of a delete or a failed load reaches screen readers.
 */
export function Toaster({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-80"
    >
      {toasts.map((toast) => {
        const Icon = TONE_ICONS[toast.tone];
        return (
          <div
            key={toast.id}
            className={cn(
              'animate-fade-in pointer-events-auto flex items-start gap-2.5 rounded-lg border bg-slate-900/95 px-3.5 py-2.5 shadow-xl backdrop-blur-md',
              TONE_CLASSES[toast.tone]
            )}
          >
            <Icon width={16} height={16} className="mt-0.5 shrink-0" />
            <p className="min-w-0 flex-1 text-sm leading-snug break-words">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss notification"
              className="-mr-1 shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <XIcon width={14} height={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
