'use client';

import { Suspense, use, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ApiError,
  deleteCampaignApi,
  dispatchCampaignBatchApi,
  getCampaignDetailsApi,
  updateCampaignApi,
  type CampaignItemRecord,
  type CampaignRecord,
} from '@/services/lead-ingestion/apiClient';
import {
  CAMPAIGN_NAME_MAX_LENGTH,
  MAX_DELAY_SECONDS,
  MIN_DELAY_SECONDS,
  formatDateTime,
  formatDelayRange,
  formatDuration,
  makeRunnerId,
  normalizeDelays,
  randomDelaySeconds,
} from '@/services/lead-ingestion/campaignRunner';
import { Card, CardContent } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { buttonClasses } from '@/components/ui/buttonClasses';
import { EmptyState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Input } from '@/components/ui/Input';
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  ClockIcon,
  EditIcon,
  ExternalLinkIcon,
  InboxIcon,
  LoaderIcon,
  PauseIcon,
  PlayIcon,
  RefreshIcon,
  SearchIcon,
  SendIcon,
  TrashIcon,
  XIcon,
} from '@/components/ui/Icons';
import { cn } from '@/lib/utils/cn';
import {
  CampaignItemStatusBadge,
  CampaignStatusBadge,
} from '@/components/lead-ingestion/campaigns/CampaignStatusBadge';

type RunMode = 'pending' | 'rerunFailed';
type RunState = 'idle' | 'sending' | 'waiting' | 'pausing';
type MessageTone = 'info' | 'success' | 'warning' | 'error';

interface RunnerMessage {
  tone: MessageTone;
  text: string;
}

type PendingAction =
  | { kind: 'start'; mode: RunMode }
  | { kind: 'sendOne'; item: CampaignItemRecord };

const ITEMS_PAGE_SIZE = 50;
const IDLE_REFRESH_MS = 30_000;
const COUNTDOWN_TICK_MS = 500;

const ITEM_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'sending', label: 'Sending' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'opened', label: 'Opened' },
  { value: 'failed', label: 'Failed' },
];

const TONE_CLASSES: Record<MessageTone, string> = {
  info: 'border-slate-200 bg-slate-50 text-slate-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-700',
};

function ToneIcon({ tone }: { tone: MessageTone }) {
  if (tone === 'success') return <CheckCircleIcon width={16} height={16} className="mt-0.5 shrink-0 text-emerald-600" />;
  if (tone === 'warning') return <AlertTriangleIcon width={16} height={16} className="mt-0.5 shrink-0 text-amber-600" />;
  if (tone === 'error') return <AlertTriangleIcon width={16} height={16} className="mt-0.5 shrink-0 text-red-600" />;
  return <ClockIcon width={16} height={16} className="mt-0.5 shrink-0 text-slate-500" />;
}

function KpiTile({ label, value, hint, tone = 'neutral' }: { label: string; value: string | number; hint?: string; tone?: 'neutral' | 'success' | 'info' | 'danger' | 'warning' }) {
  const tones = {
    neutral: 'border-slate-200 bg-white text-slate-900',
    success: 'border-emerald-200 bg-emerald-50/60 text-emerald-800',
    info: 'border-indigo-200 bg-indigo-50/60 text-indigo-800',
    danger: 'border-red-200 bg-red-50/60 text-red-800',
    warning: 'border-amber-200 bg-amber-50/60 text-amber-800',
  };
  return (
    <div className={cn('rounded-lg border p-4', tones[tone])}>
      <p className="text-[11px] font-semibold tracking-wide uppercase opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs opacity-80">{hint}</p>}
    </div>
  );
}

interface CampaignDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function CampaignDetailPage({ params }: CampaignDetailPageProps) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3" role="status">
          <LoaderIcon width={32} height={32} className="animate-spin text-indigo-600" />
          <span className="text-sm font-medium text-slate-600">Loading campaign…</span>
        </div>
      }
    >
      <CampaignDetail params={params} />
    </Suspense>
  );
}

