'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import { AlertTriangleIcon, LoaderIcon, SearchIcon, SparklesIcon } from '@/components/ui/Icons';
import {
  matchesFilters,
  parseApprovalFilter,
  parseSendStatusFilter,
  parseSmtpFilter,
  type DraftApprovalFilter,
  type DraftCounts,
  type DraftDetail,
  type DraftItem,
  type DraftSendStatusFilter,
  type DraftSmtpFilter,
} from '@/services/lead-ingestion/draftItems';
import DraftCard from './DraftCard';
import DraftEditorModal from './DraftEditorModal';
import { fetchClients, fetchDrafts, type DraftClientOption } from './draftsApi';

const PAGE_SIZE = 12;
const DEFAULTS = {
  search: '',
  clientId: 'all',
  approval: 'draft' as DraftApprovalFilter,
  smtp: 'all' as DraftSmtpFilter,
  sendStatus: 'all' as DraftSendStatusFilter,
};

function countLabel(label: string, count: number | undefined): string {
  return count === undefined ? label : `${label} (${count})`;
}

export default function DraftsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Filters live in the URL, so a refresh, the back button and a shared link
  // all show the same list.
  const [search, setSearch] = useState(searchParams.get('search') ?? DEFAULTS.search);
  const [clientId, setClientId] = useState(searchParams.get('clientId') ?? DEFAULTS.clientId);
  const [approval, setApproval] = useState<DraftApprovalFilter>(
    searchParams.has('approval') ? parseApprovalFilter(searchParams.get('approval')) : DEFAULTS.approval
  );
  const [smtp, setSmtp] = useState<DraftSmtpFilter>(parseSmtpFilter(searchParams.get('smtp')));
  const [sendStatus, setSendStatus] = useState<DraftSendStatusFilter>(
    parseSendStatusFilter(searchParams.get('sendStatus'))
  );

  const [items, setItems] = useState<DraftItem[]>([]);
  const [counts, setCounts] = useState<DraftCounts | null>(null);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openItem, setOpenItem] = useState<DraftItem | null>(null);

  const [clients, setClients] = useState<DraftClientOption[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [clientsLoading, setClientsLoading] = useState(false);
  const [clientPage, setClientPage] = useState(1);
  const [clientsHaveMore, setClientsHaveMore] = useState(false);

  const requestRef = useRef<AbortController | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const filters = useMemo(() => ({ approval, smtp, sendStatus }), [approval, smtp, sendStatus]);

  const isDefaultFilters =
    search === DEFAULTS.search &&
    clientId === DEFAULTS.clientId &&
    approval === DEFAULTS.approval &&
    smtp === DEFAULTS.smtp &&
    sendStatus === DEFAULTS.sendStatus;

  // Keep the URL in step with the filters (replace, so Back leaves the page).
  useEffect(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('search', search.trim());
    if (clientId !== DEFAULTS.clientId) params.set('clientId', clientId);
    if (approval !== DEFAULTS.approval) params.set('approval', approval);
    if (smtp !== DEFAULTS.smtp) params.set('smtp', smtp);
    if (sendStatus !== DEFAULTS.sendStatus) params.set('sendStatus', sendStatus);
    const query = params.toString();
    router.replace(query ? `?${query}` : '/lead-ingestion/emails', { scroll: false });
  }, [search, clientId, approval, smtp, sendStatus, router]);

  const load = useCallback(
    async (targetPage: number, mode: 'replace' | 'append') => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;

      if (mode === 'replace') setLoading(true);
      else setLoadingMore(true);
      setError(null);

      try {
        const data = await fetchDrafts(
          { page: targetPage, limit: PAGE_SIZE, search, clientId, ...filters },
          controller.signal
        );
        setItems((prev) => {
          if (mode === 'replace') return data.items;
          const seen = new Set(prev.map((item) => item.id));
          return [...prev, ...data.items.filter((item) => !seen.has(item.id))];
        });
        setCounts(data.counts);
        setTotal(data.total);
        setTruncated(data.truncated);
        setHasMore(data.hasMore);
        setPage(data.page);
      } catch (err) {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Could not load drafts');
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [search, clientId, filters]
  );

  // Debounced reload whenever a filter changes; the previous request is cancelled.
  useEffect(() => {
    const timer = setTimeout(() => void load(1, 'replace'), 300);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => () => requestRef.current?.abort(), []);

  // Infinite scroll. The sentinel is rendered whenever more pages exist, so the
  // list can never get stuck on a page that filtered down to nothing.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && !loadingMore) void load(page + 1, 'append');
      },
      { rootMargin: '200px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, page, load]);

  // Client dropdown data (searchable, paged).
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setClientsLoading(true);
      fetchClients(clientSearch, 1, controller.signal)
        .then((data) => {
          setClients(data.clients);
          setClientsHaveMore(data.hasMore);
          setClientPage(1);
        })
        .catch(() => {
          if (!controller.signal.aborted) setClients([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setClientsLoading(false);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [clientSearch]);

  const loadMoreClients = () => {
    if (!clientsHaveMore || clientsLoading) return;
    setClientsLoading(true);
    fetchClients(clientSearch, clientPage + 1)
      .then((data) => {
        setClients((prev) => [...prev, ...data.clients.filter((c) => !prev.some((p) => p._id === c._id))]);
        setClientsHaveMore(data.hasMore);
        setClientPage((prev) => prev + 1);
      })
      .catch(() => undefined)
      .finally(() => setClientsLoading(false));
  };

  /** A saved draft either updates in place or leaves the current filter. */
  const handleUpdated = (draft: DraftDetail) => {
    setOpenItem((current) => (current && current.id === draft.id ? { ...current, ...draft } : current));
    if (matchesFilters(draft, filters)) {
      setItems((prev) => prev.map((item) => (item.id === draft.id ? { ...item, ...draft } : item)));
      setNotice(null);
      return;
    }
    setItems((prev) => prev.filter((item) => item.id !== draft.id));
    setTotal((prev) => Math.max(0, prev - 1));
    setNotice(
      draft.approved
        ? `${draft.candidateName}'s draft was approved and moved to Ready to Send.`
        : `${draft.candidateName}'s draft no longer matches the current filters.`
    );
  };

  const resetFilters = () => {
    setSearch(DEFAULTS.search);
    setClientId(DEFAULTS.clientId);
    setApproval(DEFAULTS.approval);
    setSmtp(DEFAULTS.smtp);
    setSendStatus(DEFAULTS.sendStatus);
  };

  const clientOptions = useMemo(
    () => [
      { value: 'all', label: 'All clients' },
      ...clients.map((client) => ({ value: client._id, label: client.name })),
    ],
    [clients]
  );

  const selectedClientName =
    clientId === 'all' ? 'All clients' : clients.find((client) => client._id === clientId)?.name ?? 'Selected client';

  return (
    <div className="w-full max-w-none space-y-6 px-4 py-8 sm:px-8">
      <PageHeader
        title="Drafts"
        description="Review, edit and approve the AI-written email for each lead and company."
      />

      <Card className="border-slate-200">
        <CardContent className="space-y-3 px-4 py-3.5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1">
              <SearchIcon
                width={14}
                height={14}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400"
              />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                aria-label="Search drafts"
                placeholder="Search name, company, email, subject or body"
                className="w-full rounded-md border border-slate-200 py-2 pr-3 pl-8 text-xs focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Select
                label="Client"
                value={clientId}
                options={clientOptions}
                onChange={setClientId}
                searchable
                onSearch={setClientSearch}
                loading={clientsLoading}
                emptyText="No clients found"
                onScrollEnd={loadMoreClients}
                widthClass="w-44"
                buttonClassName="text-xs"
              />
              <Select
                label="Approval"
                value={approval}
                onChange={setApproval}
                widthClass="w-40"
                buttonClassName="text-xs"
                options={[
                  { value: 'draft', label: countLabel('Drafts', counts?.draft) },
                  { value: 'approved', label: countLabel('Approved', counts?.approved) },
                  { value: 'all', label: countLabel('All', counts?.total) },
                ]}
              />
              <Select
                label="Email status"
                value={smtp}
                onChange={setSmtp}
                widthClass="w-48"
                buttonClassName="text-xs"
                options={[
                  { value: 'all', label: 'Any email status' },
                  { value: 'valid', label: countLabel('Verified', counts?.valid) },
                  { value: 'unverified', label: countLabel('Not verified', counts?.unverified) },
                  { value: 'invalid', label: countLabel('Invalid', counts?.invalid) },
                  { value: 'no_contact_email', label: countLabel('No contact email', counts?.no_contact_email) },
                ]}
              />
              <Select
                label="Send status"
                value={sendStatus}
                onChange={setSendStatus}
                widthClass="w-40"
                buttonClassName="text-xs"
                options={[
                  { value: 'all', label: 'Any send status' },
                  { value: 'pending', label: 'Not sent' },
                  { value: 'in_progress', label: 'Sending' },
                  { value: 'delivered', label: 'Delivered' },
                  { value: 'opened', label: 'Opened' },
                  { value: 'failed', label: 'Send failed' },
                  { value: 'no_contact_email', label: 'No contact email' },
                ]}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
            <span aria-live="polite">
              {loading
                ? 'Loading drafts…'
                : `Showing ${items.length} of ${total} draft${total === 1 ? '' : 's'}`}
              {clientId !== 'all' ? ` · ${selectedClientName}` : ''}
            </span>
            {!isDefaultFilters && (
              <Button type="button" size="sm" variant="ghost" onClick={resetFilters}>
                Reset filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {truncated && (
        <p className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangleIcon width={14} height={14} className="mt-0.5 shrink-0" />
          Only the newest 1000 leads were searched. Narrow the search or pick a client to see the rest.
        </p>
      )}

      {notice && (
        <p role="status" className="rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-900">
          {notice}
        </p>
      )}

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span className="flex items-center gap-2">
            <AlertTriangleIcon width={16} height={16} className="shrink-0" />
            {error}
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => void load(1, 'replace')}>
            Try again
          </Button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Card key={index} className="h-56 animate-pulse border-slate-200 bg-slate-50" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="flex flex-col items-center justify-center border-2 border-dashed border-slate-200 py-12 text-center">
          <SparklesIcon width={32} height={32} className="mb-2 text-slate-300" />
          <p className="text-sm font-medium text-slate-600">No drafts match these filters</p>
          <p className="mt-1 text-xs text-slate-500">
            {isDefaultFilters
              ? 'Import a lead to generate its first outreach email.'
              : 'Try clearing the filters to see every draft.'}
          </p>
          {!isDefaultFilters && (
            <Button type="button" size="sm" variant="outline" className="mt-4" onClick={resetFilters}>
              Reset filters
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <DraftCard
              key={item.id}
              item={item}
              onOpen={() => setOpenItem(item)}
              onUpdated={handleUpdated}
            />
          ))}
        </div>
      )}

      {hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-6">
          <span className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-500">
            <LoaderIcon width={14} height={14} className="animate-spin text-indigo-600" />
            Loading more drafts…
          </span>
        </div>
      )}

      {openItem && (
        <DraftEditorModal
          key={openItem.id}
          item={openItem}
          onClose={() => setOpenItem(null)}
          onSaved={handleUpdated}
        />
      )}
    </div>
  );
}
