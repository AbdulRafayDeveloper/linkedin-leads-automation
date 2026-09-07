'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  createCampaignApi,
  type LeadIngestionRecord,
  type VerifiedEmailItem,
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
  GlobeIcon,
  EditIcon,
} from '@/components/ui/Icons';

interface EmailItem {
  id: string;
  leadId: string;
  clientId?: string;
  candidateName: string;
  clientName: string;
  companyName: string;
  jobTitle: string | null;
  targetEmail: string;
  emailStatus: VerifiedEmailItem['status'];
  subject: string;
  bodyHtml: string;
  createdAt: string;
  companyIndex: number;
}

function SmtpBadge({ status }: { status: VerifiedEmailItem['status'] }) {
  if (status === 'valid') return <Badge tone="success">Verified SMTP</Badge>;
  if (status === 'invalid') return <Badge tone="danger">Invalid</Badge>;
  if (status === 'risky') return <Badge tone="warning">Risky</Badge>;
  return <Badge tone="neutral">Unverified</Badge>;
}

export default function ApprovedEmailsPage() {
  const router = useRouter();

  const [leads, setLeads] = useState<LeadIngestionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Selected item IDs
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [customCountInput, setCustomCountInput] = useState('');

  // Modal State
  const [showModal, setShowModal] = useState(false);
  const [campaignName, setCampaignName] = useState('');
  const [minDelay, setMinDelay] = useState(15);
  const [maxDelay, setMaxDelay] = useState(90);
  const [creating, setCreating] = useState(false);

  const fetchApprovedUnsentLeads = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        approved: 'true',
        emailStatus: 'pending',
        limit: '100',
        ...(searchQuery.trim() ? { search: searchQuery.trim() } : {}),
      });

      const res = await fetch(`/api/leads?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch approved emails');

      const data = (await res.json()) as { leads?: LeadIngestionRecord[] };
      setLeads(data.leads ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error fetching approved emails');
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchApprovedUnsentLeads();
    }, 300);
    return () => clearTimeout(timer);
  }, [fetchApprovedUnsentLeads]);

  // Flatten approved unsent emails from lead records
  const allItems: EmailItem[] = [];

  leads.forEach((lead) => {
    const verifiedMap = new Map<string, VerifiedEmailItem['status']>();
    (lead.verifiedEmails ?? []).forEach((v) => verifiedMap.set(v.email, v.status));

    const companies = lead.currentCompanies ?? [];
    let hasCompanyDrafts = false;

    companies.forEach((comp, idx) => {
      if (comp.approved && comp.emailSubject && comp.emailBody) {
        hasCompanyDrafts = true;
        const targetEm = comp.companyEmails?.[0] || lead.email || '';
        const status = verifiedMap.get(targetEm) ?? 'pending';

        allItems.push({
          id: `${lead._id}-comp-${idx}`,
          leadId: lead._id,
          clientId: lead.clientId,
          candidateName: lead.fullName || 'Candidate Profile',
          clientName: (lead as unknown as { clientName?: string }).clientName || 'Client Profile',
          companyName: comp.companyName,
          jobTitle: comp.jobTitle,
          targetEmail: targetEm,
          emailStatus: status,
          subject: comp.emailSubject,
          bodyHtml: comp.emailBody,
          createdAt: lead.createdAt,
          companyIndex: idx,
        });
      }
    });

    if (!hasCompanyDrafts && lead.approved && lead.emailSubject && lead.emailBody) {
      const primaryComp = companies[0];
      allItems.push({
        id: `${lead._id}-main`,
        leadId: lead._id,
        clientId: lead.clientId,
        candidateName: lead.fullName || 'Candidate Profile',
        clientName: (lead as unknown as { clientName?: string }).clientName || 'Client Profile',
        companyName: primaryComp?.companyName || lead.companyName || 'Corporate Profile',
        jobTitle: primaryComp?.jobTitle || lead.jobTitle || 'Professional',
        targetEmail: primaryComp?.companyEmails?.[0] || lead.email || '',
        emailStatus: verifiedMap.get(primaryComp?.companyEmails?.[0] || lead.email || '') ?? 'pending',
        subject: lead.emailSubject,
        bodyHtml: lead.emailBody,
        createdAt: lead.createdAt,
        companyIndex: 0,
      });
    }
  });

  // Filter by Date Range
  const filteredItems = allItems.filter((item) => {
    if (!startDate && !endDate) return true;
    const itemDate = new Date(item.createdAt).getTime();
    if (startDate && itemDate < new Date(startDate).getTime()) return false;
    if (endDate && itemDate > new Date(endDate + 'T23:59:59').getTime()) return false;
    return true;
  });

  // Quick Selection Helpers
  const handleSelectCount = (count: number) => {
    const toSelect = filteredItems.slice(0, count).map((i) => i.id);
    setSelectedIds(new Set(toSelect));
  };

  const handleSelectAll = () => {
    setSelectedIds(new Set(filteredItems.map((i) => i.id)));
  };

  const handleDeselectAll = () => {
    setSelectedIds(new Set());
  };

  const handleToggleItem = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleOpenCreateModal = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const defaultName = `Campaign #${Math.floor(Math.random() * 900 + 100)} - ${todayStr}`;
    setCampaignName(defaultName);
    setShowModal(true);
  };

  const handleCreateCampaignSubmit = async (status: 'draft' | 'running') => {
    if (!campaignName.trim() || selectedIds.size === 0) return;

    setCreating(true);
    setError(null);
    try {
      const selectedItemsList = filteredItems.filter((item) => selectedIds.has(item.id));
      const payloadItems = selectedItemsList.map((item) => ({
        leadId: item.leadId,
        companyIndex: item.companyIndex,
        candidateName: item.candidateName,
        clientName: item.clientName,
        companyName: item.companyName,
        recipientEmail: item.targetEmail,
        subject: item.subject,
        bodyHtml: item.bodyHtml,
      }));

      const res = await createCampaignApi({
        name: campaignName.trim(),
        status,
        minDelaySeconds: minDelay,
        maxDelaySeconds: maxDelay,
        items: payloadItems,
      });

      setShowModal(false);
      // Redirect directly to Campaigns Dashboard or campaign detail runner
      router.push(`/lead-ingestion/campaigns?id=${res.campaign._id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create campaign');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="w-full max-w-none px-4 sm:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="Approved Unsent Emails Pool"
          description="Filter and select verified approved outreach emails to bundle into active cold email campaigns."
        />
        <Link href="/lead-ingestion/campaigns">
          <Button variant="outline" className="flex items-center gap-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-xs font-bold">
            <MailIcon width={14} height={14} />
            View Campaigns Dashboard
          </Button>
        </Link>
      </div>

      {error && (
        <div className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangleIcon width={16} height={16} className="shrink-0 mt-0.5 text-red-600" />
          <div className="flex-1 font-semibold">{error}</div>
        </div>
      )}

      {/* Control Bar: Filters & Quick Select Tags */}
      <Card className="border border-slate-200 bg-white shadow-2xs">
        <CardContent className="py-4 px-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-3">
            {/* Search & Date Filter */}
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                placeholder="Search candidate, company, email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="text-xs border border-slate-200 rounded-md px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none w-64 bg-white"
              />

              <div className="flex items-center gap-2 text-xs text-slate-600 font-semibold">
                <span>Date:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="text-xs border border-slate-200 rounded-md px-2.5 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white"
                />
                <span>to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="text-xs border border-slate-200 rounded-md px-2.5 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white"
                />
              </div>
            </div>

            <div className="text-xs font-semibold text-slate-500">
              Total Approved Available: <span className="text-indigo-600 font-bold">{filteredItems.length}</span>
            </div>
          </div>

          {/* Quick Selection Tags */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-extrabold text-slate-700 uppercase tracking-wider mr-1">Quick Select:</span>
              {[10, 20, 30, 40, 50].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => handleSelectCount(num)}
                  className="text-xs font-bold border border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full transition-colors"
                >
                  First {num}
                </button>
              ))}

              <button
                type="button"
                onClick={handleSelectAll}
                className="text-xs font-bold border border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1 rounded-full transition-colors"
              >
                Select All ({filteredItems.length})
              </button>

              <button
                type="button"
                onClick={handleDeselectAll}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 underline ml-2"
              >
                Deselect All
              </button>
            </div>

            {/* Custom Select Count */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-slate-500 font-semibold">Custom Count:</span>
              <input
                type="number"
                min={1}
                max={filteredItems.length}
                placeholder="Qty"
                value={customCountInput}
                onChange={(e) => setCustomCountInput(e.target.value)}
                className="w-16 text-xs border border-slate-200 rounded px-2 py-1 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  const val = parseInt(customCountInput, 10);
                  if (val > 0) handleSelectCount(val);
                }}
                disabled={!customCountInput || parseInt(customCountInput, 10) <= 0}
                className="text-xs py-1 px-2.5"
              >
                Apply
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Grid of Approved Unsent Email Cards */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <LoaderIcon width={28} height={28} className="text-indigo-600 animate-spin" />
          <span className="text-sm font-semibold text-slate-500">Querying database for approved unsent emails...</span>
        </div>
      ) : filteredItems.length === 0 ? (
        <Card className="py-12 border-dashed border-2 border-slate-200 flex flex-col items-center justify-center text-slate-400">
          <CheckCircleIcon width={36} height={36} className="text-green-500 mb-2" />
          <div className="text-sm font-semibold text-slate-600 mb-1">No approved unsent emails found in pool.</div>
          <div className="text-xs text-slate-400">Approve draft emails from the Candidate Ingestion profile pages to populate this list.</div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredItems.map((item) => {
            const isSelected = selectedIds.has(item.id);
            return (
              <Card
                key={item.id}
                onClick={() => handleToggleItem(item.id)}
                className={[
                  'border cursor-pointer transition-all bg-white flex flex-col justify-between overflow-hidden relative select-none',
                  isSelected
                    ? 'border-indigo-600 ring-2 ring-indigo-500/20 shadow-md'
                    : 'border-slate-200 hover:border-slate-300 shadow-2xs',
                ].join(' ')}
              >
                <CardHeader
                  title={
                    <div className="flex items-start justify-between gap-2 w-full">
                      <div className="flex items-start gap-2.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleItem(item.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                        <div>
                          <div className="text-sm font-extrabold text-slate-900 leading-snug">
                            🏢 {item.companyName}
                          </div>
                          <div className="text-xs text-indigo-600 font-semibold mt-0.5">
                            Candidate: {item.candidateName} ({item.clientName})
                          </div>
                        </div>
                      </div>
                      <Badge tone="success" className="shrink-0">✓ Approved</Badge>
                    </div>
                  }
                />

                <CardContent className="pt-2 space-y-3 flex-1 flex flex-col justify-between">
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Contact Email</span>
                    <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded px-2.5 py-1.5 gap-1">
                      <span className="text-[11px] font-mono font-bold text-slate-800 truncate">{item.targetEmail}</span>
                      <SmtpBadge status={item.emailStatus} />
                    </div>
                  </div>

                  <div className="space-y-1 bg-white border border-slate-100 p-2.5 rounded-md">
                    <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider flex items-center gap-1">
                      <SparklesIcon width={10} height={10} /> Subject Preview
                    </span>
                    <p className="text-xs font-semibold text-slate-800 line-clamp-1 truncate">
                      {item.subject}
                    </p>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Floating Bottom Action Bar for Campaign Creation */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white rounded-full px-6 py-3 shadow-2xl flex items-center gap-6 border border-slate-800 animate-in fade-in slide-in-from-bottom-4">
          <div className="flex items-center gap-2 text-sm font-bold">
            <span className="bg-indigo-600 text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">
              {selectedIds.size}
            </span>
            <span>Approved Emails Selected</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleDeselectAll}
              className="text-xs text-slate-400 hover:text-white underline font-semibold"
            >
              Clear
            </button>
            <Button
              type="button"
              onClick={handleOpenCreateModal}
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs px-5 py-2 rounded-full flex items-center gap-2 shadow-lg transition-transform active:scale-95"
            >
              <SparklesIcon width={15} height={15} />
              Create Campaign
            </Button>
          </div>
        </div>
      )}

      {/* Create Campaign Modal Window */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg rounded-xl bg-white p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div>
                <h3 className="text-lg font-extrabold text-slate-900">
                  🚀 Launch Cold Email Campaign
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Bundling {selectedIds.size} approved contact emails into campaign queue.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <XIcon width={18} height={18} />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Campaign Name
                </label>
                <input
                  type="text"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  required
                  placeholder="e.g. Campaign #01 - 2026-09-08"
                  className="w-full text-xs font-bold text-slate-900 border border-slate-300 rounded-md px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              {/* Anti-Spam Delay Configuration */}
              <div className="bg-indigo-50/60 border border-indigo-100 rounded-lg p-3 space-y-2">
                <div className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
                  <ShieldIcon width={14} height={14} className="text-indigo-600" />
                  Anti-Spam Human Delay Settings
                </div>
                <p className="text-[11px] text-slate-600 leading-normal">
                  Sets a randomized delay between sending each email to protect domain deliverability and avoid spam filters.
                </p>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                      Min Delay (Seconds)
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={300}
                      value={minDelay}
                      onChange={(e) => setMinDelay(parseInt(e.target.value, 10) || 15)}
                      className="w-full text-xs font-mono font-bold border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                      Max Delay (Seconds)
                    </label>
                    <input
                      type="number"
                      min={minDelay}
                      max={300}
                      value={maxDelay}
                      onChange={(e) => setMaxDelay(parseInt(e.target.value, 10) || 90)}
                      className="w-full text-xs font-mono font-bold border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-white"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-200 pt-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => { void handleCreateCampaignSubmit('draft'); }}
                disabled={creating}
                className="text-slate-700 border-slate-300 hover:bg-slate-100"
              >
                Save as Draft
              </Button>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setShowModal(false)}
                  disabled={creating}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => { void handleCreateCampaignSubmit('running'); }}
                  disabled={creating || !campaignName.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold px-4"
                >
                  {creating ? (
                    <LoaderIcon width={14} height={14} className="animate-spin" />
                  ) : (
                    <SparklesIcon width={14} height={14} />
                  )}
                  Launch Campaign Now
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ShieldIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
