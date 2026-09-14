'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  UsersIcon,
  LoaderIcon,
  MailIcon,
  SparklesIcon,
  ExternalLinkIcon,
  AlertTriangleIcon,
  TrashIcon,
  GlobeIcon,
  CheckCircleIcon,
  RefreshIcon,
  XIcon,
} from '@/components/ui/Icons';
import type { VerifiedEmailItem, CurrentCompanyItem } from '@/services/lead-ingestion/apiClient';

interface IngestedLead {
  _id: string;
  clientId: string;
  clientName?: string;
  fullName: string | null;
  companyName: string | null;
  jobTitle: string | null;
  email: string | null;
  websiteUrl: string | null;
  portfolioUrl: string | null;
  summary: string | null;
  rawText?: string;
  additionalUrls?: string[];
  currentCompanies?: CurrentCompanyItem[];
  discoveredEmails?: string[];
  verifiedEmails?: VerifiedEmailItem[];
  emailSubject?: string | null;
  emailBody?: string | null;
  approved?: boolean;
  emailStatus?: 'pending' | 'in_progress' | 'delivered' | 'opened' | 'failed' | 'no_contact_email';
  emailValidationStatus?: 'pending' | 'valid' | 'invalid' | 'risky' | 'unknown';
  createdAt: string;
}

interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

// ── Unified 3-Tier SmtpBadge Component (Risky considered Verified) ─────────

function SmtpBadge({ status }: { status?: VerifiedEmailItem['status'] | null }) {
  if (status === 'valid' || status === 'risky') {
    return <Badge tone="success">✓ Verified SMTP</Badge>;
  }
  if (status === 'invalid') {
    return <Badge tone="danger">❌ Email Not Exist</Badge>;
  }
  return <Badge tone="warning">⚡ SMTP Not Verified</Badge>;
}

