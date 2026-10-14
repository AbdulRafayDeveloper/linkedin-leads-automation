'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ApiError,
  deleteCampaignApi,
  getCampaignsApi,
  type CampaignSortField,
  type CampaignSummaryRecord,
} from '@/services/lead-ingestion/apiClient';
import { formatDateTime } from '@/services/lead-ingestion/campaignRunner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { buttonClasses } from '@/components/ui/buttonClasses';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  LoaderIcon,
  RefreshIcon,
  SearchIcon,
  SendIcon,
  TrashIcon,
  XIcon,
} from '@/components/ui/Icons';
import { cn } from '@/lib/utils/cn';
import { CampaignStatusBadge } from './campaigns/CampaignStatusBadge';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const POLL_WHILE_SENDING_MS = 15_000;
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'running', label: 'Running' },
  { value: 'paused', label: 'Paused' },
  { value: 'draft', label: 'Draft' },
  { value: 'completed', label: 'Completed' },
];

interface SortState {
  field: CampaignSortField;
  order: 'asc' | 'desc';
}

const DEFAULT_SORT: SortState = { field: 'createdAt', order: 'desc' };

interface ColumnDef {
  field: CampaignSortField;
  label: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
  /** Order used the first time the column is clicked. */
  initialOrder: 'asc' | 'desc';
}

const COUNT_COLUMNS: ColumnDef[] = [
  { field: 'totalEmails', label: 'Total', align: 'center', initialOrder: 'desc' },
  { field: 'deliveredCount', label: 'Delivered', align: 'center', className: 'text-emerald-700', initialOrder: 'desc' },
  { field: 'openedCount', label: 'Opened', align: 'center', className: 'text-indigo-700', initialOrder: 'desc' },
  { field: 'failedCount', label: 'Failed', align: 'center', className: 'text-red-700', initialOrder: 'desc' },
];

function processedOf(campaign: CampaignSummaryRecord): number {
  return campaign.deliveredCount + campaign.failedCount;
}

function progressLabel(campaign: CampaignSummaryRecord): string {
  const parts = [`${campaign.deliveredCount} of ${campaign.totalEmails} delivered`];
  if (campaign.failedCount > 0) parts.push(`${campaign.failedCount} failed`);
  if (campaign.pendingCount + campaign.sendingCount > 0) parts.push(`${campaign.pendingCount + campaign.sendingCount} pending`);
  return parts.join(', ');
}

