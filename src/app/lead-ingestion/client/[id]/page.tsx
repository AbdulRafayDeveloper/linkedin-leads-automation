'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  crawlLeadWebsiteApi,
  generateLeadEmailApi,
  updateLeadDetailsApi,
  type LeadIngestionRecord,
  type VerifiedEmailItem,
  type CurrentCompanyItem,
} from '@/services/lead-ingestion/apiClient';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  LoaderIcon,
  SparklesIcon,
  RefreshIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  ExternalLinkIcon,
  GlobeIcon,
  EditIcon,
  ArrowLeftIcon,
} from '@/components/ui/Icons';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PipelineState {
  leadId: string;
  clientId: string | null;
  clientName: string | null;
  phase: 1 | 2 | 3 | 4 | 'done';
  running: boolean;
  error: string | null;
  mappedCompanies: CurrentCompanyItem[] | null;
  portfolioUrl: string | null;
  crawledEmails: string[];
  crawledPhones: string[];
  verifiedEmails: Array<{ email: string; status: VerifiedEmailItem['status'] }>;
  finalLead: LeadIngestionRecord | null;
}

// ── Helper: read SSE stream ───────────────────────────────────────────────────

async function readStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: unknown) => void
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split('\n\n');
    buf = chunks.pop() ?? '';

    for (const chunk of chunks) {
      const eventMatch = chunk.match(/^event:\s*(.+)/m);
      const dataMatch = chunk.match(/^data:\s*([\s\S]+)/m);
      if (!eventMatch || !dataMatch) continue;
      try {
        onEvent(eventMatch[1].trim(), JSON.parse(dataMatch[1].trim()));
      } catch { /* ignore */ }
    }
  }
}

// ── Helper: Strict Email Deduplication Across Sub-Boxes ───────────────────────

function getCategorizedEmails(
  companies: CurrentCompanyItem[],
  allDiscoveredEmails: string[]
) {
  const companyEmailMap = new Map<number, string[]>();
  const assignedSet = new Set<string>();

  // 1. First: Explicit company emails assigned to specific companies
  companies.forEach((comp, idx) => {
    const explicit = comp.companyEmails ?? [];
    const uniqueExplicit = explicit.filter((e) => !assignedSet.has(e.toLowerCase()));
    uniqueExplicit.forEach((e) => assignedSet.add(e.toLowerCase()));
    companyEmailMap.set(idx, uniqueExplicit);
  });

  // 2. Next: Match unassigned discovered emails by domain to company websites
  companies.forEach((comp, idx) => {
    if (!comp.websiteUrl) return;
    let domain = '';
    try {
      domain = new URL(comp.websiteUrl.startsWith('http') ? comp.websiteUrl : `https://${comp.websiteUrl}`).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      domain = (comp.websiteUrl || '').toLowerCase();
    }
    if (!domain) return;

    const remainingDiscovered = allDiscoveredEmails.filter((e) => !assignedSet.has(e.toLowerCase()));
    const matched = remainingDiscovered.filter((e) => {
      const emDomain = (e.split('@')[1] || '').toLowerCase();
      return domain.includes(emDomain) || emDomain.includes(domain);
    });

    matched.forEach((e) => assignedSet.add(e.toLowerCase()));
    const existing = companyEmailMap.get(idx) ?? [];
    companyEmailMap.set(idx, Array.from(new Set([...existing, ...matched])));
  });

  // 3. Remaining unassigned emails belong strictly to Personal Profile
  const personalEmails = allDiscoveredEmails.filter((e) => !assignedSet.has(e.toLowerCase()));

  return { companyEmailMap, personalEmails };
}

// ── Components ────────────────────────────────────────────────────────────────

function SmtpBadge({ status }: { status: VerifiedEmailItem['status'] }) {
  if (status === 'valid') return <Badge tone="success">Verified SMTP</Badge>;
  if (status === 'invalid') return <Badge tone="danger">Invalid</Badge>;
  if (status === 'risky') return <Badge tone="warning">Risky</Badge>;
  return <Badge tone="neutral">Unverified</Badge>;
}

function StepBadge({ n, label, done, active }: { n: number; label: string; done: boolean; active: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className={[
          'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-extrabold shrink-0 transition-all',
          done ? 'bg-green-500 text-white' : active ? 'bg-indigo-500 text-white animate-pulse' : 'bg-slate-200 text-slate-500',
        ].join(' ')}
      >
        {done ? '✓' : n}
      </div>
      <span className={['text-xs font-semibold', done ? 'text-green-700' : active ? 'text-indigo-700' : 'text-slate-400'].join(' ')}>
        {label}
      </span>
    </div>
  );
}

