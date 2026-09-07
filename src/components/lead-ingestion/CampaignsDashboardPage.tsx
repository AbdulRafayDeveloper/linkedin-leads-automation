'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  getCampaignsApi,
  getCampaignDetailsApi,
  dispatchCampaignBatchApi,
  deleteCampaignApi,
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
  XIcon,
  RefreshIcon,
  TrashIcon,
  PlayIcon,
  PauseIcon,
} from '@/components/ui/Icons';

function StatusBadge({ status }: { status: CampaignRecord['status'] }) {
  if (status === 'completed') return <Badge tone="success">Completed</Badge>;
  if (status === 'running') return <Badge tone="info" icon={<LoaderIcon width={10} height={10} className="animate-spin" />}>Running</Badge>;
  if (status === 'paused') return <Badge tone="warning">Paused</Badge>;
  return <Badge tone="neutral">Draft</Badge>;
}

function ItemStatusBadge({ status }: { status: CampaignItemRecord['status'] }) {
  if (status === 'opened') return <Badge tone="info">Opened</Badge>;
  if (status === 'delivered') return <Badge tone="success">Delivered</Badge>;
  if (status === 'failed') return <Badge tone="danger">Failed</Badge>;
  if (status === 'sending') return <Badge tone="info" icon={<LoaderIcon width={10} height={10} className="animate-spin" />}>Sending</Badge>;
  return <Badge tone="neutral">Pending</Badge>;
}

