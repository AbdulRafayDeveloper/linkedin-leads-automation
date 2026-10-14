'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Button from '@/components/ui/Button';
import { buttonClasses } from '@/components/ui/buttonClasses';
import { Card, CardContent } from '@/components/ui/Card';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageHeader } from '@/components/ui/PageHeader';
import { Toaster, useToasts } from '@/components/ui/Toaster';
import {
  AlertTriangleIcon,
  LoaderIcon,
  MailIcon,
  PlusCircleIcon,
  TrashIcon,
  UsersIcon,
} from '@/components/ui/Icons';
import type { LeadCardRecord } from '@/lib/leads/cards';
import {
  EMPTY_FILTERS,
  buildListRequest,
  filtersToSearchParams,
  hasActiveFilters,
  parseFilters,
  type LeadFilters as Filters,
} from '@/lib/leads/listFilters';
import LeadCard from './LeadCard';
import LeadFilters from './LeadFilters';

const PAGE_SIZE = 24;
const MAX_FETCH = 200;
const SEARCH_DEBOUNCE_MS = 350;

interface LeadsResponse {
  success?: boolean;
  error?: string;
  leads?: LeadCardRecord[];
  total?: number;
  hasMore?: boolean;
  clients?: { id: string; name: string }[];
}

interface DeleteResponse {
  success?: boolean;
  error?: string;
  deletedCount?: number;
  removedCampaignItems?: number;
  removedClients?: number;
}

type PendingDelete = { kind: 'single'; lead: LeadCardRecord } | { kind: 'bulk'; ids: string[] };

function deletedMessage(data: DeleteResponse): string {
  const leads = data.deletedCount ?? 0;
  const parts = [`${leads} lead${leads === 1 ? '' : 's'} deleted`];
  if (data.removedCampaignItems) parts.push(`${data.removedCampaignItems} campaign email(s) removed`);
  if (data.removedClients) parts.push(`${data.removedClients} empty client(s) cleaned up`);
  return parts.join(' · ');
}

function LeadCardSkeleton() {
  return (
    <Card className="min-w-0 animate-pulse p-4" aria-hidden="true">
      <div className="h-4 w-1/2 rounded bg-slate-200" />
      <div className="mt-2 h-3 w-1/3 rounded bg-slate-100" />
      <div className="mt-4 h-20 rounded-lg bg-slate-100" />
      <div className="mt-2.5 h-20 rounded-lg bg-slate-100" />
    </Card>
  );
}

