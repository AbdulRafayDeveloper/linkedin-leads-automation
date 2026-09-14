'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import {
  getCampaignsApi,
  deleteCampaignApi,
  type CampaignRecord,
} from '@/services/lead-ingestion/apiClient';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  LoaderIcon,
  MailIcon,
  AlertTriangleIcon,
  RefreshIcon,
  TrashIcon,
} from '@/components/ui/Icons';

function StatusBadge({ status }: { status: CampaignRecord['status'] }) {
  if (status === 'completed') return <Badge tone="success">Completed</Badge>;
  if (status === 'running') return <Badge tone="info" icon={<LoaderIcon width={10} height={10} className="animate-spin" />}>Running</Badge>;
  if (status === 'paused') return <Badge tone="warning">Paused</Badge>;
  return <Badge tone="neutral">Draft</Badge>;
}

export default function CampaignsDashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialIdParam = searchParams.get('id');

  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters for Table
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

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

  // Open initial campaign page if ID param is passed from URL
  useEffect(() => {
    if (initialIdParam) {
      router.push(`/lead-ingestion/campaigns/${initialIdParam}`);
    }
  }, [initialIdParam, router]);

  const handleViewDetails = (id: string) => {
    router.push(`/lead-ingestion/campaigns/${id}`);
  };

  const handleDeleteCampaign = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this campaign?')) return;

    try {
      await deleteCampaignApi(id);
      setCampaigns((prev) => prev.filter((c) => c._id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete campaign');
    }
  };

  return (
    <div className="w-full max-w-none px-4 sm:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="Campaigns"
          description="Track delivery and opens, and resend failed emails."
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
    </div>
  );
}
