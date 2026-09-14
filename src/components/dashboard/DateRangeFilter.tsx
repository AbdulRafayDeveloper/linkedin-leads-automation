'use client';

import { cn } from '@/lib/utils/cn';
import { RANGE_PRESETS, toDateInput, type RangePreset } from './dateRange';

interface DateRangeFilterProps {
  preset: RangePreset;
  customFrom: string;
  customTo: string;
  onPresetChange: (preset: RangePreset) => void;
  onCustomChange: (from: string, to: string) => void;
}

const dateInputClass =
  'h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-[13px] text-slate-700 shadow-sm tabular-nums transition-colors hover:border-slate-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none';

export default function DateRangeFilter({
  preset,
  customFrom,
  customTo,
  onPresetChange,
  onCustomChange,
}: DateRangeFilterProps) {
  const today = toDateInput(new Date());

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Date range"
        className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 shadow-sm"
      >
        {RANGE_PRESETS.map((option) => {
          const selected = option.value === preset;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onPresetChange(option.value)}
              className={cn(
                'h-8 rounded-md px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-150',
                'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500',
                selected
                  ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200'
                  : 'text-slate-500 hover:text-slate-900'
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {preset === 'custom' && (
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="dashboard-from">
            From date
          </label>
          <input
            id="dashboard-from"
            type="date"
            value={customFrom}
            max={customTo || today}
            onChange={(e) => onCustomChange(e.target.value, customTo)}
            className={dateInputClass}
          />
          <span className="text-[13px] text-slate-400">to</span>
          <label className="sr-only" htmlFor="dashboard-to">
            To date
          </label>
          <input
            id="dashboard-to"
            type="date"
            value={customTo}
            min={customFrom || undefined}
            max={today}
            onChange={(e) => onCustomChange(customFrom, e.target.value)}
            className={dateInputClass}
          />
        </div>
      )}
    </div>
  );
}
