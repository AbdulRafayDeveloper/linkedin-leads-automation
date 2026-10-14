'use client';

import { useCallback, useEffect, useId, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import { XIcon } from './Icons';

export type ModalSize = 'md' | 'lg' | 'full';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Extra header content next to the title (badges, counters, small actions). */
  headerExtra?: ReactNode;
  /** Sticky footer, usually the action buttons. */
  footer?: ReactNode;
  children: ReactNode;
  size?: ModalSize;
  /** Return false to keep the modal open (e.g. "discard unsaved changes?"). */
  closeConfirm?: () => boolean;
}

const SIZE_CLASSES: Record<ModalSize, string> = {
  md: 'max-w-xl',
  lg: 'max-w-3xl',
  full: 'max-w-5xl',
};

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

/** Tabbable descendants, in DOM order. Visibility is not checked so this also works in jsdom. */
function getFocusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const tabindex = el.getAttribute('tabindex');
    return tabindex === null || Number(tabindex) >= 0;
  });
}

/**
 * Accessible dialog: labelled by its title, focus-trapped, Escape/backdrop to close,
 * body scroll locked while open. The body scrolls on its own so the sticky header and
 * footer (and the footer's buttons) stay reachable on a short or narrow viewport.
 */
export default function Modal({
  open,
  onClose,
  title,
  subtitle,
  headerExtra,
  footer,
  children,
  size = 'md',
  closeConfirm,
}: ModalProps) {
  const reactId = useId();
  const titleId = `modal-title-${reactId}`;
  const subtitleId = `modal-subtitle-${reactId}`;
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const requestClose = useCallback(() => {
    if (closeConfirm && closeConfirm() === false) return;
    onClose();
  }, [closeConfirm, onClose]);

  // Focus in on open, back out on close; body scroll locked in between.
  useEffect(() => {
    if (!open) return;

    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const dialog = dialogRef.current;
    if (dialog) {
      const [first] = getFocusable(dialog);
      (first ?? dialog).focus();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocused.current?.focus();
      previouslyFocused.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      requestClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, requestClose]);

  const trapTab = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusable = getFocusable(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && dialog.contains(active) && active !== dialog;

    if (event.shiftKey) {
      if (!inside || active === first) {
        event.preventDefault();
        last.focus();
      }
      return;
    }
    if (!inside || active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center sm:p-4">
      {/* Backdrop: not in the a11y tree, the header close button is the accessible way out. */}
      <div
        aria-hidden="true"
        data-testid="modal-backdrop"
        onClick={requestClose}
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs"
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        onKeyDown={trapTab}
        className={cn(
          'relative flex h-[100dvh] w-full min-w-0 flex-col overflow-hidden bg-white shadow-2xl',
          'sm:h-auto sm:max-h-[90vh] sm:rounded-xl',
          SIZE_CLASSES[size]
        )}
      >
        <header className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5 sm:py-4">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 id={titleId} className="truncate text-base font-semibold text-slate-900">
                {title}
              </h2>
              {headerExtra}
            </div>
            {subtitle && (
              <p id={subtitleId} className="mt-1 text-sm break-words text-slate-500">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            <XIcon width={18} height={18} />
          </button>
        </header>

        <div className="min-h-0 w-full flex-1 overflow-x-hidden overflow-y-auto px-4 py-4 break-words sm:px-5">
          {children}
        </div>

        {footer && (
          <footer className="sticky bottom-0 z-10 flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:px-5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