export default function CampaignsDashboardPage() {
  const searchParams = useSearchParams();
  const initialIdParam = searchParams.get('id');

  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters for Table
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Selected Campaign Detail Modal
  const [activeCampaign, setActiveCampaign] = useState<CampaignRecord | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [itemStatusFilter, setItemStatusFilter] = useState<string>('all');
  const [itemSearchQuery, setItemSearchQuery] = useState('');

  // Execution Runner States
  const [isRunning, setIsRunning] = useState(false);
  const [runnerStatus, setRunnerStatus] = useState<string | null>(null);
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getCampaignsApi({
        search: searchQuery.trim(),
        status: statusFilter,
        limit: 50,
      });
      setCampaigns(res.campaigns);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch campaigns');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchCampaigns();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchCampaigns]);

  // Open initial campaign if ID param is passed from URL
  useEffect(() => {
    if (initialIdParam) {
      void handleViewDetails(initialIdParam);
    }
  }, [initialIdParam]);

  // Accidental Tab Close Protection Guard (`window.onbeforeunload`)
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

  const handleViewDetails = async (id: string) => {
    setLoadingDetails(true);
    try {
      const res = await getCampaignDetailsApi(id);
      setActiveCampaign(res.campaign);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load campaign details');
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleDeleteCampaign = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this campaign?')) return;

    try {
      await deleteCampaignApi(id);
      setCampaigns((prev) => prev.filter((c) => c._id !== id));
      if (activeCampaign?._id === id) setActiveCampaign(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete campaign');
    }
  };

  // Execution Batch Loop Engine with Randomized Anti-Spam Delays
  const runCampaignLoop = useCallback(async (campaignId: string, rerunFailed = false) => {
    setIsRunning(true);
    setError(null);
    setRunnerStatus('Initializing campaign batch dispatch...');

    try {
      // 1. Trigger initial dispatch batch
      const batchRes = await dispatchCampaignBatchApi(campaignId, { rerunFailed });
      setActiveCampaign(batchRes.campaign);
      setCampaigns((prev) => prev.map((c) => (c._id === campaignId ? batchRes.campaign : c)));

      if (batchRes.remainingCount === 0 || batchRes.campaign.status === 'completed') {
        setRunnerStatus('Campaign execution completed successfully!');
        setIsRunning(false);
        setCountdownSeconds(null);
        return;
      }

      // 2. Anti-Spam Randomized Delay countdown
      const minS = batchRes.campaign.minDelaySeconds || 15;
      const maxS = batchRes.campaign.maxDelaySeconds || 90;
      const randomDelaySec = Math.floor(Math.random() * (maxS - minS + 1)) + minS;

      setRunnerStatus(`Batch of ${batchRes.processedCount} processed. Next email batch sending in ${randomDelaySec}s...`);
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
      setActiveCampaign(res.campaign);
      setCampaigns((prev) => prev.map((c) => (c._id === campaignId ? res.campaign : c)));
    } catch { /* ignore */ }
  };

  // Filtered recipient items for detail modal
  const filteredItems = (activeCampaign?.items ?? []).filter((item) => {
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

  const openRatePercent = activeCampaign && activeCampaign.deliveredCount > 0
    ? Math.round((activeCampaign.openedCount / activeCampaign.deliveredCount) * 100)
    : 0;

  return (
    <div className="w-full max-w-none px-4 sm:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="Cold Email Campaigns & Analytics"
          description="Manage active campaigns, monitor real-time delivery and open statistics, and re-run unsent or failed email batches."
        />
        <Button
          type="button"
          onClick={() => { void fetchCampaigns(); }}
          variant="outline"
          className="flex items-center gap-1.5 text-xs text-slate-600"
        >
          <RefreshIcon width={14} height={14} /> Refresh List
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangleIcon width={16} height={16} className="shrink-0 mt-0.5 text-red-600" />
          <div className="flex-1 font-semibold">{error}</div>
        </div>
      )}

      {/* Control Bar: Search & Status Filter */}
      <Card className="border border-slate-200 bg-white shadow-2xs">
        <CardContent className="py-3.5 px-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              placeholder="Search campaign by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-xs border border-slate-200 rounded-md px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none w-64 bg-white"
            />

            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
              <span>Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="text-xs border border-slate-200 rounded-md px-2.5 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white font-semibold"
              >
                <option value="all">All Statuses</option>
                <option value="running">Running</option>
                <option value="draft">Draft</option>
                <option value="completed">Completed</option>
                <option value="paused">Paused</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Campaigns Directory Table */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <LoaderIcon width={28} height={28} className="text-indigo-600 animate-spin" />
          <span className="text-sm font-semibold text-slate-500">Querying campaigns database...</span>
        </div>
      ) : campaigns.length === 0 ? (
        <Card className="py-12 border-dashed border-2 border-slate-200 flex flex-col items-center justify-center text-slate-400">
          <MailIcon width={36} height={36} className="text-slate-300 mb-2" />
          <div className="text-sm font-semibold text-slate-600 mb-1">No email campaigns created yet.</div>
          <div className="text-xs text-slate-400">Go to the Approved Unsent Emails pool to bundle approved emails into a new campaign.</div>
        </Card>
      ) : (
        <Card className="border border-slate-200 overflow-hidden shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b border-slate-200 font-extrabold text-slate-600 uppercase tracking-wider">
                <tr>
                  <th className="py-3 px-4">Campaign Name</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Created Date</th>
                  <th className="py-3 px-4 text-center">Total</th>
                  <th className="py-3 px-4 text-center text-green-700">Delivered</th>
                  <th className="py-3 px-4 text-center text-blue-700">Opened</th>
                  <th className="py-3 px-4 text-center text-red-600">Failed</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {campaigns.map((comp) => {
                  const percent = comp.totalEmails > 0 ? Math.round((comp.sentCount / comp.totalEmails) * 100) : 0;
                  return (
                    <tr
                      key={comp._id}
                      onClick={() => { void handleViewDetails(comp._id); }}
                      className="hover:bg-indigo-50/40 transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-4">
                        <div className="font-extrabold text-slate-900 text-sm">{comp.name}</div>
                        <div className="w-36 bg-slate-100 rounded-full h-1.5 mt-1 overflow-hidden">
                          <div className="bg-indigo-600 h-full transition-all" style={{ width: `${percent}%` }} />
                        </div>
                      </td>

                      <td className="py-3 px-4">
                        <StatusBadge status={comp.status} />
                      </td>

                      <td className="py-3 px-4 font-mono text-slate-500">
                        {new Date(comp.createdAt).toLocaleDateString()}
                      </td>

                      <td className="py-3 px-4 text-center font-bold text-slate-800">{comp.totalEmails}</td>
                      <td className="py-3 px-4 text-center font-bold text-green-700">{comp.deliveredCount}</td>
                      <td className="py-3 px-4 text-center font-bold text-blue-700">{comp.openedCount}</td>
                      <td className="py-3 px-4 text-center font-bold text-red-600">{comp.failedCount}</td>

                      <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => { void handleViewDetails(comp._id); }}
                            className="text-xs py-1"
                          >
                            View Details
                          </Button>
                          <button
                            type="button"
                            onClick={(e) => { void handleDeleteCampaign(comp._id, e); }}
                            className="text-slate-400 hover:text-red-600 p-1.5 rounded hover:bg-red-50 transition-colors"
                            title="Delete Campaign"
                          >
                            <TrashIcon width={14} height={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Campaign Details & Re-Run Execution Modal Window */}
      {activeCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="relative w-full max-w-4xl rounded-xl bg-white p-6 shadow-2xl space-y-5 max-h-[92vh] overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-xl font-extrabold text-slate-900">
                    📊 {activeCampaign.name}
                  </h3>
                  <StatusBadge status={activeCampaign.status} />
                </div>
                <div className="text-xs text-slate-500 font-medium mt-0.5">
                  Created on {new Date(activeCampaign.createdAt).toLocaleString()} &bull; Anti-Spam Delays: {activeCampaign.minDelaySeconds}s - {activeCampaign.maxDelaySeconds}s
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (isRunning) handlePauseRunner(activeCampaign._id);
                  setActiveCampaign(null);
                }}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <XIcon width={18} height={18} />
              </button>
            </div>

            {/* Runner Control Banner */}
            <div className="bg-slate-900 text-white rounded-lg p-4 space-y-3 shadow-md">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider text-indigo-400">
                    Execution Engine (Vercel Batch Runner)
                  </div>
                  <div className="text-sm font-bold mt-0.5 flex items-center gap-2">
                    {runnerStatus || (isRunning ? 'Processing campaign batch...' : 'Ready for campaign dispatch')}
                    {countdownSeconds !== null && (
                      <span className="bg-indigo-600 text-white text-xs px-2 py-0.5 rounded-full font-mono">
                        ⏳ {countdownSeconds}s
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {isRunning ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handlePauseRunner(activeCampaign._id)}
                      className="bg-amber-600 hover:bg-amber-700 text-white font-bold flex items-center gap-1.5"
                    >
                      <PauseIcon width={14} height={14} /> Pause Runner
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => { void runCampaignLoop(activeCampaign._id, false); }}
                      className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold flex items-center gap-1.5"
                    >
                      <PlayIcon width={14} height={14} /> Start / Resume Batch
                    </Button>
                  )}

                  {(activeCampaign.failedCount > 0 || activeCampaign.sentCount < activeCampaign.totalEmails) && (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => { void runCampaignLoop(activeCampaign._id, true); }}
                      disabled={isRunning}
                      className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center gap-1.5"
                    >
                      <RefreshIcon width={13} height={13} /> Re-run Unsent / Failed
                    </Button>
                  )}
                </div>
              </div>
            </div>

            {/* Stat Cards Overview */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Emails</span>
                <div className="text-xl font-extrabold text-slate-900">{activeCampaign.totalEmails}</div>
              </div>

              <div className="bg-green-50/60 border border-green-200 rounded-lg p-3 space-y-1">
                <span className="text-[10px] font-bold text-green-700 uppercase tracking-wider">Delivered</span>
                <div className="text-xl font-extrabold text-green-800">{activeCampaign.deliveredCount}</div>
              </div>

              <div className="bg-blue-50/60 border border-blue-200 rounded-lg p-3 space-y-1">
                <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Opened ({openRatePercent}%)</span>
                <div className="text-xl font-extrabold text-blue-800">{activeCampaign.openedCount}</div>
              </div>

              <div className="bg-red-50/60 border border-red-200 rounded-lg p-3 space-y-1">
                <span className="text-[10px] font-bold text-red-600 uppercase tracking-wider">Failed</span>
                <div className="text-xl font-extrabold text-red-700">{activeCampaign.failedCount}</div>
              </div>
            </div>

            {/* Recipient Breakdown Controls & Table */}
            <div className="space-y-3 pt-2">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-2">
                <h4 className="text-sm font-extrabold text-slate-800">
                  Recipient Email Deliveries ({filteredItems.length})
                </h4>

                <div className="flex items-center gap-3">
                  <input
                    type="text"
                    placeholder="Filter recipient or company..."
                    value={itemSearchQuery}
                    onChange={(e) => setItemSearchQuery(e.target.value)}
                    className="text-xs border border-slate-200 rounded px-2.5 py-1 focus:ring-1 focus:ring-indigo-500 focus:outline-none w-48 bg-white"
                  />

                  <div className="flex items-center gap-1.5 text-xs text-slate-500 font-semibold">
                    <span>Status:</span>
                    <select
                      value={itemStatusFilter}
                      onChange={(e) => setItemStatusFilter(e.target.value)}
                      className="text-xs border border-slate-200 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white font-semibold"
                    >
                      <option value="all">All Items</option>
                      <option value="opened">Opened Only</option>
                      <option value="delivered">Delivered Only</option>
                      <option value="failed">Failed Only</option>
                      <option value="pending">Pending Only</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                    <tr>
                      <th className="py-2.5 px-3">Candidate / Company</th>
                      <th className="py-2.5 px-3">Recipient Email</th>
                      <th className="py-2.5 px-3">Subject</th>
                      <th className="py-2.5 px-3">Status</th>
                      <th className="py-2.5 px-3 text-right">Sent Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredItems.map((item) => (
                      <tr key={item._id} className="hover:bg-slate-50">
                        <td className="py-2 px-3">
                          <div className="font-bold text-slate-900">{item.candidateName}</div>
                          <div className="text-[10px] text-slate-500">🏢 {item.companyName}</div>
                        </td>

                        <td className="py-2 px-3 font-mono font-semibold text-slate-800">
                          {item.recipientEmail}
                        </td>

                        <td className="py-2 px-3 text-slate-700 truncate max-w-[200px]" title={item.subject}>
                          {item.subject}
                        </td>

                        <td className="py-2 px-3">
                          <ItemStatusBadge status={item.status} />
                          {item.errorMessage && (
                            <div className="text-[9px] text-red-600 font-semibold mt-0.5 truncate max-w-[150px]" title={item.errorMessage}>
                              {item.errorMessage}
                            </div>
                          )}
                        </td>

                        <td className="py-2 px-3 text-right font-mono text-slate-400 text-[11px]">
                          {item.sentAt ? new Date(item.sentAt).toLocaleTimeString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end border-t border-slate-200 pt-3">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (isRunning) handlePauseRunner(activeCampaign._id);
                  setActiveCampaign(null);
                }}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
