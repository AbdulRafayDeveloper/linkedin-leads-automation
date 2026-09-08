'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import {
  crawlLeadWebsiteApi,
  generateLeadEmailApi,
  refineLeadEmailApi,
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
  XIcon,
} from '@/components/ui/Icons';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PipelineState {
  leadId: string;
  clientId: string | null;
  clientName: string | null;
  phase: 1 | 2 | 3 | 4 | 5 | 'done';
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

const PERSONAL_PROVIDER_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com',
  'yahoo.com', 'icloud.com', 'me.com', 'live.com', 'msn.com',
  'protonmail.com', 'proton.me', 'aol.com', 'yandex.com', 'gmx.com', 'mail.com', 'zoho.com'
]);

function getCategorizedEmails(
  companies: CurrentCompanyItem[],
  allDiscoveredEmails: string[],
  portfolioUrl?: string | null
) {
  const companyEmailMap = new Map<number, string[]>();
  const assignedSet = new Set<string>();
  const personalEmailsSet = new Set<string>();

  const getDomain = (email: string) => (email.split('@')[1] || '').toLowerCase().trim();
  const getSlug = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

  let portfolioHost = '';
  if (portfolioUrl) {
    try {
      portfolioHost = new URL(portfolioUrl.startsWith('http') ? portfolioUrl : `https://${portfolioUrl}`).hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      portfolioHost = (portfolioUrl || '').toLowerCase();
    }
  }

  // 1. Explicitly assigned companyEmails on each company object
  companies.forEach((comp, idx) => {
    const explicit = (comp.companyEmails ?? []).map((e) => e.toLowerCase().trim()).filter(Boolean);
    const validCompanyEmails: string[] = [];

    explicit.forEach((e) => {
      const dom = getDomain(e);
      if (!PERSONAL_PROVIDER_DOMAINS.has(dom) && !assignedSet.has(e)) {
        validCompanyEmails.push(e);
        assignedSet.add(e);
      }
    });
    companyEmailMap.set(idx, validCompanyEmails);
  });

  // 2. Classify all discovered emails
  allDiscoveredEmails.forEach((rawEmail) => {
    const email = rawEmail.toLowerCase().trim();
    if (!email || assignedSet.has(email)) return;

    const domain = getDomain(email);
    if (!domain) return;

    // A. Personal Provider Domain (gmail, yahoo, outlook, etc.)
    if (PERSONAL_PROVIDER_DOMAINS.has(domain)) {
      personalEmailsSet.add(email);
      assignedSet.add(email);
      return;
    }

    // B. Personal Portfolio Domain Match
    if (portfolioHost && (portfolioHost.includes(domain) || domain.includes(portfolioHost))) {
      personalEmailsSet.add(email);
      assignedSet.add(email);
      return;
    }

    // C. Match to Companies by websiteUrl or companyName slug
    let matchedIdx = -1;

    companies.forEach((comp, idx) => {
      if (matchedIdx !== -1) return;

      // C1. Website URL domain match
      if (comp.websiteUrl) {
        try {
          const compHost = new URL(comp.websiteUrl.startsWith('http') ? comp.websiteUrl : `https://${comp.websiteUrl}`).hostname.replace(/^www\./, '').toLowerCase();
          if (compHost.includes(domain) || domain.includes(compHost)) {
            matchedIdx = idx;
          }
        } catch {
          // ignore
        }
      }

      // C2. Company Name slug match (e.g. HSQ Solution -> hsqsolution vs hsqsolution.site)
      if (matchedIdx === -1 && comp.companyName) {
        const compSlug = getSlug(comp.companyName);
        const domainSlug = getSlug(domain.split('.')[0] || '');
        if (compSlug && domainSlug && (compSlug.includes(domainSlug) || domainSlug.includes(compSlug))) {
          matchedIdx = idx;
        }
      }
    });

    if (matchedIdx !== -1) {
      const existing = companyEmailMap.get(matchedIdx) ?? [];
      if (!existing.includes(email)) {
        companyEmailMap.set(matchedIdx, [...existing, email]);
      }
      assignedSet.add(email);
      return;
    }

    // D. If company email (custom domain) did not match a specific company, assign to first company if available
    if (companies.length > 0) {
      const existing = companyEmailMap.get(0) ?? [];
      if (!existing.includes(email)) {
        companyEmailMap.set(0, [...existing, email]);
      }
      assignedSet.add(email);
    } else {
      // No companies exist at all, store under personal
      personalEmailsSet.add(email);
      assignedSet.add(email);
    }
  });

  const personalEmails = Array.from(personalEmailsSet);
  return { companyEmailMap, personalEmails };
}

// ── Badges & Step Indicators ──────────────────────────────────────────────────

