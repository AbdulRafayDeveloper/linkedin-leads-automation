'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { buttonClasses } from '@/components/ui/buttonClasses';
import {
  AlertTriangleIcon,
  ChartIcon,
  CheckCircleIcon,
  InboxIcon,
  MailIcon,
  PlusCircleIcon,
  RefreshIcon,
  SendIcon,
  UsersIcon,
} from '@/components/ui/Icons';
import { cn } from '@/lib/utils/cn';
import { getDashboardStatsApi } from '@/services/dashboard/apiClient';
import type { DashboardStats } from '@/services/dashboard/types';
import ActivityChart, { CHART_METRICS, type Metric } from './ActivityChart';
import DateRangeFilter from './DateRangeFilter';
import KpiTile from './KpiTile';
import {
  CampaignsPanel,
  DeliveryPanel,
  DraftsPanel,
  FunnelPanel,
  RecentLeadsPanel,
  ResearchPanel,
  VerificationPanel,
} from './DashboardCards';
import { DEFAULT_PRESET, comparisonLabel, isRangePreset, resolveRange, toDateInput, type RangePreset } from './dateRange';
import { formatDay, formatPercent, timeAgo } from './format';

/** How often the "updated" line and the relative times are recomputed. */
const CLOCK_TICK_MS = 30_000;
/** A tab brought back to the front reloads if its data is older than this. */
const STALE_AFTER_MS = 60_000;

function rangeCaption(stats: DashboardStats): string {
  const from = formatDay(stats.range.from);
  const to = formatDay(stats.range.to);
  if (stats.range.isAllTime) return stats.hasAnyData ? `Since ${from}` : 'No data yet';
  return from === to ? from : `${from} – ${to}`;
}