function CampaignDetail({ params }: CampaignDetailPageProps) {
  const { id } = use(params);
  const router = useRouter();
  const searchParams = useSearchParams();
  const autostartRequested = searchParams.get('autostart') === '1';

  // One id per mounted page: the server uses it to let only one tab send.
  const [runnerId] = useState(makeRunnerId);

  const [campaign, setCampaign] = useState<CampaignRecord | null>(null);
  const [openTrackingEnabled, setOpenTrackingEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [runState, setRunState] = useState<RunState>('idle');
  const [countdown, setCountdown] = useState<number | null>(null);
  const [runnerMessage, setRunnerMessage] = useState<RunnerMessage | null>(null);
  const [otherTabConflict, setOtherTabConflict] = useState(false);

  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [itemStatusFilter, setItemStatusFilter] = useState('all');
  const [itemSearch, setItemSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(ITEMS_PAGE_SIZE);

  const mountedRef = useRef(true);
  const runStateRef = useRef<RunState>('idle');
  const campaignRef = useRef<CampaignRecord | null>(null);
  const stopRequestedRef = useRef(false);
  const takeoverRef = useRef(false);
  const lastModeRef = useRef<RunMode>('pending');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlightRef = useRef<Promise<unknown> | null>(null);
  const autostartedRef = useRef(false);

  useEffect(() => {
    campaignRef.current = campaign;
  }, [campaign]);

  const setRun = useCallback((state: RunState) => {
    runStateRef.current = state;
    setRunState(state);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const refresh = useCallback(
    async (options: { silent?: boolean } = {}) => {
      try {
        const res = await getCampaignDetailsApi(id);
        if (!mountedRef.current) return;
        setCampaign(res.campaign);
        setOpenTrackingEnabled(res.openTrackingEnabled);
        setLoadError(null);
      } catch (err) {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : 'Failed to load campaign';
        if (options.silent && campaignRef.current) setError(message);
        else setLoadError(message);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    // Deferred a tick so the effect itself sets no state synchronously.
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  // Lifecycle: on unmount stop the loop and release the runner lock. Leaving the
  // page must never leave emails going out with no one watching.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopRequestedRef.current = true;
      clearTimer();
      if (runStateRef.current !== 'idle') {
        const inFlight = inFlightRef.current ?? Promise.resolve();
        void inFlight
          .catch(() => undefined)
          .then(() => updateCampaignApi(id, { status: 'paused', runnerId }))
          .catch(() => undefined);
      }
    };
  }, [id, runnerId, clearTimer]);

  // Warn before the tab closes mid-run. Browsers show their own wording.
  useEffect(() => {
    if (runState === 'idle') return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [runState]);

  // While idle, keep opens and other tabs' progress fresh.
  useEffect(() => {
    if (runState !== 'idle') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh({ silent: true });
    }, IDLE_REFRESH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(timer);
    };
  }, [runState, refresh]);

  const finishRun = useCallback(
    (message: RunnerMessage | null) => {
      clearTimer();
      setCountdown(null);
      setRun('idle');
      if (message) setRunnerMessage(message);
    },
    [clearTimer, setRun]
  );

  const dispatch = useCallback(
    async (payload: { rerunFailed?: boolean; itemIds?: string[]; takeover?: boolean }) => {
      const promise = dispatchCampaignBatchApi(id, { ...payload, runnerId });
      inFlightRef.current = promise;
      try {
        return await promise;
      } finally {
        if (inFlightRef.current === promise) inFlightRef.current = null;
      }
    },
    [id, runnerId]
  );

  const stepRef = useRef<(mode: RunMode) => Promise<void>>(async () => undefined);

  const step = useCallback(
    async (mode: RunMode) => {
      if (stopRequestedRef.current || !mountedRef.current) return;
      lastModeRef.current = mode;
      setRun('sending');
      setCountdown(null);
      setRunnerMessage({ tone: 'info', text: 'Sending the next email…' });

      let res;
      try {
        res = await dispatch({ rerunFailed: mode === 'rerunFailed', takeover: takeoverRef.current });
        takeoverRef.current = false;
      } catch (err) {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : 'Campaign runner error';
        if (err instanceof ApiError && err.status === 409 && /another tab/i.test(message)) {
          setOtherTabConflict(true);
        }
        finishRun({ tone: 'error', text: message });
        void refresh({ silent: true });
        return;
      }

      if (!mountedRef.current) return;
      setCampaign(res.campaign);
      setOtherTabConflict(false);

      if (stopRequestedRef.current) {
        finishRun({ tone: 'warning', text: 'Paused. Nothing more will be sent until you resume.' });
        return;
      }

      if (res.processedCount === 0) {
        finishRun({ tone: 'info', text: res.message ?? 'Nothing left to send.' });
        return;
      }

      const last = res.item
        ? res.item.status === 'delivered'
          ? `Sent to ${res.item.recipientEmail}.`
          : `Failed for ${res.item.recipientEmail}.`
        : '';

      if (res.remainingCount === 0) {
        const c = res.campaign;
        if (mode === 'rerunFailed') {
          finishRun(
            c.failedCount > 0
              ? { tone: 'warning', text: `${last} Retry finished: ${c.failedCount} still failed.` }
              : { tone: 'success', text: `${last} Retry finished: every failed email was delivered.` }
          );
        } else {
          finishRun(
            c.failedCount > 0
              ? {
                  tone: 'warning',
                  text: `${last} Finished: ${c.deliveredCount} delivered, ${c.failedCount} failed. Use "Retry failed" to send the failed ones again.`,
                }
              : {
                  tone: 'success',
                  text: `${last} Finished: all ${c.deliveredCount} ${c.deliveredCount === 1 ? 'email' : 'emails'} delivered.`,
                }
          );
        }
        return;
      }

      const delay = randomDelaySeconds(res.campaign.minDelaySeconds, res.campaign.maxDelaySeconds);
      const target = Date.now() + delay * 1000;
      setRun('waiting');
      setCountdown(delay);
      setRunnerMessage({
        tone: res.item?.status === 'failed' ? 'warning' : 'info',
        text: `${last} ${res.remainingCount} left. Next email in ${formatDuration(delay)}.`,
      });

      clearTimer();
      timerRef.current = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((target - Date.now()) / 1000));
        setCountdown(remaining);
        if (remaining <= 0) {
          clearTimer();
          void stepRef.current(mode);
        }
      }, COUNTDOWN_TICK_MS);
    },
    [dispatch, finishRun, refresh, clearTimer, setRun]
  );

  useEffect(() => {
    stepRef.current = step;
  }, [step]);

  const startRun = useCallback(
    (mode: RunMode, options: { takeover?: boolean } = {}) => {
      stopRequestedRef.current = false;
      takeoverRef.current = Boolean(options.takeover);
      setError(null);
      setOtherTabConflict(false);
      void stepRef.current(mode);
    },
    []
  );

  const pauseRun = useCallback(async () => {
    stopRequestedRef.current = true;
    clearTimer();
    setCountdown(null);
    setRun('pausing');
    setRunnerMessage({
      tone: 'info',
      text: inFlightRef.current ? 'Finishing the email that is already sending, then pausing…' : 'Pausing…',
    });
    if (inFlightRef.current) {
      await inFlightRef.current.catch(() => undefined);
    }
    try {
      const res = await updateCampaignApi(id, { status: 'paused', runnerId });
      if (mountedRef.current) setCampaign(res.campaign);
    } catch (err) {
      if (mountedRef.current) setError(err instanceof Error ? err.message : 'Could not pause the campaign');
    }
    if (mountedRef.current) {
      finishRun({ tone: 'warning', text: 'Paused. Nothing more will be sent until you resume.' });
    }
    stopRequestedRef.current = false;
  }, [id, runnerId, clearTimer, setRun, finishRun]);

  const sendSingle = useCallback(
    async (item: CampaignItemRecord) => {
      stopRequestedRef.current = false;
      setError(null);
      setRun('sending');
      setRunnerMessage({ tone: 'info', text: `Sending to ${item.recipientEmail}…` });
      try {
        const res = await dispatch({ itemIds: [item._id] });
        if (!mountedRef.current) return;
        setCampaign(res.campaign);
        finishRun(
          res.processedCount === 0
            ? { tone: 'info', text: res.message ?? 'That email is no longer pending or failed.' }
            : res.successCount > 0
              ? { tone: 'success', text: `Sent to ${item.recipientEmail}.` }
              : { tone: 'error', text: `Failed for ${item.recipientEmail}: ${res.item?.errorMessage ?? 'unknown error'}` }
        );
      } catch (err) {
        if (!mountedRef.current) return;
        const message = err instanceof Error ? err.message : 'Send failed';
        if (err instanceof ApiError && err.status === 409 && /another tab/i.test(message)) setOtherTabConflict(true);
        finishRun({ tone: 'error', text: message });
        void refresh({ silent: true });
      }
    },
    [dispatch, finishRun, refresh, setRun]
  );

  // "Create and start" from Ready to Send lands here with ?autostart=1.
  useEffect(() => {
    if (!autostartRequested || autostartedRef.current || !campaign || loading) return;
    autostartedRef.current = true;
    const canAutostart = campaign.pendingCount > 0 && !(campaign.isRunnerActive && campaign.activeRunnerId !== runnerId);
    // Deferred a tick so the effect itself sets no state synchronously.
    void Promise.resolve().then(() => {
      router.replace(`/lead-ingestion/campaigns/${id}`);
      if (canAutostart) startRun('pending');
    });
  }, [autostartRequested, campaign, loading, id, router, runnerId, startRun]);

  const confirmPendingAction = () => {
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    if (action.kind === 'start') startRun(action.mode);
    else void sendSingle(action.item);
  };

  const handleDelete = async () => {
    if (!campaign || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCampaignApi(campaign._id);
      router.push('/lead-ingestion/campaigns');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete campaign');
      setDeleting(false);
    }
  };

  const filteredItems = useMemo(() => {
    if (!campaign) return [];
    const q = itemSearch.trim().toLowerCase();
    return campaign.items.filter((item) => {
      if (itemStatusFilter !== 'all' && item.status !== itemStatusFilter) return false;
      if (!q) return true;
      return (
        item.candidateName.toLowerCase().includes(q) ||
        item.recipientEmail.toLowerCase().includes(q) ||
        item.companyName.toLowerCase().includes(q) ||
        item.subject.toLowerCase().includes(q)
      );
    });
  }, [campaign, itemSearch, itemStatusFilter]);

  const changeItemSearch = (value: string) => {
    setItemSearch(value);
    setVisibleCount(ITEMS_PAGE_SIZE);
  };

  const changeItemStatusFilter = (value: string) => {
    setItemStatusFilter(value);
    setVisibleCount(ITEMS_PAGE_SIZE);
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3" role="status">
        <LoaderIcon width={32} height={32} className="animate-spin text-indigo-600" />
        <span className="text-sm font-medium text-slate-600">Loading campaign…</span>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-12">
        <EmptyState
          icon={<AlertTriangleIcon width={20} height={20} />}
          title={loadError ?? 'Campaign not found'}
          description="The campaign may have been deleted, or the link is wrong."
          action={
            <Link href="/lead-ingestion/campaigns" className={buttonClasses('outline', 'sm')}>
              <ArrowLeftIcon width={14} height={14} /> Back to Campaigns
            </Link>
          }
        />
      </div>
    );
  }

  const isIdle = runState === 'idle';
  const otherTabActive = campaign.isRunnerActive && campaign.activeRunnerId !== null && campaign.activeRunnerId !== runnerId;
  const pendingTotal = campaign.pendingCount + campaign.sendingCount;
  const canStart = isIdle && pendingTotal > 0 && !otherTabActive;
  const canRetry = isIdle && campaign.failedCount > 0 && !otherTabActive;
  const openRate = campaign.deliveredCount > 0 ? Math.round((campaign.openedCount / campaign.deliveredCount) * 100) : 0;
  const nextItemId = runState === 'waiting' ? campaign.items.find((i) => i.status === 'pending')?._id : undefined;
  const visibleItems = filteredItems.slice(0, visibleCount);
  const delayRange = formatDelayRange(campaign);

  const startLabel = campaign.deliveredCount + campaign.failedCount > 0 ? 'Resume sending' : 'Start sending';

  return (
    <div className="w-full px-4 py-8 sm:px-8">
      {/* Header */}
      <div className="mb-6 border-b border-slate-200 pb-5">
        <Link href="/lead-ingestion/campaigns" className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-900">
          <ArrowLeftIcon width={14} height={14} /> Campaigns
        </Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight text-slate-900 sm:text-[26px] sm:leading-8" title={campaign.name}>
                {campaign.name}
              </h1>
              <CampaignStatusBadge status={campaign.status} isRunnerActive={campaign.isRunnerActive} />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Created {formatDateTime(campaign.createdAt)} · {campaign.totalEmails} {campaign.totalEmails === 1 ? 'recipient' : 'recipients'} · delay {delayRange}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setShowEdit(true)} disabled={!isIdle}>
              <EditIcon width={14} height={14} /> Edit
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => { setDeleteError(null); setShowDelete(true); }}
              disabled={!isIdle}
              className="text-red-600 hover:bg-red-50"
            >
              <TrashIcon width={14} height={14} /> Delete
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangleIcon width={16} height={16} className="mt-0.5 shrink-0 text-red-600" />
            <div className="flex-1 font-medium">{error}</div>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss error" className="rounded p-0.5 text-red-500 hover:bg-red-100">
              <XIcon width={14} height={14} />
            </button>
          </div>
        )}

        {(otherTabActive || otherTabConflict) && isIdle && (
          <div role="status" className="flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <AlertTriangleIcon width={16} height={16} className="mt-0.5 shrink-0 text-amber-600" />
              <span className="font-medium">This campaign is being sent from another tab. Only one tab can run it at a time.</span>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => startRun(lastModeRef.current, { takeover: true })}>
              Take over here
            </Button>
          </div>
        )}

        {/* Runner */}
        <Card>
          <CardContent className="space-y-4 py-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1 space-y-2">
                <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-indigo-600 uppercase">
                  <SendIcon width={14} height={14} /> Sender
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold text-slate-900">
                    {runState === 'sending' && 'Sending an email…'}
                    {runState === 'waiting' && 'Waiting before the next email'}
                    {runState === 'pausing' && 'Pausing…'}
                    {runState === 'idle' &&
                      (pendingTotal === 0
                        ? campaign.failedCount > 0
                          ? 'Nothing pending. Some emails failed.'
                          : campaign.totalEmails === 0
                            ? 'This campaign has no recipients.'
                            : 'All emails delivered.'
                        : `${pendingTotal} ${pendingTotal === 1 ? 'email' : 'emails'} waiting to be sent`)}
                  </p>
                  {countdown !== null && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-3 py-1 font-mono text-xs font-semibold text-white tabular-nums" aria-live="off">
                      <ClockIcon width={12} height={12} /> {formatDuration(countdown)}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500">
                  Emails go out one at a time with a random pause of {delayRange} between them. Keep this tab open while sending.
                </p>
                {runnerMessage && (
                  <div role="status" aria-live="polite" className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-sm', TONE_CLASSES[runnerMessage.tone])}>
                    <ToneIcon tone={runnerMessage.tone} />
                    <span>{runnerMessage.text}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                {isIdle ? (
                  <Button
                    type="button"
                    onClick={() => setPendingAction({ kind: 'start', mode: 'pending' })}
                    disabled={!canStart}
                    title={!canStart && pendingTotal === 0 ? 'Nothing pending to send' : undefined}
                  >
                    <PlayIcon width={15} height={15} /> {startLabel}
                  </Button>
                ) : (
                  <Button type="button" variant="secondary" onClick={() => { void pauseRun(); }} disabled={runState === 'pausing'} isLoading={runState === 'pausing'}>
                    {runState !== 'pausing' && <PauseIcon width={15} height={15} />} Pause
                  </Button>
                )}
                {campaign.failedCount > 0 && (
                  <Button type="button" variant="outline" onClick={() => setPendingAction({ kind: 'start', mode: 'rerunFailed' })} disabled={!canRetry}>
                    <RefreshIcon width={14} height={14} /> Retry failed ({campaign.failedCount})
                  </Button>
                )}
                <Button type="button" variant="ghost" size="sm" onClick={() => { void refresh({ silent: true }); }} aria-label="Refresh campaign">
                  <RefreshIcon width={14} height={14} /> Refresh
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <KpiTile label="Recipients" value={campaign.totalEmails} />
          <KpiTile label="Pending" value={pendingTotal} tone="warning" />
          <KpiTile label="Delivered" value={campaign.deliveredCount} tone="success" />
          <KpiTile
            label="Opened"
            value={openTrackingEnabled ? campaign.openedCount : '—'}
            hint={openTrackingEnabled ? `${openRate}% of delivered` : 'Open tracking is off'}
            tone="info"
          />
          <KpiTile label="Failed" value={campaign.failedCount} tone="danger" />
        </div>

        {/* Recipients */}
        <Card>
          <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Recipients{' '}
              <span className="font-normal text-slate-500">
                ({filteredItems.length === campaign.items.length ? campaign.items.length : `${filteredItems.length} of ${campaign.items.length}`})
              </span>
            </h2>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative w-full sm:w-64">
                <label htmlFor="recipient-search" className="sr-only">
                  Search recipients
                </label>
                <SearchIcon width={14} height={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
                <Input
                  id="recipient-search"
                  type="search"
                  placeholder="Name, company, email or subject"
                  value={itemSearch}
                  onChange={(e) => changeItemSearch(e.target.value)}
                  className="py-1.5 pl-8 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="recipient-status" className="text-sm font-medium text-slate-600">
                  Status
                </label>
                <select
                  id="recipient-status"
                  value={itemStatusFilter}
                  onChange={(e) => changeItemStatusFilter(e.target.value)}
                  className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none"
                >
                  {ITEM_STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {filteredItems.length === 0 ? (
            <EmptyState
              icon={<InboxIcon width={20} height={20} />}
              title={campaign.items.length === 0 ? 'No recipients in this campaign' : 'No recipients match these filters'}
              description={campaign.items.length === 0 ? undefined : 'Try another status or search term.'}
              action={
                campaign.items.length > 0 ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => { setItemSearch(''); setItemStatusFilter('all'); }}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full table-fixed text-left text-sm">
                  <colgroup>
                    <col className="w-[24%]" />
                    <col className="w-[22%]" />
                    <col className="w-[24%]" />
                    <col className="w-[14%]" />
                    <col className="w-[16%]" />
                  </colgroup>
                  <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold tracking-wide text-slate-600 uppercase">
                    <tr>
                      <th scope="col" className="px-4 py-3">Recipient</th>
                      <th scope="col" className="px-4 py-3">Email</th>
                      <th scope="col" className="px-4 py-3">Subject</th>
                      <th scope="col" className="px-4 py-3">Status</th>
                      <th scope="col" className="px-4 py-3 text-right">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleItems.map((item) => (
                      <RecipientRow
                        key={item._id}
                        item={item}
                        isNext={item._id === nextItemId}
                        canAct={isIdle && !otherTabActive}
                        onSend={() => setPendingAction({ kind: 'sendOne', item })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <ul className="divide-y divide-slate-100 md:hidden">
                {visibleItems.map((item) => (
                  <RecipientCard
                    key={item._id}
                    item={item}
                    isNext={item._id === nextItemId}
                    canAct={isIdle && !otherTabActive}
                    onSend={() => setPendingAction({ kind: 'sendOne', item })}
                  />
                ))}
              </ul>

              {filteredItems.length > visibleCount && (
                <div className="flex items-center justify-center border-t border-slate-100 px-5 py-3">
                  <Button type="button" variant="outline" size="sm" onClick={() => setVisibleCount((n) => n + ITEMS_PAGE_SIZE)}>
                    Show {Math.min(ITEMS_PAGE_SIZE, filteredItems.length - visibleCount)} more
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* Confirmations */}
      <ConfirmDialog
        open={pendingAction?.kind === 'start'}
        title={pendingAction?.kind === 'start' && pendingAction.mode === 'rerunFailed' ? `Retry ${campaign.failedCount} failed ${campaign.failedCount === 1 ? 'email' : 'emails'}?` : `${startLabel}?`}
        description={
          pendingAction?.kind === 'start' && pendingAction.mode === 'rerunFailed'
            ? `The failed emails are sent again one at a time, with a random pause of ${delayRange} between them. Keep this tab open.`
            : `${pendingTotal} ${pendingTotal === 1 ? 'email goes' : 'emails go'} out one at a time, with a random pause of ${delayRange} between them. Keep this tab open until it finishes.`
        }
        confirmLabel={pendingAction?.kind === 'start' && pendingAction.mode === 'rerunFailed' ? 'Retry failed' : startLabel}
        onConfirm={confirmPendingAction}
        onCancel={() => setPendingAction(null)}
      />

      <ConfirmDialog
        open={pendingAction?.kind === 'sendOne'}
        title={pendingAction?.kind === 'sendOne' ? `Send to ${pendingAction.item.recipientEmail} now?` : ''}
        description={
          pendingAction?.kind === 'sendOne'
            ? pendingAction.item.status === 'failed'
              ? `The last attempt failed: ${pendingAction.item.errorMessage ?? 'unknown error'}. Only this email is sent.`
              : 'Only this email is sent; the rest of the campaign stays as it is.'
            : undefined
        }
        confirmLabel="Send now"
        onConfirm={confirmPendingAction}
        onCancel={() => setPendingAction(null)}
      />

      <ConfirmDialog
        open={showDelete}
        tone="danger"
        title={`Delete "${campaign.name}"?`}
        description={
          pendingTotal + campaign.failedCount > 0
            ? `${pendingTotal + campaign.failedCount} unsent ${pendingTotal + campaign.failedCount === 1 ? 'draft goes' : 'drafts go'} back to Ready to Send. Delivered emails stay sent. This cannot be undone.`
            : 'Delivery history for this campaign will be removed. This cannot be undone.'
        }
        confirmLabel="Delete campaign"
        busy={deleting}
        onConfirm={() => { void handleDelete(); }}
        onCancel={() => { if (!deleting) setShowDelete(false); }}
      >
        {deleteError && (
          <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {deleteError}
          </p>
        )}
      </ConfirmDialog>

      {showEdit && (
        <EditCampaignDialog
          campaign={campaign}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => {
            setCampaign(updated);
            setShowEdit(false);
          }}
        />
      )}
    </div>
  );
}

function itemTime(item: CampaignItemRecord): { label: string; value: string | null } {
  if (item.status === 'opened') return { label: 'Opened', value: item.openedAt ?? item.sentAt ?? null };
  if (item.status === 'delivered') return { label: 'Sent', value: item.sentAt ?? null };
  if (item.status === 'failed') return { label: 'Failed', value: item.failedAt ?? null };
  if (item.status === 'sending') return { label: 'Started', value: item.sendingStartedAt ?? null };
  return { label: '', value: null };
}

function ItemAction({ item, canAct, onSend }: { item: CampaignItemRecord; canAct: boolean; onSend: () => void }) {
  if (item.status === 'failed') {
    return (
      <Button type="button" variant="outline" size="sm" onClick={onSend} disabled={!canAct}>
        <RefreshIcon width={13} height={13} /> Retry
      </Button>
    );
  }
  if (item.status === 'pending') {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={onSend} disabled={!canAct}>
        <SendIcon width={13} height={13} /> Send now
      </Button>
    );
  }
  return null;
}

function RecipientRow({ item, isNext, canAct, onSend }: { item: CampaignItemRecord; isNext: boolean; canAct: boolean; onSend: () => void }) {
  const isSending = item.status === 'sending';
  const time = itemTime(item);
  return (
    <tr className={cn('transition-colors', isSending ? 'bg-indigo-50/70' : isNext ? 'bg-amber-50/50' : 'hover:bg-slate-50/80')}>
      <td className="px-4 py-3">
        <div className="flex items-start gap-1.5">
          <div className="min-w-0">
            <Link href={`/lead-ingestion/client/${item.leadId}`} className="block truncate font-semibold text-slate-900 hover:text-indigo-700" title={item.candidateName}>
              {item.candidateName}
            </Link>
            <p className="truncate text-xs text-slate-500" title={item.companyName}>
              {item.companyName}
            </p>
          </div>
          <Link href={`/lead-ingestion/client/${item.leadId}`} aria-label={`Open lead ${item.candidateName}`} className="mt-0.5 shrink-0 text-slate-300 hover:text-indigo-600">
            <ExternalLinkIcon width={12} height={12} />
          </Link>
        </div>
      </td>
      <td className="px-4 py-3">
        <p className="truncate font-mono text-xs text-slate-700" title={item.recipientEmail}>
          {item.recipientEmail}
        </p>
      </td>
      <td className="px-4 py-3">
        <p className="truncate text-slate-700" title={item.subject}>
          {item.subject}
        </p>
        {item.errorMessage && (
          <p className="mt-0.5 truncate text-xs text-red-600" title={item.errorMessage}>
            {item.errorMessage}
          </p>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex flex-col items-start gap-1">
          <CampaignItemStatusBadge status={item.status} isNext={isNext} />
          {(item.attempts ?? 0) > 1 && <span className="text-[11px] text-slate-500">{item.attempts} attempts</span>}
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex flex-col items-end gap-1">
          {time.value ? (
            <span className="text-xs text-slate-500 tabular-nums" title={`${time.label} ${formatDateTime(time.value)}`}>
              {formatDateTime(time.value)}
            </span>
          ) : (
            <span className="text-xs text-slate-400">—</span>
          )}
          <ItemAction item={item} canAct={canAct} onSend={onSend} />
        </div>
      </td>
    </tr>
  );
}

function RecipientCard({ item, isNext, canAct, onSend }: { item: CampaignItemRecord; isNext: boolean; canAct: boolean; onSend: () => void }) {
  const isSending = item.status === 'sending';
  const time = itemTime(item);
  return (
    <li className={cn('px-4 py-3', isSending && 'bg-indigo-50/70', isNext && 'bg-amber-50/50')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/lead-ingestion/client/${item.leadId}`} className="block truncate font-semibold text-slate-900">
            {item.candidateName}
          </Link>
          <p className="truncate text-xs text-slate-500">{item.companyName}</p>
          <p className="mt-1 truncate font-mono text-xs text-slate-700">{item.recipientEmail}</p>
        </div>
        <CampaignItemStatusBadge status={item.status} isNext={isNext} />
      </div>
      <p className="mt-2 line-clamp-2 text-sm text-slate-700">{item.subject}</p>
      {item.errorMessage && <p className="mt-1 text-xs text-red-600">{item.errorMessage}</p>}
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">
          {time.value ? `${time.label} ${formatDateTime(time.value)}` : 'Not sent yet'}
        </span>
        <ItemAction item={item} canAct={canAct} onSend={onSend} />
      </div>
    </li>
  );
}

function EditCampaignDialog({
  campaign,
  onClose,
  onSaved,
}: {
  campaign: CampaignRecord;
  onClose: () => void;
  onSaved: (campaign: CampaignRecord) => void;
}) {
  const [name, setName] = useState(campaign.name);
  const [minDelay, setMinDelay] = useState(String(campaign.minDelaySeconds));
  const [maxDelay, setMaxDelay] = useState(String(campaign.maxDelaySeconds));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, saving]);

  const preview = normalizeDelays(Number(minDelay), Number(maxDelay), campaign);
  const trimmedName = name.trim();
  const nameInvalid = trimmedName.length === 0 || trimmedName.length > CAMPAIGN_NAME_MAX_LENGTH;
  const minNum = Number(minDelay);
  const maxNum = Number(maxDelay);
  const delaysInvalid =
    !Number.isFinite(minNum) || !Number.isFinite(maxNum) || minNum < MIN_DELAY_SECONDS || maxNum > MAX_DELAY_SECONDS || minNum > maxNum;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (nameInvalid || delaysInvalid || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await updateCampaignApi(campaign._id, {
        name: trimmedName,
        minDelaySeconds: minNum,
        maxDelaySeconds: maxNum,
      });
      onSaved(res.campaign);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-4 sm:items-center" role="dialog" aria-modal="true" aria-labelledby="edit-campaign-title">
      <button type="button" aria-label="Close dialog" tabIndex={-1} onClick={() => { if (!saving) onClose(); }} className="absolute inset-0 bg-slate-900/50 backdrop-blur-[2px]" />
      <form onSubmit={(e) => { void submit(e); }} className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 id="edit-campaign-title" className="text-base font-semibold text-slate-900">
            Edit campaign
          </h2>
          <button type="button" onClick={onClose} aria-label="Close dialog" disabled={saving} className="-mr-1 -mt-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900">
            <XIcon width={16} height={16} />
          </button>
        </div>

        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="edit-campaign-name" className="mb-1 block text-sm font-medium text-slate-700">
              Name
            </label>
            <Input
              id="edit-campaign-name"
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={CAMPAIGN_NAME_MAX_LENGTH}
              aria-invalid={nameInvalid}
            />
            <p className="mt-1 text-xs text-slate-500">
              {trimmedName.length}/{CAMPAIGN_NAME_MAX_LENGTH}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="edit-min-delay" className="mb-1 block text-sm font-medium text-slate-700">
                Min delay (seconds)
              </label>
              <Input id="edit-min-delay" type="number" inputMode="numeric" min={MIN_DELAY_SECONDS} max={MAX_DELAY_SECONDS} value={minDelay} onChange={(e) => setMinDelay(e.target.value)} aria-invalid={delaysInvalid} />
            </div>
            <div>
              <label htmlFor="edit-max-delay" className="mb-1 block text-sm font-medium text-slate-700">
                Max delay (seconds)
              </label>
              <Input id="edit-max-delay" type="number" inputMode="numeric" min={MIN_DELAY_SECONDS} max={MAX_DELAY_SECONDS} value={maxDelay} onChange={(e) => setMaxDelay(e.target.value)} aria-invalid={delaysInvalid} />
            </div>
          </div>
          <p className={cn('text-xs', delaysInvalid ? 'text-red-600' : 'text-slate-500')}>
            {delaysInvalid
              ? `Both delays must be between ${MIN_DELAY_SECONDS} and ${MAX_DELAY_SECONDS} seconds, and the minimum cannot be above the maximum.`
              : `Random pause of ${formatDelayRange(preview)} between emails.`}
          </p>

          {formError && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </p>
          )}
        </div>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" isLoading={saving} disabled={nameInvalid || delaysInvalid}>
            Save changes
          </Button>
        </div>
      </form>
    </div>
  );
}
