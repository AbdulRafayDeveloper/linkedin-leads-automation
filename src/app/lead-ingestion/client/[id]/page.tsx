'use client';

import { useEffect, useState, use, useRef } from 'react';
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

interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email.trim().toLowerCase());
}

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

// ── Helper: Robust Email Categorization & Remapping ────────────────────────────

const PERSONAL_PROVIDER_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com',
  'yahoo.com', 'icloud.com', 'me.com', 'live.com', 'msn.com',
  'protonmail.com', 'proton.me', 'aol.com', 'yandex.com', 'gmx.com', 'mail.com', 'zoho.com'
]);

function getCategorizedEmails(
  companies: CurrentCompanyItem[],
  explicitDiscoveredEmails: string[],
  crawledEmails: string[] = [],
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

  // 1. Explicitly assigned companyEmails on each company object (highest precedence for company boxes)
  companies.forEach((comp, idx) => {
    const explicit = (comp.companyEmails ?? []).map((e) => e.toLowerCase().trim()).filter(Boolean);
    const validCompanyEmails: string[] = [];

    explicit.forEach((e) => {
      if (!assignedSet.has(e)) {
        validCompanyEmails.push(e);
        assignedSet.add(e);
      }
    });
    companyEmailMap.set(idx, validCompanyEmails);
  });

  // 2. Explicitly assigned personal discoveredEmails (highest precedence for personal profile box)
  explicitDiscoveredEmails.forEach((rawEmail) => {
    const email = rawEmail.toLowerCase().trim();
    if (email && !assignedSet.has(email)) {
      personalEmailsSet.add(email);
      assignedSet.add(email);
    }
  });

  // 3. Classify unassigned crawled emails (discovery fallback for remaining emails)
  crawledEmails.forEach((rawEmail) => {
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

      // C2. Company Name slug match
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

    // D. If custom domain email did not match a specific company, assign to first company if available, else personal
    if (companies.length > 0) {
      const existing = companyEmailMap.get(0) ?? [];
      if (!existing.includes(email)) {
        companyEmailMap.set(0, [...existing, email]);
      }
      assignedSet.add(email);
    } else {
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
  if (status === 'risky') return <Badge tone="success">⚡ Risky/Catch-All SMTP</Badge>;
  if (status === 'invalid') return <Badge tone="danger">❌ Email Not Exist</Badge>;
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

function InlineRichDraftEditor({
  initialSubject,
  initialBody,
  smtpStatus,
  hasEmail,
  isSaving,
  isRegenerating,
  isRewriting,
  isApproved,
  aiPromptValue,
  title,
  themeColor = 'blue',
  onSave,
  onRegenerate,
  onToggleApprove,
  onAiPromptChange,
  onAiRefine,
}: {
  initialSubject: string;
  initialBody: string;
  smtpStatus: string | null;
  hasEmail: boolean;
  isSaving: boolean;
  isRegenerating: boolean;
  isRewriting: boolean;
  isApproved: boolean;
  aiPromptValue: string;
  title: string;
  themeColor?: 'blue' | 'indigo' | 'purple';
  onSave: (subject: string, body: string) => Promise<void>;
  onRegenerate: () => Promise<void>;
  onToggleApprove: () => Promise<void>;
  onAiPromptChange: (val: string) => void;
  onAiRefine: () => Promise<void>;
}) {
  const [subject, setSubject] = useState(initialSubject || '');
  const [body, setBody] = useState(initialBody || '');
  const [mode, setMode] = useState<'visual' | 'code'>('visual');
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSubject(initialSubject || '');
  }, [initialSubject]);

  useEffect(() => {
    setBody(initialBody || '');
    if (editorRef.current && document.activeElement !== editorRef.current) {
      editorRef.current.innerHTML = initialBody || '';
    }
  }, [initialBody]);

  const applyFormat = (command: string, value: string | undefined = undefined) => {
    if (mode === 'visual' && editorRef.current) {
      editorRef.current.focus();
      document.execCommand(command, false, value);
      setBody(editorRef.current.innerHTML);
    } else {
      if (command === 'bold') setBody((prev) => prev + ' <strong>bold text</strong>');
      else if (command === 'italic') setBody((prev) => prev + ' <em>italic text</em>');
      else if (command === 'underline') setBody((prev) => prev + ' <u>underlined text</u>');
      else if (command === 'paragraph') setBody((prev) => prev + '\n<p>New paragraph...</p>');
      else if (command === 'link') setBody((prev) => prev + ' <a href="https://">Link</a>');
    }
  };

  const norm = (str?: string | null) => (str || '').trim();
  const isDirty = norm(subject) !== norm(initialSubject) || norm(body) !== norm(initialBody);

  return (
    <div className={`border border-${themeColor}-200 bg-white rounded-md p-3.5 space-y-3 mt-3 shadow-2xs`}>
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-100 pb-2 gap-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-extrabold text-${themeColor}-950 flex items-center gap-1.5`}>
            <SparklesIcon width={13} height={13} className={`text-${themeColor}-500`} />
            {title}
          </span>
          {!hasEmail ? <Badge tone="warning">⚠️ No Email Found</Badge> : <SmtpBadge status={(smtpStatus as any) ?? 'pending'} />}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <Button
            size="sm"
            variant="outline"
            disabled={isRegenerating}
            onClick={() => void onRegenerate()}
            className={`text-[10px] px-2.5 py-0.5 border-${themeColor}-200 text-${themeColor}-700 hover:bg-${themeColor}-50 flex items-center gap-1 font-semibold disabled:opacity-40`}
          >
            {isRegenerating ? (
              <><LoaderIcon width={11} height={11} className="animate-spin" /> Generating...</>
            ) : (
              <><SparklesIcon width={11} height={11} /> ✨ Regenerate</>
            )}
          </Button>

          {(isDirty || isSaving) && (
            <Button
              size="sm"
              disabled={isSaving}
              onClick={async () => {
                await onSave(subject, body);
              }}
              className="text-[10px] px-3 py-0.5 font-bold flex items-center gap-1 bg-purple-600 hover:bg-purple-700 text-white shadow-md animate-pulse transition-all disabled:opacity-50"
            >
              {isSaving ? <LoaderIcon width={10} height={10} className="animate-spin" /> : <CheckCircleIcon width={10} height={10} />}
              Save Changes
            </Button>
          )}

          <Button
            size="sm"
            variant={isApproved ? 'primary' : 'outline'}
            onClick={() => void onToggleApprove()}
            className={[
              'text-[10px] px-2.5 py-0.5 font-bold transition-all',
              isApproved ? 'bg-green-600 hover:bg-green-700 text-white border-green-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50',
            ].join(' ')}
          >
            {isApproved ? '✓ Approved' : 'Approve'}
          </Button>
        </div>
      </div>

      {/* Editable Subject & Direct Rich Editor */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-600 shrink-0">Subject:</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Type outreach email subject line here..."
            className="flex-1 text-xs font-semibold border border-slate-200 rounded px-2.5 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none bg-slate-50/50 focus:bg-white"
          />
        </div>

        {/* Toolbar & Mode Switcher */}
        <div className="flex items-center justify-between bg-slate-50 px-2 py-1 rounded-t-md border border-slate-200 border-b-0 text-xs">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => applyFormat('bold')}
              className="px-2 py-0.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-200 font-bold text-[11px]"
              title="Bold"
            >
              B
            </button>
            <button
              type="button"
              onClick={() => applyFormat('italic')}
              className="px-2 py-0.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-200 italic font-semibold text-[11px]"
              title="Italic"
            >
              I
            </button>
            <button
              type="button"
              onClick={() => applyFormat('underline')}
              className="px-2 py-0.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-200 underline font-semibold text-[11px]"
              title="Underline"
            >
              U
            </button>
            <span className="text-slate-300 mx-1">|</span>
            <button
              type="button"
              onClick={() => applyFormat('paragraph')}
              className="px-2 py-0.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-200 font-semibold text-[10px]"
              title="Add Paragraph"
            >
              + ¶
            </button>
            <button
              type="button"
              onClick={() => applyFormat('link')}
              className="px-2 py-0.5 rounded border border-slate-300 text-slate-700 hover:bg-slate-200 font-semibold text-[10px]"
              title="Add Link"
            >
              + Link
            </button>
          </div>

          <div className="flex items-center gap-1 text-[10px]">
            <button
              type="button"
              onClick={() => setMode('visual')}
              className={`px-2 py-0.5 rounded font-bold transition-all ${mode === 'visual' ? 'bg-white text-indigo-700 border border-slate-300 shadow-2xs' : 'text-slate-500 hover:text-slate-800'}`}
            >
              Visual Rich Editor
            </button>
            <button
              type="button"
              onClick={() => setMode('code')}
              className={`px-2 py-0.5 rounded font-bold transition-all ${mode === 'code' ? 'bg-white text-indigo-700 border border-slate-300 shadow-2xs' : 'text-slate-500 hover:text-slate-800'}`}
            >
              HTML Code
            </button>
          </div>
        </div>

        {/* Directly Editable Body Box */}
        {mode === 'visual' ? (
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={(e) => setBody(e.currentTarget.innerHTML)}
            onBlur={(e) => setBody(e.currentTarget.innerHTML)}
            className="w-full text-xs text-slate-800 leading-relaxed min-h-[160px] p-3.5 border border-slate-300 rounded-b-md focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white prose prose-slate max-w-none cursor-text"
          />
        ) : (
          <textarea
            rows={8}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="w-full text-xs font-mono border border-slate-300 rounded-b-md p-3 focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-slate-900 text-slate-100"
            placeholder="<p>Hi Firstname,</p>..."
          />
        )}
      </div>

      {/* AI Refine Assistant */}
      <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
        <input
          type="text"
          placeholder="Ask AI to refine (e.g. 'Make it shorter')..."
          value={aiPromptValue}
          onChange={(e) => onAiPromptChange(e.target.value)}
          disabled={isRewriting}
          className="text-xs border border-purple-200 rounded-md px-3 py-1.5 flex-1 bg-purple-50/30 focus:bg-white focus:ring-1 focus:ring-purple-500 focus:outline-none"
        />
        <Button
          size="sm"
          onClick={() => void onAiRefine()}
          disabled={isRewriting || !aiPromptValue.trim()}
          className="bg-purple-600 hover:bg-purple-700 text-white text-[11px] px-3 py-1 font-semibold shrink-0 flex items-center gap-1 disabled:opacity-50"
        >
          {isRewriting ? <LoaderIcon width={10} height={10} className="animate-spin" /> : <SparklesIcon width={10} height={10} />}
          Refine with AI
        </Button>
      </div>
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

  // ── Toast Notification State ───────────────────────────────────────────────
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'error') => {
    const toastId = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id: toastId, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== toastId));
    }, 4500);
  };

  const removeToast = (toastId: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== toastId));
  };

  // URL State Management
  const [editingWebIndex, setEditingWebIndex] = useState<number | null>(null);
  const [customWebInput, setCustomWebInput] = useState('');
  const [crawlingCompIndex, setCrawlingCompIndex] = useState<number | null>(null);

  const [editingPersonalWeb, setEditingPersonalWeb] = useState(false);
  const [customPersonalWebInput, setCustomPersonalWebInput] = useState('');
  const [crawlingPersonalWeb, setCrawlingPersonalWeb] = useState(false);

  // Single-Email SMTP Verification State
  const [verifyingEmailMap, setVerifyingEmailMap] = useState<Record<string, boolean>>({});

  // Per-email remap loading state (key = email string)
  const [remapLoadingMap, setRemapLoadingMap] = useState<Record<string, boolean>>({});

  // ── Inline draft editing (per box index; -1 = personal) ────────────────────
  const [inlineEditingIndex, setInlineEditingIndex] = useState<number | null>(null);
  const [inlineSubject, setInlineSubject] = useState('');
  const [inlineBody, setInlineBody] = useState('');
  const [savingDraftIndex, setSavingDraftIndex] = useState<number | null>(null);
  const [regeneratingCompIndex, setRegeneratingCompIndex] = useState<number | null>(null);
  const [boxAiPrompts, setBoxAiPrompts] = useState<Record<number, string>>({});
  const [rewritingAiIndex, setRewritingAiIndex] = useState<number | null>(null);

  // ── Per-email add / inline-edit state ────────────────────────────────
  // addingEmailBox: 'personal' | '0' | '1' etc
  const [addingEmailBox, setAddingEmailBox] = useState<string | null>(null);
  const [addingEmailValue, setAddingEmailValue] = useState('');
  const [addingEmailLoading, setAddingEmailLoading] = useState(false);

  // inline edit per email: key = email string
  const [editingEmailKey, setEditingEmailKey] = useState<string | null>(null);
  const [editingEmailValue, setEditingEmailValue] = useState('');
  const [editingEmailLoading, setEditingEmailLoading] = useState(false);
  const [deletingEmailKey, setDeletingEmailKey] = useState<string | null>(null);

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
        if (isMounted) showToast(err instanceof Error ? err.message : 'Failed to load candidate', 'error');
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
        showToast('Auto Pipeline completed successfully!', 'success');

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
        showToast('Auto Pipeline completed successfully!', 'success');
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Pipeline failed';
      setPipeline((p) => p ? ({ ...p, running: false, error: errMsg }) : null);
      showToast(errMsg, 'error');
    }
  };

  // ── On-Demand Single Email Socket SMTP Verification Handler ─────────────────────
  const handleVerifySingleEmail = async (emailToVerify: string) => {
    if (!id || !emailToVerify) return;
    setVerifyingEmailMap((prev) => ({ ...prev, [emailToVerify]: true }));
    try {
      const res = await updateLeadDetailsApi(id, { forceVerifyEmail: emailToVerify });
      setLead(res.result);
      showToast(`SMTP verification complete for ${emailToVerify}`, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : `Failed to verify SMTP for ${emailToVerify}`, 'error');
    } finally {
      setVerifyingEmailMap((prev) => ({ ...prev, [emailToVerify]: false }));
    }
  };

  // ── Add Personal Email with Systematic De-duplication Across Containers ─────
  const handleAddPersonalEmail = async () => {
    const rawVal = addingEmailValue.trim().toLowerCase();
    if (!id) return;

    if (!isValidEmail(rawVal)) {
      showToast(`"${rawVal || 'Empty'}" is not a valid email address! (e.g. name@domain.com)`, 'error');
      return;
    }

    setAddingEmailLoading(true);
    try {
      // Clean rawVal out of all company email arrays to prevent duplicates
      const updatedCompanies = companies.map((comp) => ({
        ...comp,
        companyEmails: (comp.companyEmails ?? []).filter((e) => e.toLowerCase() !== rawVal),
      }));

      const existingDiscovered = Array.from(
        new Set([
          ...(lead?.discoveredEmails ?? []).filter((e) => e.toLowerCase() !== rawVal),
          rawVal,
        ])
      );

      const res = await updateLeadDetailsApi(id, {
        currentCompanies: updatedCompanies,
        discoveredEmails: existingDiscovered,
      });
      setLead(res.result);
      setAddingEmailBox(null);
      setAddingEmailValue('');
      showToast(`Added ${rawVal} to Personal Profile! Verifying SMTP...`, 'success');

      // Background SMTP Verification
      void handleVerifySingleEmail(rawVal);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to add personal email', 'error');
    } finally {
      setAddingEmailLoading(false);
    }
  };

  // ── Add Company Email with Systematic De-duplication Across Containers ─────
  const handleAddCompanyEmail = async (companyIndex: number) => {
    const rawVal = addingEmailValue.trim().toLowerCase();
    if (!id) return;

    if (!isValidEmail(rawVal)) {
      showToast(`"${rawVal || 'Empty'}" is not a valid email address! (e.g. contact@company.com)`, 'error');
      return;
    }

    setAddingEmailLoading(true);
    try {
      // Clean rawVal out of discoveredEmails
      const updatedDiscovered = (lead?.discoveredEmails ?? []).filter((e) => e.toLowerCase() !== rawVal);

      // Clean rawVal out of all other company email arrays, add to targeted companyIndex
      const updatedCompanies = companies.map((comp, idx) =>
        idx === companyIndex
          ? {
              ...comp,
              companyEmails: Array.from(new Set([...(comp.companyEmails ?? []).filter((e) => e.toLowerCase() !== rawVal), rawVal])),
            }
          : {
              ...comp,
              companyEmails: (comp.companyEmails ?? []).filter((e) => e.toLowerCase() !== rawVal),
            }
      );

      const res = await updateLeadDetailsApi(id, {
        currentCompanies: updatedCompanies,
        discoveredEmails: updatedDiscovered,
      });
      setLead(res.result);
      setAddingEmailBox(null);
      setAddingEmailValue('');
      showToast(`Added ${rawVal} to company! Verifying SMTP...`, 'success');

      // Background SMTP Verification
      void handleVerifySingleEmail(rawVal);
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to add company email', 'error');
    } finally {
      setAddingEmailLoading(false);
    }
  };

  // ── Email Remapping Handler Across Containers (Fixes Email Movement Glitch) ─
  const handleRemapEmail = async (
    email: string,
    fromContainer: 'personal' | number,
    toContainer: 'personal' | number
  ) => {
    if (!id) return;
    setRemapLoadingMap((prev) => ({ ...prev, [email]: true }));
    try {
      const targetEmail = email.toLowerCase().trim();

      // 1. Purge targetEmail out of ALL company email arrays
      const updatedCompanies = companies.map((c) => ({
        ...c,
        companyEmails: (c.companyEmails ?? []).filter((e) => e.toLowerCase() !== targetEmail),
      }));

      // 2. Purge targetEmail out of personal discoveredEmails
      let updatedDiscovered = (lead?.discoveredEmails ?? []).filter((e) => e.toLowerCase() !== targetEmail);

      // 3. Add to requested target container
      if (toContainer === 'personal') {
        if (!updatedDiscovered.some((e) => e.toLowerCase() === targetEmail)) {
          updatedDiscovered.push(targetEmail);
        }
      } else {
        const targetComp = updatedCompanies[toContainer];
        if (targetComp) {
          if (!targetComp.companyEmails.some((e) => e.toLowerCase() === targetEmail)) {
            targetComp.companyEmails.push(targetEmail);
          }
        }
      }

      // 4. Save updated containers to DB
      const res = await updateLeadDetailsApi(id, {
        currentCompanies: updatedCompanies,
        discoveredEmails: updatedDiscovered,
      });
      setLead(res.result);
      showToast(`Moved ${targetEmail} successfully!`, 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to remap email address', 'error');
    } finally {
      setRemapLoadingMap((prev) => ({ ...prev, [email]: false }));
    }
  };

  const handleCompanyCrawl = async (companyIndex: number, newUrl: string) => {
    if (!newUrl.trim() || !id) return;
    setCrawlingCompIndex(companyIndex);
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

      const crawlRes = await crawlLeadWebsiteApi(id, newUrl.trim(), [], companyIndex);
      setLead(crawlRes.result);
      setEditingWebIndex(null);
      setCustomWebInput('');
      showToast('Website saved and crawled! Contact emails updated.', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to crawl company website', 'error');
    } finally {
      setCrawlingCompIndex(null);
    }
  };

  const handlePersonalPortfolioCrawl = async (newUrl: string) => {
    if (!newUrl.trim() || !id) return;
    setCrawlingPersonalWeb(true);
    try {
      await updateLeadDetailsApi(id, { portfolioUrl: newUrl.trim() });
      const crawlRes = await crawlLeadWebsiteApi(id, newUrl.trim());
      setLead(crawlRes.result);
      setEditingPersonalWeb(false);
      showToast('Personal portfolio saved and crawled!', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to crawl personal website', 'error');
    } finally {
      setCrawlingPersonalWeb(false);
    }
  };

  const handleToggleApproveDraft = async (boxIndex: number) => {
    if (!id) return;
    try {
      if (boxIndex < 0) {
        // Personal Profile Outreach Draft
        const primaryPersonalEmail = personalEmails[0] || lead?.email || '';
        const emailStatus = verifiedMap.get(primaryPersonalEmail);

        if (!lead?.approved) {
          if (!primaryPersonalEmail || (emailStatus !== 'valid' && emailStatus !== 'risky')) {
            showToast('Cannot approve draft! Contact email must be entered and SMTP verified as valid or risky.', 'error');
            return;
          }
        }

        const newApproved = !lead?.approved;
        const res = await updateLeadDetailsApi(id, { approved: newApproved });
        setLead(res.result);
        showToast(newApproved ? 'Personal draft approved!' : 'Personal draft approval removed.', 'success');
      } else {
        // Company Outreach Draft (boxIndex >= 0)
        const updatedCompanies = [...companies];
        const comp = updatedCompanies[boxIndex];
        if (!comp) return;

        const compEmails = companyEmailMap.get(boxIndex) ?? [];
        const primaryEmail = compEmails[0] || '';
        const emailStatus = verifiedMap.get(primaryEmail);

        if (!comp.approved) {
          if (!primaryEmail || (emailStatus !== 'valid' && emailStatus !== 'risky')) {
            showToast('Cannot approve draft! Contact email must be entered and SMTP verified as valid or risky.', 'error');
            return;
          }
        }

        comp.approved = !comp.approved;

        const res = await updateLeadDetailsApi(id, {
          currentCompanies: updatedCompanies,
          approved: updatedCompanies[0]?.approved ?? lead?.approved,
        });
        setLead(res.result);
        showToast(comp.approved ? 'Company draft approved!' : 'Company draft approval removed.', 'success');
      }
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to update approval', 'error');
    }
  };


  // Save inline-edited subject + body for a specific draft box
  const handleSaveInlineDraft = async (boxIndex: number, subjectOverride?: string, bodyOverride?: string) => {
    if (!id) return;
    setSavingDraftIndex(boxIndex);
    try {
      const subjToSave = subjectOverride ?? (boxIndex === -1 ? lead?.emailSubject : companies[boxIndex]?.emailSubject) ?? '';
      const bodyToSave = bodyOverride ?? (boxIndex === -1 ? lead?.emailBody : companies[boxIndex]?.emailBody) ?? '';

      if (boxIndex === -1) {
        const res = await updateLeadDetailsApi(id, {
          emailSubject: subjToSave,
          emailBody: bodyToSave,
        });
        setLead(res.result);
      } else {
        const updatedCompanies = [...companies];
        updatedCompanies[boxIndex] = {
          ...updatedCompanies[boxIndex],
          emailSubject: subjToSave,
          emailBody: bodyToSave,
        };
        const res = await updateLeadDetailsApi(id, {
          currentCompanies: updatedCompanies,
          emailSubject: updatedCompanies[0]?.emailSubject ?? lead?.emailSubject,
          emailBody: updatedCompanies[0]?.emailBody ?? lead?.emailBody,
        });
        setLead(res.result);
      }
      showToast('Email draft saved successfully!', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to save email draft', 'error');
    } finally {
      setSavingDraftIndex(null);
    }
  };

  // Per-Company / Personal AI Draft Regeneration
  const handleRegenerateCompanyDraft = async (companyIndex: number) => {
    if (!id) return;
    setRegeneratingCompIndex(companyIndex);
    try {
      const res = await generateLeadEmailApi(id, undefined, companyIndex);
      setLead(res.result);
      showToast('Email draft regenerated with AI!', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to regenerate email draft', 'error');
    } finally {
      setRegeneratingCompIndex(null);
    }
  };

  // Refine Draft with AI Prompt (per-box inline bar)
  const handleAiRefineDraft = async (companyIndex: number) => {
    const promptText = (boxAiPrompts[companyIndex] || '').trim();
    if (!id || !promptText) return;
    setRewritingAiIndex(companyIndex);
    try {
      const res = await generateLeadEmailApi(id, promptText, companyIndex);
      setLead(res.result);
      setBoxAiPrompts((prev) => ({ ...prev, [companyIndex]: '' }));
      showToast('Email draft refined with AI!', 'success');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Failed to refine draft with AI', 'error');
    } finally {
      setRewritingAiIndex(null);
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
            summary: '',
          },
        ];

  const verifiedMap = new Map<string, VerifiedEmailItem['status']>();
  if (lead?.verifiedEmails) {
    lead.verifiedEmails.forEach((v) => verifiedMap.set(v.email, v.status));
  } else if (pipeline?.verifiedEmails) {
    pipeline.verifiedEmails.forEach((v) => verifiedMap.set(v.email, v.status));
  }

  const explicitDiscoveredEmails = Array.from(
    new Set(
      lead?.discoveredEmails !== undefined && lead.discoveredEmails.length > 0
        ? lead.discoveredEmails
        : lead?.email
        ? [lead.email]
        : []
    )
  );

  const unassignedCrawledEmails = pipeline?.crawledEmails ?? [];

  const { companyEmailMap, personalEmails } = getCategorizedEmails(
    companies,
    explicitDiscoveredEmails,
    unassignedCrawledEmails,
    portfolioUrl
  );

  const personalPhones = Array.from(new Set<string>([...(lead?.discoveredPhones ?? []), ...(pipeline?.crawledPhones ?? [])]));

  return (
    <div className="w-full max-w-none px-4 sm:px-8 py-6 space-y-6 relative">
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

            {/* Personal Emails — per-email edit/delete/add with save-first then SMTP */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Personal Emails</span>
                {addingEmailBox !== 'personal' && (
                  <button
                    type="button"
                    onClick={() => { setAddingEmailBox('personal'); setAddingEmailValue(''); }}
                    className="text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded hover:bg-blue-100 flex items-center gap-1 transition-colors"
                  >
                    + Add Email
                  </button>
                )}
              </div>

              {/* Add email row with Inline Zod-Style Error Helper */}
              {addingEmailBox === 'personal' && (
                <div className="flex flex-col gap-1.5 mb-2 bg-blue-50/60 border border-blue-100 rounded-md px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="email"
                      autoFocus
                      placeholder="e.g. name@domain.com"
                      value={addingEmailValue}
                      onChange={(e) => setAddingEmailValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && isValidEmail(addingEmailValue)) {
                          void handleAddPersonalEmail();
                        }
                      }}
                      disabled={addingEmailLoading}
                      className={[
                        'text-xs border rounded px-2.5 py-1.5 focus:ring-1 focus:outline-none flex-1 bg-white font-mono disabled:opacity-50 transition-colors',
                        addingEmailValue.length > 0 && !isValidEmail(addingEmailValue)
                          ? 'border-red-400 focus:ring-red-500 bg-red-50/30 text-red-900'
                          : 'border-slate-300 focus:ring-blue-500 text-slate-900',
                      ].join(' ')}
                    />
                    <Button
                      size="sm"
                      disabled={addingEmailLoading || !isValidEmail(addingEmailValue)}
                      onClick={() => { void handleAddPersonalEmail(); }}
                      className="bg-blue-600 hover:bg-blue-700 text-white text-[11px] px-3 py-1.5 font-semibold shrink-0 flex items-center gap-1 disabled:opacity-40 transition-all"
                    >
                      {addingEmailLoading ? <LoaderIcon width={10} height={10} className="animate-spin" /> : <CheckCircleIcon width={10} height={10} />}
                      Save & Verify
                    </Button>
                    <button
                      type="button"
                      onClick={() => { setAddingEmailBox(null); setAddingEmailValue(''); }}
                      className="text-[10px] text-slate-400 hover:text-slate-600 px-1"
                    >
                      Cancel
                    </button>
                  </div>
                  {addingEmailValue.length > 0 && !isValidEmail(addingEmailValue) && (
                    <p className="text-[11px] font-medium text-red-600 flex items-center gap-1 animate-in fade-in">
                      <AlertTriangleIcon width={12} height={12} className="shrink-0 text-red-500" />
                      Invalid email address (e.g. name@domain.com)
                    </p>
                  )}
                </div>
              )}

              {personalEmails.length === 0 && addingEmailBox !== 'personal' ? (
                <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs">
                  <span className="text-amber-800 font-semibold italic">No personal email address mapped yet</span>
                  <Badge tone="warning">⚠️ No Personal Email</Badge>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {personalEmails.map((em: string) => {
                    const status = verifiedMap.get(em);
                    const isVerifyingThis = verifyingEmailMap[em] || isGlobalVerifyRunning;
                    const isRemapping = remapLoadingMap[em];
                    const isEditingThis = editingEmailKey === em;

                    return (
                      <li key={em} className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-md px-3 py-1.5">
                        {isEditingThis ? (
                          <div className="flex flex-col gap-1 flex-1">
                            <div className="flex items-center gap-1.5">
                              <input
                                autoFocus
                                type="email"
                                value={editingEmailValue}
                                onChange={(e) => setEditingEmailValue(e.target.value)}
                                disabled={editingEmailLoading}
                                className={[
                                  'text-xs font-mono border rounded px-2 py-1 flex-1 focus:ring-1 focus:outline-none bg-white disabled:opacity-50 transition-colors',
                                  editingEmailValue.length > 0 && !isValidEmail(editingEmailValue)
                                    ? 'border-red-400 focus:ring-red-500 bg-red-50/30 text-red-900'
                                    : 'border-blue-300 focus:ring-blue-500 text-slate-900',
                                ].join(' ')}
                              />
                              <button
                                type="button"
                                disabled={editingEmailLoading || !isValidEmail(editingEmailValue)}
                                onClick={() => {
                                  void (async () => {
                                    const newVal = editingEmailValue.trim().toLowerCase();
                                    if (!isValidEmail(newVal)) {
                                      showToast(`"${newVal || 'Empty'}" is not a valid email address!`, 'error');
                                      return;
                                    }
                                    setEditingEmailLoading(true);
                                    try {
                                      const updated = personalEmails.map((e) => e === em ? newVal : e);
                                      const res = await updateLeadDetailsApi(id, { discoveredEmails: updated });
                                      setLead(res.result);
                                      setEditingEmailKey(null);
                                      showToast(`Updated email to ${newVal}`, 'success');
                                      void handleVerifySingleEmail(newVal);
                                    } catch (err) {
                                      showToast(err instanceof Error ? err.message : 'Failed to update email', 'error');
                                    } finally {
                                      setEditingEmailLoading(false);
                                    }
                                  })();
                                }}
                                className="text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded hover:bg-green-100 flex items-center gap-1 disabled:opacity-40"
                              >
                                {editingEmailLoading ? <LoaderIcon width={9} height={9} className="animate-spin" /> : '✓'} Save
                              </button>
                              <button type="button" onClick={() => setEditingEmailKey(null)} className="text-[10px] text-slate-400 hover:text-slate-600 px-1">
                                Cancel
                              </button>
                            </div>
                            {editingEmailValue.length > 0 && !isValidEmail(editingEmailValue) && (
                              <p className="text-[11px] font-medium text-red-600 flex items-center gap-1">
                                <AlertTriangleIcon width={11} height={11} className="shrink-0 text-red-500" />
                                Invalid email format (e.g. user@domain.com)
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs font-bold text-slate-900 font-mono flex-1 min-w-0 truncate">{em}</span>
                        )}

                        <div className="flex items-center gap-1.5 ml-auto shrink-0">
                          <SmtpBadge status={status ?? 'pending'} />

                          <button
                            type="button"
                            disabled={isVerifyingThis}
                            onClick={() => { void handleVerifySingleEmail(em); }}
                            title="Re-verify SMTP"
                            className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded hover:bg-amber-100 transition-colors disabled:opacity-50"
                          >
                            {isVerifyingThis ? <LoaderIcon width={9} height={9} className="animate-spin text-amber-600" /> : '⚡'}
                          </button>

                          {!isEditingThis && (
                            <button
                              type="button"
                              onClick={() => { setEditingEmailKey(em); setEditingEmailValue(em); }}
                              title="Edit email"
                              className="text-[10px] text-slate-400 hover:text-indigo-600 p-0.5 rounded transition-colors"
                            >
                              <EditIcon width={12} height={12} />
                            </button>
                          )}

                          {/* Remap to company */}
                          {companies.length > 0 && (
                            isRemapping ? (
                              <LoaderIcon width={10} height={10} className="animate-spin text-indigo-500" />
                            ) : (
                              <select
                                value="personal"
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (val.startsWith('c-')) { void handleRemapEmail(em, 'personal', parseInt(val.slice(2), 10)); }
                                }}
                                className="text-[10px] border border-slate-200 rounded px-1.5 py-0.5 bg-slate-50 text-slate-700 font-semibold focus:outline-none cursor-pointer hover:bg-slate-100"
                                title="Move to company box"
                              >
                                <option value="personal">👤 Personal</option>
                                {companies.map((c, idx) => <option key={idx} value={`c-${idx}`}>🏢 {c.companyName || `Co. #${idx + 1}`}</option>)}
                              </select>
                            )
                          )}

                          {/* Delete personal email */}
                          <button
                            type="button"
                            disabled={!!deletingEmailKey}
                            onClick={() => {
                              void (async () => {
                                setDeletingEmailKey(em);
                                try {
                                  const updated = personalEmails.filter((e) => e !== em);
                                  const res = await updateLeadDetailsApi(id, { discoveredEmails: updated });
                                  setLead(res.result);
                                  showToast(`Deleted ${em}`, 'info');
                                } catch (err) {
                                  showToast(err instanceof Error ? err.message : 'Failed to delete email', 'error');
                                } finally {
                                  setDeletingEmailKey(null);
                                }
                              })();
                            }}
                            title="Delete email"
                            className="text-[10px] text-red-400 hover:text-red-600 p-0.5 rounded transition-colors disabled:opacity-40"
                          >
                            {deletingEmailKey === em ? <LoaderIcon width={10} height={10} className="animate-spin" /> : <XIcon width={12} height={12} />}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {personalPhones.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1 border-t border-blue-100/60">
                {personalPhones.map((p) => (
                  <span key={p} className="bg-white border border-slate-200 text-slate-800 px-2.5 py-1 rounded-md font-mono text-[11px] font-medium">📞 {p}</span>
                ))}
              </div>
            )}

            {/* IN-BOX PERSONAL AI OUTREACH DRAFT — Fully Inline Editor */}
            {(() => {
              const primaryPersonalEmail = personalEmails[0] || lead?.email || '';
              const personalSmtpStatus = primaryPersonalEmail ? (verifiedMap.get(primaryPersonalEmail) ?? 'pending') : null;

              return (
                <InlineRichDraftEditor
                  title="Personal AI Outreach Draft"
                  themeColor="blue"
                  initialSubject={lead?.emailSubject || ''}
                  initialBody={lead?.emailBody || ''}
                  smtpStatus={personalSmtpStatus}
                  hasEmail={Boolean(primaryPersonalEmail)}
                  isSaving={savingDraftIndex === -1}
                  isRegenerating={regeneratingCompIndex === -1}
                  isRewriting={rewritingAiIndex === -1}
                  isApproved={Boolean(lead?.approved)}
                  aiPromptValue={boxAiPrompts[-1] || ''}
                  onSave={(subj, body) => handleSaveInlineDraft(-1, subj, body)}
                  onRegenerate={() => handleRegenerateCompanyDraft(-1)}
                  onToggleApprove={() => handleToggleApproveDraft(-1)}
                  onAiPromptChange={(val) => setBoxAiPrompts((prev) => ({ ...prev, [-1]: val }))}
                  onAiRefine={() => handleAiRefineDraft(-1)}
                />
              );
            })()}
          </div>

          {/* Company Sub-Boxes Updated In-Place with Strict Email Deduplication */}
          <div className="space-y-4">
            {companies.map((c, i) => {
              const isCrawlingThis = (crawlingCompIndex === i) || (isGlobalCrawlRunning && Boolean(c.websiteUrl));
              const isEditingThis = editingWebIndex === i;

              const compEmails = companyEmailMap.get(i) ?? [];
              const draftSubject = c.emailSubject ?? null;
              const draftBody = c.emailBody ?? null;
              const isApproved = c.approved ?? false;

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

                  {/* Company Contact Emails — per-email edit/delete/add with save-first then SMTP */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Contact Emails</span>
                      {addingEmailBox !== String(i) && (
                        <button
                          type="button"
                          onClick={() => { setAddingEmailBox(String(i)); setAddingEmailValue(''); }}
                          className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2.5 py-0.5 rounded hover:bg-indigo-100 flex items-center gap-1 transition-colors"
                        >
                          + Add Email
                        </button>
                      )}
                    </div>

                    {/* Add email row with Inline Zod-Style Error Helper */}
                    {addingEmailBox === String(i) && (
                      <div className="flex flex-col gap-1.5 mb-2 bg-indigo-50/60 border border-indigo-100 rounded-md px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="email"
                            autoFocus
                            placeholder="e.g. contact@company.com"
                            value={addingEmailValue}
                            onChange={(e) => setAddingEmailValue(e.target.value)}
                            disabled={addingEmailLoading}
                            className={[
                              'text-xs border rounded px-2.5 py-1.5 focus:ring-1 focus:outline-none flex-1 bg-white font-mono disabled:opacity-50 transition-colors',
                              addingEmailValue.length > 0 && !isValidEmail(addingEmailValue)
                                ? 'border-red-400 focus:ring-red-500 bg-red-50/30 text-red-900'
                                : 'border-slate-300 focus:ring-indigo-500 text-slate-900',
                            ].join(' ')}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && isValidEmail(addingEmailValue)) {
                                void handleAddCompanyEmail(i);
                              }
                            }}
                          />
                          <Button
                            size="sm"
                            disabled={addingEmailLoading || !isValidEmail(addingEmailValue)}
                            onClick={() => { void handleAddCompanyEmail(i); }}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] px-3 py-1.5 font-semibold shrink-0 flex items-center gap-1 disabled:opacity-40 transition-all"
                          >
                            {addingEmailLoading ? <LoaderIcon width={10} height={10} className="animate-spin" /> : <CheckCircleIcon width={10} height={10} />}
                            Save & Verify
                          </Button>
                          <button
                            type="button"
                            onClick={() => { setAddingEmailBox(null); setAddingEmailValue(''); }}
                            className="text-[10px] text-slate-400 hover:text-slate-600 px-1"
                          >
                            Cancel
                          </button>
                        </div>
                        {addingEmailValue.length > 0 && !isValidEmail(addingEmailValue) && (
                          <p className="text-[11px] font-medium text-red-600 flex items-center gap-1 animate-in fade-in">
                            <AlertTriangleIcon width={12} height={12} className="shrink-0 text-red-500" />
                            Invalid email address (e.g. contact@company.com)
                          </p>
                        )}
                      </div>
                    )}

                    {compEmails.length === 0 && addingEmailBox !== String(i) ? (
                      <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-md px-3 py-2 text-xs">
                        <span className="text-amber-800 font-semibold italic">{isCrawlingThis ? 'Extracting emails...' : 'No contact emails for this company'}</span>
                        <Badge tone="warning">⚠️ No Company Email</Badge>
                      </div>
                    ) : (
                      <ul className="space-y-1.5">
                        {compEmails.map((em: string) => {
                          const status = verifiedMap.get(em);
                          const isVerifyingThis = verifyingEmailMap[em] || isGlobalVerifyRunning;
                          const isRemapping = remapLoadingMap[em];
                          const isEditingThis = editingEmailKey === em;

                          return (
                            <li key={em} className="flex flex-wrap items-center gap-2 bg-white border border-slate-200 rounded-md px-3 py-1.5">
                              {isEditingThis ? (
                                <div className="flex flex-col gap-1 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      autoFocus
                                      type="email"
                                      value={editingEmailValue}
                                      onChange={(e) => setEditingEmailValue(e.target.value)}
                                      disabled={editingEmailLoading}
                                      className={[
                                        'text-xs font-mono border rounded px-2 py-1 flex-1 focus:ring-1 focus:outline-none bg-white disabled:opacity-50 transition-colors',
                                        editingEmailValue.length > 0 && !isValidEmail(editingEmailValue)
                                          ? 'border-red-400 focus:ring-red-500 bg-red-50/30 text-red-900'
                                          : 'border-indigo-300 focus:ring-indigo-500 text-slate-900',
                                      ].join(' ')}
                                    />
                                    <button
                                      type="button"
                                      disabled={editingEmailLoading || !isValidEmail(editingEmailValue)}
                                      onClick={() => {
                                        void (async () => {
                                          const newVal = editingEmailValue.trim().toLowerCase();
                                          if (!isValidEmail(newVal)) {
                                            showToast(`"${newVal || 'Empty'}" is not a valid email address!`, 'error');
                                            return;
                                          }
                                          setEditingEmailLoading(true);
                                          try {
                                            const updComp = companies.map((comp, idx) => idx === i
                                              ? { ...comp, companyEmails: (comp.companyEmails ?? []).map((e) => e === em ? newVal : e) }
                                              : { ...comp });
                                            const res = await updateLeadDetailsApi(id, { currentCompanies: updComp });
                                            setLead(res.result);
                                            setEditingEmailKey(null);
                                            showToast(`Updated email to ${newVal}`, 'success');
                                            void handleVerifySingleEmail(newVal);
                                          } catch (err) {
                                            showToast(err instanceof Error ? err.message : 'Failed to update email', 'error');
                                          } finally {
                                            setEditingEmailLoading(false);
                                          }
                                        })();
                                      }}
                                      className="text-[10px] font-bold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded hover:bg-green-100 flex items-center gap-1 disabled:opacity-40"
                                    >
                                      {editingEmailLoading ? <LoaderIcon width={9} height={9} className="animate-spin" /> : '✓'} Save
                                    </button>
                                    <button type="button" onClick={() => setEditingEmailKey(null)} className="text-[10px] text-slate-400 hover:text-slate-600 px-1">
                                      Cancel
                                    </button>
                                  </div>
                                  {editingEmailValue.length > 0 && !isValidEmail(editingEmailValue) && (
                                    <p className="text-[11px] font-medium text-red-600 flex items-center gap-1">
                                      <AlertTriangleIcon width={11} height={11} className="shrink-0 text-red-500" />
                                      Invalid email format (e.g. user@domain.com)
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <span className="text-xs font-bold text-slate-900 font-mono flex-1 min-w-0 truncate">{em}</span>
                              )}

                              <div className="flex items-center gap-1.5 ml-auto shrink-0">
                                <SmtpBadge status={status ?? 'pending'} />
                                <button
                                  type="button"
                                  disabled={isVerifyingThis}
                                  onClick={() => { void handleVerifySingleEmail(em); }}
                                  title="Re-verify SMTP"
                                  className="flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded hover:bg-amber-100 transition-colors disabled:opacity-50"
                                >
                                  {isVerifyingThis ? <LoaderIcon width={9} height={9} className="animate-spin text-amber-600" /> : '⚡'}
                                </button>
                                {!isEditingThis && (
                                  <button
                                    type="button"
                                    onClick={() => { setEditingEmailKey(em); setEditingEmailValue(em); }}
                                    title="Edit email"
                                    className="text-[10px] text-slate-400 hover:text-indigo-600 p-0.5 rounded transition-colors"
                                  >
                                    <EditIcon width={12} height={12} />
                                  </button>
                                )}
                                {/* Remap */}
                                {isRemapping ? <LoaderIcon width={10} height={10} className="animate-spin text-indigo-500" /> : (
                                  <select
                                    value={`c-${i}`}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val === 'personal') { void handleRemapEmail(em, i, 'personal'); }
                                      else if (val.startsWith('c-')) { const idx = parseInt(val.slice(2), 10); if (idx !== i) void handleRemapEmail(em, i, idx); }
                                    }}
                                    className="text-[10px] border border-slate-200 rounded px-1.5 py-0.5 bg-slate-50 text-slate-700 font-semibold focus:outline-none cursor-pointer hover:bg-slate-100"
                                    title="Move email"
                                  >
                                    <option value="personal">👤 Personal</option>
                                    {companies.map((compObj, idx) => <option key={idx} value={`c-${idx}`}>🏢 {idx === i ? `Here` : compObj.companyName || `Co. #${idx + 1}`}</option>)}
                                  </select>
                                )}
                                {/* Delete company email */}
                                <button
                                  type="button"
                                  disabled={!!deletingEmailKey}
                                  onClick={() => {
                                    void (async () => {
                                      setDeletingEmailKey(em);
                                      try {
                                        const updComp = companies.map((comp, idx) => idx === i
                                          ? { ...comp, companyEmails: (comp.companyEmails ?? []).filter((e) => e !== em) }
                                          : { ...comp });
                                        const res = await updateLeadDetailsApi(id, { currentCompanies: updComp });
                                        setLead(res.result);
                                        showToast(`Deleted ${em}`, 'info');
                                      } catch (err) {
                                        showToast(err instanceof Error ? err.message : 'Failed to delete email', 'error');
                                      } finally {
                                        setDeletingEmailKey(null);
                                      }
                                    })();
                                  }}
                                  title="Delete email"
                                  className="text-[10px] text-red-400 hover:text-red-600 p-0.5 rounded transition-colors disabled:opacity-40"
                                >
                                  {deletingEmailKey === em ? <LoaderIcon width={10} height={10} className="animate-spin" /> : <XIcon width={12} height={12} />}
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>

                  {/* IN-BOX AI OUTREACH DRAFT — Fully Inline Editor */}
                  {(() => {
                    const primaryCompEmail = compEmails[0] || '';
                    const compSmtpStatus = primaryCompEmail ? (verifiedMap.get(primaryCompEmail) ?? 'pending') : null;

                    return (
                      <InlineRichDraftEditor
                        key={i}
                        title={`AI Outreach Draft — ${c.companyName || `Company #${i + 1}`}`}
                        themeColor="indigo"
                        initialSubject={draftSubject || ''}
                        initialBody={draftBody || ''}
                        smtpStatus={compSmtpStatus}
                        hasEmail={Boolean(primaryCompEmail)}
                        isSaving={savingDraftIndex === i}
                        isRegenerating={regeneratingCompIndex === i}
                        isRewriting={rewritingAiIndex === i}
                        isApproved={isApproved}
                        aiPromptValue={boxAiPrompts[i] || ''}
                        onSave={(subj, body) => handleSaveInlineDraft(i, subj, body)}
                        onRegenerate={() => handleRegenerateCompanyDraft(i)}
                        onToggleApprove={() => handleToggleApproveDraft(i)}
                        onAiPromptChange={(val) => setBoxAiPrompts((prev) => ({ ...prev, [i]: val }))}
                        onAiRefine={() => handleAiRefineDraft(i)}
                      />
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Floating Toast Notification Container (Top-Right & Compact) */}
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

