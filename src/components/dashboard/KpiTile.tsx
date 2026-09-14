import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import type { IconProps } from '@/components/ui/Icons';
import type { MetricWithDelta } from '@/services/dashboard/types';
import { formatNumber } from './format';

function ArrowIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === 'up' ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M5 12l7 7 7-7" />}
    </svg>
  );
}

function Delta({ metric, comparison }: { metric: MetricWithDelta; comparison: string }) {
  if (metric.previous === null) return null;
  const diff = metric.value - metric.previous;

  if (diff === 0) {
    return <p className="text-xs text-slate-400">No change {comparison}</p>;
  }

  const up = diff > 0;
  const amount =
    metric.previous > 0 ? `${Math.round((Math.abs(diff) / metric.previous) * 100)}%` : formatNumber(Math.abs(diff));

  return (
    <p className="flex flex-wrap items-center gap-x-1 text-xs">
      <span
        className={cn(
          'inline-flex items-center gap-0.5 font-semibold',
          up ? 'text-emerald-700' : 'text-red-600'
        )}
      >
        <ArrowIcon direction={up ? 'up' : 'down'} />
        <span className="sr-only">{up ? 'Up' : 'Down'}</span>
        {amount}
      </span>
      <span className="text-slate-400">{comparison}</span>
    </p>
  );
}

export default function KpiTile({
  label,
  metric,
  comparison,
  icon: Icon,
  footnote,
  className,
}: {
  className?: string;
  label: string;
  metric: MetricWithDelta;
  comparison: string;
  icon: (props: IconProps) => ReactNode;
  /** Extra context under the delta, e.g. an open rate. */
  footnote?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-slate-500">{label}</p>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-50 text-slate-400 ring-1 ring-slate-200/70 ring-inset">
          <Icon width={15} height={15} />
        </span>
      </div>
      <p className="text-[28px] leading-8 font-semibold tracking-tight text-slate-900">{formatNumber(metric.value)}</p>
      <div className="mt-auto space-y-0.5">
        <Delta metric={metric} comparison={comparison} />
        {footnote && <p className="text-xs text-slate-400">{footnote}</p>}
      </div>
    </div>
  );
}