export default function MyLeadsPage() {
  const router = useRouter();

  const [leads, setLeads] = useState<IngestedLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Filter States
  const [search, setSearch] = useState('');
  const [selectedApproval, setSelectedApproval] = useState('all'); // 'all' | 'approved' | 'pending' | 'verified_smtp' | 'no_email'
  const [selectedDateRange, setSelectedDateRange] = useState('all'); // 'all' | 'today' | '7days' | '30days' | 'custom'
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Toast Notifications
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    const toastId = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id: toastId, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toastId));
    }, 4000);
  };

  const removeToast = (toastId: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== toastId));
  };

  const loadLeads = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (selectedApproval !== 'all') params.set('emailStatus', selectedApproval);
      if (selectedDateRange !== 'all') {
        params.set('dateRange', selectedDateRange);
        if (selectedDateRange === 'custom') {
          if (customStartDate) params.set('startDate', customStartDate);
          if (customEndDate) params.set('endDate', customEndDate);
        }
      }

      const res = await fetch(`/api/leads?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch leads');
      const data = (await res.json()) as { leads?: IngestedLead[] };
      setLeads(data.leads ?? []);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load leads', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLeads();
  }, [selectedApproval, selectedDateRange, customStartDate, customEndDate]);

  // Debounced search trigger
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadLeads();
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Single Lead Delete
  const handleDeleteLead = async (leadId: string, name: string) => {
    if (!confirm(`Are you sure you want to delete lead "${name}"?`)) return;
    setDeletingId(leadId);
    try {
      const res = await fetch(`/api/leads?id=${leadId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete lead');
      setLeads((prev) => prev.filter((l) => l._id !== leadId));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(leadId);
        return next;
      });
      showToast(`Deleted "${name}" successfully`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete lead', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  // Bulk Delete
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected lead(s)? This action cannot be undone.`)) return;

    try {
      const res = await fetch('/api/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (!res.ok) throw new Error('Failed to delete selected leads');
      const count = selectedIds.size;
      setSelectedIds(new Set());
      showToast(`Successfully deleted ${count} lead(s)`, 'success');
      void loadLeads();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to delete selected leads', 'error');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredLeads.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredLeads.map((l) => l._id)));
    }
  };

  // Advanced Approval & Status Filter Logic (Checks Personal & All Company Boxes)
  const filteredLeads = useMemo(() => {
    return leads.filter((l) => {
      if (selectedApproval === 'all') return true;

      const personalEmails = Array.from(
        new Set([...(l.discoveredEmails ?? []), ...(l.email ? [l.email] : [])])
      );

      const verifiedSet = new Set<string>();
      (l.verifiedEmails ?? []).forEach((v) => {
        if (v.status === 'valid' || v.status === 'risky') {
          verifiedSet.add(v.email.toLowerCase());
        }
      });
      if (l.emailValidationStatus === 'valid' || l.emailValidationStatus === 'risky') {
        if (l.email) verifiedSet.add(l.email.toLowerCase());
      }

      const isPersonalVerified = personalEmails.some((em) => verifiedSet.has(em.toLowerCase()));

      if (selectedApproval === 'unapproved_verified_smtp') {
        // Strict Criteria: Both Personal Profile and all Companies MUST have at least one verified SMTP email AND be unapproved!
        if (l.approved === true) return false;
        if (!isPersonalVerified) return false;

        const companies = l.currentCompanies ?? [];
        if (companies.length > 0) {
          for (const comp of companies) {
            if (comp.approved === true) return false;
            const compEmails = comp.companyEmails ?? [];
            const hasVerifiedComp = compEmails.some((em) => verifiedSet.has(em.toLowerCase()));
            if (!hasVerifiedComp) return false; // Discard if company lacks a verified SMTP email!
          }
        }

        return true;
      }

      if (selectedApproval === 'missing_or_unverified') {
        // Matches if EVEN ONE profile (Personal or ANY Company) is missing email or lacks a verified SMTP email
        if (personalEmails.length === 0 || !isPersonalVerified) {
          return true; // Personal profile has missing or unverified email
        }

        const companies = l.currentCompanies ?? [];
        if (companies.length > 0) {
          for (const comp of companies) {
            const compEmails = comp.companyEmails ?? [];
            const hasVerifiedComp = compEmails.some((em) => verifiedSet.has(em.toLowerCase()));
            if (compEmails.length === 0 || !hasVerifiedComp) {
              return true; // Company profile has missing or unverified email
            }
          }
        }

        return false; // All personal & company boxes have verified SMTP emails
      }

      return true;
    });
  }, [leads, selectedApproval]);

  return (
    <div className="w-full max-w-none px-4 sm:px-8 py-6 space-y-6 relative">
      {/* Top Header Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <PageHeader
          title="Leads"
          description="Every imported prospect with their companies, contact emails and verification status."
        />
        <div className="flex items-center gap-3">
          <Link href="/lead-ingestion">
            <Button className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-xs flex items-center gap-2">
              <SparklesIcon width={14} height={14} />
              + Ingest New Lead
            </Button>
          </Link>
          <Link href="/lead-ingestion/emails">
            <Button variant="outline" className="flex items-center gap-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-xs">
              <MailIcon width={14} height={14} />
              Outreach Drafts
            </Button>
          </Link>
        </div>
      </div>

      {/* Top Filters Toolbar */}
      <Card className="border border-slate-200 bg-white shadow-2xs">
        <CardContent className="py-3 px-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Search Input */}
            <div className="flex items-center gap-2 flex-1 min-w-[260px]">
              <input
                type="text"
                placeholder="Search LinkedIn URL, full name, company, or email address..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="text-xs border border-slate-300 rounded-md px-3 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none w-full bg-white font-medium"
              />
            </div>

            {/* Filter Dropdowns */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* Date Filter */}
              <select
                value={selectedDateRange}
                onChange={(e) => setSelectedDateRange(e.target.value)}
                className="text-xs border border-slate-300 rounded-md px-2.5 py-1.5 bg-slate-50 text-slate-700 font-semibold focus:outline-none cursor-pointer hover:bg-slate-100"
              >
                <option value="all">📅 All Time</option>
                <option value="today">📅 Today</option>
                <option value="7days">📅 Last 7 Days</option>
                <option value="30days">📅 Last 30 Days</option>
                <option value="custom">📅 Custom Date Range</option>
              </select>

              {/* Custom Date Inputs (Visible when selectedDateRange === 'custom') */}
              {selectedDateRange === 'custom' && (
                <div className="flex items-center gap-1.5 bg-indigo-50/80 border border-indigo-200 rounded-md px-2 py-1 text-xs">
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-bold text-indigo-900">From:</span>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="text-xs border border-indigo-200 rounded px-1.5 py-0.5 bg-white text-slate-800 font-medium focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[11px] font-bold text-indigo-900">To:</span>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="text-xs border border-indigo-200 rounded px-1.5 py-0.5 bg-white text-slate-800 font-medium focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                    />
                  </div>
                  {(customStartDate || customEndDate) && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomStartDate('');
                        setCustomEndDate('');
                      }}
                      className="text-[10px] text-slate-500 hover:text-indigo-700 font-bold ml-1 hover:underline"
                      title="Clear custom date selection"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}

              {/* Approval & Validation Status Filter */}
              <select
                value={selectedApproval}
                onChange={(e) => setSelectedApproval(e.target.value)}
                className="text-xs border border-slate-300 rounded-md px-2.5 py-1.5 bg-slate-50 text-slate-700 font-semibold focus:outline-none cursor-pointer hover:bg-slate-100 font-bold"
              >
                <option value="all">⚡ All Statuses</option>
                <option value="unapproved_verified_smtp">⚡ Verified SMTP & Unapproved (Personal & Companies)</option>
                <option value="missing_or_unverified">⚠️ Missing Email / SMTP Not Verified (Personal or Companies)</option>
              </select>

              {/* Refresh */}
              <button
                type="button"
                onClick={() => { void loadLeads(); }}
                className="p-1.5 text-slate-500 hover:text-indigo-600 rounded-md border border-slate-200 hover:bg-slate-50 transition-colors"
                title="Refresh leads"
              >
                <RefreshIcon width={14} height={14} />
              </button>
            </div>
          </div>

          {/* Bulk Selection Header */}
          {filteredLeads.length > 0 && (
            <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100 text-xs">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filteredLeads.length > 0 && selectedIds.size === filteredLeads.length}
                  onChange={toggleSelectAll}
                  className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                />
                <span className="text-slate-600 font-semibold">
                  {selectedIds.size > 0 ? `${selectedIds.size} of ${filteredLeads.length} selected` : `Showing ${filteredLeads.length} lead(s)`}
                </span>
              </div>

              {selectedIds.size > 0 && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => { void handleBulkDelete(); }}
                  className="text-[11px] px-2.5 py-1 font-bold flex items-center gap-1.5 bg-red-600 hover:bg-red-700 text-white"
                >
                  <TrashIcon width={13} height={13} />
                  Delete {selectedIds.size} Selected
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cards Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <LoaderIcon width={32} height={32} className="animate-spin text-indigo-600" />
          <span className="text-sm font-semibold text-slate-500">Loading candidate profile records...</span>
        </div>
      ) : filteredLeads.length === 0 ? (
        <Card className="py-16 border-dashed border-2 border-slate-200 flex flex-col items-center justify-center text-slate-400">
          <UsersIcon width={40} height={40} className="text-slate-300 mb-2" />
          <div className="text-base font-bold text-slate-700 mb-1">No leads match your search or filter criteria</div>
          <div className="text-xs text-slate-400">Try adjusting your top search query or custom date filter.</div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredLeads.map((lead) => {
            const createdDateStr = new Date(lead.createdAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            });

            // Extract LinkedIn URL if present
            const linkedInUrl =
              lead.portfolioUrl?.includes('linkedin.com')
                ? lead.portfolioUrl
                : (lead.additionalUrls ?? []).find((u) => u.includes('linkedin.com')) ||
                  (lead.rawText?.match(/https?:\/\/[a-z0-9.]*linkedin\.com\/[^\s]+/i)?.[0] ?? null);

            const verifiedMap = new Map<string, VerifiedEmailItem['status']>();
            (lead.verifiedEmails ?? []).forEach((v) => verifiedMap.set(v.email, v.status));

            const personalEmails = Array.from(
              new Set([...(lead.discoveredEmails ?? []), ...(lead.email ? [lead.email] : [])])
            );

            const companiesList: CurrentCompanyItem[] =
              (lead.currentCompanies?.length ?? 0) > 0
                ? lead.currentCompanies!
                : [
                    {
                      companyName: lead.companyName || 'Corporate Profile',
                      jobTitle: lead.jobTitle || 'Professional',
                      workPeriod: null,
                      websiteUrl: lead.websiteUrl || null,
                      summary: '',
                    },
                  ];

            return (
              <Card
                key={lead._id}
                className="border border-slate-200 shadow-xs hover:shadow-md transition-all bg-white overflow-hidden flex flex-col rounded-lg"
              >
                {/* Lead Header */}
                <CardHeader
                  title={
                    <div className="flex items-start justify-between gap-2 w-full">
                      <div className="flex items-start gap-2 flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(lead._id)}
                          onChange={() => toggleSelect(lead._id)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 mt-1 shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-base font-extrabold text-slate-900 leading-snug truncate">
                            {lead.fullName || 'Candidate Profile'}
                          </div>

                          <div className="flex items-center gap-1.5 flex-wrap mt-1">
                            {lead.clientName && (
                              <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full">
                                🏢 {lead.clientName}
                              </span>
                            )}
                            <span className="text-[10px] font-semibold text-slate-400">
                              {createdDateStr}
                            </span>
                          </div>

                          {linkedInUrl && (
                            <a
                              href={linkedInUrl.startsWith('http') ? linkedInUrl : `https://${linkedInUrl}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[11px] font-semibold text-blue-600 hover:underline flex items-center gap-1 mt-1 truncate"
                            >
                              <GlobeIcon width={10} height={10} className="text-blue-500 shrink-0" />
                              <span className="truncate">{linkedInUrl.replace(/^https?:\/\//, '')}</span>
                              <ExternalLinkIcon width={9} height={9} className="shrink-0" />
                            </a>
                          )}
                        </div>
                      </div>

                      {/* Single Delete Button */}
                      <button
                        type="button"
                        disabled={deletingId === lead._id}
                        onClick={() => { void handleDeleteLead(lead._id, lead.fullName || 'Candidate'); }}
                        className="text-slate-400 hover:text-red-600 p-1 rounded transition-colors shrink-0 disabled:opacity-40"
                        title="Delete lead"
                      >
                        {deletingId === lead._id ? (
                          <LoaderIcon width={13} height={13} className="animate-spin text-red-500" />
                        ) : (
                          <TrashIcon width={14} height={14} />
                        )}
                      </button>
                    </div>
                  }
                />

                <CardContent className="pt-2 flex-1 flex flex-col justify-between space-y-3 text-xs">
                  {/* SUB-BOX 1: Personal Profile & Direct Emails */}
                  <div className="border border-blue-200 bg-blue-50/20 rounded-md p-3 space-y-2">
                    <div className="flex items-center justify-between border-b border-blue-100 pb-1.5">
                      <span className="text-[11px] font-extrabold text-blue-950 flex items-center gap-1">
                        👤 Personal Profile
                      </span>
                      {lead.approved ? (
                        <Badge tone="success">✓ Draft Approved</Badge>
                      ) : (
                        <Badge tone="neutral">⏳ Approval Pending</Badge>
                      )}
                    </div>

                    {personalEmails.length > 0 ? (
                      <div className="space-y-1">
                        {personalEmails.map((em) => {
                          const status = verifiedMap.get(em) ?? lead.emailValidationStatus;
                          return (
                            <div key={em} className="flex items-center justify-between bg-white border border-slate-200 rounded px-2 py-1 gap-1.5">
                              <span className="text-[11px] font-mono font-semibold text-slate-800 truncate">{em}</span>
                              <SmtpBadge status={status} />
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between bg-amber-50/80 border border-amber-200 rounded px-2 py-1 text-[11px]">
                        <span className="text-amber-800 italic">No personal email mapped</span>
                        <Badge tone="warning">⚠️ No Personal Email</Badge>
                      </div>
                    )}
                  </div>

                  {/* SUB-BOXES 2+: Company Sub-Boxes */}
                  <div className="space-y-2">
                    {companiesList.map((comp, idx) => {
                      const compEmails = comp.companyEmails ?? [];
                      const primaryCompEmail = compEmails[0] || '';
                      const compSmtpStatus = primaryCompEmail ? (verifiedMap.get(primaryCompEmail) ?? 'pending') : null;

                      return (
                        <div key={idx} className="border border-purple-200 bg-purple-50/20 rounded-md p-3 space-y-2">
                          <div className="flex items-center justify-between border-b border-purple-100 pb-1.5 gap-1">
                            <div className="min-w-0 flex-1">
                              <span className="text-[11px] font-extrabold text-purple-950 truncate block">
                                🏢 {comp.companyName}
                              </span>
                              {comp.jobTitle && (
                                <span className="text-[10px] font-semibold text-indigo-600 block truncate">
                                  {comp.jobTitle}
                                </span>
                              )}
                            </div>
                            {comp.approved ? (
                              <Badge tone="success">✓ Draft Approved</Badge>
                            ) : (
                              <Badge tone="neutral">⏳ Approval Pending</Badge>
                            )}
                          </div>

                          {compEmails.length > 0 ? (
                            <div className="space-y-1">
                              {compEmails.map((em) => {
                                const status = verifiedMap.get(em) ?? compSmtpStatus;
                                return (
                                  <div key={em} className="flex items-center justify-between bg-white border border-slate-200 rounded px-2 py-1 gap-1.5">
                                    <span className="text-[11px] font-mono font-semibold text-slate-800 truncate">{em}</span>
                                    <SmtpBadge status={status} />
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="flex items-center justify-between bg-amber-50/80 border border-amber-200 rounded px-2 py-1 text-[11px]">
                              <span className="text-amber-800 italic">No contact email for this company</span>
                              <Badge tone="warning">⚠️ No Company Email</Badge>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Card Action Footer */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 mt-auto">
                    <span className="text-[10px] text-slate-400 font-semibold">ID: #{lead._id.slice(-6)}</span>
                    <button
                      type="button"
                      onClick={() => router.push(`/lead-ingestion/client/${lead._id}`)}
                      className="text-xs font-bold text-indigo-700 hover:text-indigo-900 flex items-center gap-1 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-md transition-colors"
                    >
                      View Candidate Workspace <ExternalLinkIcon width={11} height={11} />
                    </button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Floating Toast Notification Container (Top Right & Compact) */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-xs sm:max-w-sm w-full pointer-events-none px-4 sm:px-0">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={[
              'pointer-events-auto flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-lg shadow-xl border backdrop-blur-md transition-all duration-300 animate-in fade-in slide-in-from-top-3 text-xs font-semibold',
              t.type === 'error'
                ? 'bg-slate-900/95 text-red-200 border-red-500/50 shadow-red-950/40'
                : t.type === 'success'
                ? 'bg-slate-900/95 text-emerald-200 border-emerald-500/50 shadow-emerald-950/40'
                : 'bg-slate-900/95 text-slate-200 border-slate-700 shadow-slate-950/40',
            ].join(' ')}
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              {t.type === 'error' && <AlertTriangleIcon width={15} height={15} className="text-red-400 shrink-0" />}
              {t.type === 'success' && <CheckCircleIcon width={15} height={15} className="text-emerald-400 shrink-0" />}
              {t.type === 'info' && <SparklesIcon width={15} height={15} className="text-indigo-400 shrink-0" />}
              <span className="text-[11px] font-semibold leading-tight break-words text-slate-100">{t.message}</span>
            </div>
            <button
              type="button"
              onClick={() => removeToast(t.id)}
              className="text-slate-400 hover:text-white p-0.5 rounded transition-colors shrink-0"
              title="Dismiss notification"
            >
              <XIcon width={12} height={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