function PhaseSteps({ phase, running }: { phase: 1 | 2 | 3 | 4 | 'done'; running: boolean }) {
  const currentStep = phase === 'done' ? 5 : phase;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-white border border-slate-200 rounded-lg p-4">
      {[
        { n: 1, label: 'AI Extraction' },
        { n: 2, label: 'URL Mapping' },
        { n: 3, label: 'Web Crawl' },
        { n: 4, label: 'SMTP Verify' },
      ].map((s, i) => (
        <span key={s.n} className="flex items-center gap-1.5">
          <StepBadge n={s.n} label={s.label} done={currentStep > s.n} active={currentStep === s.n && running} />
          {i < 3 && <span className="text-slate-300 text-xs">→</span>}
        </span>
      ))}
      {running && (
        <div className="flex items-center gap-2 text-xs text-indigo-600 font-semibold ml-auto">
          <LoaderIcon width={12} height={12} className="animate-spin" />
          Processing step {typeof phase === 'number' ? phase : ''}...
        </div>
      )}
    </div>
  );
}

interface ClientPageProps {
  params: Promise<{ id: string }>;
}

export default function ClientProfilePage({ params }: ClientPageProps) {
  const { id } = use(params);

  const [lead, setLead] = useState<LeadIngestionRecord | null>(null);
  const [pipeline, setPipeline] = useState<PipelineState | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [editingWebIndex, setEditingWebIndex] = useState<number | null>(null);
  const [customWebInput, setCustomWebInput] = useState('');
  const [crawlingCompIndex, setCrawlingCompIndex] = useState<number | null>(null);

  const [editingPersonalWeb, setEditingPersonalWeb] = useState(false);
  const [customPersonalWebInput, setCustomPersonalWebInput] = useState('');
  const [crawlingPersonalWeb, setCrawlingPersonalWeb] = useState(false);

  // Email Editors (Comma-Separated String state)
  const [editingCompanyEmailIndex, setEditingCompanyEmailIndex] = useState<number | null>(null);
  const [companyEmailsInput, setCompanyEmailsInput] = useState('');
  const [savingCompanyEmails, setSavingCompanyEmails] = useState(false);

  const [editingPersonalEmails, setEditingPersonalEmails] = useState(false);
  const [personalEmailsInput, setPersonalEmailsInput] = useState('');
  const [savingPersonalEmails, setSavingPersonalEmails] = useState(false);

  const [editingDraftIndex, setEditingDraftIndex] = useState<number | null>(null);
  const [draftSubjectInput, setDraftSubjectInput] = useState('');
  const [draftBodyInput, setDraftBodyInput] = useState('');
  const [savingDraftIndex, setSavingDraftIndex] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);

  async function callPhase(
    phase: 'extract' | 'map' | 'crawl' | 'verify',
    body: Record<string, unknown>
  ) {
    const res = await fetch('/api/lead-ingestion/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase, ...body }),
    });
    if (!res.ok || !res.body) throw new Error(`Stream error ${res.status}`);
    return res.body;
  }

  useEffect(() => {
    let isMounted = true;

    async function init() {
      try {
        setLoading(true);
        const res = await fetch(`/api/lead-ingestion/${id}`);
        if (!res.ok) {
          throw new Error('Failed to load candidate record');
        }
        const data = (await res.json()) as { lead?: LeadIngestionRecord; result?: LeadIngestionRecord };
        const fetchedLead = data.lead || data.result;

        if (fetchedLead && isMounted) {
          setLead(fetchedLead);

          if (!fetchedLead.emailSubject && fetchedLead.status !== 'completed') {
            void runAutoPipeline(fetchedLead._id);
          }
        }
      } catch (err) {
        if (isMounted) setPageError(err instanceof Error ? err.message : 'Failed to load candidate');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    void init();
    return () => { isMounted = false; };
  }, [id]);

  const runAutoPipeline = async (targetLeadId: string) => {
    setPipeline({
      leadId: targetLeadId,
      clientId: null,
      clientName: null,
      phase: 2,
      running: true,
      error: null,
      mappedCompanies: null,
      portfolioUrl: null,
      crawledEmails: [],
      crawledPhones: [],
      verifiedEmails: [],
      finalLead: null,
    });

    try {
      const mapBody = await callPhase('map', { leadId: targetLeadId });
      let mappedCompanies: CurrentCompanyItem[] | null = null;
      let portfolioUrl: string | null = null;

      await readStream(mapBody, (event, data) => {
        const d = data as Record<string, unknown>;
        if (event === 'mapped') {
          mappedCompanies = (d.mappedCompanies ?? null) as CurrentCompanyItem[] | null;
          portfolioUrl = (d.portfolioUrl ?? null) as string | null;
        }
      });

      setPipeline((prev) => prev ? ({ ...prev, phase: 3, mappedCompanies, portfolioUrl }) : null);

      const hasWebsitesToCrawl = (mappedCompanies as CurrentCompanyItem[] | null ?? []).some((c: CurrentCompanyItem) => Boolean(c.websiteUrl)) || !!portfolioUrl;

      if (hasWebsitesToCrawl) {
        const crawlBody = await callPhase('crawl', { leadId: targetLeadId });
        let crawledEmails: string[] = [];
        let crawledPhones: string[] = [];

        await readStream(crawlBody, (event, data) => {
          const d = data as Record<string, unknown>;
          if (event === 'phase_done' && (d.step as number) === 3) {
            crawledEmails = (d.emails ?? []) as string[];
            crawledPhones = (d.phones ?? []) as string[];
          }
          if (event === 'crawled') {
            crawledEmails = [...new Set([...crawledEmails, ...((d.emails ?? []) as string[])])];
            crawledPhones = [...new Set([...crawledPhones, ...((d.phones ?? []) as string[])])];
          }
        });

        setPipeline((prev) => prev ? ({ ...prev, phase: 4, crawledEmails, crawledPhones }) : null);

        const verifyBody = await callPhase('verify', { leadId: targetLeadId });
        let finalLead: LeadIngestionRecord | null = null;

        await readStream(verifyBody, (event, data) => {
          const d = data as Record<string, unknown>;
          if (event === 'verified') {
            setPipeline((prev) => prev ? ({
              ...prev,
              verifiedEmails: [...prev.verifiedEmails, { email: d.email as string, status: d.status as VerifiedEmailItem['status'] }],
            }) : null);
          }
          if (event === 'done') finalLead = d.result as LeadIngestionRecord;
        });

        try {
          const emailRes = await generateLeadEmailApi(targetLeadId);
          finalLead = emailRes.result;
        } catch { /* ignore */ }

        if (finalLead) setLead(finalLead);

        setPipeline((prev) => prev ? ({ ...prev, running: false, phase: 'done', finalLead }) : null);
      } else {
        setPipeline((prev) => prev ? ({ ...prev, running: false }) : null);
      }
    } catch (err) {
      setPipeline((p) => p ? ({ ...p, running: false, error: err instanceof Error ? err.message : 'Pipeline failed' }) : null);
    }
  };

  const handleCompanyCrawl = async (companyIndex: number, newUrl: string) => {
    if (!newUrl.trim() || !id) return;
    setCrawlingCompIndex(companyIndex);
    setPageError(null);
    try {
      const updatedCompanies = [...companies];
      updatedCompanies[companyIndex] = {
        ...updatedCompanies[companyIndex],
        websiteUrl: newUrl.trim(),
      };

      await updateLeadDetailsApi(id, {
        currentCompanies: updatedCompanies,
        websiteUrl: updatedCompanies[0]?.websiteUrl ?? lead?.websiteUrl,
      });

      const crawlRes = await crawlLeadWebsiteApi(id, newUrl.trim());
      setLead(crawlRes.result);
      setEditingWebIndex(null);
      setCustomWebInput('');
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to crawl company website');
    } finally {
      setCrawlingCompIndex(null);
    }
  };

  const handlePersonalPortfolioCrawl = async (newUrl: string) => {
    if (!newUrl.trim() || !id) return;
    setCrawlingPersonalWeb(true);
    setPageError(null);
    try {
      await updateLeadDetailsApi(id, { portfolioUrl: newUrl.trim() });
      const crawlRes = await crawlLeadWebsiteApi(id, newUrl.trim());
      setLead(crawlRes.result);
      setEditingPersonalWeb(false);
      setCustomPersonalWebInput('');
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to crawl personal website');
    } finally {
      setCrawlingPersonalWeb(false);
    }
  };

  // Save edited company emails (Validates duplicates across other boxes!)
  const handleSaveCompanyEmails = async (companyIndex: number) => {
    if (!id) return;
    setSavingCompanyEmails(true);
    setPageError(null);
    try {
      const parsedEmails = companyEmailsInput
        .split(/[,;\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes('@'));

      // Check for duplicate emails existing in OTHER company sub-boxes or personal profile
      const otherBoxesEmails = new Set<string>();
      companies.forEach((comp, idx) => {
        if (idx !== companyIndex) {
          (comp.companyEmails ?? []).forEach((e) => otherBoxesEmails.add(e.toLowerCase()));
        }
      });
      personalEmails.forEach((e) => otherBoxesEmails.add(e.toLowerCase()));

      const duplicates = parsedEmails.filter((e) => otherBoxesEmails.has(e));
      if (duplicates.length > 0) {
        setPageError(`Email "${duplicates.join(', ')}" already exists in another sub-box! Duplicate emails across boxes are not allowed.`);
        setSavingCompanyEmails(false);
        return;
      }

      const updatedCompanies = [...companies];
      updatedCompanies[companyIndex] = {
        ...updatedCompanies[companyIndex],
        companyEmails: Array.from(new Set(parsedEmails)),
      };

      const res = await updateLeadDetailsApi(id, {
        currentCompanies: updatedCompanies,
      });
      setLead(res.result);
      setEditingCompanyEmailIndex(null);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to save company emails');
    } finally {
      setSavingCompanyEmails(false);
    }
  };

  // Save edited personal emails (Validates duplicates across company boxes!)
  const handleSavePersonalEmails = async () => {
    if (!id) return;
    setSavingPersonalEmails(true);
    setPageError(null);
    try {
      const parsedEmails = personalEmailsInput
        .split(/[,;\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes('@'));

      // Check for duplicate emails existing in company boxes
      const companyEmailsSet = new Set<string>();
      companies.forEach((comp) => {
        (comp.companyEmails ?? []).forEach((e) => companyEmailsSet.add(e.toLowerCase()));
      });

      const duplicates = parsedEmails.filter((e) => companyEmailsSet.has(e));
      if (duplicates.length > 0) {
        setPageError(`Email "${duplicates.join(', ')}" is already assigned to a Company sub-box! Duplicate emails across boxes are not allowed.`);
        setSavingPersonalEmails(false);
        return;
      }

      const res = await updateLeadDetailsApi(id, {
        discoveredEmails: Array.from(new Set(parsedEmails)),
      });
      setLead(res.result);
      setEditingPersonalEmails(false);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to save personal emails');
    } finally {
      setSavingPersonalEmails(false);
    }
  };

  const handleToggleApproveDraft = async (companyIndex: number) => {
    if (!id) return;
    setPageError(null);
    try {
      const updatedCompanies = [...companies];
      const comp = updatedCompanies[companyIndex];

      const compEmails = companyEmailMap.get(companyIndex) ?? [];
      const primaryEmail = compEmails[0] || lead?.email || '';
      const emailStatus = verifiedMap.get(primaryEmail);

      if (!comp.approved) {
        if (!primaryEmail || emailStatus !== 'valid') {
          setPageError('Cannot approve email draft! Target contact email must be entered and SMTP verified as valid before approval.');
          return;
        }
      }

      comp.approved = !comp.approved;

      const res = await updateLeadDetailsApi(id, {
        currentCompanies: updatedCompanies,
        approved: updatedCompanies[0]?.approved ?? lead?.approved,
      });
      setLead(res.result);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to update approval');
    }
  };

  const handleSaveCompanyDraftEmail = async (companyIndex: number) => {
    if (!id) return;
    setSavingDraftIndex(companyIndex);
    try {
      const updatedCompanies = [...companies];
      updatedCompanies[companyIndex] = {
        ...updatedCompanies[companyIndex],
        emailSubject: draftSubjectInput,
        emailBody: draftBodyInput,
      };

      const res = await updateLeadDetailsApi(id, {
        currentCompanies: updatedCompanies,
        emailSubject: updatedCompanies[0]?.emailSubject ?? lead?.emailSubject,
        emailBody: updatedCompanies[0]?.emailBody ?? lead?.emailBody,
      });
      setLead(res.result);
      setEditingDraftIndex(null);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to save email draft');
    } finally {
      setSavingDraftIndex(null);
    }
  };

  const handleRegenerateAllEmails = async () => {
    if (!id) return;
    setGenerating(true);
    try {
      const res = await generateLeadEmailApi(id);
      setLead(res.result);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to generate email');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <LoaderIcon width={32} height={32} className="animate-spin text-indigo-600" />
        <span className="text-sm font-semibold text-slate-600">Loading Candidate Profile Workspace...</span>
      </div>
    );
  }

  const fullName = lead?.fullName || 'Candidate Profile';
  const personSummary = lead?.summary || '';
  const portfolioUrl = lead?.portfolioUrl || pipeline?.portfolioUrl || null;

  const isGlobalCrawlRunning = (pipeline?.running && pipeline?.phase === 3);
  const isGlobalVerifyRunning = (pipeline?.running && pipeline?.phase === 4);
  const isAnyCrawlActive = (crawlingCompIndex !== null) || crawlingPersonalWeb || isGlobalCrawlRunning;

  const companies: CurrentCompanyItem[] =
    lead?.currentCompanies?.length
      ? lead.currentCompanies
      : pipeline?.mappedCompanies?.length
      ? pipeline.mappedCompanies
      : [
          {
            companyName: 'Unspecified Company',
            jobTitle: 'Professional',
            workPeriod: null,
            websiteUrl: null,
            roleSummary: '',
          },
        ];

  const verifiedMap = new Map<string, VerifiedEmailItem['status']>();
  if (lead?.verifiedEmails) {
    lead.verifiedEmails.forEach((v) => verifiedMap.set(v.email, v.status));
  } else if (pipeline?.verifiedEmails) {
    pipeline.verifiedEmails.forEach((v) => verifiedMap.set(v.email, v.status));
  }

  const allDiscoveredEmails = Array.from(
    new Set([
      ...(lead?.email ? [lead.email] : []),
      ...(lead?.discoveredEmails ?? pipeline?.crawledEmails ?? []),
    ])
  );

  const { companyEmailMap, personalEmails } = getCategorizedEmails(companies, allDiscoveredEmails);
  const personalPhones = Array.from(new Set<string>([...(lead?.discoveredPhones ?? []), ...(pipeline?.crawledPhones ?? [])]));

  return (
    <div className="w-full max-w-none px-4 sm:px-8 py-6 space-y-6">
      {/* Top Bar Navigation */}
      <div className="flex items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="flex items-center gap-3">
          <Link href="/lead-ingestion">
            <Button variant="outline" size="sm" className="flex items-center gap-1.5 text-xs text-slate-600 border-slate-300 hover:bg-slate-50">
              <ArrowLeftIcon width={14} height={14} /> Back to Ingestion
            </Button>
          </Link>
          <PageHeader
            title={`${fullName}`}
            description="Candidate Profile & Lead Intelligence Workspace"
          />
        </div>


      </div>

      {pageError && (
        <div className="flex gap-2.5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangleIcon width={15} height={15} className="shrink-0 mt-0.5" />
          {pageError}
        </div>
      )}

      {/* Step Progress Indicator */}
      <PhaseSteps phase={pipeline?.phase ?? 'done'} running={!!pipeline?.running} />

      {/* Candidate Profile Details & Summary */}
      <Card className="border border-indigo-200/90 shadow-sm bg-white overflow-hidden w-full">
        <CardHeader
          title={
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 w-full">
              <div className="flex items-center gap-2">
                <span className="text-xl font-extrabold text-slate-900">{fullName}</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                  Lead ID: #{id.slice(-6)}
                </span>
              </div>
              <div className="text-xs font-semibold text-slate-500">
                Present Working Companies ({companies.length})
              </div>
            </div>
          }
        />

        <CardContent className="pt-3 space-y-4">
          {personSummary && (
            <p className="text-xs text-slate-700 bg-slate-50 border border-slate-200/80 rounded-md px-3.5 py-3 leading-relaxed font-medium">
              {personSummary}
            </p>
          )}

          {/* ALWAYS-PRESENT PERSONAL PROFILE & PORTFOLIO SUB-BOX */}
          <div className="border border-blue-200 bg-blue-50/20 rounded-lg p-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 border-b border-blue-100 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900 flex items-center gap-1.5">
                  👤 Personal Profile & Direct Info
                </h3>
                <div className="text-xs text-blue-700 font-semibold mt-0.5">
                  Candidate Portfolio & Personal Contact Records
                </div>
              </div>

              {/* Personal Portfolio URL Controls */}
              <div className="flex items-center gap-2 shrink-0">
                {crawlingPersonalWeb ? (
                  <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 px-3 py-1.5 rounded-md text-blue-700 text-xs font-semibold animate-pulse shadow-2xs">
                    <LoaderIcon width={13} height={13} className="animate-spin text-blue-600" />
                    Crawling personal site & extracting emails...
                  </div>
                ) : (
                  <>
                    {portfolioUrl && !editingPersonalWeb && (
                      <div className="flex items-center gap-1.5 bg-white border border-blue-200 px-2.5 py-1 rounded-md shadow-2xs">
                        <a
                          href={portfolioUrl.startsWith('http') ? portfolioUrl : `https://${portfolioUrl}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:underline"
                        >
                          <GlobeIcon width={11} height={11} className="text-blue-500" />
                          {portfolioUrl.replace(/^https?:\/\//, '').split('/')[0]}
                          <ExternalLinkIcon width={9} height={9} />
                        </a>
                        <button
                          type="button"
                          title="Edit Personal Portfolio URL"
                          disabled={isAnyCrawlActive}
                          onClick={() => {
                            setEditingPersonalWeb(true);
                            setCustomPersonalWebInput(portfolioUrl || '');
                          }}
                          className="text-slate-400 hover:text-blue-600 p-0.5 rounded transition-colors ml-1 disabled:opacity-30"
                        >
                          <EditIcon width={13} height={13} />
                        </button>
                      </div>
                    )}

                    {(!portfolioUrl || editingPersonalWeb) && (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="url"
                          placeholder="Enter personal portfolio URL..."
                          value={editingPersonalWeb ? customPersonalWebInput : portfolioUrl || ''}
                          onChange={(e) => setCustomPersonalWebInput(e.target.value)}
                          disabled={isAnyCrawlActive}
                          className="text-xs border border-blue-200 rounded px-2.5 py-1 focus:ring-1 focus:ring-blue-500 focus:outline-none w-64 bg-white disabled:opacity-50"
                        />
                        <Button
                          size="sm"
                          onClick={() => { void handlePersonalPortfolioCrawl(customPersonalWebInput); }}
                          disabled={isAnyCrawlActive || !customPersonalWebInput.trim()}
                          className="bg-blue-600 hover:bg-blue-700 text-white text-[11px] px-2.5 py-1 font-semibold flex items-center gap-1 shrink-0 disabled:opacity-50"
                        >
                          {crawlingPersonalWeb ? <LoaderIcon width={10} height={10} className="animate-spin" /> : <RefreshIcon width={10} height={10} />}
                          Save & Crawl
                        </Button>
                        {editingPersonalWeb && (
                          <button
                            type="button"
                            disabled={isAnyCrawlActive}
                            onClick={() => setEditingPersonalWeb(false)}
                            className="text-[10px] text-slate-400 hover:text-slate-600 px-1 disabled:opacity-30"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Personal Emails & Strictly Deduplicated List */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Personal Emails</span>
                {!editingPersonalEmails && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isAnyCrawlActive}
                    onClick={() => {
                      setEditingPersonalEmails(true);
                      setPersonalEmailsInput(personalEmails.join(', '));
                    }}
                    className="text-[10px] px-2 py-0.5 border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-40 flex items-center gap-1"
                  >
                    <EditIcon width={11} height={11} />
                    Edit Personal Email(s)
                  </Button>
                )}
              </div>

              {editingPersonalEmails ? (
                <div className="flex flex-col gap-1.5 mb-2 bg-blue-50/50 p-2.5 rounded-md border border-blue-100">
                  <label className="text-[10px] font-bold text-blue-700">Edit Personal Emails (Comma-Separated):</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      placeholder="e.g. candidate@gmail.com, personal@outlook.com"
                      value={personalEmailsInput}
                      onChange={(e) => setPersonalEmailsInput(e.target.value)}
                      disabled={isAnyCrawlActive}
                      className="text-xs border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-blue-500 focus:outline-none flex-1 bg-white disabled:opacity-50 font-mono"
                    />
                    <Button
                      size="sm"
                      onClick={() => { void handleSavePersonalEmails(); }}
                      disabled={savingPersonalEmails || isAnyCrawlActive}
                      className="bg-blue-600 hover:bg-blue-700 text-white text-[11px] px-3 py-1 font-semibold flex items-center gap-1 shrink-0 disabled:opacity-50"
                    >
                      {savingPersonalEmails ? <LoaderIcon width={10} height={10} className="animate-spin" /> : <CheckCircleIcon width={10} height={10} />}
                      Save Personal Emails
                    </Button>
                    <button
                      type="button"
                      onClick={() => setEditingPersonalEmails(false)}
                      className="text-[10px] text-slate-400 hover:text-slate-600 px-1"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {personalEmails.length === 0 ? (
                    <div className="text-slate-400 italic text-[11px]">No unique personal email address mapped yet. Click Edit Personal Email(s) above.</div>
                  ) : (
                    <ul className="space-y-1">
                      {personalEmails.map((em: string) => {
                        const status = verifiedMap.get(em);
                        const isVerifyingThisEmail = isGlobalVerifyRunning || (savingPersonalEmails && personalEmailsInput.includes(em));

                        return (
                          <li key={em} className="flex items-center justify-between bg-white border border-slate-200 rounded-md px-2.5 py-1.5 gap-2">
                            <span className="text-[11px] font-semibold text-slate-800 truncate font-mono">{em}</span>
                            {isVerifyingThisEmail && !status ? (
                              <span className="flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded animate-pulse">
                                <LoaderIcon width={10} height={10} className="animate-spin text-blue-600" />
                                Verifying email...
                              </span>
                            ) : (
                              <SmtpBadge status={status ?? 'pending'} />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </div>

            {personalPhones.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1 border-t border-blue-100/60">
                {personalPhones.map((p) => (
                  <span key={p} className="bg-white border border-slate-200 text-slate-800 px-2.5 py-1 rounded-md font-mono text-[11px]">📞 {p}</span>
                ))}
              </div>
            )}
          </div>

          {/* Company Sub-Boxes Updated In-Place with Strict Email Deduplication */}
          <div className="space-y-4">
            {companies.map((c, i) => {
              const isCrawlingThis = (crawlingCompIndex === i) || (isGlobalCrawlRunning && Boolean(c.websiteUrl));
              const isEditingThis = editingWebIndex === i;
              const isEditingCompanyEmailsThis = editingCompanyEmailIndex === i;
              const isEditingDraftThis = editingDraftIndex === i;
              const isSavingDraftThis = savingDraftIndex === i;

              const compEmails = companyEmailMap.get(i) ?? [];
              const draftSubject = c.emailSubject || (i === 0 ? lead?.emailSubject : null);
              const draftBody = c.emailBody || (i === 0 ? lead?.emailBody : null);
              const isApproved = c.approved ?? (i === 0 ? lead?.approved : false);

              return (
                <div key={i} className="border border-purple-200 bg-purple-50/20 rounded-lg p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 border-b border-purple-100 pb-3">
                    <div>
                      <h3 className="text-base font-extrabold text-slate-900">🏢 {c.companyName}</h3>
                      <div className="text-xs text-indigo-600 font-semibold mt-0.5 flex items-center gap-1.5">
                        <span>{c.jobTitle}</span>
                        {c.workPeriod && <span className="text-slate-400">({c.workPeriod})</span>}
                      </div>
                    </div>

                    {/* Company Website URL Controls */}
                    <div className="flex items-center gap-2 shrink-0">
                      {isCrawlingThis ? (
                        <div className="flex items-center gap-2 bg-indigo-50 border border-indigo-200 px-3 py-1.5 rounded-md text-indigo-700 text-xs font-semibold animate-pulse shadow-2xs">
                          <LoaderIcon width={13} height={13} className="animate-spin text-indigo-600" />
                          Crawling website & extracting emails...
                        </div>
                      ) : (
                        <>
                          {c.websiteUrl && !isEditingThis && (
                            <div className="flex items-center gap-1.5 bg-white border border-purple-200 px-2.5 py-1 rounded-md shadow-2xs">
                              <a
                                href={c.websiteUrl.startsWith('http') ? c.websiteUrl : `https://${c.websiteUrl}`}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:underline"
                              >
                                <GlobeIcon width={11} height={11} className="text-indigo-500" />
                                {c.websiteUrl.replace(/^https?:\/\//, '').split('/')[0]}
                                <ExternalLinkIcon width={9} height={9} />
                              </a>

                              <button
                                type="button"
                                title="Edit Company Website URL"
                                disabled={isAnyCrawlActive}
                                onClick={() => {
                                  setEditingWebIndex(i);
                                  setCustomWebInput(c.websiteUrl || '');
                                }}
                                className="text-slate-400 hover:text-indigo-600 p-0.5 rounded transition-colors ml-1 disabled:opacity-30"
                              >
                                <EditIcon width={13} height={13} />
                              </button>
                            </div>
                          )}

                          {(!c.websiteUrl || isEditingThis) && (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="url"
                                placeholder="Enter company website URL..."
                                value={isEditingThis ? customWebInput : c.websiteUrl || ''}
                                onChange={(e) => setCustomWebInput(e.target.value)}
                                disabled={isAnyCrawlActive}
                                className="text-xs border border-purple-200 rounded px-2.5 py-1 focus:ring-1 focus:ring-indigo-500 focus:outline-none w-64 bg-white disabled:opacity-50"
                              />
                              <Button
                                size="sm"
                                onClick={() => { void handleCompanyCrawl(i, customWebInput); }}
                                disabled={isAnyCrawlActive || !customWebInput.trim()}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] px-2.5 py-1 font-semibold flex items-center gap-1 shrink-0 disabled:opacity-50"
                              >
                                {isCrawlingThis ? <LoaderIcon width={10} height={10} className="animate-spin" /> : <RefreshIcon width={10} height={10} />}
                                Save & Crawl
                              </Button>
                              {isEditingThis && (
                                <button
                                  type="button"
                                  disabled={isAnyCrawlActive}
                                  onClick={() => setEditingWebIndex(null)}
                                  className="text-[10px] text-slate-400 hover:text-slate-600 px-1 disabled:opacity-30"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Company Contact Emails (Strictly Unique) */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Contact Emails</span>
                      {!isEditingCompanyEmailsThis && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isAnyCrawlActive}
                          onClick={() => {
                            setEditingCompanyEmailIndex(i);
                            setCompanyEmailsInput(compEmails.join(', '));
                          }}
                          className="text-[10px] px-2 py-0.5 border-indigo-200 text-indigo-700 hover:bg-indigo-50 disabled:opacity-40 flex items-center gap-1"
                        >
                          <EditIcon width={11} height={11} />
                          Edit Emails
                        </Button>
                      )}
                    </div>

                    {isEditingCompanyEmailsThis ? (
                      <div className="flex flex-col gap-1.5 mb-2 bg-indigo-50/50 p-2.5 rounded-md border border-indigo-100">
                        <label className="text-[10px] font-bold text-indigo-700">Edit Company Emails (Comma-Separated):</label>
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            placeholder="e.g. tjames@prometheusags.ai, contact@prometheusags.ai"
                            value={companyEmailsInput}
                            onChange={(e) => setCompanyEmailsInput(e.target.value)}
                            disabled={isAnyCrawlActive}
                            className="text-xs border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none flex-1 bg-white disabled:opacity-50 font-mono"
                          />
                          <Button
                            size="sm"
                            onClick={() => { void handleSaveCompanyEmails(i); }}
                            disabled={savingCompanyEmails || isAnyCrawlActive}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] px-3 py-1 font-semibold flex items-center gap-1 shrink-0 disabled:opacity-50"
                          >
                            {savingCompanyEmails ? <LoaderIcon width={10} height={10} className="animate-spin" /> : <CheckCircleIcon width={10} height={10} />}
                            Save Emails
                          </Button>
                          <button
                            type="button"
                            onClick={() => setEditingCompanyEmailIndex(null)}
                            className="text-[10px] text-slate-400 hover:text-slate-600 px-1"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {compEmails.length === 0 ? (
                          <div className="text-slate-400 italic text-[11px]">
                            {isCrawlingThis
                              ? 'Extracting contact emails from website...'
                              : 'No contact emails for this company. Click Edit Emails above.'}
                          </div>
                        ) : (
                          <ul className="space-y-1">
                            {compEmails.map((em: string) => {
                              const status = verifiedMap.get(em);
                              const isVerifyingThisEmail = isGlobalVerifyRunning || (savingCompanyEmails && companyEmailsInput.includes(em));

                              return (
                                <li key={em} className="flex items-center justify-between bg-white border border-slate-200 rounded-md px-2.5 py-1.5 gap-2">
                                  <span className="text-[11px] font-semibold text-slate-800 truncate font-mono">{em}</span>
                                  {isVerifyingThisEmail && !status ? (
                                    <span className="flex items-center gap-1 text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded animate-pulse">
                                      <LoaderIcon width={10} height={10} className="animate-spin text-indigo-600" />
                                      Verifying email...
                                    </span>
                                  ) : (
                                    <SmtpBadge status={status ?? 'pending'} />
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </>
                    )}
                  </div>

                  {/* IN-BOX AI OUTREACH DRAFT EMAIL & INTERACTIVE APPROVAL */}
                  {draftSubject && draftBody && (
                    <div className="border border-indigo-200 bg-white rounded-md p-3.5 space-y-2 mt-3">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <span className="text-xs font-extrabold text-indigo-950 flex items-center gap-1.5">
                          <SparklesIcon width={13} height={13} className="text-indigo-500" />
                          AI Outreach Draft Email
                        </span>

                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant={isApproved ? 'primary' : 'outline'}
                            onClick={() => { void handleToggleApproveDraft(i); }}
                            className={[
                              'text-[10px] px-2.5 py-0.5 font-bold transition-all',
                              isApproved
                                ? 'bg-green-600 hover:bg-green-700 text-white border-green-600'
                                : 'border-slate-300 text-slate-600 hover:bg-slate-50',
                            ].join(' ')}
                          >
                            {isApproved ? '✓ Approved' : 'Approve Draft'}
                          </Button>

                          {!isEditingDraftThis && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingDraftIndex(i);
                                setDraftSubjectInput(draftSubject);
                                setDraftBodyInput(draftBody);
                              }}
                              className="text-slate-400 hover:text-indigo-600 p-1 rounded"
                              title="Edit Draft Email"
                            >
                              <EditIcon width={13} height={13} />
                            </button>
                          )}
                        </div>
                      </div>

                      {isEditingDraftThis ? (
                        <div className="space-y-2 pt-1">
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Subject Line</label>
                            <input
                              type="text"
                              value={draftSubjectInput}
                              onChange={(e) => setDraftSubjectInput(e.target.value)}
                              className="w-full text-xs font-bold border border-slate-300 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold text-slate-400 uppercase">Email Body (HTML)</label>
                            <textarea
                              rows={6}
                              value={draftBodyInput}
                              onChange={(e) => setDraftBodyInput(e.target.value)}
                              className="w-full text-xs font-mono border border-slate-300 rounded p-2.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-slate-50"
                            />
                          </div>
                          <div className="flex justify-end gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => setEditingDraftIndex(null)}
                              className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
                            >
                              Cancel
                            </button>
                            <Button
                              size="sm"
                              onClick={() => { void handleSaveCompanyDraftEmail(i); }}
                              disabled={isSavingDraftThis}
                              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1 font-semibold flex items-center gap-1"
                            >
                              {isSavingDraftThis ? <LoaderIcon width={11} height={11} className="animate-spin" /> : <CheckCircleIcon width={11} height={11} />}
                              Save Draft Changes
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-1.5 pt-1">
                          <div className="text-xs font-bold text-slate-900 border-b border-slate-100 pb-1">
                            Subject: <span className="font-semibold text-slate-700">{draftSubject}</span>
                          </div>
                          <div
                            className="text-xs text-slate-700 leading-relaxed font-sans prose prose-slate max-w-none pt-1"
                            dangerouslySetInnerHTML={{ __html: draftBody }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
