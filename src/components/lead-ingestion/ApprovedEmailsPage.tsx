'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ApiError, createCampaignApi } from '@/services/lead-ingestion/apiClient';
import { getReadyToSendLeadsApi, type ReadyLeadRecord } from '@/services/lead-ingestion/readyToSendApi';
import {
  DEFAULT_MAX_DELAY_SECONDS,
  DEFAULT_MIN_DELAY_SECONDS,
  DELAY_MAX_SECONDS,
  DELAY_MIN_SECONDS,
  draftEmailCandidates,
  isDraftReady,
  parseDelayRange,
  verificationStatusFor,
  type VerificationStatus,
} from '@/services/lead-ingestion/readyToSend';
import { CAMPAIGN_NAME_MAX_LENGTH } from '@/services/lead-ingestion/campaignRunner';
import { sanitizeEmailHtml } from '@/lib/utils/sanitizeHtml';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { buttonClasses } from '@/components/ui/buttonClasses';
import { Badge } from '@/components/ui/Badge';
import CopyButton from '@/components/ui/CopyButton';
import Modal from '@/components/ui/Modal';
import { cn } from '@/lib/utils/cn';
import {
  AlertTriangleIcon,
  BuildingIcon,
  CheckCircleIcon,
  ClockIcon,
  EditIcon,
  EyeIcon,
  InboxIcon,
  LoaderIcon,
  MailIcon,
  SendIcon,
  ShieldIcon,
  XCircleIcon,
  XIcon,
} from '@/components/ui/Icons';

/** Leads fetched per page. Each lead holds one or more drafts. */
const PAGE_SIZE = 50;
const QUICK_SELECT_COUNTS = [10, 20, 30, 40, 50];
const SEARCH_DEBOUNCE_MS = 300;

interface EmailItem {
  id: string;
  leadId: string;
  companyIndex: number;
  candidateName: string;
  clientName: string;
  companyName: string;
  jobTitle: string | null;
  /** Known addresses for this draft, best first. Empty when none was found. */
  emails: string[];
  subject: string;
  bodyHtml: string;
}

interface ResolvedItem extends EmailItem {
  targetEmail: string;
  emailStatus: VerificationStatus;
  selectable: boolean;
}

type ListStatus = 'loading' | 'refreshing' | 'loading-more' | 'idle';

function SmtpBadge({ status }: { status: VerificationStatus }) {
  if (status === 'valid') {
    return <Badge tone="success" icon={<CheckCircleIcon width={12} height={12} />}>Verified</Badge>;
  }
  if (status === 'invalid') {
    return <Badge tone="danger" icon={<XCircleIcon width={12} height={12} />}>Invalid</Badge>;
  }
  if (status === 'risky') {
    return <Badge tone="warning" icon={<AlertTriangleIcon width={12} height={12} />}>Risky</Badge>;
  }
  return <Badge tone="neutral" icon={<ClockIcon width={12} height={12} />}>Unverified</Badge>;
}

function cleanTitle(title: string | null | undefined): string | null {
  const value = title?.trim();
  return value && value !== 'Professional' ? value : null;
}

/** Flattens every ready draft of every lead into one list. */
export function flattenDrafts(leads: ReadyLeadRecord[]): EmailItem[] {
  const items: EmailItem[] = [];
  for (const lead of leads) {
    const candidateName = lead.fullName?.trim() || 'Candidate Profile';
    const clientName = lead.clientName?.trim() || 'Client Profile';

    (lead.currentCompanies ?? []).forEach((comp, idx) => {
      if (!isDraftReady(comp)) return;
      items.push({
        id: `${lead._id}-comp-${idx}`,
        leadId: lead._id,
        companyIndex: idx,
        candidateName,
        clientName,
        companyName: comp.companyName?.trim() || 'Unspecified Company',
        jobTitle: cleanTitle(comp.jobTitle),
        emails: draftEmailCandidates(lead, idx),
        subject: (comp.emailSubject ?? '').trim(),
        bodyHtml: (comp.emailBody ?? '').trim(),
      });
    });

    if (isDraftReady(lead)) {
      items.push({
        id: `${lead._id}-personal`,
        leadId: lead._id,
        companyIndex: -1,
        candidateName,
        clientName,
        companyName: lead.companyName?.trim() || 'Personal / Direct Email',
        jobTitle: cleanTitle(lead.jobTitle),
        emails: draftEmailCandidates(lead, -1),
        subject: (lead.emailSubject ?? '').trim(),
        bodyHtml: (lead.emailBody ?? '').trim(),
      });
    }
  }
  return items;
}

