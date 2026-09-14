'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  InboxIcon,
  MailIcon,
  RefreshIcon,
  SendIcon,
  UsersIcon,
} from '@/components/ui/Icons';
import { cn } from '@/lib/utils/cn';
import { getDashboardStatsApi } from '@/services/dashboard/apiClient';
import type { DashboardStats } from '@/services/dashboard/types';
import ActivityChart from './ActivityChart';
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
import { formatPercent } from './format';

function rangeCaption(stats: DashboardStats): string {
  const from = new Date(stats.range.from);
  const to = new Date(stats.range.to);
  const day = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (stats.range.isAllTime) return `Since ${day(from)}`;
  return day(from) === day(to) ? day(from) : `${day(from)} – ${day(to)}`;
}

function LoadingState() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-[132px] animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="h-[318px] animate-pulse rounded-xl border border-slate-200 bg-slate-50 xl:col-span-2" />
        <div className="h-[318px] animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const rangeParam = searchParams.get('range');
  const preset: RangePreset = isRangePreset(rangeParam) ? rangeParam : DEFAULT_PRESET;
  const customFrom = searchParams.get('from') ?? '';
  const customTo = searchParams.get('to') ?? '';

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

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
      setLoading(true);
      try {
        // Resolved on every load (and refresh) so "today" never goes stale.
        const range = resolveRange(preset, { from: customFrom, to: customTo });
        const next = await getDashboardStatsApi(range, controller.signal);
        setStats(next);
        setError(null);
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

  const comparison = comparisonLabel(preset);

  return (
    <div className="w-full max-w-none space-y-6 px-4 py-8 sm:px-8">
      <PageHeader title="Dashboard" description="How your prospecting and outreach are performing." />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <DateRangeFilter
          preset={preset}
          customFrom={customFrom}
          customTo={customTo}
          onPresetChange={onPresetChange}
          onCustomChange={(from, to) => updateQuery({ range: 'custom', from, to })}
        />
        <div className="flex items-center gap-3 text-xs text-slate-500">
          {stats && <span className="hidden sm:inline">{rangeCaption(stats)}</span>}
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 font-medium text-slate-600 ring-1 ring-slate-200 transition-colors ring-inset hover:bg-slate-50 hover:text-slate-900 disabled:opacity-60"
          >
            <RefreshIcon width={14} height={14} className={cn(loading && stats && 'animate-spin')} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangleIcon width={16} height={16} className="shrink-0" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setReloadKey((k) => k + 1)} className="font-medium underline-offset-2 hover:underline">
            Try again
          </button>
        </div>
      )}

      {!stats && loading && <LoadingState />}

      {stats && (
        <div className={cn('space-y-4 transition-opacity duration-200', loading && 'opacity-60')}>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-5">
            <KpiTile label="Leads imported" icon={UsersIcon} metric={stats.kpis.leads} comparison={comparison} />
            <KpiTile label="Emails found" icon={InboxIcon} metric={stats.kpis.emailsFound} comparison={comparison} />
            <KpiTile
              label="Verified emails"
              icon={CheckCircleIcon}
              metric={stats.kpis.verified}
              comparison={comparison}
              footnote="Valid or risky"
            />
            <KpiTile label="Emails sent" icon={SendIcon} metric={stats.kpis.sent} comparison={comparison} />
            <KpiTile
              className="col-span-2 lg:col-span-1"
              label="Opens"
              icon={MailIcon}
              metric={stats.kpis.opened}
              comparison={comparison}
              footnote={
                stats.trackingEnabled
                  ? stats.delivery.openRate === null
                    ? undefined
                    : `${formatPercent(stats.delivery.openRate)} open rate`
                  : 'Open tracking is off'
              }
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <ActivityChart points={stats.series} />
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
            <RecentLeadsPanel leads={stats.recentLeads} />
            <CampaignsPanel campaigns={stats.campaigns} />
          </div>
        </div>
      )}
    </div>
  );
}