function LoadingState() {
  const block = (className: string) => (
    <div className={cn('animate-pulse rounded-xl border border-slate-200 bg-slate-50', className)} />
  );
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={cn('h-[132px] animate-pulse rounded-xl border border-slate-200 bg-slate-50', i === 4 && 'col-span-2 xl:col-span-1')} />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        {block('h-[318px] xl:col-span-2')}
        {block('h-[318px]')}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {block('h-[232px]')}
        {block('h-[232px]')}
        {block('h-[232px]')}
        {block('h-[232px]')}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {block('h-[280px]')}
        {block('h-[280px]')}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rangeParam = searchParams.get('range');
  const presetKnown = isRangePreset(rangeParam);
  const preset: RangePreset = presetKnown ? rangeParam : DEFAULT_PRESET;
  const customFrom = searchParams.get('from') ?? '';
  const customTo = searchParams.get('to') ?? '';
  const metricParam = searchParams.get('metric');
  const metric: Metric = CHART_METRICS.includes(metricParam as Metric) ? (metricParam as Metric) : 'leads';
  const view = searchParams.get('view') === 'table' ? 'table' : 'chart';

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => new Date());
  const fetchedAtRef = useRef(0);

  const updateQuery = useCallback(
    (next: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  // An unknown ?range= value falls back to the default; keep the URL honest.
  useEffect(() => {
    if (rangeParam && !presetKnown) updateQuery({ range: null, from: null, to: null });
  }, [rangeParam, presetKnown, updateQuery]);

  const onPresetChange = (next: RangePreset) => {
    if (next === 'custom') {
      const today = toDateInput(new Date());
      updateQuery({ range: 'custom', from: customFrom || today, to: customTo || today });
    } else {
      updateQuery({ range: next === DEFAULT_PRESET ? null : next, from: null, to: null });
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      // Resolved on every load (and refresh) so "today" never goes stale.
      const resolution = resolveRange(preset, { from: customFrom, to: customTo });
      if (resolution.kind === 'invalid') {
        // Keep the numbers that are on screen rather than answering a question
        // nobody asked: an unusable range is reported, not guessed at.
        setRangeError(resolution.message);
        setLoading(false);
        return;
      }
      setRangeError(null);
      setLoading(true);
      try {
        const next = await getDashboardStatsApi(resolution.kind === 'all' ? null : resolution.range, controller.signal);
        setStats(next);
        setError(null);
        const at = new Date();
        setFetchedAt(at);
        setNow(at);
        fetchedAtRef.current = at.getTime();
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to load dashboard');
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [preset, customFrom, customTo, reloadKey]);

  // Keeps "updated 2m ago" and the relative times in the lists honest.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Coming back to a tab that has been sitting open reloads stale numbers.
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - fetchedAtRef.current > STALE_AFTER_MS) setReloadKey((key) => key + 1);
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const comparison = comparisonLabel(preset);
  const showEmptyWorkspace = Boolean(stats && !stats.hasAnyData);

  return (
    <div className="w-full max-w-none space-y-6 px-4 py-8 sm:px-8">
      <PageHeader title="Dashboard" description="How your prospecting and outreach are performing." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangeFilter
          preset={preset}
          customFrom={customFrom}
          customTo={customTo}
          error={rangeError ?? undefined}
          onPresetChange={onPresetChange}
          onCustomChange={(from, to) => updateQuery({ range: 'custom', from, to })}
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
          {stats && <span>{rangeCaption(stats)}</span>}
          {fetchedAt && (
            <span className="text-slate-500">Updated {timeAgo(fetchedAt.toISOString(), now)}</span>
          )}
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 font-medium text-slate-700 ring-1 ring-slate-200 transition-colors ring-inset hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-60"
          >
            <RefreshIcon width={14} height={14} className={cn(loading && stats && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {/* One polite announcement for the whole page state. */}
      <p aria-live="polite" className="sr-only">
        {loading
          ? 'Loading dashboard'
          : stats
            ? `Dashboard updated for ${rangeCaption(stats)}`
            : ''}
      </p>

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <AlertTriangleIcon width={16} height={16} className="shrink-0" />
          <span className="min-w-0 flex-1">
            {error}
            {stats && ' — showing the last numbers that loaded.'}
          </span>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="font-medium underline-offset-2 hover:underline"
          >
            Try again
          </button>
        </div>
      )}

      {!stats && loading && <LoadingState />}

      {!stats && !loading && !error && (
        <Card>
          <EmptyState
            icon={<ChartIcon width={20} height={20} />}
            title="Nothing to show yet"
            description="Pick a date range to load your numbers."
          />
        </Card>
      )}

      {showEmptyWorkspace && (
        <Card>
          <EmptyState
            icon={<ChartIcon width={20} height={20} />}
            title="No data yet"
            description="Import your first lead and this dashboard will fill up with contacts found, drafts written and emails sent."
            action={
              <Link href="/lead-ingestion" className={buttonClasses('primary', 'sm')}>
                <PlusCircleIcon width={14} height={14} />
                Import a lead
              </Link>
            }
          />
        </Card>
      )}

      {stats && !showEmptyWorkspace && (
        <div className={cn('space-y-4 transition-opacity duration-200', loading && 'opacity-60')}>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-5">
            <KpiTile label="Leads imported" unit="leads" icon={UsersIcon} metric={stats.kpis.leads} comparison={comparison} />
            <KpiTile
              label="Emails found"
              unit="addresses"
              icon={InboxIcon}
              metric={stats.kpis.emailsFound}
              comparison={comparison}
              footnote="Distinct addresses"
            />
            <KpiTile
              label="Verified emails"
              unit="addresses"
              icon={CheckCircleIcon}
              metric={stats.kpis.verified}
              comparison={comparison}
              footnote="Valid or risky"
            />
            <KpiTile label="Emails sent" unit="emails" icon={SendIcon} metric={stats.kpis.sent} comparison={comparison} />
            <KpiTile
              className="col-span-2 xl:col-span-1"
              label="Opens"
              unit="opens"
              icon={MailIcon}
              metric={stats.kpis.opened}
              comparison={comparison}
              unavailable={!stats.trackingEnabled}
              footnote={
                stats.trackingEnabled
                  ? stats.delivery.openRate === null
                    ? undefined
                    : `${formatPercent(stats.delivery.openRate)} of emails sent in this period`
                  : 'Open tracking is off'
              }
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="min-w-0 xl:col-span-2">
              <ActivityChart
                points={stats.series}
                metric={metric}
                view={view}
                onMetricChange={(next) => updateQuery({ metric: next === 'leads' ? null : next })}
                onViewChange={(next) => updateQuery({ view: next === 'chart' ? null : next })}
              />
            </div>
            <FunnelPanel funnel={stats.funnel} />
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <VerificationPanel verification={stats.verification} />
            <DraftsPanel drafts={stats.drafts} />
            <DeliveryPanel delivery={stats.delivery} trackingEnabled={stats.trackingEnabled} />
            <ResearchPanel research={stats.research} leads={stats.kpis.leads.value} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <RecentLeadsPanel leads={stats.recentLeads} now={now} />
            <CampaignsPanel campaigns={stats.campaigns} now={now} />
          </div>
        </div>
      )}
    </div>
  );
}