/** Does the draft itself (not just its lead) mention every search word? */
export function matchesSearch(item: EmailItem, term: string): boolean {
  const haystack = [item.candidateName, item.clientName, item.companyName, item.jobTitle ?? '', item.subject, ...item.emails]
    .join('\n')
    .toLowerCase();
  return term
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

/**
 * Turns two `YYYY-MM-DD` inputs into ISO instants for the whole local days,
 * so the server filters in the browser's time zone.
 */
export function localDayBounds(start: string, end: string): { from?: string; to?: string; error: string | null } {
  const parse = (value: string, endOfDay: boolean): Date | null | undefined => {
    if (!value) return undefined;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    const [, y, m, d] = match.map(Number);
    const date = endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d, 0, 0, 0, 0);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return date;
  };
  const from = parse(start, false);
  const to = parse(end, true);
  if (from === null || to === null) return { error: 'Enter a valid date.' };
  if (from && to && from > to) {
    return { error: 'The start date must be on or before the end date.' };
  }
  return { from: from?.toISOString(), to: to?.toISOString(), error: null };
}

export function defaultCampaignName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Campaign ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export default function ApprovedEmailsPage() {
  const router = useRouter();
  const ids = {
    search: useId(),
    start: useId(),
    end: useId(),
    count: useId(),
    name: useId(),
    min: useId(),
    max: useId(),
  };

  // List
  const [leads, setLeads] = useState<ReadyLeadRecord[]>([]);
  const [status, setStatus] = useState<ListStatus>('loading');
  const [listError, setListError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [totalLeads, setTotalLeads] = useState(0);
  const hasLoadedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Filters
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const bounds = useMemo(() => localDayBounds(startDate, endDate), [startDate, endDate]);

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [recipientChoice, setRecipientChoice] = useState<Record<string, string>>({});
  const [customCountInput, setCustomCountInput] = useState('');

  // Preview, create modal, notices
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [minDelayInput, setMinDelayInput] = useState(String(DEFAULT_MIN_DELAY_SECONDS));
  const [maxDelayInput, setMaxDelayInput] = useState(String(DEFAULT_MAX_DELAY_SECONDS));
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ text: string; href: string } | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(
    async (pageToLoad: number, append: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setStatus(append ? 'loading-more' : hasLoadedRef.current ? 'refreshing' : 'loading');
      try {
        const res = await getReadyToSendLeadsApi(
          { search, from: bounds.from, to: bounds.to, page: pageToLoad, limit: PAGE_SIZE },
          controller.signal
        );
        if (controller.signal.aborted) return;
        setLeads((prev) => {
          if (!append) return res.leads;
          const known = new Set(prev.map((l) => l._id));
          return [...prev, ...res.leads.filter((l) => !known.has(l._id))];
        });
        setPage(res.page);
        setHasMore(res.hasMore);
        setTotalLeads(res.total);
        setListError(null);
        hasLoadedRef.current = true;
      } catch (err) {
        if (controller.signal.aborted) return;
        setListError(err instanceof Error ? err.message : 'Could not load approved drafts.');
      } finally {
        if (!controller.signal.aborted) setStatus('idle');
      }
    },
    [search, bounds.from, bounds.to]
  );

  useEffect(() => {
    if (bounds.error) return;
    void load(1, false);
  }, [load, bounds.error]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const allItems = useMemo(() => flattenDrafts(leads), [leads]);

  // Selection is derived from `selectedIds` ∩ the drafts currently shown, so an
  // id for a draft that was filtered out, queued elsewhere or deleted never
  // counts and never gets sent.
  const leadMap = useMemo(() => new Map(leads.map((l) => [l._id, l])), [leads]);

  const visibleItems: ResolvedItem[] = useMemo(() => {
    return allItems
      .filter((item) => !search || matchesSearch(item, search))
      .map((item) => {
        const chosen = recipientChoice[item.id];
        const targetEmail = chosen && item.emails.includes(chosen) ? chosen : (item.emails[0] ?? '');
        const lead = leadMap.get(item.leadId);
        return {
          ...item,
          targetEmail,
          emailStatus: lead && targetEmail ? verificationStatusFor(lead, targetEmail) : 'pending',
          selectable: targetEmail.length > 0,
        };
      });
  }, [allItems, search, recipientChoice, leadMap]);

  const selectableItems = useMemo(() => visibleItems.filter((item) => item.selectable), [visibleItems]);
  const selectedItems = useMemo(
    () => selectableItems.filter((item) => selectedIds.has(item.id)),
    [selectableItems, selectedIds]
  );
  const invalidSelectedCount = selectedItems.filter((item) => item.emailStatus === 'invalid').length;
  const previewItem = previewId ? (visibleItems.find((item) => item.id === previewId) ?? null) : null;
  const previewHtml = useMemo(() => (previewItem ? sanitizeEmailHtml(previewItem.bodyHtml) : ''), [previewItem]);

  const filtersActive = Boolean(search || startDate || endDate);
  const isInitialLoading = status === 'loading';

  // Selection helpers
  const selectFirst = (count: number) => {
    setSelectedIds(new Set(selectableItems.slice(0, count).map((item) => item.id)));
  };
  const selectAll = () => setSelectedIds(new Set(selectableItems.map((item) => item.id)));
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCardClick = (item: ResolvedItem, event: MouseEvent<HTMLDivElement>) => {
    if (!item.selectable) return;
    const target = event.target as HTMLElement;
    if (target.closest('a, button, input, select, label')) return;
    if (window.getSelection()?.toString()) return; // the user is copying text
    toggleItem(item.id);
  };

  const applyCustomCount = (event: FormEvent) => {
    event.preventDefault();
    const raw = customCountInput.trim();
    if (!/^\d+$/.test(raw) || Number(raw) < 1) return;
    const count = Math.min(Number(raw), selectableItems.length);
    selectFirst(count);
    setCustomCountInput(String(count));
  };

  const clearFilters = () => {
    setSearchInput('');
    setSearch('');
    setStartDate('');
    setEndDate('');
  };

  // Campaign creation
  const openCreateModal = () => {
    setCampaignName(defaultCampaignName());
    setMinDelayInput(String(DEFAULT_MIN_DELAY_SECONDS));
    setMaxDelayInput(String(DEFAULT_MAX_DELAY_SECONDS));
    setFormError(null);
    setNotice(null);
    setShowModal(true);
  };
  const closeCreateModal = useCallback(() => setShowModal(false), []);
  const closePreview = useCallback(() => setPreviewId(null), []);

  const submitCampaign = async (mode: 'draft' | 'open') => {
    const name = campaignName.trim();
    if (!name) {
      setFormError('Enter a campaign name.');
      return;
    }
    if (name.length > CAMPAIGN_NAME_MAX_LENGTH) {
      setFormError(`The campaign name must be ${CAMPAIGN_NAME_MAX_LENGTH} characters or fewer.`);
      return;
    }
    const delays = parseDelayRange(minDelayInput, maxDelayInput);
    if (!delays.ok) {
      setFormError(delays.error);
      return;
    }
    if (selectedItems.length === 0) {
      setFormError('No selectable drafts are selected. Close this window and pick at least one.');
      return;
    }

    setCreating(true);
    setFormError(null);
    try {
      const res = await createCampaignApi({
        name,
        status: 'draft',
        minDelaySeconds: delays.min,
        maxDelaySeconds: delays.max,
        items: selectedItems.map((item) => ({
          leadId: item.leadId,
          companyIndex: item.companyIndex,
          candidateName: item.candidateName,
          clientName: item.clientName,
          companyName: item.companyName,
          recipientEmail: item.targetEmail,
          subject: item.subject,
          bodyHtml: item.bodyHtml,
        })),
      });
      const href = `/lead-ingestion/campaigns/${res.campaign._id}`;
      if (mode === 'open') {
        router.push(href);
        return;
      }
      setShowModal(false);
      setSelectedIds(new Set());
      setNotice({
        text: `Campaign "${res.campaign.name}" saved as a draft with ${res.campaign.totalEmails} emails.`,
        href,
      });
      void load(1, false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create campaign';
      if (err instanceof ApiError && err.status === 409) {
        // Someone queued one of these drafts meanwhile; show the fresh list behind the modal.
        setFormError(`${message} The list has been refreshed; close this window and pick again.`);
        void load(1, false);
      } else {
        setFormError(message);
      }
    } finally {
      setCreating(false);
    }
  };

  const quickCounts = QUICK_SELECT_COUNTS.filter((n) => n < selectableItems.length);
  const countLabel = (n: number) => (isInitialLoading ? '…' : String(n));

  return (
    <div className={cn('w-full max-w-none space-y-6 px-4 py-8 sm:px-8', selectedItems.length > 0 && 'pb-36 sm:pb-28')}>
      <PageHeader
        title="Ready to Send"
        description="Approved drafts that are not in a campaign yet. Select some to create a campaign."
        actions={
          <Link href="/lead-ingestion/campaigns" className={buttonClasses('outline', 'sm')}>
            <MailIcon width={14} height={14} />
            Campaigns
          </Link>
        }
      />

      {notice && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
        >
          <CheckCircleIcon width={16} height={16} className="shrink-0 text-emerald-600" />
          <span className="flex-1">{notice.text}</span>
          <Link href={notice.href} className="font-semibold underline">
            Open campaign
          </Link>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss" className="rounded p-0.5 hover:bg-emerald-100">
            <XIcon width={14} height={14} />
          </button>
        </div>
      )}

      {listError && (
        <div role="alert" className="flex flex-wrap items-center gap-2.5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangleIcon width={16} height={16} className="shrink-0 text-red-600" />
          <span className="flex-1 font-medium">{listError}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void load(1, false)}>
            Retry
          </Button>
        </div>
      )}

      {/* Filters and quick selection */}
      <Card>
        <div className="space-y-4 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <div className="flex flex-col gap-1">
                <label htmlFor={ids.search} className="text-xs font-medium text-slate-600">
                  Search
                </label>
                <input
                  id={ids.search}
                  type="search"
                  placeholder="Name, company, email or subject"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 sm:w-64"
                />
              </div>

              <div className="flex flex-col gap-1">
                <span className="text-xs font-medium text-slate-600">Imported between</span>
                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor={ids.start} className="sr-only">
                    Imported from
                  </label>
                  <input
                    id={ids.start}
                    type="date"
                    value={startDate}
                    max={endDate || undefined}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="min-w-0 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  <span className="text-xs text-slate-500">to</span>
                  <label htmlFor={ids.end} className="sr-only">
                    Imported until
                  </label>
                  <input
                    id={ids.end}
                    type="date"
                    value={endDate}
                    min={startDate || undefined}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="min-w-0 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                  />
                  {filtersActive && (
                    <button type="button" onClick={clearFilters} className="text-xs font-medium text-slate-500 underline hover:text-slate-800">
                      Clear filters
                    </button>
                  )}
                </div>
                {bounds.error && (
                  <p role="alert" className="text-xs text-red-600">
                    {bounds.error}
                  </p>
                )}
              </div>
            </div>

            <div className="text-xs text-slate-500" aria-live="polite" data-testid="draft-count">
              {isInitialLoading ? (
                'Loading…'
              ) : (
                <>
                  <span className="font-semibold text-slate-900">{visibleItems.length}</span> drafts from{' '}
                  <span className="font-semibold text-slate-900">{leads.length}</span> of{' '}
                  <span className="font-semibold text-slate-900">{totalLeads}</span> leads
                  {status === 'refreshing' && <span className="ml-2 text-slate-400">Refreshing…</span>}
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-xs font-semibold uppercase tracking-wider text-slate-600">Quick select</span>
              {quickCounts.map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => selectFirst(num)}
                  className="rounded-full border border-indigo-200 bg-indigo-50/50 px-3 py-1 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100"
                >
                  First {num}
                </button>
              ))}
              <button
                type="button"
                onClick={selectAll}
                disabled={selectableItems.length === 0}
                className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Select all ({countLabel(selectableItems.length)})
              </button>
              <button
                type="button"
                onClick={clearSelection}
                disabled={selectedItems.length === 0}
                className="ml-1 text-xs font-semibold text-slate-500 underline hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Deselect all
              </button>
            </div>

            <form onSubmit={applyCustomCount} noValidate className="flex items-center gap-1.5 text-xs">
              <label htmlFor={ids.count} className="font-medium text-slate-600">
                Select first
              </label>
              <input
                id={ids.count}
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                placeholder="Qty"
                value={customCountInput}
                onChange={(e) => setCustomCountInput(e.target.value)}
                className="w-16 rounded-md border border-slate-300 px-2 py-1 text-xs focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
              <Button
                type="submit"
                size="sm"
                variant="outline"
                disabled={selectableItems.length === 0 || !/^\d+$/.test(customCountInput.trim()) || Number(customCountInput) < 1}
              >
                Apply
              </Button>
            </form>
          </div>
          {hasMore && selectableItems.length > 0 && (
            <p className="text-xs text-slate-400">
              Quick select only covers the drafts loaded so far. Use “Load more” below to bring in older leads.
            </p>
          )}
        </div>
      </Card>

      {/* Draft cards */}
      {isInitialLoading ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16" role="status">
          <LoaderIcon width={28} height={28} className="animate-spin text-indigo-600" />
          <span className="text-sm text-slate-500">Loading approved drafts…</span>
        </div>
      ) : visibleItems.length === 0 ? (
        <Card className="flex flex-col items-center justify-center border-2 border-dashed px-6 py-12 text-center">
          <InboxIcon width={36} height={36} className="mb-2 text-slate-300" />
          {filtersActive ? (
            <>
              <p className="text-sm font-medium text-slate-700">No drafts match these filters.</p>
              <button type="button" onClick={clearFilters} className="mt-2 text-xs font-semibold text-indigo-600 underline">
                Clear filters
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-700">Nothing is waiting to be sent.</p>
              <p className="mt-1 max-w-sm text-xs text-slate-500">
                Approve drafts on the{' '}
                <Link href="/lead-ingestion/emails" className="font-semibold text-indigo-600 underline">
                  Drafts
                </Link>{' '}
                page or on a lead’s profile and they will appear here.
              </p>
            </>
          )}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleItems.map((item) => {
              const isSelected = item.selectable && selectedIds.has(item.id);
              return (
                <Card
                  key={item.id}
                  onClick={(event) => handleCardClick(item, event)}
                  className={cn(
                    'relative flex flex-col overflow-hidden transition-colors',
                    item.selectable ? 'cursor-pointer' : 'bg-slate-50/70',
                    isSelected ? 'border-indigo-600 shadow-md ring-2 ring-indigo-500/20' : 'hover:border-slate-300'
                  )}
                >
                  <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!item.selectable}
                      onChange={() => toggleItem(item.id)}
                      aria-label={`Select draft for ${item.companyName} (${item.candidateName})`}
                      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed"
                    />
                    <div className="min-w-0 flex-1">
                      <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-slate-900">
                        <BuildingIcon width={14} height={14} className="shrink-0 text-slate-400" />
                        <span className="truncate" title={item.companyName}>
                          {item.companyName}
                        </span>
                      </h2>
                      <p className="mt-0.5 truncate text-xs text-slate-600">
                        {item.candidateName}
                        {item.jobTitle ? ` · ${item.jobTitle}` : ''}
                      </p>
                      <p className="truncate text-xs text-indigo-600">{item.clientName}</p>
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col gap-3 px-4 py-3">
                    <div className="space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Recipient</span>
                      {item.emails.length === 0 ? (
                        <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
                          <AlertTriangleIcon width={14} height={14} className="shrink-0" />
                          <span>No contact email. Add one on the lead page to send this draft.</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5">
                          {item.emails.length > 1 ? (
                            <select
                              aria-label={`Recipient for ${item.companyName}`}
                              value={item.targetEmail}
                              onChange={(e) => setRecipientChoice((prev) => ({ ...prev, [item.id]: e.target.value }))}
                              className="min-w-0 flex-1 bg-transparent font-mono text-[11px] font-semibold text-slate-800 focus:outline-none"
                            >
                              {item.emails.map((email) => (
                                <option key={email} value={email}>
                                  {email}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-semibold text-slate-800" title={item.targetEmail}>
                              {item.targetEmail}
                            </span>
                          )}
                          <SmtpBadge status={item.emailStatus} />
                          <CopyButton getContent={() => ({ text: item.targetEmail })} label="Copy email" className="h-6 w-6" />
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Subject</span>
                      <p className="truncate text-xs font-medium text-slate-800" title={item.subject}>
                        {item.subject}
                      </p>
                    </div>

                    <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setPreviewId(item.id)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline"
                      >
                        <EyeIcon width={14} height={14} />
                        Preview email
                      </button>
                      <Link
                        href={`/lead-ingestion/client/${item.leadId}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800 hover:underline"
                      >
                        <EditIcon width={13} height={13} />
                        Edit on lead page
                      </Link>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {hasMore && (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="outline"
                onClick={() => void load(page + 1, true)}
                isLoading={status === 'loading-more'}
                disabled={status !== 'idle'}
              >
                Load more leads ({leads.length} of {totalLeads} loaded)
              </Button>
            </div>
          )}
        </>
      )}

      {/* Floating action bar */}
      {selectedItems.length > 0 && (
        <div data-testid="selection-bar" className="animate-fade-in fixed inset-x-4 bottom-4 z-40 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-white shadow-2xl sm:inset-x-auto sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2 sm:rounded-full sm:px-6">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-indigo-600 px-1.5 text-xs">
              {selectedItems.length}
            </span>
            <span>{selectedItems.length === 1 ? 'draft selected' : 'drafts selected'}</span>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={clearSelection} className="text-xs font-semibold text-slate-300 underline hover:text-white">
              Clear
            </button>
            <Button type="button" size="sm" onClick={openCreateModal} className="rounded-full px-4">
              <SendIcon width={14} height={14} />
              Create campaign
            </Button>
          </div>
        </div>
      )}

      {/* Email preview */}
      <Modal
        open={previewItem !== null}
        onClose={closePreview}
        title={previewItem?.subject ?? 'Email preview'}
        subtitle={previewItem ? `${previewItem.companyName} · ${previewItem.candidateName}` : undefined}
        size="lg"
        footer={
          previewItem && (
            <>
              <Link href={`/lead-ingestion/client/${previewItem.leadId}`} className={buttonClasses('outline', 'sm')}>
                <EditIcon width={13} height={13} />
                Edit on lead page
              </Link>
              <Button type="button" size="sm" onClick={closePreview}>
                Close
              </Button>
            </>
          )
        }
      >
        {previewItem && (
          <>
            <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="font-semibold text-slate-500">To</dt>
              <dd className="font-mono break-all text-slate-800">{previewItem.targetEmail || 'No contact email'}</dd>
              <dt className="font-semibold text-slate-500">Subject</dt>
              <dd className="text-slate-800">{previewItem.subject}</dd>
            </dl>
            <div
              className="email-body rounded-md border border-slate-200 bg-slate-50 p-4 text-sm leading-relaxed text-slate-800"
              dangerouslySetInnerHTML={{ __html: previewHtml }}
            />
          </>
        )}
      </Modal>

      {/* Create campaign */}
      <Modal
        open={showModal}
        onClose={closeCreateModal}
        closeConfirm={() => !creating}
        title="Create campaign"
        subtitle={`${selectedItems.length} ${selectedItems.length === 1 ? 'draft' : 'drafts'} will be queued.`}
        footer={
          <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void submitCampaign('draft')}
              disabled={creating}
              className="w-full justify-center sm:w-auto"
            >
              Save as draft
            </Button>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={closeCreateModal}
                disabled={creating}
                className="w-full justify-center sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void submitCampaign('open')}
                isLoading={creating}
                disabled={creating}
                className="w-full justify-center sm:w-auto"
              >
                {!creating && <SendIcon width={14} height={14} />}
                Create and open runner
              </Button>
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              <AlertTriangleIcon width={14} height={14} className="mt-0.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}
          {invalidSelectedCount > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangleIcon width={14} height={14} className="mt-0.5 shrink-0" />
              <span>
                {invalidSelectedCount} selected {invalidSelectedCount === 1 ? 'address was' : 'addresses were'} marked
                invalid by verification and will probably bounce.
              </span>
            </div>
          )}

          <div className="space-y-1">
            <label htmlFor={ids.name} className="text-xs font-medium text-slate-600">
              Campaign name <span className="text-red-500">*</span>
            </label>
            <input
              id={ids.name}
              type="text"
              value={campaignName}
              maxLength={CAMPAIGN_NAME_MAX_LENGTH}
              onChange={(e) => setCampaignName(e.target.value)}
              required
              aria-invalid={!campaignName.trim() || undefined}
              placeholder={defaultCampaignName()}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            />
          </div>

          <div className="space-y-2 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-900">
              <ShieldIcon width={14} height={14} className="text-indigo-600" />
              Delay between emails
            </div>
            <p className="text-[11px] leading-normal text-slate-600">
              Each email waits a random number of seconds in this range before the next one is sent, which keeps the
              sending pattern human-like. Allowed: {DELAY_MIN_SECONDS}–{DELAY_MAX_SECONDS} seconds.
            </p>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label htmlFor={ids.min} className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">
                  Minimum (seconds)
                </label>
                <input
                  id={ids.min}
                  type="number"
                  inputMode="numeric"
                  min={DELAY_MIN_SECONDS}
                  max={DELAY_MAX_SECONDS}
                  step={1}
                  value={minDelayInput}
                  onChange={(e) => setMinDelayInput(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs font-semibold focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
              <div>
                <label htmlFor={ids.max} className="mb-1 block text-[10px] font-semibold uppercase text-slate-500">
                  Maximum (seconds)
                </label>
                <input
                  id={ids.max}
                  type="number"
                  inputMode="numeric"
                  min={DELAY_MIN_SECONDS}
                  max={DELAY_MAX_SECONDS}
                  step={1}
                  value={maxDelayInput}
                  onChange={(e) => setMaxDelayInput(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs font-semibold focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                />
              </div>
            </div>
          </div>

          <p className="text-[11px] leading-normal text-slate-500">
            The campaign is saved as a draft. Nothing is sent until you press Start on the campaign page, and sending
            runs while that tab stays open.
          </p>
        </div>
      </Modal>
    </div>
  );
}