/** Two-tone progress: delivered in emerald, failed in red, the rest empty. */
function ProgressBar({ campaign, className }: { campaign: CampaignSummaryRecord; className?: string }) {
  const total = Math.max(campaign.totalEmails, 1);
  const delivered = (campaign.deliveredCount / total) * 100;
  const failed = (campaign.failedCount / total) * 100;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={campaign.totalEmails}
      aria-valuenow={processedOf(campaign)}
      aria-label={progressLabel(campaign)}
      title={progressLabel(campaign)}
      className={cn('flex h-1.5 w-full max-w-[9rem] overflow-hidden rounded-full bg-slate-100', className)}
    >
      <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${delivered}%` }} />
      <div className="h-full bg-red-400 transition-[width]" style={{ width: `${failed}%` }} />
    </div>
  );
}

function SortIndicator({ active, order }: { active: boolean; order: 'asc' | 'desc' }) {
  return (
    <ChevronDownIcon
      width={12}
      height={12}
      aria-hidden="true"
      className={cn(
        'shrink-0 transition-transform',
        active ? 'text-slate-700' : 'text-slate-300',
        active && order === 'asc' && 'rotate-180'
      )}
    />
  );
}

export default function CampaignsDashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const legacyIdParam = searchParams.get('id');

  const [campaigns, setCampaigns] = useState<CampaignSummaryRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openTrackingEnabled, setOpenTrackingEnabled] = useState(true);

  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  const [deleteTarget, setDeleteTarget] = useState<CampaignSummaryRecord | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const requestRef = useRef<AbortController | null>(null);

  // Old links from the Ready to Send page arrived as /campaigns?id=…; send them
  // straight to the campaign page without leaving a history entry behind.
  useEffect(() => {
    if (!legacyIdParam) return;
    router.replace(
      OBJECT_ID_PATTERN.test(legacyIdParam) ? `/lead-ingestion/campaigns/${legacyIdParam}` : '/lead-ingestion/campaigns'
    );
  }, [legacyIdParam, router]);

  const load = useCallback(
    async (options: { silent?: boolean } = {}) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      if (!options.silent) setRefreshing(true);

      try {
        const res = await getCampaignsApi(
          {
            page,
            limit: PAGE_SIZE,
            search: searchQuery,
            status: statusFilter,
            sort: sort.field,
            order: sort.order,
          },
          { signal: controller.signal }
        );
        if (controller.signal.aborted) return;
        setCampaigns(res.campaigns);
        setTotal(res.total);
        setPages(res.pages);
        setOpenTrackingEnabled(res.openTrackingEnabled);
        setError(null);
        if (page > res.pages) setPage(res.pages);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Failed to fetch campaigns');
      } finally {
        if (!controller.signal.aborted) {
          setInitialLoading(false);
          setRefreshing(false);
        }
      }
    },
    [page, searchQuery, statusFilter, sort]
  );

  // Debounce typing; a new search always starts from the first page.
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput.trim();
      setSearchQuery((prev) => {
        if (prev !== next) setPage(1);
        return next;
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    // Deferred a tick so the effect itself sets no state synchronously.
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
      requestRef.current?.abort();
    };
  }, [load]);

  // Keep counts fresh while something is sending, and when the tab comes back.
  const anySending = campaigns.some((c) => c.isRunnerActive || c.sendingCount > 0);
  useEffect(() => {
    if (!anySending) return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    }, POLL_WHILE_SENDING_MS);
    return () => clearInterval(timer);
  }, [anySending, load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const changeStatus = (value: string) => {
    setStatusFilter(value);
    setPage(1);
  };

  const toggleSort = (column: ColumnDef | { field: CampaignSortField; initialOrder: 'asc' | 'desc' }) => {
    setSort((prev) =>
      prev.field === column.field
        ? { field: column.field, order: prev.order === 'asc' ? 'desc' : 'asc' }
        : { field: column.field, order: column.initialOrder }
    );
    setPage(1);
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearchQuery('');
    changeStatus('all');
    setSort(DEFAULT_SORT);
  };

  const openCampaign = (id: string) => router.push(`/lead-ingestion/campaigns/${id}`);

  const onRowClick = (event: MouseEvent<HTMLTableRowElement>, id: string) => {
    if ((event.target as HTMLElement).closest('a, button, input, select')) return;
    openCampaign(id);
  };

  const onRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, id: string) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openCampaign(id);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await deleteCampaignApi(deleteTarget._id);
      setDeleteTarget(null);
      setNotice(
        res.releasedDrafts > 0
          ? `Deleted "${deleteTarget.name}". ${res.releasedDrafts} unsent ${res.releasedDrafts === 1 ? 'draft is' : 'drafts are'} back in Ready to Send.`
          : `Deleted "${deleteTarget.name}".`
      );
      await load({ silent: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setDeleteTarget(null);
        setNotice(`"${deleteTarget.name}" was already deleted.`);
        await load({ silent: true });
      } else {
        setDeleteError(err instanceof Error ? err.message : 'Failed to delete campaign');
      }
    } finally {
      setDeleting(false);
    }
  };

  const hasFilters = searchQuery !== '' || statusFilter !== 'all';
  const firstIndex = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastIndex = Math.min(page * PAGE_SIZE, total);

  const headerButton = (column: ColumnDef) => {
    const active = sort.field === column.field;
    return (
      <th
        key={column.field}
        scope="col"
        aria-sort={active ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={cn('px-4 py-3', column.align === 'center' && 'text-center', column.align === 'right' && 'text-right')}
      >
        <button
          type="button"
          onClick={() => toggleSort(column)}
          className={cn(
            'inline-flex items-center gap-1 rounded hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
            column.className
          )}
        >
          {column.label}
          {column.field === 'openedCount' && !openTrackingEnabled && (
            <span className="rounded bg-slate-100 px-1 text-[10px] font-medium normal-case tracking-normal text-slate-500" title="Open tracking is off. Set ENABLE_OPEN_TRACKING=true to record opens.">
              off
            </span>
          )}
          <SortIndicator active={active} order={sort.order} />
        </button>
      </th>
    );
  };

  return (
    <div className="w-full px-4 py-8 sm:px-8">
      <PageHeader
        title="Campaigns"
        description="Track delivery and opens, and resend failed emails."
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => { void load(); }}
            isLoading={refreshing && !initialLoading}
            aria-label="Refresh campaigns"
          >
            {!(refreshing && !initialLoading) && <RefreshIcon width={14} height={14} />}
            Refresh
          </Button>
        }
      />

      <div className="space-y-4">
        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangleIcon width={16} height={16} className="mt-0.5 shrink-0 text-red-600" />
            <div className="flex-1 font-medium">{error}</div>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss error" className="rounded p-0.5 text-red-500 hover:bg-red-100">
              <XIcon width={14} height={14} />
            </button>
          </div>
        )}

        {notice && (
          <div role="status" className="flex items-start gap-2.5 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            <CheckCircleIcon width={16} height={16} className="mt-0.5 shrink-0 text-emerald-600" />
            <div className="flex-1 font-medium">{notice}</div>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message" className="rounded p-0.5 text-emerald-600 hover:bg-emerald-100">
              <XIcon width={14} height={14} />
            </button>
          </div>
        )}

        {/* Filters */}
        <Card className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative w-full sm:w-72">
              <label htmlFor="campaign-search" className="sr-only">
                Search campaigns by name
              </label>
              <SearchIcon width={14} height={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
              <input
                id="campaign-search"
                type="search"
                placeholder="Search by name"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full rounded-md border border-slate-300 bg-white py-2 pr-8 pl-8 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  aria-label="Clear search"
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <XIcon width={14} height={14} />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="campaign-status" className="text-sm font-medium text-slate-600">
                Status
              </label>
              <select
                id="campaign-status"
                value={statusFilter}
                onChange={(e) => changeStatus(e.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            {hasFilters && (
              <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                Clear filters
              </Button>
            )}
          </div>

          <p className="text-xs text-slate-500" aria-live="polite">
            {initialLoading
              ? 'Loading campaigns…'
              : total === 0
                ? 'No campaigns'
                : `Showing ${firstIndex}–${lastIndex} of ${total}`}
          </p>
        </Card>

        {initialLoading ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16" role="status">
            <LoaderIcon width={28} height={28} className="animate-spin text-indigo-600" />
            <span className="text-sm font-medium text-slate-500">Loading campaigns…</span>
          </div>
        ) : campaigns.length === 0 ? (
          <Card>
            {hasFilters ? (
              <EmptyState
                icon={<SearchIcon width={20} height={20} />}
                title="No campaigns match these filters"
                description="Try a different name or status."
                action={
                  <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<SendIcon width={20} height={20} />}
                title="No campaigns yet"
                description="Pick approved drafts on the Ready to Send page and bundle them into a campaign."
                action={
                  <Link href="/lead-ingestion/approved" className={buttonClasses('primary', 'sm')}>
                    Go to Ready to Send
                  </Link>
                }
              />
            )}
          </Card>
        ) : (
          <>
            {/* Desktop table */}
            <Card className={cn('hidden overflow-hidden md:block', refreshing && 'opacity-70 transition-opacity')} aria-busy={refreshing}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-600 uppercase">
                    <tr>
                      <th scope="col" aria-sort={sort.field === 'name' ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'} className="px-4 py-3">
                        <button type="button" onClick={() => toggleSort({ field: 'name', initialOrder: 'asc' })} className="inline-flex items-center gap-1 rounded hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
                          Campaign
                          <SortIndicator active={sort.field === 'name'} order={sort.order} />
                        </button>
                      </th>
                      <th scope="col" className="px-4 py-3">Status</th>
                      <th scope="col" aria-sort={sort.field === 'createdAt' ? (sort.order === 'asc' ? 'ascending' : 'descending') : 'none'} className="px-4 py-3">
                        <button type="button" onClick={() => toggleSort({ field: 'createdAt', initialOrder: 'desc' })} className="inline-flex items-center gap-1 rounded hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600">
                          Created
                          <SortIndicator active={sort.field === 'createdAt'} order={sort.order} />
                        </button>
                      </th>
                      <th scope="col" className="px-4 py-3 text-center text-slate-600">Pending</th>
                      {COUNT_COLUMNS.map(headerButton)}
                      <th scope="col" className="px-4 py-3 text-right">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {campaigns.map((campaign) => (
                      <tr
                        key={campaign._id}
                        tabIndex={0}
                        onClick={(e) => onRowClick(e, campaign._id)}
                        onKeyDown={(e) => onRowKeyDown(e, campaign._id)}
                        className="cursor-pointer transition-colors hover:bg-indigo-50/40 focus-visible:bg-indigo-50/60 focus-visible:outline-none"
                      >
                        <td className="px-4 py-3">
                          <Link
                            href={`/lead-ingestion/campaigns/${campaign._id}`}
                            className="block max-w-xs truncate font-semibold text-slate-900 hover:text-indigo-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                            title={campaign.name}
                          >
                            {campaign.name}
                          </Link>
                          <ProgressBar campaign={campaign} className="mt-1.5" />
                        </td>
                        <td className="px-4 py-3">
                          <CampaignStatusBadge status={campaign.status} isRunnerActive={campaign.isRunnerActive} />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDateTime(campaign.createdAt)}</td>
                        <td className="px-4 py-3 text-center font-semibold text-slate-700">{campaign.pendingCount + campaign.sendingCount}</td>
                        <td className="px-4 py-3 text-center font-semibold text-slate-900">{campaign.totalEmails}</td>
                        <td className="px-4 py-3 text-center font-semibold text-emerald-700">{campaign.deliveredCount}</td>
                        <td className="px-4 py-3 text-center font-semibold text-indigo-700" title={openTrackingEnabled ? undefined : 'Open tracking is off'}>
                          {openTrackingEnabled ? campaign.openedCount : '—'}
                        </td>
                        <td className="px-4 py-3 text-center font-semibold text-red-700">{campaign.failedCount}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Link href={`/lead-ingestion/campaigns/${campaign._id}`} className={buttonClasses('outline', 'sm')}>
                              Open
                            </Link>
                            <button
                              type="button"
                              onClick={() => { setDeleteError(null); setDeleteTarget(campaign); }}
                              aria-label={`Delete campaign ${campaign.name}`}
                              title="Delete campaign"
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                            >
                              <TrashIcon width={15} height={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Mobile cards */}
            <ul className={cn('space-y-3 md:hidden', refreshing && 'opacity-70 transition-opacity')} aria-busy={refreshing}>
              {campaigns.map((campaign) => (
                <li key={campaign._id}>
                  <Card className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/lead-ingestion/campaigns/${campaign._id}`}
                          className="block truncate text-base font-semibold text-slate-900 hover:text-indigo-700"
                        >
                          {campaign.name}
                        </Link>
                        <p className="mt-0.5 text-xs text-slate-500">Created {formatDateTime(campaign.createdAt)}</p>
                      </div>
                      <CampaignStatusBadge status={campaign.status} isRunnerActive={campaign.isRunnerActive} />
                    </div>
                    <ProgressBar campaign={campaign} className="mt-3 max-w-none" />
                    <p className="mt-1 text-xs text-slate-500">{progressLabel(campaign)}</p>
                    <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                      <div className="rounded-md bg-slate-50 py-2">
                        <dt className="text-[10px] font-semibold tracking-wide text-slate-500 uppercase">Total</dt>
                        <dd className="text-base font-semibold text-slate-900">{campaign.totalEmails}</dd>
                      </div>
                      <div className="rounded-md bg-emerald-50 py-2">
                        <dt className="text-[10px] font-semibold tracking-wide text-emerald-700 uppercase">Sent</dt>
                        <dd className="text-base font-semibold text-emerald-800">{campaign.deliveredCount}</dd>
                      </div>
                      <div className="rounded-md bg-indigo-50 py-2">
                        <dt className="text-[10px] font-semibold tracking-wide text-indigo-700 uppercase">Opened</dt>
                        <dd className="text-base font-semibold text-indigo-800">{openTrackingEnabled ? campaign.openedCount : '—'}</dd>
                      </div>
                      <div className="rounded-md bg-red-50 py-2">
                        <dt className="text-[10px] font-semibold tracking-wide text-red-700 uppercase">Failed</dt>
                        <dd className="text-base font-semibold text-red-800">{campaign.failedCount}</dd>
                      </div>
                    </dl>
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <Link href={`/lead-ingestion/campaigns/${campaign._id}`} className={buttonClasses('outline', 'sm')}>
                        Open
                      </Link>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => { setDeleteError(null); setDeleteTarget(campaign); }}
                        className="text-red-600 hover:bg-red-50 hover:text-red-700"
                      >
                        <TrashIcon width={14} height={14} /> Delete
                      </Button>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>

            {pages > 1 && (
              <nav aria-label="Pagination" className="flex items-center justify-between gap-3">
                <Button type="button" variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || refreshing}>
                  <ChevronLeftIcon width={14} height={14} /> Previous
                </Button>
                <span className="text-sm text-slate-600">
                  Page {page} of {pages}
                </span>
                <Button type="button" variant="outline" size="sm" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages || refreshing}>
                  Next <ChevronRightIcon width={14} height={14} />
                </Button>
              </nav>
            )}
          </>
        )}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        tone="danger"
        title={deleteTarget ? `Delete "${deleteTarget.name}"?` : 'Delete campaign?'}
        description={
          deleteTarget && deleteTarget.pendingCount + deleteTarget.sendingCount + deleteTarget.failedCount > 0
            ? `${deleteTarget.pendingCount + deleteTarget.sendingCount + deleteTarget.failedCount} unsent ${deleteTarget.pendingCount + deleteTarget.sendingCount + deleteTarget.failedCount === 1 ? 'draft goes' : 'drafts go'} back to Ready to Send. Emails already delivered stay sent. This cannot be undone.`
            : 'Delivery history for this campaign will be removed. This cannot be undone.'
        }
        confirmLabel="Delete campaign"
        busy={deleting}
        onConfirm={() => { void confirmDelete(); }}
        onCancel={() => { if (!deleting) { setDeleteTarget(null); setDeleteError(null); } }}
      >
        {deleteError && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {deleteError}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
