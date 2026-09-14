'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils/cn';
import type { SeriesPoint } from '@/services/dashboard/types';
import { formatNumber } from './format';

type Metric = 'leads' | 'sent' | 'opened';

const METRICS: { value: Metric; tab: string; unit: [string, string] }[] = [
  { value: 'leads', tab: 'Leads imported', unit: ['lead', 'leads'] },
  { value: 'sent', tab: 'Emails sent', unit: ['email sent', 'emails sent'] },
  { value: 'opened', tab: 'Opens', unit: ['open', 'opens'] },
];

const PLOT_HEIGHT = 200;
const AXIS_BAND = 28;
const Y_GUTTER = 36;
const TOP_PAD = 8;
const BAR = '#4f46e5';
const BAR_ACTIVE = '#3730a3';

function niceScale(max: number): { top: number; ticks: number[] } {
  if (max <= 0) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const rough = max / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough;
  const wholeStep = Math.max(1, step);
  const top = Math.ceil(max / wholeStep) * wholeStep;
  const ticks: number[] = [];
  for (let t = 0; t <= top; t += wholeStep) ticks.push(t);
  return { top, ticks };
}

/** Column path: 4px rounded data-end, square at the baseline. */
function columnPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function ColumnChart({ points, metric }: { points: SeriesPoint[]; metric: (typeof METRICS)[number] }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const values = points.map((p) => p[metric.value]);
  const { top, ticks } = niceScale(Math.max(...values, 0));
  const plotWidth = Math.max(0, width - Y_GUTTER);
  const band = points.length ? plotWidth / points.length : 0;
  const barWidth = Math.max(2, Math.min(24, band * 0.62));
  const y = (v: number) => TOP_PAD + (1 - v / top) * (PLOT_HEIGHT - TOP_PAD);
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotWidth / 64))));
  const total = values.reduce((a, b) => a + b, 0);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!points.length) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      setActive((i) => (i === null ? (delta > 0 ? 0 : points.length - 1) : Math.min(points.length - 1, Math.max(0, i + delta))));
    }
    if (event.key === 'Escape') setActive(null);
  };

  const activePoint = active !== null ? points[active] : null;
  const tooltipLeft =
    active !== null ? Math.min(Math.max(Y_GUTTER + band * (active + 0.5), 70), Math.max(70, width - 70)) : 0;

  return (
    <div
      ref={ref}
      role="group"
      aria-roledescription="chart"
      aria-label={`${metric.tab} over time: ${formatNumber(total)} in total. Use left and right arrow keys to read each period.`}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onBlur={() => setActive(null)}
      onMouseLeave={() => setActive(null)}
      className="relative rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-500"
      style={{ height: PLOT_HEIGHT + AXIS_BAND }}
    >
      {width > 0 && (
        <svg width={width} height={PLOT_HEIGHT + AXIS_BAND} className="block overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={Y_GUTTER} x2={width} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#cbd5e1' : '#f1f5f9'} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={Y_GUTTER - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-slate-400 text-[11px] tabular-nums">
                {formatNumber(t)}
              </text>
            </g>
          ))}

          {points.map((p, i) => {
            const v = p[metric.value];
            const x = Y_GUTTER + band * i;
            const isActive = i === active;
            return (
              <g key={p.key} onMouseEnter={() => setActive(i)} onClick={() => setActive(i)}>
                <rect x={x} y={0} width={band} height={PLOT_HEIGHT} className={isActive ? 'fill-slate-100/70' : 'fill-transparent'} />
                {v > 0 && (
                  <path
                    d={columnPath(x + (band - barWidth) / 2, y(v), barWidth, y(0) - y(v))}
                    fill={isActive ? BAR_ACTIVE : BAR}
                    className="transition-colors duration-100"
                  />
                )}
                {i % labelEvery === 0 && (
                  <text x={x + band / 2} y={PLOT_HEIGHT + 18} textAnchor="middle" className="fill-slate-400 text-[11px]">
                    {p.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}

      {total === 0 && width > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-center" style={{ height: PLOT_HEIGHT }}>
          <p className="rounded-md bg-white/90 px-3 py-1.5 text-[13px] text-slate-500">No {metric.unit[1]} in this period</p>
        </div>
      )}

      {activePoint && (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg"
          style={{ left: tooltipLeft }}
        >
          <p className="text-sm font-semibold whitespace-nowrap text-slate-900">
            {formatNumber(activePoint[metric.value])}{' '}
            <span className="font-normal text-slate-500">
              {activePoint[metric.value] === 1 ? metric.unit[0] : metric.unit[1]}
            </span>
          </p>
          <p className="mt-0.5 text-xs whitespace-nowrap text-slate-400">{activePoint.fullLabel}</p>
        </div>
      )}
    </div>
  );
}

function SeriesTable({ points }: { points: SeriesPoint[] }) {
  return (
    <div className="max-h-[228px] overflow-auto rounded-md border border-slate-200">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Period</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Leads</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Sent</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Opens</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 tabular-nums">
          {[...points].reverse().map((p) => (
            <tr key={p.key}>
              <td className="px-3 py-1.5 text-slate-600">{p.fullLabel}</td>
              <td className="px-3 py-1.5 text-right text-slate-900">{formatNumber(p.leads)}</td>
              <td className="px-3 py-1.5 text-right text-slate-900">{formatNumber(p.sent)}</td>
              <td className="px-3 py-1.5 text-right text-slate-900">{formatNumber(p.opened)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ActivityChart({ points }: { points: SeriesPoint[] }) {
  const [metricKey, setMetricKey] = useState<Metric>('leads');
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const metric = METRICS.find((m) => m.value === metricKey)!;

  return (
    <section className="flex h-full flex-col rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-slate-900">Activity</h2>
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Metric" className="inline-flex rounded-lg bg-slate-100 p-0.5">
            {METRICS.map((m) => (
              <button
                key={m.value}
                type="button"
                role="tab"
                aria-selected={m.value === metricKey}
                onClick={() => setMetricKey(m.value)}
                className={cn(
                  'h-7 rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
                  m.value === metricKey ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                )}
              >
                {m.tab}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setView((v) => (v === 'chart' ? 'table' : 'chart'))}
            className="h-7 rounded-md px-2.5 text-xs font-medium text-slate-500 ring-1 ring-slate-200 transition-colors ring-inset hover:bg-slate-50 hover:text-slate-800"
          >
            {view === 'chart' ? 'Table' : 'Chart'}
          </button>
        </div>
      </div>
      <div className="flex-1 px-5 pt-5 pb-3">
        {view === 'chart' ? <ColumnChart points={points} metric={metric} /> : <SeriesTable points={points} />}
      </div>
    </section>
  );
}
