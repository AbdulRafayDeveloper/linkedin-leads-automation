'use client';

import { useEffect, useState } from 'react';
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
} from '@/components/ui/Icons';
import { updateLeadDetailsApi, type VerifiedEmailItem, type CurrentCompanyItem } from '@/services/lead-ingestion/apiClient';

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
  currentCompanies?: CurrentCompanyItem[];
  discoveredEmails?: string[];
  verifiedEmails?: VerifiedEmailItem[];
  emailSubject?: string | null;
  emailBody?: string | null;
  approved?: boolean;
  emailStatus?: 'pending' | 'in_progress' | 'delivered' | 'opened' | 'failed';
  emailValidationStatus?: 'pending' | 'valid' | 'invalid' | 'risky' | 'unknown';
  createdAt: string;
}

function SmtpBadge({ status }: { status: VerifiedEmailItem['status'] }) {
  if (status === 'valid') return <Badge tone="success">Verified SMTP</Badge>;
  if (status === 'invalid') return <Badge tone="danger">Invalid</Badge>;
  if (status === 'risky') return <Badge tone="warning">Risky</Badge>;
  return <Badge tone="neutral">Unverified</Badge>;
}

export default function DashboardPage() {
  const router = useRouter();

  const [leads, setLeads] = useState<IngestedLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const loadLeads = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/leads');
      if (!res.ok) throw new Error('Failed to fetch leads');
      const data = (await res.json()) as { leads?: IngestedLead[] };
      setLeads(data.leads ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load leads');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLeads();
  }, []);

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} selected lead(s)? This cannot be undone.`)) return;

    try {
      const res = await fetch('/api/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (!res.ok) throw new Error('Failed to delete leads');
      setSelectedIds(new Set());
      void loadLeads();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete selected leads');
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

  // Search filter
  const filteredLeads = leads.filter((l) => {
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      const matchName = (l.fullName || '').toLowerCase().includes(q);
      const matchComp = (l.companyName || '').toLowerCase().includes(q);
      const matchEmail = (l.email || '').toLowerCase().includes(q) || (l.discoveredEmails ?? []).some((e) => e.toLowerCase().includes(q));
      if (!matchName && !matchComp && !matchEmail) return false;
    }
    return true;
  });

  return (
    <div className="w-full max-w-none px-4 sm:px-8 py-8 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="My Ingested Leads"
          description="Browse candidate lead intelligence, company websites, verified emails, and profile details."
        />
        <div className="flex items-center gap-3">
          <Link href="/lead-ingestion">
            <Button className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm flex items-center gap-2">
              <SparklesIcon width={15} height={15} />
              Ingest New Lead
            </Button>
          </Link>
          <Link href="/lead-ingestion/emails">
            <Button variant="outline" className="flex items-center gap-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-sm">
              <MailIcon width={15} height={15} />
              Outreach Emails
            </Button>
          </Link>
        </div>
      </div>

      {error && (
        <div className="flex gap-2.5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangleIcon width={15} height={15} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Clean Candidate Search Bar */}
      <Card className="border border-slate-200 bg-white shadow-2xs">
        <CardContent className="py-3.5 px-4">
          <div className="flex items-center justify-between gap-3">
            <input
              type="text"
              placeholder="Search candidate name, company, or email address..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="text-xs border border-slate-200 rounded-md px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none w-80 bg-white"
            />

            {selectedIds.size > 0 && (
              <Button type="button" variant="destructive" size="sm" onClick={() => { void handleBulkDelete(); }}>
                <TrashIcon width={14} height={14} />
                Delete {selectedIds.size} selected
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Cards Grid */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <LoaderIcon width={28} height={28} className="animate-spin text-indigo-600" />
          <span className="text-sm font-semibold text-slate-500">Loading ingested leads...</span>
        </div>
      ) : filteredLeads.length === 0 ? (
        <Card className="py-12 border-dashed border-2 border-slate-200 flex flex-col items-center justify-center text-slate-400">
          <UsersIcon width={36} height={36} className="text-slate-300 mb-2" />
          <div className="text-sm font-semibold text-slate-600 mb-1">No ingested leads found.</div>
          <div className="text-xs text-slate-400">Paste LinkedIn raw text in Client Ingestion to create new lead records.</div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredLeads.map((lead) => {
            const verifiedStatus = lead.emailValidationStatus ?? 'pending';
            const primaryCompany = lead.currentCompanies?.[0];

            return (
              <Card key={lead._id} className="border border-slate-200 shadow-2xs hover:shadow-md transition-all bg-white overflow-hidden flex flex-col">
                <CardHeader
                  title={
                    <div className="flex items-start justify-between gap-2 w-full">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(lead._id)}
                          onChange={() => toggleSelect(lead._id)}
                          className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                        />
                        <div>
                          <div className="text-base font-extrabold text-slate-900 leading-snug">
                            {lead.fullName || 'Candidate Profile'}
                          </div>
                          {lead.clientName && (
                            <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded-full inline-block mt-0.5">
                              {lead.clientName}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  }
                />

                <CardContent className="pt-2 flex-1 flex flex-col justify-between space-y-3">
                  {/* Company & Title */}
                  <div className="space-y-1 bg-slate-50 border border-slate-100 p-2.5 rounded-md">
                    <div className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <span>🏢 {lead.companyName || primaryCompany?.companyName || 'Corporate Profile'}</span>
                    </div>
                    {lead.jobTitle && (
                      <div className="text-[11px] font-semibold text-indigo-600">
                        {lead.jobTitle}
                      </div>
                    )}
                    {lead.websiteUrl && (
                      <a
                        href={lead.websiteUrl.startsWith('http') ? lead.websiteUrl : `https://${lead.websiteUrl}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] font-semibold text-slate-500 hover:underline flex items-center gap-1 mt-1"
                      >
                        <GlobeIcon width={10} height={10} />
                        {lead.websiteUrl.replace(/^https?:\/\//, '').split('/')[0]}
                      </a>
                    )}
                  </div>

                  {/* Email & SMTP Status */}
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Primary Email</span>
                    {lead.email ? (
                      <div className="flex items-center justify-between bg-white border border-slate-200 rounded px-2.5 py-1.5 gap-1.5">
                        <span className="text-[11px] font-mono font-semibold text-slate-800 truncate">{lead.email}</span>
                        <SmtpBadge status={verifiedStatus} />
                      </div>
                    ) : (
                      <div className="text-[11px] italic text-slate-400">No primary email mapped yet</div>
                    )}
                  </div>

                  {/* Footer Bar & Action */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2 mt-auto">
                    <button
                      type="button"
                      onClick={() => router.push(`/lead-ingestion/client/${lead._id}`)}
                      className="text-xs font-bold text-indigo-600 hover:text-indigo-800 flex items-center gap-1 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded transition-colors"
                    >
                      View Client Profile <ExternalLinkIcon width={11} height={11} />
                    </button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
