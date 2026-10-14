'use client';

import { useRef, useSyncExternalStore, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils/cn';
import { AlertTriangleIcon } from '@/components/ui/Icons';
import { RANGE_PRESETS, toDateInput, type RangePreset } from './dateRange';

interface DateRangeFilterProps {
  preset: RangePreset;
  customFrom: string;
  customTo: string;
  /** Why the custom range can't be used, shown next to the inputs. */
  error?: string;
  onPresetChange: (preset: RangePreset) => void;
  onCustomChange: (from: string, to: string) => void;
}

// 16px on phones, so focusing a date box doesn't zoom the page on iOS.
const dateInputClass =
  'h-9 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-2.5 text-base text-slate-700 shadow-sm tabular-nums transition-colors hover:border-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none sm:w-[9.5rem] sm:text-[13px]';

export default function DateRangeFilter({
  preset,
  customFrom,
  customTo,
  error,
  onPresetChange,
  onCustomChange,
}: DateRangeFilterProps) {
  // Read on the client only: the server's "today" can be a different day, and
  // rendering its date into `max` would not match what the browser renders.
  const today = useSyncExternalStore(
    () => () => {},
    () => toDateInput(new Date()),
    () => undefined
  );

  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(0, RANGE_PRESETS.findIndex((option) => option.value === preset));

  const move = (nextIndex: number) => {
    const option = RANGE_PRESETS[nextIndex];
    if (!option) return;
    onPresetChange(option.value);
    buttons.current[nextIndex]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = RANGE_PRESETS.length - 1;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        move(selectedIndex === last ? 0 : selectedIndex + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        move(selectedIndex === 0 ? last : selectedIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        move(0);
        break;
      case 'End':
        event.preventDefault();
        move(last);
        break;
      default:
        break;
    }
  };

  return (
    <div className="flex min-w-0 flex-wrap items-start gap-2">
      <div
        role="radiogroup"
        aria-label="Date range"
        onKeyDown={onKeyDown}
        className="flex flex-wrap rounded-lg border border-slate-200 bg-slate-50 p-0.5 shadow-sm"
      >
        {RANGE_PRESETS.map((option, index) => {
          const selected = option.value === preset;
          return (
            <button
              key={option.value}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              // One tab stop for the group; arrows move between the options.
              tabIndex={index === selectedIndex ? 0 : -1}
              onClick={() => onPresetChange(option.value)}
              className={cn(
                'h-8 rounded-md px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 sm:px-3',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500',
                selected
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-600 hover:text-slate-900'
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {preset === 'custom' && (
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="dashboard-from">
            From date
          </label>
          <input
            id="dashboard-from"
            type="date"
            value={customFrom}
            max={customTo || today}
            aria-invalid={Boolean(error)}
            onChange={(e) => onCustomChange(e.target.value, customTo)}
            className={dateInputClass}
          />
          <span className="text-[13px] text-slate-500">to</span>
          <label className="sr-only" htmlFor="dashboard-to">
            To date
          </label>
          <input
            id="dashboard-to"
            type="date"
            value={customTo}
            min={customFrom || undefined}
            max={today}
            aria-invalid={Boolean(error)}
            onChange={(e) => onCustomChange(customFrom, e.target.value)}
            className={dateInputClass}
          />
        </div>
      )}

      {error && (
        <p className="flex items-center gap-1.5 self-center text-[13px] font-medium text-red-600">
          <AlertTriangleIcon width={14} height={14} className="shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
