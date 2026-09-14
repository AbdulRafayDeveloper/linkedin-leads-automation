'use client';

import { useEffect, useState, useRef, useCallback, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  getCampaignDetailsApi,
  dispatchCampaignBatchApi,
  updateCampaignApi,
  type CampaignRecord,
  type CampaignItemRecord,
} from '@/services/lead-ingestion/apiClient';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  LoaderIcon,
  CheckCircleIcon,
  MailIcon,
  SparklesIcon,
  AlertTriangleIcon,
  RefreshIcon,
  PlayIcon,
  PauseIcon,
  ArrowLeftIcon,
} from '@/components/ui/Icons';

function StatusBadge({ status }: { status: CampaignRecord['status'] }) {
  if (status === 'completed') return <Badge tone="success">Completed</Badge>;
  if (status === 'running') return <Badge tone="info" icon={<LoaderIcon width={10} height={10} className="animate-spin" />}>Running</Badge>;
  if (status === 'paused') return <Badge tone="warning">Paused</Badge>;
  return <Badge tone="neutral">Draft</Badge>;
}

function ItemStatusBadge({ status, isActive }: { status: CampaignItemRecord['status']; isActive?: boolean }) {
  if (status === 'opened') return <Badge tone="info">Opened</Badge>;
  if (status === 'delivered') return <Badge tone="success">Delivered</Badge>;
  if (status === 'failed') return <Badge tone="danger">Failed</Badge>;
  if (status === 'sending' || isActive) {
    return (
      <Badge tone="info" icon={<LoaderIcon width={10} height={10} className="animate-spin text-indigo-600" />}>
        ⚡ Dispatching In Progress...
      </Badge>
    );
  }
  return <Badge tone="neutral">Pending</Badge>;
}

interface CampaignDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function CampaignDetailPage({ params }: CampaignDetailPageProps) {
  const { id } = use(params);
  const router = useRouter();

  const [campaign, setCampaign] = useState<CampaignRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters for recipient list
  const [itemStatusFilter, setItemStatusFilter] = useState<string>('all');
  const [itemSearchQuery, setItemSearchQuery] = useState('');