function SmtpBadge({ status }: { status: VerifiedEmailItem['status'] }) {
  if (status === 'valid') return <Badge tone="success">✓ Verified SMTP</Badge>;
  if (status === 'invalid') return <Badge tone="danger">❌ Email Not Exist</Badge>;
  if (status === 'risky') return <Badge tone="warning">⚠️ Risky SMTP</Badge>;
  return <Badge tone="warning">⚡ SMTP Not Verified</Badge>;
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

function PhaseSteps({ phase, running }: { phase: 1 | 2 | 3 | 4 | 5 | 'done'; running: boolean }) {
  const currentStep = phase === 'done' ? 6 : phase;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-white border border-slate-200 rounded-lg p-4">
      {[
        { n: 1, label: 'AI Extraction' },
        { n: 2, label: 'URL Mapping' },
        { n: 3, label: 'Web Crawl' },
        { n: 4, label: 'SMTP Verify' },
        { n: 5, label: 'AI Drafting' },
      ].map((s, i) => (
        <span key={s.n} className="flex items-center gap-1.5">
          <StepBadge n={s.n} label={s.label} done={currentStep > s.n} active={currentStep === s.n && running} />
          {i < 4 && <span className="text-slate-300 text-xs">→</span>}
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

  // URL State Management
  const [editingWebIndex, setEditingWebIndex] = useState<number | null>(null);
  const [customWebInput, setCustomWebInput] = useState('');
  const [crawlingCompIndex, setCrawlingCompIndex] = useState<number | null>(null);

  const [editingPersonalWeb, setEditingPersonalWeb] = useState(false);
  const [customPersonalWebInput, setCustomPersonalWebInput] = useState('');
  const [crawlingPersonalWeb, setCrawlingPersonalWeb] = useState(false);

  // Single-Email SMTP Verification State
  const [verifyingEmailMap, setVerifyingEmailMap] = useState<Record<string, boolean>>({});

  // Email Editors (Comma-Separated String state)
  const [editingCompanyEmailIndex, setEditingCompanyEmailIndex] = useState<number | null>(null);
  const [companyEmailsInput, setCompanyEmailsInput] = useState('');
  const [savingCompanyEmails, setSavingCompanyEmails] = useState(false);

  const [editingPersonalEmails, setEditingPersonalEmails] = useState(false);
  const [personalEmailsInput, setPersonalEmailsInput] = useState('');
  const [savingPersonalEmails, setSavingPersonalEmails] = useState(false);

  // Draft Editor Modal State
  const [editingDraftIndex, setEditingDraftIndex] = useState<number | null>(null);
  const [draftSubjectInput, setDraftSubjectInput] = useState('');
  const [draftBodyInput, setDraftBodyInput] = useState('');
  const [savingDraftIndex, setSavingDraftIndex] = useState<number | null>(null);
  const [regeneratingCompIndex, setRegeneratingCompIndex] = useState<number | null>(null);
  
  // Modal Mode & AI Prompt
  const [editorTab, setEditorTab] = useState<'visual' | 'code'>('visual');
  const [aiRewritePrompt, setAiRewritePrompt] = useState('');
  const [rewritingAi, setRewritingAi] = useState(false);

  async function callPhase(
    phase: 'extract' | 'map' | 'crawl' | 'verify' | 'generate',
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
          setCustomPersonalWebInput(fetchedLead.portfolioUrl || '');

          if (fetchedLead.crawlStatus !== 'completed' || fetchedLead.status !== 'completed') {
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
        await readStream(verifyBody, (event, data) => {
          const d = data as Record<string, unknown>;
          if (event === 'verified') {
            setPipeline((prev) => prev ? ({
              ...prev,
              verifiedEmails: [...prev.verifiedEmails, { email: d.email as string, status: d.status as VerifiedEmailItem['status'] }],
            }) : null);
          }
        });

        // Phase 5: Generate Email Drafts (Always runs)
        setPipeline((prev) => prev ? ({ ...prev, phase: 5 }) : null);
        const generateBody = await callPhase('generate', { leadId: targetLeadId });
        let finalLead: LeadIngestionRecord | null = null;
        
        await readStream(generateBody, (event, data) => {
          if (event === 'done') finalLead = (data as Record<string, unknown>).result as LeadIngestionRecord;
        });

        if (finalLead) setLead(finalLead);
        setPipeline((prev) => prev ? ({ ...prev, running: false, phase: 'done', finalLead }) : null);

      } else {
        // No websites to crawl — skip directly to verify & generate
        setPipeline((prev) => prev ? ({ ...prev, phase: 4 }) : null);
        
        const verifyBody = await callPhase('verify', { leadId: targetLeadId });
        await readStream(verifyBody, () => {});

        setPipeline((prev) => prev ? ({ ...prev, phase: 5 }) : null);
        const generateBody = await callPhase('generate', { leadId: targetLeadId });
        let finalLead: LeadIngestionRecord | null = null;
        
        await readStream(generateBody, (event, data) => {
          if (event === 'done') finalLead = (data as Record<string, unknown>).result as LeadIngestionRecord;
        });

        if (finalLead) setLead(finalLead);
        setPipeline((prev) => prev ? ({ ...prev, running: false, phase: 'done', finalLead }) : null);
      }
    } catch (err) {
      setPipeline((p) => p ? ({ ...p, running: false, error: err instanceof Error ? err.message : 'Pipeline failed' }) : null);
    }
  };

  // ── On-Demand Single Email Socket SMTP Verification Handler ─────────────────────
  const handleVerifySingleEmail = async (emailToVerify: string) => {
    if (!id || !emailToVerify) return;
    setVerifyingEmailMap((prev) => ({ ...prev, [emailToVerify]: true }));
    setPageError(null);
    try {
      const res = await updateLeadDetailsApi(id, { forceVerifyEmail: emailToVerify });
      setLead(res.result);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : `Failed to verify SMTP for ${emailToVerify}`);
    } finally {
      setVerifyingEmailMap((prev) => ({ ...prev, [emailToVerify]: false }));
    }
  };

  // ── Email Remapping Handler Across Containers ───────────────────────────────
  const handleRemapEmail = async (
    email: string,
    fromContainer: 'personal' | number,
    toContainer: 'personal' | number
  ) => {
    if (!id) return;
    setPageError(null);
    try {
      const targetEmail = email.toLowerCase().trim();
      const updatedCompanies = companies.map((c) => ({
        ...c,
        companyEmails: [...(c.companyEmails ?? [])],
      }));

      let updatedDiscovered = [...(lead?.discoveredEmails ?? [])];

      // Remove from source container
      if (fromContainer === 'personal') {
        updatedDiscovered = updatedDiscovered.filter((e) => e.toLowerCase() !== targetEmail);
      } else {
        const comp = updatedCompanies[fromContainer];
        if (comp) {
          comp.companyEmails = (comp.companyEmails ?? []).filter((e) => e.toLowerCase() !== targetEmail);
        }
      }

      // Add to target container
      if (toContainer === 'personal') {
        if (!updatedDiscovered.some((e) => e.toLowerCase() === targetEmail)) {
          updatedDiscovered.push(targetEmail);
        }
      } else {
        const comp = updatedCompanies[toContainer];
        if (comp) {
          const existing = comp.companyEmails ?? [];
          if (!existing.some((e) => e.toLowerCase() === targetEmail)) {
            comp.companyEmails = [...existing, targetEmail];
          }
        }
      }

      const res = await updateLeadDetailsApi(id, {
        currentCompanies: updatedCompanies,
        discoveredEmails: updatedDiscovered,
      });
      setLead(res.result);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to remap email address');
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

      // Pass companyIndex so the crawl service assigns discovered emails
      // directly to this company's companyEmails, not the personal pool.
      const crawlRes = await crawlLeadWebsiteApi(id, newUrl.trim(), [], companyIndex);
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
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to crawl personal website');
    } finally {
      setCrawlingPersonalWeb(false);
    }
  };

  // Save edited company emails & trigger SMTP verification via verifyCompanyEmails
  // (does NOT call addManualEmail which would push to discoveredEmails/personal pool)
  const handleSaveCompanyEmails = async (companyIndex: number) => {
    if (!id) return;
    setSavingCompanyEmails(true);
    setPageError(null);
    try {
      const parsedEmails = companyEmailsInput
        .split(/[,;\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes('@'));

      const otherBoxesEmails = new Set<string>();
      companies.forEach((comp, idx) => {
        if (idx !== companyIndex) {
          (comp.companyEmails ?? []).forEach((e) => otherBoxesEmails.add(e.toLowerCase()));
        }
      });
      personalEmails.forEach((e) => otherBoxesEmails.add(e.toLowerCase()));

      const duplicates = parsedEmails.filter((e) => otherBoxesEmails.has(e));
      if (duplicates.length > 0) {
        setPageError(`Email "${duplicates.join(', ')}" already exists in another sub-box!`);
        setSavingCompanyEmails(false);
        return;
      }

      const updatedCompanies = [...companies];
      updatedCompanies[companyIndex] = {
        ...updatedCompanies[companyIndex],
        companyEmails: Array.from(new Set(parsedEmails)),
      };

      // Use verifyCompanyEmails (not addManualEmail) so emails are SMTP-verified
      // but NOT pushed into discoveredEmails (the personal pool).
      const res = await updateLeadDetailsApi(id, {
        currentCompanies: updatedCompanies,
        ...(parsedEmails.length > 0 ? { verifyCompanyEmails: parsedEmails } : {}),
      });
      setLead(res.result);
      setEditingCompanyEmailIndex(null);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to save company emails');
    } finally {
      setSavingCompanyEmails(false);
    }
  };

  // Save edited personal emails & trigger instant SMTP verification via discoveredEmails update
  const handleSavePersonalEmails = async () => {
    if (!id) return;
    setSavingPersonalEmails(true);
    setPageError(null);
    try {
      const parsedEmails = personalEmailsInput
        .split(/[,;\s]+/)
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes('@'));

      const companyEmailsSet = new Set<string>();
      companies.forEach((comp) => {
        (comp.companyEmails ?? []).forEach((e) => companyEmailsSet.add(e.toLowerCase()));
      });

      const duplicates = parsedEmails.filter((e) => companyEmailsSet.has(e));
      if (duplicates.length > 0) {
        setPageError(`Email "${duplicates.join(', ')}" is already assigned to a Company sub-box!`);
        setSavingPersonalEmails(false);
        return;
      }

      // Set discoveredEmails directly — the API handler will SMTP-verify any new ones
      // and update emailValidationStatus for the personal primary email automatically.
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

  // Save company or personal draft subject & body from modal
  const handleSaveCompanyDraftEmail = async (companyIndex: number, markApproved: boolean = false) => {
    if (!id) return;
    setSavingDraftIndex(companyIndex);
    try {
      if (companyIndex === -1) {
        const res = await updateLeadDetailsApi(id, {
          emailSubject: draftSubjectInput,
          emailBody: draftBodyInput,
          ...(markApproved ? { approved: true } : {}),
        });
        setLead(res.result);
        setEditingDraftIndex(null);
        return;
      }

      const updatedCompanies = [...companies];
      updatedCompanies[companyIndex] = {
        ...updatedCompanies[companyIndex],
        emailSubject: draftSubjectInput,
        emailBody: draftBodyInput,
        ...(markApproved ? { approved: true } : {}),
      };

      const res = await updateLeadDetailsApi(id, {
        currentCompanies: updatedCompanies,
        emailSubject: updatedCompanies[0]?.emailSubject ?? lead?.emailSubject,
        emailBody: updatedCompanies[0]?.emailBody ?? lead?.emailBody,
        approved: updatedCompanies[0]?.approved ?? lead?.approved,
      });
      setLead(res.result);
      setEditingDraftIndex(null);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to save email draft');
    } finally {
      setSavingDraftIndex(null);
    }
  };

  const handleToggleApprovePersonalDraft = async () => {
    if (!id) return;
    setPageError(null);
    try {
      const primaryEmail = personalEmails[0] || lead?.email || '';
      const emailStatus = verifiedMap.get(primaryEmail);

      if (!lead?.approved) {
        if (!primaryEmail || emailStatus !== 'valid') {
          setPageError('Cannot approve email draft! Target contact email must be entered and SMTP verified as valid before approval.');
          return;
        }
      }

      const res = await updateLeadDetailsApi(id, {
        approved: !lead?.approved,
      });
      setLead(res.result);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to update approval');
    }
  };

  // Per-Company / Personal AI Draft Regeneration
  const handleRegenerateCompanyDraft = async (companyIndex: number) => {
    if (!id) return;
    setRegeneratingCompIndex(companyIndex);
    setPageError(null);
    try {
      const res = await generateLeadEmailApi(id, undefined, companyIndex);
      setLead(res.result);
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to regenerate email draft');
    } finally {
      setRegeneratingCompIndex(null);
    }
  };

  // Refine Draft with AI Prompt from Modal
  const handleAiRefineDraft = async (companyIndex: number) => {
    if (!id || !aiRewritePrompt.trim()) return;
    setRewritingAi(true);
    setPageError(null);
    try {
      const res = await generateLeadEmailApi(id, aiRewritePrompt.trim(), companyIndex);
      setLead(res.result);
      if (companyIndex === -1) {
        setDraftSubjectInput(res.result.emailSubject || draftSubjectInput);
        setDraftBodyInput(res.result.emailBody || draftBodyInput);
      } else {
        const updatedComp = res.result.currentCompanies?.[companyIndex];
        if (updatedComp) {
          setDraftSubjectInput(updatedComp.emailSubject || draftSubjectInput);
          setDraftBodyInput(updatedComp.emailBody || draftBodyInput);
        }
      }
      setAiRewritePrompt('');
    } catch (e) {
      setPageError(e instanceof Error ? e.message : 'Failed to refine draft with AI');
    } finally {
      setRewritingAi(false);
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
      ...(lead?.discoveredEmails !== undefined && lead.discoveredEmails.length > 0
        ? lead.discoveredEmails
        : lead?.email
        ? [lead.email]
        : []),
      ...(pipeline?.crawledEmails ?? []),
    ])
  );

  const { companyEmailMap, personalEmails } = getCategorizedEmails(companies, allDiscoveredEmails, portfolioUrl);
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
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!!pipeline?.running || isAnyCrawlActive}
            onClick={() => { void runAutoPipeline(id); }}
            className="flex items-center gap-1.5 text-xs text-indigo-700 border-indigo-200 bg-indigo-50 hover:bg-indigo-100 font-bold disabled:opacity-40"
          >
            {pipeline?.running ? (
              <>
                <LoaderIcon width={13} height={13} className="animate-spin text-indigo-600" />
                Pipeline Running...
              </>
            ) : (
              <>
                <RefreshIcon width={13} height={13} className="text-indigo-600" />
                ⚡ Run Crawl & Verification
              </>
            )}
          </Button>
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

              {/* Personal Portfolio URL Controls (Typing & Focus Bug Fix) */}
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
                          value={customPersonalWebInput}
                          onFocus={() => setEditingPersonalWeb(true)}
                          onChange={(e) => {
                            setEditingPersonalWeb(true);
                            setCustomPersonalWebInput(e.target.value);
                          }}
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

            {/* Personal Emails with SMTP Re-verify & Remap Dropdown */}
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
                    <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs">
                      <span className="text-amber-800 font-semibold italic">No personal email address mapped yet</span>
                      <Badge tone="warning">⚠️ No Personal Email</Badge>
                    </div>
                  ) : (
                    <ul className="space-y-1.5">
                      {personalEmails.map((em: string) => {
                        const status = verifiedMap.get(em);
                        const isVerifyingThis = verifyingEmailMap[em] || isGlobalVerifyRunning;

                        return (
                          <li key={em} className="flex flex-wrap items-center justify-between bg-white border border-slate-200 rounded-md px-3 py-1.5 gap-2">
                            <span className="text-xs font-bold text-slate-900 font-mono shrink-0">{em}</span>

                            <div className="flex items-center gap-2 ml-auto">
                              <SmtpBadge status={status ?? 'pending'} />

                              {/* Single Email SMTP Re-verify Button */}
                              <button
                                type="button"
                                disabled={isVerifyingThis}
                                onClick={() => { void handleVerifySingleEmail(em); }}
                                className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded hover:bg-amber-100 transition-colors disabled:opacity-50"
                                title="Re-run real socket SMTP verification on this email"
                              >
                                {isVerifyingThis ? (
                                  <>
                                    <LoaderIcon width={10} height={10} className="animate-spin text-amber-600" />
                                    Verifying...
                                  </>
                                ) : (
                                  <>⚡ Verify SMTP</>
                                )}
                              </button>

                              {/* Email Remapping Dropdown */}
                              <select
                                value="personal"
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val.startsWith('company-')) {
                                    const targetIdx = parseInt(val.replace('company-', ''), 10);
                                    void handleRemapEmail(em, 'personal', targetIdx);
                                  }
                                }}
                                className="text-[10px] border border-slate-200 rounded px-1.5 py-0.5 bg-slate-50 text-slate-700 font-semibold focus:outline-none cursor-pointer hover:bg-slate-100"
                              >
                                <option value="personal">👤 Personal Profile</option>
                                {companies.map((c, idx) => (
                                  <option key={idx} value={`company-${idx}`}>
                                    🏢 Move to {c.companyName || `Company #${idx + 1}`}
                                  </option>
                                ))}
                              </select>
                            </div>
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
                  <span key={p} className="bg-white border border-slate-200 text-slate-800 px-2.5 py-1 rounded-md font-mono text-[11px] font-medium">📞 {p}</span>
                ))}
              </div>
            )}

            {/* IN-BOX PERSONAL AI OUTREACH DRAFT EMAIL & REGENERATE */}
            {(() => {
              const primaryPersonalEmail = personalEmails[0] || lead?.email || '';
              const personalSmtpStatus = primaryPersonalEmail ? (verifiedMap.get(primaryPersonalEmail) ?? 'pending') : null;

              return (
                <div className="border border-blue-200 bg-white rounded-md p-3.5 space-y-2 mt-3 shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-2 gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-extrabold text-blue-950 flex items-center gap-1.5">
                        <SparklesIcon width={13} height={13} className="text-blue-500" />
                        Personal AI Outreach Draft Email
                      </span>
                      {!primaryPersonalEmail ? (
                        <Badge tone="warning">⚠️ No Email Found</Badge>
                      ) : personalSmtpStatus === 'valid' ? (
                        <Badge tone="success">✓ Verified SMTP</Badge>
                      ) : personalSmtpStatus === 'invalid' ? (
                        <Badge tone="danger">❌ Email Not Exist</Badge>
                      ) : (
                        <Badge tone="warning">⚡ SMTP Not Verified</Badge>
                      )}
                    </div>

                <div className="flex items-center gap-2">
                  {/* Personal Draft Regenerate Button */}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={regeneratingCompIndex === -1 || isAnyCrawlActive}
                    onClick={() => { void handleRegenerateCompanyDraft(-1); }}
                    className="text-[10px] px-2.5 py-0.5 border-blue-200 text-blue-700 hover:bg-blue-50 flex items-center gap-1 font-semibold disabled:opacity-40"
                  >
                    {regeneratingCompIndex === -1 ? (
                      <>
                        <LoaderIcon width={11} height={11} className="animate-spin text-blue-600" />
                        Generating Draft...
                      </>
                    ) : (
                      <>
                        <SparklesIcon width={11} height={11} className="text-blue-600" />
                        ✨ Regenerate Draft
                      </>
                    )}
                  </Button>

                  <Button
                    size="sm"
                    variant={lead?.approved ? 'primary' : 'outline'}
                    onClick={() => { void handleToggleApprovePersonalDraft(); }}
                    className={[
                      'text-[10px] px-2.5 py-0.5 font-bold transition-all',
                      lead?.approved
                        ? 'bg-green-600 hover:bg-green-700 text-white border-green-600'
                        : 'border-slate-300 text-slate-600 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    {lead?.approved ? '✓ Approved' : 'Approve Draft'}
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setEditingDraftIndex(-1);
                      setDraftSubjectInput(lead?.emailSubject || '');
                      setDraftBodyInput(lead?.emailBody || '');
                    }}
                    className="text-[10px] px-2 py-0.5 border-blue-200 text-blue-700 hover:bg-blue-50 flex items-center gap-1 font-semibold"
                  >
                    <EditIcon width={11} height={11} />
                    Preview & Edit
                  </Button>
                  </div>
                </div>

              {/* Formatted HTML Display (No raw HTML tags) */}
              {lead?.emailSubject && lead?.emailBody ? (
                <div className="space-y-2 pt-1">
                  <div className="text-xs font-bold text-slate-900 border-b border-slate-100 pb-1.5 flex items-center justify-between">
                    <span>Subject: <span className="font-semibold text-slate-800">{lead.emailSubject}</span></span>
                  </div>
                  <div
                    className="text-xs text-slate-700 leading-relaxed font-sans prose prose-slate max-w-none pt-1"
                    dangerouslySetInnerHTML={{ __html: lead.emailBody }}
                  />
                </div>
              ) : (
                <div className="text-xs text-slate-400 italic py-2 text-center">
                  No personal AI draft generated yet. Click &quot;✨ Regenerate Draft&quot; above to generate one.
                </div>
              )}
            </div>
          );
        })()}
          </div>

          {/* Company Sub-Boxes Updated In-Place with Strict Email Deduplication */}
          <div className="space-y-4">
            {companies.map((c, i) => {
              const isCrawlingThis = (crawlingCompIndex === i) || (isGlobalCrawlRunning && Boolean(c.websiteUrl));
              const isEditingThis = editingWebIndex === i;
              const isEditingCompanyEmailsThis = editingCompanyEmailIndex === i;

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

                    {/* Company Website URL Controls (Typing Bug Fix) */}
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
                                onFocus={() => {
                                  setEditingWebIndex(i);
                                  if (!isEditingThis) setCustomWebInput(c.websiteUrl || '');
                                }}
                                onChange={(e) => {
                                  setEditingWebIndex(i);
                                  setCustomWebInput(e.target.value);
                                }}
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

                  {/* Company Contact Emails with SMTP Re-verify & Remap Dropdown */}
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
                            placeholder="e.g. contact@company.com"
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
                          <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs">
                            <span className="text-amber-800 font-semibold italic">
                              {isCrawlingThis
                                ? 'Extracting contact emails from website...'
                                : 'No contact emails for this company'}
                            </span>
                            <Badge tone="warning">⚠️ No Company Email</Badge>
                          </div>
                        ) : (
                          <ul className="space-y-1.5">
                            {compEmails.map((em: string) => {
                              const status = verifiedMap.get(em);
                              const isVerifyingThis = verifyingEmailMap[em] || isGlobalVerifyRunning;

                              return (
                                <li key={em} className="flex flex-wrap items-center justify-between bg-white border border-slate-200 rounded-md px-3 py-1.5 gap-2">
                                  <span className="text-xs font-bold text-slate-900 font-mono shrink-0">{em}</span>

                                  <div className="flex items-center gap-2 ml-auto">
                                    <SmtpBadge status={status ?? 'pending'} />

                                    {/* Single Email SMTP Re-verify Button */}
                                    <button
                                      type="button"
                                      disabled={isVerifyingThis}
                                      onClick={() => { void handleVerifySingleEmail(em); }}
                                      className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded hover:bg-amber-100 transition-colors disabled:opacity-50"
                                      title="Re-run real socket SMTP verification on this email"
                                    >
                                      {isVerifyingThis ? (
                                        <>
                                          <LoaderIcon width={10} height={10} className="animate-spin text-amber-600" />
                                          Verifying...
                                        </>
                                      ) : (
                                        <>⚡ Verify SMTP</>
                                      )}
                                    </button>

                                    {/* Email Remapping Dropdown */}
                                    <select
                                      value={`company-${i}`}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === 'personal') {
                                          void handleRemapEmail(em, i, 'personal');
                                        } else if (val.startsWith('company-')) {
                                          const targetIdx = parseInt(val.replace('company-', ''), 10);
                                          if (targetIdx !== i) {
                                            void handleRemapEmail(em, i, targetIdx);
                                          }
                                        }
                                      }}
                                      className="text-[10px] border border-slate-200 rounded px-1.5 py-0.5 bg-slate-50 text-slate-700 font-semibold focus:outline-none cursor-pointer hover:bg-slate-100"
                                    >
                                      <option value="personal">👤 Move to Personal</option>
                                      {companies.map((compObj, idx) => (
                                        <option key={idx} value={`company-${idx}`}>
                                          🏢 {idx === i ? `Assigned to ${compObj.companyName}` : `Move to ${compObj.companyName}`}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </>
                    )}
                  </div>

                  {/* IN-BOX AI OUTREACH DRAFT EMAIL & PER-COMPANY REGENERATE */}
                  {(() => {
                    const primaryCompEmail = compEmails[0] || '';
                    const compSmtpStatus = primaryCompEmail ? (verifiedMap.get(primaryCompEmail) ?? 'pending') : null;

                    return (
                      <div className="border border-indigo-200 bg-white rounded-md p-3.5 space-y-2 mt-3 shadow-2xs">
                        <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-2 gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-extrabold text-indigo-950 flex items-center gap-1.5">
                              <SparklesIcon width={13} height={13} className="text-indigo-500" />
                              AI Outreach Draft Email
                            </span>
                            {!primaryCompEmail ? (
                              <Badge tone="warning">⚠️ No Email Found</Badge>
                            ) : compSmtpStatus === 'valid' ? (
                              <Badge tone="success">✓ Verified SMTP</Badge>
                            ) : compSmtpStatus === 'invalid' ? (
                              <Badge tone="danger">❌ Email Not Exist</Badge>
                            ) : (
                              <Badge tone="warning">⚡ SMTP Not Verified</Badge>
                            )}
                          </div>

                      <div className="flex items-center gap-2">
                        {/* Per-Company Draft Regenerate Button */}
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={regeneratingCompIndex === i || isAnyCrawlActive}
                          onClick={() => { void handleRegenerateCompanyDraft(i); }}
                          className="text-[10px] px-2.5 py-0.5 border-purple-200 text-purple-700 hover:bg-purple-50 flex items-center gap-1 font-semibold disabled:opacity-40"
                        >
                          {regeneratingCompIndex === i ? (
                            <>
                              <LoaderIcon width={11} height={11} className="animate-spin text-purple-600" />
                              Generating Draft...
                            </>
                          ) : (
                            <>
                              <SparklesIcon width={11} height={11} className="text-purple-600" />
                              ✨ Regenerate Draft
                            </>
                          )}
                        </Button>

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

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditingDraftIndex(i);
                            setDraftSubjectInput(draftSubject || '');
                            setDraftBodyInput(draftBody || '');
                          }}
                          className="text-[10px] px-2 py-0.5 border-indigo-200 text-indigo-700 hover:bg-indigo-50 flex items-center gap-1 font-semibold"
                        >
                          <EditIcon width={11} height={11} />
                          Preview & Edit
                        </Button>
                      </div>
                    </div>

                    {/* Formatted HTML Display (No raw HTML tags) */}
                    {draftSubject && draftBody ? (
                      <div className="space-y-2 pt-1">
                        <div className="text-xs font-bold text-slate-900 border-b border-slate-100 pb-1.5 flex items-center justify-between">
                          <span>Subject: <span className="font-semibold text-slate-800">{draftSubject}</span></span>
                        </div>
                        <div
                          className="text-xs text-slate-700 leading-relaxed font-sans prose prose-slate max-w-none pt-1"
                          dangerouslySetInnerHTML={{ __html: draftBody }}
                        />
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400 italic py-2 text-center">
                        No AI draft generated for this company yet. Click &quot;✨ Regenerate Draft&quot; above to generate one.
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}
          </div>
        </CardContent>
      </Card>

      {/* ── RICH DRAFT REWRITE & PREVIEW MODAL WINDOW ───────────────────────── */}
      {editingDraftIndex !== null && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2">
                <SparklesIcon width={18} height={18} className="text-indigo-600" />
                <h3 className="text-base font-extrabold text-slate-900">
                  Outreach Email Draft — {editingDraftIndex === -1 ? `${fullName} (Personal Direct)` : companies[editingDraftIndex]?.companyName}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingDraftIndex(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md"
              >
                <XIcon width={18} height={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* Target Contact Email Indicator */}
              <div className="bg-indigo-50/60 border border-indigo-100 rounded-md p-3 text-xs flex items-center justify-between">
                <span className="font-semibold text-indigo-900">Target Contact Email:</span>
                <span className="font-mono font-bold text-indigo-700 bg-white px-2 py-0.5 rounded border border-indigo-200">
                  {editingDraftIndex === -1 ? (personalEmails[0] || lead?.email || 'No primary personal email set') : (companyEmailMap.get(editingDraftIndex)?.[0] || lead?.email || 'No primary email set')}
                </span>
              </div>

              {/* Subject Line Input */}
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700">Subject Line</label>
                <input
                  type="text"
                  value={draftSubjectInput}
                  onChange={(e) => setDraftSubjectInput(e.target.value)}
                  className="w-full text-xs font-semibold border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  placeholder="Enter email subject line..."
                />
              </div>

              {/* Editor Mode Tabs & Formatting Controls */}
              <div className="space-y-2">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <label className="text-xs font-bold text-slate-700">Email Body</label>
                  <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-md border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setEditorTab('visual')}
                      className={[
                        'text-xs font-bold px-3 py-1 rounded transition-all',
                        editorTab === 'visual' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-500 hover:text-slate-800',
                      ].join(' ')}
                    >
                      Formatted Visual Preview
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditorTab('code')}
                      className={[
                        'text-xs font-bold px-3 py-1 rounded transition-all',
                        editorTab === 'code' ? 'bg-white text-indigo-700 shadow-2xs' : 'text-slate-500 hover:text-slate-800',
                      ].join(' ')}
                    >
                      Edit Raw HTML Code
                    </button>
                  </div>
                </div>

                {/* Rich Formatting Toolbar (Visual Mode) */}
                {editorTab === 'visual' && (
                  <div className="flex items-center gap-1 bg-slate-50 p-1.5 rounded-t-md border border-slate-200 border-b-0 text-xs">
                    <button
                      type="button"
                      onClick={() => setDraftBodyInput((prev) => prev + ' <strong>bold text</strong>')}
                      className="px-2 py-0.5 rounded font-bold hover:bg-slate-200 border border-slate-300 text-slate-700"
                    >
                      B
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraftBodyInput((prev) => prev + ' <em>italic text</em>')}
                      className="px-2 py-0.5 rounded italic hover:bg-slate-200 border border-slate-300 text-slate-700"
                    >
                      I
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraftBodyInput((prev) => prev + '\n<p>New paragraph here...</p>')}
                      className="px-2 py-0.5 rounded hover:bg-slate-200 border border-slate-300 text-slate-700 font-semibold"
                    >
                      + Paragraph
                    </button>
                    <button
                      type="button"
                      onClick={() => setDraftBodyInput((prev) => prev + ' <a href="https://portfolio.url">Link</a>')}
                      className="px-2 py-0.5 rounded hover:bg-slate-200 border border-slate-300 text-slate-700 font-semibold"
                    >
                      + Link
                    </button>
                  </div>
                )}

                {/* Body Content Input / View */}
                {editorTab === 'visual' ? (
                  <div className="border border-slate-200 rounded-b-md p-4 bg-slate-50/30 min-h-[180px] text-xs text-slate-800 leading-relaxed prose prose-slate max-w-none">
                    <div dangerouslySetInnerHTML={{ __html: draftBodyInput }} />
                  </div>
                ) : (
                  <textarea
                    rows={8}
                    value={draftBodyInput}
                    onChange={(e) => setDraftBodyInput(e.target.value)}
                    className="w-full text-xs font-mono border border-slate-300 rounded-md p-3 focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-slate-900 text-slate-100"
                    placeholder="<p>Hi Firstname,</p>..."
                  />
                )}
              </div>

              {/* AI Revision Assistant Box */}
              <div className="bg-purple-50/60 border border-purple-200 rounded-lg p-3.5 space-y-2">
                <label className="text-xs font-extrabold text-purple-950 flex items-center gap-1.5">
                  <SparklesIcon width={13} height={13} className="text-purple-600" />
                  ✨ Ask AI to Rewrite / Refine this Draft
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="e.g. Make tone more casual, mention 70+ shipped SaaS products..."
                    value={aiRewritePrompt}
                    onChange={(e) => setAiRewritePrompt(e.target.value)}
                    disabled={rewritingAi}
                    className="flex-1 text-xs border border-purple-200 rounded-md px-3 py-1.5 focus:ring-1 focus:ring-purple-500 focus:outline-none bg-white"
                  />
                  <Button
                    size="sm"
                    onClick={() => { void handleAiRefineDraft(editingDraftIndex); }}
                    disabled={rewritingAi || !aiRewritePrompt.trim()}
                    className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3.5 py-1.5 font-bold shrink-0 flex items-center gap-1 disabled:opacity-50"
                  >
                    {rewritingAi ? <LoaderIcon width={12} height={12} className="animate-spin" /> : <SparklesIcon width={12} height={12} />}
                    Rewrite with AI
                  </Button>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setEditingDraftIndex(null)}
                className="text-xs font-semibold text-slate-600 hover:text-slate-800 px-3 py-1.5"
              >
                Cancel
              </button>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { void handleSaveCompanyDraftEmail(editingDraftIndex, false); }}
                  disabled={savingDraftIndex === editingDraftIndex}
                  className="border-slate-300 text-slate-700 hover:bg-white text-xs px-3.5 py-1.5 font-semibold"
                >
                  Save Draft
                </Button>
                <Button
                  size="sm"
                  onClick={() => { void handleSaveCompanyDraftEmail(editingDraftIndex, true); }}
                  disabled={savingDraftIndex === editingDraftIndex}
                  className="bg-green-600 hover:bg-green-700 text-white text-xs px-4 py-1.5 font-bold flex items-center gap-1.5"
                >
                  {savingDraftIndex === editingDraftIndex ? <LoaderIcon width={12} height={12} className="animate-spin" /> : <CheckCircleIcon width={12} height={12} />}
                  Approve & Save Draft
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