export default function MyLeadsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toasts, push, dismiss } = useToasts();

  const [filters, setFilters] = useState<Filters>(() =>
    parseFilters(new URLSearchParams(searchParams.toString()))
  );
  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);
  const [leads, setLeads] = useState<LeadCardRecord[]>([]);
  const [clients, setClients] = useState<{ id: string; name: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [pagesLoaded, setPagesLoaded] = useState(1);
  const [firstLoadDone, setFirstLoadDone] = useState(false);
  const [busy, setBusy] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | undefined>(undefined);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const selectAllRef = useRef<HTMLInputElement>(null);

  // Only the typed search is debounced; the dropdowns apply at once.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const applied = useMemo<Filters>(
    () => ({ ...filters, search: debouncedSearch }),
    [filters, debouncedSearch]
  );
  const queryKey = useMemo(() => filtersToSearchParams(applied).toString(), [applied]);

  // Read by the loader, so changing a filter can't rebuild (and re-fire) it.
  const appliedRef = useRef(applied);
  useEffect(() => {
    appliedRef.current = applied;
  }, [applied]);

  const load = useCallback(
    async (targetPage: number, append: boolean, limit = PAGE_SIZE) => {
      const request = buildListRequest(appliedRef.current, { page: targetPage, limit });
      if (request.error || !request.params) {
        // A broken custom range: say so and keep the rows that are on screen.
        setDateError(request.error);
        setBusy(false);
        setFirstLoadDone(true);
        return;
      }
      setDateError(undefined);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const requestId = (requestIdRef.current += 1);

      if (append) setLoadingMore(true);
      else setBusy(true);

      try {
        const response = await fetch(`/api/leads?${request.params.toString()}`, {
          signal: controller.signal,
        });
        const data = (await response.json().catch(() => null)) as LeadsResponse | null;
        // A slower earlier request must never overwrite a newer one.
        if (requestId !== requestIdRef.current) return;
        if (!response.ok || !data?.success) {
          throw new Error(data?.error || 'Could not load leads');
        }

        const rows = data.leads ?? [];
        setLeads((previous) => (append ? [...previous, ...rows] : rows));
        setPagesLoaded(append ? targetPage : Math.max(1, Math.ceil(limit / PAGE_SIZE)));
        if (!append) {
          // Rows the new query doesn't contain can no longer be acted on.
          const visible = new Set(rows.map((row) => row._id));
          setSelectedIds((previous) => {
            if (previous.size === 0) return previous;
            const kept = new Set([...previous].filter((id) => visible.has(id)));
            return kept.size === previous.size ? previous : kept;
          });
        }
        setTotal(data.total ?? rows.length);
        setHasMore(Boolean(data.hasMore));
        if (data.clients) setClients(data.clients);
        setError(null);
      } catch (caught) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) return;
        const message = caught instanceof Error ? caught.message : 'Could not load leads';
        setError(message);
        push(message, 'error');
      } finally {
        if (requestId === requestIdRef.current) {
          setBusy(false);
          setLoadingMore(false);
          setFirstLoadDone(true);
        }
      }
    },
    [push]
  );

  // One effect, one request per query change (no duplicate call on mount).
  useEffect(() => {
    void load(1, false);
  }, [queryKey, load]);

  // Keep the address bar in step, so a filtered view can be shared or reloaded.
  useEffect(() => {
    const next = filtersToSearchParams(applied).toString();
    if (next === searchParams.toString()) return;
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [applied, pathname, router, searchParams]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const visibleIds = useMemo(() => leads.map((lead) => lead._id), [leads]);
  const selectedVisible = visibleIds.filter((id) => selectedIds.has(id));
  const allSelected = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selectedVisible.length > 0 && !allSelected;
    }
  }, [allSelected, selectedVisible.length]);

  const reload = useCallback(() => {
    void load(1, false, Math.min(MAX_FETCH, pagesLoaded * PAGE_SIZE));
  }, [load, pagesLoaded]);

  const updateFilters = (patch: Partial<Filters>) => setFilters((prev) => ({ ...prev, ...patch }));

  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleSelectAll = () =>
    setSelectedIds(() => (allSelected ? new Set<string>() : new Set(visibleIds)));

  const runDelete = async () => {
    if (!pendingDelete || deleting) return;
    const ids = pendingDelete.kind === 'single' ? [pendingDelete.lead._id] : pendingDelete.ids;
    setDeleting(true);
    try {
      const response = await fetch('/api/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
      const data = (await response.json().catch(() => null)) as DeleteResponse | null;
      if (!response.ok || !data?.success) {
        throw new Error(data?.error || 'Could not delete the selected leads');
      }

      setSelectedIds((prev) => {
        const next = new Set(prev);
        ids.forEach((id) => next.delete(id));
        return next;
      });
      setPendingDelete(null);
      push(deletedMessage(data), (data.deletedCount ?? 0) > 0 ? 'success' : 'info');
      // Refetch so the page stays full and the total is the server's, not a guess.
      reload();
    } catch (caught) {
      push(caught instanceof Error ? caught.message : 'Could not delete the leads', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const showSkeleton = busy && !firstLoadDone;
  const filtersActive = hasActiveFilters(applied);
  const deleteTargetName =
    pendingDelete?.kind === 'single' ? pendingDelete.lead.fullName?.trim() || 'this lead' : '';

  return (
    <div className="w-full max-w-none space-y-6 px-4 py-8 sm:px-8">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <PageHeader
          title="Leads"
          description="Every imported prospect with their companies, contact emails and verification status."
        />
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link href="/lead-ingestion" className={buttonClasses('primary', 'sm')}>
            <PlusCircleIcon width={14} height={14} />
            New Lead
          </Link>
          <Link href="/lead-ingestion/emails" className={buttonClasses('outline', 'sm')}>
            <MailIcon width={14} height={14} />
            Drafts
          </Link>
        </div>
      </div>

      <LeadFilters
        filters={filters}
        clients={clients}
        busy={busy}
        dateError={dateError}
        onChange={updateFilters}
        onReset={() => setFilters(EMPTY_FILTERS)}
        onRefresh={reload}
      />

      {error && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <span className="flex min-w-0 items-center gap-2">
            <AlertTriangleIcon width={16} height={16} className="shrink-0" />
            <span className="min-w-0 break-words">
              {error}
              {leads.length > 0 && ' — showing the last results that loaded.'}
            </span>
          </span>
          <Button variant="outline" size="sm" onClick={reload}>
            Try again
          </Button>
        </div>
      )}

      {/* Sticky under the app header so the bulk action stays reachable while scrolling. */}
      <div className="sticky top-14 z-20 -mx-4 bg-slate-50/95 px-4 py-2 backdrop-blur sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={allSelected}
              onChange={toggleSelectAll}
              disabled={visibleIds.length === 0}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:opacity-40"
            />
            <span>Select all on this page</span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <p aria-live="polite" className="text-sm text-slate-600">
              {busy && !firstLoadDone
                ? 'Loading leads…'
                : selectedVisible.length > 0
                  ? `${selectedVisible.length} selected · showing ${leads.length} of ${total}`
                  : `Showing ${leads.length} of ${total} lead${total === 1 ? '' : 's'}`}
            </p>
            {selectedVisible.length > 0 && (
              <Button
                variant="destructive"
                size="sm"
                disabled={deleting}
                onClick={() => setPendingDelete({ kind: 'bulk', ids: selectedVisible })}
              >
                <TrashIcon width={14} height={14} />
                Delete {selectedVisible.length}
              </Button>
            )}
          </div>
        </div>
      </div>

      {showSkeleton ? (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <LeadCardSkeleton key={index} />
          ))}
        </div>
      ) : leads.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            {filtersActive ? (
              <EmptyState
                icon={<UsersIcon width={20} height={20} />}
                title="No leads match these filters"
                description="Try a different date range or status, or clear the filters to see everything."
                action={
                  <Button variant="outline" size="sm" onClick={() => setFilters(EMPTY_FILTERS)}>
                    Clear filters
                  </Button>
                }
              />
            ) : (
              <EmptyState
                icon={<UsersIcon width={20} height={20} />}
                title="No leads yet"
                description="Paste a LinkedIn or Sales Navigator profile and LeadForge will find the contacts and draft the outreach."
                action={
                  <Link href="/lead-ingestion" className={buttonClasses('primary', 'sm')}>
                    <PlusCircleIcon width={14} height={14} />
                    Import your first lead
                  </Link>
                }
              />
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <div
            className={`grid min-w-0 gap-4 transition-opacity lg:grid-cols-2 2xl:grid-cols-3 ${busy ? 'opacity-60' : ''}`}
          >
            {leads.map((lead) => (
              <LeadCard
                key={lead._id}
                lead={lead}
                selected={selectedIds.has(lead._id)}
                deleting={deleting && pendingDelete?.kind === 'single' && pendingDelete.lead._id === lead._id}
                onToggleSelect={toggleSelect}
                onRequestDelete={(target) => setPendingDelete({ kind: 'single', lead: target })}
              />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => void load(pagesLoaded + 1, true)}
                isLoading={loadingMore}
              >
                {loadingMore ? 'Loading…' : `Load more (${total - leads.length} left)`}
              </Button>
            </div>
          )}
        </>
      )}

      {busy && firstLoadDone && (
        <p className="flex items-center justify-center gap-2 text-sm text-slate-500">
          <LoaderIcon width={14} height={14} className="animate-spin" />
          Updating…
        </p>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        tone="danger"
        busy={deleting}
        title={pendingDelete?.kind === 'bulk' ? 'Delete selected leads?' : 'Delete this lead?'}
        confirmLabel={
          pendingDelete?.kind === 'bulk' ? `Delete ${pendingDelete.ids.length} leads` : 'Delete lead'
        }
        description={
          pendingDelete?.kind === 'bulk' ? (
            <>
              <strong>{pendingDelete.ids.length} leads</strong> and their drafts will be deleted.
              Their emails are also removed from any campaign, and clients left without a lead are
              cleaned up. This cannot be undone.
            </>
          ) : (
            <>
              <strong>{deleteTargetName}</strong> and the drafts for this lead will be deleted. The
              emails are also removed from any campaign. This cannot be undone.
            </>
          )
        }
        onConfirm={() => void runDelete()}
        onCancel={() => setPendingDelete(null)}
      />

      <Toaster toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}
