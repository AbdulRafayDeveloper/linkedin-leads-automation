'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode, UIEvent } from 'react';
import { cn } from '@/lib/utils/cn';
import { ChevronDownIcon, LoaderIcon } from './Icons';

export interface SelectOption<T extends string> {
  value: T;
  label: string;
  hint?: string;
}

export interface SelectProps<T extends string> {
  value: T;
  options: Array<SelectOption<T>>;
  onChange: (value: T) => void;
  /** Accessible name for the trigger and the listbox. */
  label: string;
  widthClass?: string;
  buttonClassName?: string;
  searchable?: boolean;
  /** Called on every keystroke of the search box. Debouncing and filtering are the caller's job. */
  onSearch?: (query: string) => void;
  loading?: boolean;
  emptyText?: string;
  footer?: ReactNode;
  /** Fires when the option list is scrolled near its bottom (infinite loading). */
  onScrollEnd?: () => void;
}

/** px from the bottom of the list that counts as "scrolled to the end". */
const SCROLL_END_THRESHOLD = 32;

/**
 * Keyboard-accessible listbox dropdown. Focus stays on the trigger (or the search box)
 * and the active option is announced with aria-activedescendant, so there is no focus
 * juggling between the options themselves.
 */
export default function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  widthClass = 'w-48',
  buttonClassName,
  searchable = false,
  onSearch,
  loading = false,
  emptyText = 'No options',
  footer,
  onScrollEnd,
}: SelectProps<T>) {
  const reactId = useId();
  const labelId = `select-label-${reactId}`;
  const valueId = `select-value-${reactId}`;
  const listId = `select-list-${reactId}`;
  const optionId = (index: number) => `select-option-${reactId}-${index}`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [query, setQuery] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const openList = useCallback(() => {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [selectedIndex]);

  const closeList = useCallback((refocus: boolean) => {
    setOpen(false);
    setActiveIndex(-1);
    if (refocus) triggerRef.current?.focus();
  }, []);

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (!option) {
        closeList(true);
        return;
      }
      onChange(option.value);
      closeList(true);
    },
    [closeList, onChange, options]
  );

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target;
      if (target instanceof Node && containerRef.current?.contains(target)) return;
      setOpen(false);
      setActiveIndex(-1);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [open]);

  // The search box takes focus when the popup opens.
  useEffect(() => {
    if (open && searchable) searchRef.current?.focus();
  }, [open, searchable]);

  // Keep the active option in view while arrowing through a long list.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, open]);

  const moveActive = (delta: number) => {
    if (options.length === 0) return;
    setActiveIndex((current) => {
      const start = current < 0 ? (selectedIndex >= 0 ? selectedIndex : 0) : current;
      return (start + delta + options.length) % options.length;
    });
  };

  const jumpToLetter = (letter: string) => {
    const lower = letter.toLowerCase();
    const index = options.findIndex((option) => option.label.toLowerCase().startsWith(lower));
    if (index >= 0) setActiveIndex(index);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        openList();
        return;
      }
      if (!searchable && event.key.length === 1 && /\S/.test(event.key)) {
        event.preventDefault();
        openList();
        jumpToLetter(event.key);
      }
      return;
    }

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        closeList(true);
        return;
      case 'Tab':
        setOpen(false);
        setActiveIndex(-1);
        return;
      case 'ArrowDown':
        event.preventDefault();
        moveActive(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(-1);
        return;
      case 'Home':
        event.preventDefault();
        if (options.length > 0) setActiveIndex(0);
        return;
      case 'Enter':
        event.preventDefault();
        commit(activeIndex);
        return;
      case 'End':
        event.preventDefault();
        if (options.length > 0) setActiveIndex(options.length - 1);
        return;
      case ' ':
        if (searchable) return; // a space belongs in the search box
        event.preventDefault();
        commit(activeIndex);
        return;
      default:
        if (!searchable && event.key.length === 1 && /\S/.test(event.key)) {
          jumpToLetter(event.key);
        }
    }
  };

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    if (!onScrollEnd) return;
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= SCROLL_END_THRESHOLD) onScrollEnd();
  };

  const activeDescendant = open && activeIndex >= 0 ? optionId(activeIndex) : undefined;

  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      className={cn('relative min-w-0', widthClass)}
    >
      <span id={labelId} className="sr-only">
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-labelledby={`${labelId} ${valueId}`}
        aria-activedescendant={searchable ? undefined : activeDescendant}
        onClick={() => (open ? closeList(false) : openList())}
        className={cn(
          'flex w-full min-w-0 items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
          buttonClassName
        )}
      >
        <span id={valueId} className="min-w-0 truncate">
          {selected ? selected.label : label}
        </span>
        <ChevronDownIcon
          width={14}
          height={14}
          className={cn('shrink-0 text-slate-400 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div className="absolute left-0 z-40 mt-1 w-full max-w-[calc(100vw-2rem)] min-w-0 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
          {searchable && (
            <div className="border-b border-slate-200 p-2">
              <input
                ref={searchRef}
                type="text"
                value={query}
                aria-label={`Search ${label}`}
                placeholder="Search..."
                onChange={(event) => {
                  setQuery(event.target.value);
                  onSearch?.(event.target.value);
                }}
                aria-controls={listId}
                aria-activedescendant={activeDescendant}
                className="w-full min-w-0 rounded-md border border-slate-300 px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
              />
            </div>
          )}

          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-labelledby={labelId}
            onScroll={handleScroll}
            className="max-h-64 overflow-x-hidden overflow-y-auto py-1"
          >
            {options.map((option, index) => (
              <div
                key={option.value}
                id={optionId(index)}
                data-index={index}
                role="option"
                aria-selected={option.value === value}
                onClick={() => commit(index)}
                onMouseEnter={() => setActiveIndex(index)}
                className={cn(
                  'cursor-pointer px-3 py-2 text-sm break-words',
                  index === activeIndex ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700',
                  option.value === value && 'font-medium'
                )}
              >
                <span className="block truncate">{option.label}</span>
                {option.hint && (
                  <span className="mt-0.5 block truncate text-xs text-slate-500">{option.hint}</span>
                )}
              </div>
            ))}

            {loading && (
              <div className="flex items-center gap-2 px-3 py-2 text-sm text-slate-500" aria-live="polite">
                <LoaderIcon width={14} height={14} />
                Loading...
              </div>
            )}

            {!loading && options.length === 0 && (
              <p className="px-3 py-2 text-sm text-slate-500">{emptyText}</p>
            )}
          </div>

          {footer && <div className="border-t border-slate-200 p-2">{footer}</div>}
        </div>
      )}
    </div>
  );
}