  // Execution Runner States
  const [isRunning, setIsRunning] = useState(false);
  const [runnerStatus, setRunnerStatus] = useState<string | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchCampaign = useCallback(async () => {
    try {
      const res = await getCampaignDetailsApi(id);
      setCampaign(res.campaign);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaign');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchCampaign();
  }, [fetchCampaign]);

  // Accidental Tab Close Protection Guard
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isRunning) {
        e.preventDefault();
        e.returnValue = 'Cold email campaign dispatch is currently running. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isRunning]);

  // Sequential Campaign Execution Runner with Strict Random Anti-Spam Delays
  const runCampaignLoop = useCallback(async (campaignId: string, rerunFailed = false) => {
    setIsRunning(true);
    setError(null);
    setRunnerStatus('Dispatching 1 email sequentially...');

    try {
      // 1. Dispatch 1 email sequentially
      const batchRes = await dispatchCampaignBatchApi(campaignId, { rerunFailed });
      setCampaign(batchRes.campaign);

      if (batchRes.remainingCount === 0 || batchRes.campaign.status === 'completed') {
        setRunnerStatus('🎉 Campaign execution completed! All emails dispatched.');
        setIsRunning(false);
        setCountdownSeconds(null);
        return;
      }

      // 2. Strict Anti-Spam Randomized Delay countdown (between minDelaySeconds and maxDelaySeconds)
      const minS = batchRes.campaign.minDelaySeconds || 60;
      const maxS = batchRes.campaign.maxDelaySeconds || 600;
      const randomDelaySec = Math.floor(Math.random() * (maxS - minS + 1)) + minS;

      const formatMinSec = (sec: number) => {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        return m > 0 ? `${m}m ${s}s` : `${s}s`;
      };

      setRunnerStatus(`Email dispatched successfully! Next email sending in ${formatMinSec(randomDelaySec)}...`);
      setCountdownSeconds(randomDelaySec);

      let remaining = randomDelaySec;
      if (timerRef.current) clearInterval(timerRef.current);

      timerRef.current = setInterval(() => {
        remaining -= 1;
        setCountdownSeconds(remaining);
        if (remaining <= 0) {
          if (timerRef.current) clearInterval(timerRef.current);
          void runCampaignLoop(campaignId, rerunFailed);
        }
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Campaign runner error');
      setIsRunning(false);
      setRunnerStatus(null);
      setCountdownSeconds(null);
    }
  }, []);

  const handlePauseRunner = async (campaignId: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    setIsRunning(false);
    setCountdownSeconds(null);
    setRunnerStatus('Campaign execution paused by user.');
    try {
      const res = await updateCampaignApi(campaignId, { status: 'paused' });
      setCampaign(res.campaign);
    } catch { /* ignore */ }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <LoaderIcon width={32} height={32} className="animate-spin text-indigo-600" />
        <span className="text-sm font-semibold text-slate-600">Loading Campaign Runner Workspace...</span>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="w-full max-w-4xl mx-auto px-4 py-12 text-center space-y-4">
        <div className="text-red-600 text-lg font-bold">{error || 'Campaign not found'}</div>
        <Link href="/lead-ingestion/campaigns">
          <Button variant="outline" className="text-xs">
            Back to Campaigns Dashboard
          </Button>
        </Link>
      </div>
    );
  }

  const filteredItems = (campaign.items ?? []).filter((item) => {
    if (itemStatusFilter !== 'all' && item.status !== itemStatusFilter) return false;
    if (itemSearchQuery.trim()) {
      const q = itemSearchQuery.toLowerCase().trim();
      const matchName = item.candidateName.toLowerCase().includes(q);
      const matchEmail = item.recipientEmail.toLowerCase().includes(q);
      const matchComp = item.companyName.toLowerCase().includes(q);
      if (!matchName && !matchEmail && !matchComp) return false;
    }
    return true;
  });

  const openRatePercent = campaign.deliveredCount > 0
    ? Math.round((campaign.openedCount / campaign.deliveredCount) * 100)
    : 0;

  const activeDispatchItem = (campaign.items ?? []).find(
    (item) => item.status === 'sending' || (isRunning && item.status === 'pending')
  );

  return (
    <div className="w-full max-w-none px-4 sm:px-8 py-8 space-y-6">
      {/* Top Header Navigation */}
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-3">
          <Link href="/lead-ingestion/campaigns">
            <Button variant="outline" size="sm" className="flex items-center gap-1.5 text-xs text-slate-600 border-slate-300 hover:bg-slate-50">
              <ArrowLeftIcon width={14} height={14} /> Back to Campaigns
            </Button>
          </Link>
          <PageHeader
            title={campaign.name}
            description={`Campaign #${campaign._id.slice(-6)}`}
          />
        </div>
        <StatusBadge status={campaign.status} />
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangleIcon width={16} height={16} className="shrink-0 mt-0.5 text-red-600" />
          <div className="flex-1 font-semibold">{error}</div>
        </div>
      )}

      {/* Dedicated Execution Engine Panel */}
      <Card className="border border-slate-900 bg-slate-900 text-white shadow-xl">
        <CardContent className="py-5 px-6 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
                <SparklesIcon width={14} height={14} />
                Sequential Anti-Spam Dispatch Engine
              </div>
              <div className="text-base font-extrabold flex items-center gap-2 flex-wrap">
                <span>{runnerStatus || (isRunning ? 'Processing campaign email...' : 'Ready for campaign dispatch')}</span>
                {countdownSeconds !== null && (
                  <span className="bg-indigo-600 text-white text-xs px-3 py-1 rounded-full font-mono font-bold animate-pulse">
                    ⏳ {Math.floor(countdownSeconds / 60) > 0 ? `${Math.floor(countdownSeconds / 60)}m ${countdownSeconds % 60}s` : `${countdownSeconds}s`} delay
                  </span>
                )}
              </div>
              <div className="text-xs text-slate-400 font-medium">
                Anti-Spam Human Random Delay Range: <span className="text-indigo-300 font-bold">{campaign.minDelaySeconds}s (1m)</span> &bull; <span className="text-indigo-300 font-bold">{campaign.maxDelaySeconds}s (10m)</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap">
              {isRunning ? (
                <Button
                  type="button"
                  onClick={() => handlePauseRunner(campaign._id)}
                  className="bg-amber-600 hover:bg-amber-700 text-white font-bold flex items-center gap-1.5 text-xs px-4 py-2"
                >
                  <PauseIcon width={15} height={15} /> Pause Runner
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={() => { void runCampaignLoop(campaign._id, false); }}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center gap-1.5 text-xs px-4 py-2 shadow-lg"
                >
                  <PlayIcon width={15} height={15} /> Start / Resume Sequential Dispatch
                </Button>
              )}

              {campaign.failedCount > 0 && (
                <Button
                  type="button"
                  onClick={() => { void runCampaignLoop(campaign._id, true); }}
                  disabled={isRunning}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1.5 text-xs px-4 py-2 disabled:opacity-50"
                >
                  <RefreshIcon width={14} height={14} /> Re-run Failed Emails ({campaign.failedCount})
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Analytics Overview Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
        <Card className="border border-slate-200 bg-white shadow-2xs">
          <CardContent className="p-4 space-y-1">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Total Recipients</span>
            <div className="text-2xl font-extrabold text-slate-900">{campaign.totalEmails}</div>
          </CardContent>
        </Card>

        <Card className="border border-green-200 bg-green-50/50 shadow-2xs">
          <CardContent className="p-4 space-y-1">
            <span className="text-[10px] font-bold text-green-700 uppercase tracking-wider block">Delivered</span>
            <div className="text-2xl font-extrabold text-green-800">{campaign.deliveredCount}</div>
          </CardContent>
        </Card>

        <Card className="border border-blue-200 bg-blue-50/50 shadow-2xs">
          <CardContent className="p-4 space-y-1">
            <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider block">Opened ({openRatePercent}%)</span>
            <div className="text-2xl font-extrabold text-blue-800">{campaign.openedCount}</div>
          </CardContent>
        </Card>

        <Card className="border border-red-200 bg-red-50/50 shadow-2xs">
          <CardContent className="p-4 space-y-1">
            <span className="text-[10px] font-bold text-red-600 uppercase tracking-wider block">Failed</span>
            <div className="text-2xl font-extrabold text-red-700">{campaign.failedCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Recipient Deliveries List */}
      <Card className="border border-slate-200 bg-white shadow-2xs">
        <CardHeader
          title={
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
              <span className="text-base font-extrabold text-slate-900">
                Recipient Email Deliveries ({filteredItems.length})
              </span>

              <div className="flex items-center gap-3">
                <input
                  type="text"
                  placeholder="Filter by candidate, company, email..."
                  value={itemSearchQuery}
                  onChange={(e) => setItemSearchQuery(e.target.value)}
                  className="text-xs border border-slate-200 rounded-md px-3 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none w-64 bg-white"
                />

                <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
                  <span>Status:</span>
                  <select
                    value={itemStatusFilter}
                    onChange={(e) => setItemStatusFilter(e.target.value)}
                    className="text-xs border border-slate-200 rounded-md px-2.5 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white font-semibold"
                  >
                    <option value="all">All Statuses</option>
                    <option value="opened">Opened Only</option>
                    <option value="delivered">Delivered Only</option>
                    <option value="failed">Failed Only</option>
                    <option value="pending">Pending Only</option>
                  </select>
                </div>
              </div>
            </div>
          }
        />

        <CardContent className="pt-2">
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 font-extrabold text-slate-600 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Candidate / Company</th>
                  <th className="py-3 px-4">Recipient Email</th>
                  <th className="py-3 px-4">Subject</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Sent Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.map((item) => {
                  const isActiveSending = activeDispatchItem?._id === item._id;
                  return (
                    <tr
                      key={item._id}
                      className={
                        isActiveSending
                          ? 'bg-indigo-50/90 border-l-4 border-indigo-600 transition-colors shadow-2xs font-semibold'
                          : 'hover:bg-slate-50/80 transition-colors'
                      }
                    >
                      <td className="py-3 px-4">
                        <div className="font-extrabold text-slate-900">{item.candidateName}</div>
                        <div className="text-[11px] text-slate-500 font-semibold">🏢 {item.companyName}</div>
                      </td>

                      <td className="py-3 px-4 font-mono font-bold text-slate-800">
                        {item.recipientEmail}
                      </td>

                      <td className="py-3 px-4 text-slate-700 font-medium truncate max-w-xs" title={item.subject}>
                        {item.subject}
                      </td>

                      <td className="py-3 px-4">
                        <ItemStatusBadge status={item.status} isActive={isActiveSending} />
                        {item.errorMessage && (
                          <div className="text-[10px] text-red-600 font-semibold mt-0.5 truncate max-w-xs" title={item.errorMessage}>
                            {item.errorMessage}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right font-mono text-slate-400 text-xs">
                        {isActiveSending ? (
                          <span className="text-indigo-600 font-bold animate-pulse">Sending now...</span>
                        ) : item.sentAt ? (
                          new Date(item.sentAt).toLocaleTimeString()
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
