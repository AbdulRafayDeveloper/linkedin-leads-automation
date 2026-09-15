'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils/cn';
import { copyToClipboard, type ClipboardContent } from '@/lib/utils/clipboard';
import { CheckIcon, CopyIcon } from './Icons';

type CopyState = 'idle' | 'copied' | 'failed';

/**
 * Icon button that copies `getContent()` and shows a check for 2 seconds.
 * `label` names what is copied, e.g. "Copy subject".
 */
export default function CopyButton({
  getContent,
  label,
  className,
}: {
  getContent: () => ClipboardContent;
  label: string;
  className?: string;
}) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const handleCopy = async () => {
    clearTimeout(timer.current);
    try {
      await copyToClipboard(getContent());
      setState('copied');
    } catch {
      setState('failed');
    }
    timer.current = setTimeout(() => setState('idle'), 2000);
  };

  const status = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : label;

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={status}
      title={status}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md border bg-white/95 shadow-2xs transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
        state === 'copied'
          ? 'border-green-300 text-green-600'
          : state === 'failed'
            ? 'border-red-300 text-red-600'
            : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-900',
        className
      )}
    >
      {state === 'copied' ? <CheckIcon width={14} height={14} /> : <CopyIcon width={14} height={14} />}
      <span className="sr-only" aria-live="polite">
        {state === 'idle' ? '' : status}
      </span>
    </button>
  );
}
