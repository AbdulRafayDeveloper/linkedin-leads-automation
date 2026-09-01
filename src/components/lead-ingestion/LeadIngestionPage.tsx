'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  getIngestedLeadsApi,
  crawlLeadWebsiteApi,
  generateLeadEmailApi,
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
  MailIcon,
  SparklesIcon,
  RefreshIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  ExternalLinkIcon,
  GlobeIcon,
} from '@/components/ui/Icons';
import { useRouter } from 'next/navigation';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExtractedPreview {
  fullName: string | null;
  personSummary: string;
  currentCompanies: CurrentCompanyItem[];
  rawUrls: string[];
  rawEmails: string[];
  rawPhones: string[];
}

interface PipelineState {
  leadId: string | null;
  clientId: string | null;
  clientName: string | null;
  phase: 1 | 2 | 3 | 4 | 'done';
  running: boolean;
  error: string | null;
  extracted: ExtractedPreview | null;
  mappedCompanies: CurrentCompanyItem[] | null;
  portfolioUrl: string | null;
  crawledEmails: string[];
  crawledPhones: string[];
  verifiedEmails: Array<{ email: string; status: VerifiedEmailItem['status'] }>;
  finalLead: LeadIngestionRecord | null;
}

const initialPipeline: PipelineState = {
  leadId: null,
  clientId: null,
  clientName: null,
  phase: 1,
  running: false,
  error: null,
  extracted: null,
  mappedCompanies: null,
  portfolioUrl: null,
  crawledEmails: [],
  crawledPhones: [],
  verifiedEmails: [],
  finalLead: null,
};

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
      const dataMatch = chunk.match(/^data:\s*(.+)/ms);
      if (!eventMatch || !dataMatch) continue;
      try {
        onEvent(eventMatch[1].trim(), JSON.parse(dataMatch[1].trim()));
      } catch { /* ignore */ }
    }
  }
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

function PhaseSteps({ pipeline }: { pipeline: PipelineState }) {
  const currentStep = pipeline.phase === 'done' ? 5 : pipeline.phase;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {[
        { n: 1, label: 'AI Extraction' },
        { n: 2, label: 'URL Mapping' },
        { n: 3, label: 'Web Crawl' },
        { n: 4, label: 'SMTP Verify' },
      ].map((s, i) => (
        <span key={s.n} className="flex items-center gap-1.5">
          <StepBadge n={s.n} label={s.label} done={currentStep > s.n} active={currentStep === s.n && pipeline.running} />
          {i < 3 && <span className="text-slate-300 text-xs">→</span>}
        </span>
      ))}
    </div>
  );
}

/** Shows phase 1 result — extracted candidate data */
function ExtractionResult({
  data,
  pipeline,
  onNextPhase,
}: {
  data: ExtractedPreview;
  pipeline: PipelineState;
  onNextPhase: () => void;
}) {
  return (
    <div className="border border-green-200 bg-green-50/30 rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <CheckCircleIcon width={14} height={14} className="text-green-600" />
            <span className="text-xs font-bold text-green-800 uppercase tracking-wider">Phase 1 Complete — AI Extraction</span>
          </div>
          <div className="text-xl font-extrabold text-slate-900 mt-1">{data.fullName ?? 'Unknown'}</div>
          {pipeline.clientName && (
            <div className="text-xs font-semibold text-indigo-600 mt-0.5">Client folder: {pipeline.clientName}</div>
          )}
        </div>
        <Button
          size="sm"
          onClick={onNextPhase}
          disabled={pipeline.running}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-1.5 shrink-0"
        >
          {pipeline.running ? <LoaderIcon width={12} height={12} className="animate-spin" /> : <RefreshIcon width={12} height={12} />}
          Map URLs → Step 2
        </Button>
      </div>

      {data.personSummary && (
        <p className="text-xs text-slate-700 bg-white border border-slate-200 rounded-md px-3 py-2.5 leading-relaxed">
          {data.personSummary}
        </p>
      )}

      {/* Extracted Present Companies */}
      <div className="space-y-2">
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Present Working Companies ({data.currentCompanies.length})</span>
        {data.currentCompanies.map((c, i) => (
          <div key={i} className="bg-white border border-purple-200 rounded-md px-3 py-2.5 space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-extrabold text-slate-900">🏢 {c.companyName}</span>
              {c.websiteUrl && (
                <a href={c.websiteUrl.startsWith('http') ? c.websiteUrl : `https://${c.websiteUrl}`}
                  target="_blank" rel="noreferrer"
                  className="text-[10px] text-indigo-600 hover:underline flex items-center gap-0.5 font-semibold">
                  {c.websiteUrl.replace(/^https?:\/\//, '')}
                  <ExternalLinkIcon width={8} height={8} />
                </a>
              )}
            </div>
            <div className="text-xs text-slate-600 flex items-center gap-1.5">
              <span className="font-semibold text-indigo-600">{c.jobTitle}</span>
              {c.workPeriod && <span className="text-slate-400">({c.workPeriod})</span>}
            </div>
            {c.roleSummary && <p className="text-[11px] text-slate-500 italic">{c.roleSummary}</p>}
          </div>
        ))}
      </div>

      {/* Raw extracted data grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 border-t border-green-100">
        <div>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">URLs Found</span>
          {data.rawUrls.length === 0 ? (
            <span className="text-xs text-slate-400 italic">None</span>
          ) : data.rawUrls.map((u, i) => (
            <div key={i} className="text-[11px] text-indigo-600 truncate font-mono">{u}</div>
          ))}
        </div>
        <div>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Emails Found</span>
          {data.rawEmails.length === 0 ? (
            <span className="text-xs text-slate-400 italic">None in raw text</span>
          ) : data.rawEmails.map((e, i) => (
            <div key={i} className="text-[11px] text-slate-700 font-mono">{e}</div>
          ))}
        </div>
        <div>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Phones Found</span>
          {data.rawPhones.length === 0 ? (
            <span className="text-xs text-slate-400 italic">None in raw text</span>
          ) : data.rawPhones.map((p, i) => (
            <div key={i} className="text-[11px] text-slate-700 font-mono">📞 {p}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Shows phase 2 result — mapped companies with URLs */
function MappingResult({
  companies,
  portfolioUrl,
  pipeline,
  onNextPhase,
}: {
  companies: CurrentCompanyItem[];
  portfolioUrl: string | null;
  pipeline: PipelineState;
  onNextPhase: () => void;
}) {
  return (
    <div className="border border-blue-200 bg-blue-50/20 rounded-lg p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircleIcon width={14} height={14} className="text-blue-600" />
          <span className="text-xs font-bold text-blue-800 uppercase tracking-wider">Phase 2 Complete — URL Mapping</span>
        </div>
        <Button
          size="sm"
          onClick={onNextPhase}
          disabled={pipeline.running}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-1.5 shrink-0"
        >
          {pipeline.running ? <LoaderIcon width={12} height={12} className="animate-spin" /> : <GlobeIcon width={12} height={12} />}
          Crawl Websites → Step 3
        </Button>
      </div>

      {companies.map((c, i) => (
        <div key={i} className="bg-white border border-blue-200 rounded-md px-3 py-2.5 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-extrabold text-slate-900">🏢 {c.companyName}</div>
            <div className="text-xs text-slate-500 mt-0.5">{c.jobTitle} {c.workPeriod && `(${c.workPeriod})`}</div>
          </div>
          {c.websiteUrl ? (
            <a href={c.websiteUrl.startsWith('http') ? c.websiteUrl : `https://${c.websiteUrl}`}
              target="_blank" rel="noreferrer"
              className="text-xs font-semibold text-indigo-600 hover:underline flex items-center gap-1 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded">
              <GlobeIcon width={10} height={10} />
              {c.websiteUrl.replace(/^https?:\/\//, '').split('/')[0]}
              <ExternalLinkIcon width={8} height={8} />
            </a>
          ) : (
            <span className="text-xs text-slate-400 italic">No URL mapped</span>
          )}
        </div>
      ))}

      {portfolioUrl && (
        <div className="flex items-center gap-2 text-xs text-blue-700 bg-white border border-blue-200 rounded-md px-3 py-2">
          <span className="font-bold">👤 Personal Portfolio:</span>
          <a href={portfolioUrl.startsWith('http') ? portfolioUrl : `https://${portfolioUrl}`}
            target="_blank" rel="noreferrer"
            className="font-semibold text-blue-600 hover:underline flex items-center gap-1">
            {portfolioUrl}<ExternalLinkIcon width={9} height={9} />
          </a>
        </div>
      )}
    </div>
  );
}

/** Shows phase 3 result — crawled emails/phones */
function CrawlResult({
  emails,
  phones,
  pipeline,
  onNextPhase,
}: {
  emails: string[];
  phones: string[];
  pipeline: PipelineState;
  onNextPhase: () => void;
}) {
  return (
    <div className="border border-orange-200 bg-orange-50/20 rounded-lg p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CheckCircleIcon width={14} height={14} className="text-orange-600" />
          <span className="text-xs font-bold text-orange-800 uppercase tracking-wider">
            Phase 3 Complete — Web Crawl ({emails.length} email{emails.length !== 1 ? 's' : ''} found)
          </span>
        </div>
        {emails.length > 0 && (
          <Button
            size="sm"
            onClick={onNextPhase}
            disabled={pipeline.running}
            className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-1.5 shrink-0"
          >
            {pipeline.running ? <LoaderIcon width={12} height={12} className="animate-spin" /> : <MailIcon width={12} height={12} />}
            Verify Emails → Step 4
          </Button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Discovered Emails</span>
          {emails.length === 0 ? (
            <span className="text-xs text-slate-400 italic">No emails found on site</span>
          ) : emails.map((e, i) => (
            <div key={i} className="text-[11px] font-mono text-slate-700 py-0.5">{e}</div>
          ))}
        </div>
        <div>
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Discovered Phones</span>
          {phones.length === 0 ? (
            <span className="text-xs text-slate-400 italic">No phones found</span>
          ) : phones.map((p, i) => (
            <div key={i} className="text-[11px] font-mono text-slate-700 py-0.5">📞 {p}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Final verified lead card */
function FinalLeadCard({ lead, onLeadUpdated }: { lead: LeadIngestionRecord; onLeadUpdated: (u: LeadIngestionRecord) => void }) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [crawling, setCrawling] = useState(false);
  const [extraUrl, setExtraUrl] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const companies: CurrentCompanyItem[] = lead.currentCompanies?.length
    ? lead.currentCompanies
    : [{ companyName: lead.companyName ?? 'Unknown', jobTitle: lead.jobTitle ?? '', workPeriod: lead.workPeriod ?? null, websiteUrl: lead.websiteUrl ?? null, roleSummary: lead.summary ?? '' }];

  const verifiedMap = new Map((lead.verifiedEmails ?? []).map((v) => [v.email, v.status]));
  const emails = Array.from(new Set([...(lead.email ? [lead.email] : []), ...(lead.discoveredEmails ?? [])]));

  const handleEmail = async () => {
    setGenerating(true); setErr(null);
    try {
      const res = await generateLeadEmailApi(lead._id);
      onLeadUpdated(res.result);
      router.push('/lead-ingestion/emails');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); }
    finally { setGenerating(false); }
  };

  const handleCrawl = async () => {
    setCrawling(true); setErr(null);
    try {
      const extras = extraUrl.trim() ? [extraUrl.trim()] : [];
      const res = await crawlLeadWebsiteApi(lead._id, lead.websiteUrl ?? undefined, extras);
      onLeadUpdated(res.result);
      setExtraUrl('');
    } catch (e) { setErr(e instanceof Error ? e.message : 'Crawl failed'); }
    finally { setCrawling(false); }
  };

  return (
    <Card className="border border-green-200 shadow-sm bg-white">
      <CardHeader
        title={
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <CheckCircleIcon width={16} height={16} className="text-green-500" />
                <span className="text-xl font-extrabold text-slate-900">{lead.fullName}</span>
              </div>
              <div className="text-xs text-slate-500 mt-0.5">
                {companies.length} present {companies.length === 1 ? 'company' : 'companies'} · All phases complete
              </div>
            </div>
            <Button size="sm" onClick={() => { void handleEmail(); }} disabled={generating}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-1.5 shrink-0">
              {generating ? <LoaderIcon width={12} height={12} className="animate-spin" /> : <SparklesIcon width={12} height={12} />}
              {lead.emailSubject ? 'Edit Draft Email' : 'Write Outreach Email'}
            </Button>
          </div>
        }
      />
      <CardContent className="pt-3 space-y-4">
        {lead.summary && (
          <p className="text-xs text-slate-700 bg-slate-50 border border-slate-100 rounded-md px-3.5 py-3 leading-relaxed">{lead.summary}</p>
        )}

        {companies.map((c, i) => {
          const compEmails = emails; // all emails on primary; could be per-company later
          return (
            <div key={i} className="border border-purple-200 bg-purple-50/20 rounded-lg p-4 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 border-b border-purple-100 pb-3">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">{c.companyName}</h3>
                  <div className="text-xs text-indigo-600 font-semibold mt-0.5 flex items-center gap-1.5">
                    <span>{c.jobTitle}</span>
                    {c.workPeriod && <span className="text-slate-400">({c.workPeriod})</span>}
                  </div>
                </div>
                {c.websiteUrl && (
                  <a href={c.websiteUrl.startsWith('http') ? c.websiteUrl : `https://${c.websiteUrl}`}
                    target="_blank" rel="noreferrer"
                    className="flex items-center gap-1 text-xs font-semibold text-indigo-600 border border-purple-200 bg-white px-2.5 py-1 rounded-md hover:underline shrink-0">
                    <GlobeIcon width={10} height={10} />
                    {c.websiteUrl.replace(/^https?:\/\//, '').split('/')[0]}
                    <ExternalLinkIcon width={9} height={9} />
                  </a>
                )}
              </div>

              {i === 0 && compEmails.length > 0 && (
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">Contact Emails</span>
                  <ul className="space-y-1">
                    {compEmails.map((em) => (
                      <li key={em} className="flex items-center justify-between bg-white border border-slate-200 rounded-md px-2.5 py-1.5 gap-2">
                        <span className="text-[11px] font-semibold text-slate-800 truncate font-mono">{em}</span>
                        <SmtpBadge status={verifiedMap.get(em) ?? (lead.email === em ? lead.emailValidationStatus : 'pending')} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {i === 0 && (lead.discoveredPhones ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {(lead.discoveredPhones ?? []).map((p) => (
                    <span key={p} className="bg-white border border-slate-200 text-slate-800 px-2.5 py-1 rounded-md font-mono text-[11px]">📞 {p}</span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {lead.portfolioUrl && (
          <div className="border border-blue-200 bg-blue-50/20 rounded-md px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-xs font-bold text-blue-900">👤 Personal Portfolio</span>
            <a href={lead.portfolioUrl.startsWith('http') ? lead.portfolioUrl : `https://${lead.portfolioUrl}`}
              target="_blank" rel="noreferrer"
              className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
              {lead.portfolioUrl}<ExternalLinkIcon width={9} height={9} />
            </a>
          </div>
        )}

        <div className="flex gap-2 pt-1 border-t border-slate-100">
          <input type="url" placeholder="Add URL to crawl for more contacts..." value={extraUrl}
            onChange={(e) => setExtraUrl(e.target.value)}
            className="flex-1 text-xs border border-slate-200 rounded-md px-3 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:outline-none" />
          <Button variant="outline" size="sm" onClick={() => { void handleCrawl(); }} disabled={crawling}
            className="shrink-0 border-slate-300 text-slate-600 flex items-center gap-1 text-xs">
            {crawling ? <LoaderIcon width={11} height={11} className="animate-spin" /> : <RefreshIcon width={11} height={11} />}
            Crawl
          </Button>
        </div>
        {err && <p className="text-xs text-red-600 font-semibold">{err}</p>}
      </CardContent>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LeadIngestionPage() {
  const [rawText, setRawText] = useState('');
  const [pipeline, setPipeline] = useState<PipelineState | null>(null);
  const [savedLeads, setSavedLeads] = useState<LeadIngestionRecord[]>([]);
  const [pageError, setPageError] = useState<string | null>(null);

  // Helper: call SSE stream endpoint for a given phase
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

  // PHASE 1 — run on form submit
  const handleIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = rawText.trim();
    if (!text) return;

    setPageError(null);
    setRawText('');
    setPipeline({ ...initialPipeline, running: true, phase: 1 });

    try {
      const body = await callPhase('extract', { content: text });

      let extracted: ExtractedPreview | null = null;
      let clientId: string | null = null;
      let leadId: string | null = null;
      let clientName: string | null = null;

      await readStream(body, (event, data) => {
        const d = data as Record<string, unknown>;
        if (event === 'extracted') extracted = d as unknown as ExtractedPreview;
        if (event === 'client_created') {
          clientId = d.clientId as string;
          leadId = d.leadId as string;
          clientName = d.clientName as string;
        }
      });

      setPipeline((prev) => prev ? ({
        ...prev,
        running: false,
        phase: 2,
        extracted,
        clientId,
        leadId,
        clientName,
      }) : null);
    } catch (err) {
      setPipeline(null);
      setPageError(err instanceof Error ? err.message : 'Phase 1 failed');
    }
  };

  // PHASE 2 — manual trigger
  const handleMapPhase = async () => {
    if (!pipeline?.leadId) return;
    setPipeline((p) => p ? ({ ...p, running: true }) : null);

    try {
      const body = await callPhase('map', { leadId: pipeline.leadId });
      let mappedCompanies: CurrentCompanyItem[] | null = null;
      let portfolioUrl: string | null = null;

      await readStream(body, (event, data) => {
        const d = data as Record<string, unknown>;
        if (event === 'mapped') {
          mappedCompanies = (d.mappedCompanies ?? null) as CurrentCompanyItem[] | null;
          portfolioUrl = (d.portfolioUrl ?? null) as string | null;
        }
      });

      setPipeline((p) => p ? ({ ...p, running: false, phase: 3, mappedCompanies, portfolioUrl }) : null);
    } catch (err) {
      setPipeline((p) => p ? ({ ...p, running: false, error: err instanceof Error ? err.message : 'Phase 2 failed' }) : null);
    }
  };

  // PHASE 3 — manual trigger
  const handleCrawlPhase = async () => {
    if (!pipeline?.leadId) return;
    setPipeline((p) => p ? ({ ...p, running: true }) : null);

    try {
      const body = await callPhase('crawl', { leadId: pipeline.leadId });
      let crawledEmails: string[] = [];
      let crawledPhones: string[] = [];

      await readStream(body, (event, data) => {
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

      setPipeline((p) => p ? ({ ...p, running: false, phase: 4, crawledEmails, crawledPhones }) : null);
    } catch (err) {
      setPipeline((p) => p ? ({ ...p, running: false, error: err instanceof Error ? err.message : 'Phase 3 failed' }) : null);
    }
  };

  // PHASE 4 — manual trigger
  const handleVerifyPhase = async () => {
    if (!pipeline?.leadId || !pipeline.clientId) return;
    setPipeline((p) => p ? ({ ...p, running: true }) : null);

    try {
      const body = await callPhase('verify', { leadId: pipeline.leadId });
      let finalLead: LeadIngestionRecord | null = null;
      const verifiedEmails: Array<{ email: string; status: VerifiedEmailItem['status'] }> = [];

      await readStream(body, (event, data) => {
        const d = data as Record<string, unknown>;
        if (event === 'verified') {
          verifiedEmails.push({ email: d.email as string, status: d.status as VerifiedEmailItem['status'] });
          setPipeline((p) => p ? ({ ...p, verifiedEmails: [...p.verifiedEmails, { email: d.email as string, status: d.status as VerifiedEmailItem['status'] }] }) : null);
        }
        if (event === 'done') finalLead = d.result as LeadIngestionRecord;
      });

      if (finalLead) {
        setSavedLeads((prev) => [finalLead!, ...prev]);
      }

      setPipeline((p) => p ? ({ ...p, running: false, phase: 'done', finalLead }) : null);

      // Reload recently processed leads
      if (pipeline.clientId) {
        try {
          const { results } = await getIngestedLeadsApi(pipeline.clientId);
          if (results.length > 0) {
            setSavedLeads((prev) => {
              const ids = new Set(prev.map((l) => l._id));
              return [...results.filter((r) => !ids.has(r._id)), ...prev];
            });
          }
        } catch { /* ignore */ }
      }
    } catch (err) {
      setPipeline((p) => p ? ({ ...p, running: false, error: err instanceof Error ? err.message : 'Phase 4 failed' }) : null);
    }
  };

  const isRunning = !!pipeline?.running;

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <PageHeader
          title="Lead Ingestion & Intelligence"
          description="Paste LinkedIn raw text. AI extracts present companies → maps URLs → crawls sites → verifies emails, step by step."
        />
        <Link href="/lead-ingestion/emails">
          <Button variant="outline" className="flex items-center gap-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50 text-sm">
            <MailIcon width={15} height={15} />
            Outreach Emails
          </Button>
        </Link>
      </div>

      {pageError && (
        <div className="flex gap-2.5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangleIcon width={15} height={15} className="shrink-0 mt-0.5" />
          {pageError}
        </div>
      )}

      {/* Paste Box */}
      <Card className="border border-indigo-100 bg-gradient-to-br from-indigo-50/30 to-white shadow-sm">
        <CardHeader title="Paste LinkedIn Raw Profile Text" action={<SparklesIcon width={16} height={16} className="text-indigo-400" />} />
        <CardContent className="pt-2">
          <form onSubmit={(e) => { void handleIngest(e); }} className="space-y-3">
            <textarea
              rows={5}
              required
              placeholder="Paste the full raw text from a LinkedIn Sales Navigator profile page here..."
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              disabled={isRunning}
              className="w-full text-sm text-slate-800 border border-slate-200 rounded-md p-3.5 focus:ring-2 focus:ring-indigo-500 focus:outline-none leading-relaxed bg-white disabled:opacity-50"
            />
            <div className="flex justify-end">
              <Button type="submit" disabled={!rawText.trim() || isRunning}
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-6 py-2.5 flex items-center gap-2">
                {isRunning && pipeline?.phase === 1
                  ? <><LoaderIcon width={15} height={15} className="animate-spin" />Extracting...</>
                  : <><SparklesIcon width={15} height={15} />Step 1: Extract with AI</>
                }
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Pipeline progress area */}
      {pipeline && (
        <div className="space-y-4">
          {/* Step indicator */}
          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <PhaseSteps pipeline={pipeline} />
            {pipeline.running && (
              <div className="flex items-center gap-2 mt-3 text-xs text-indigo-600 font-semibold">
                <LoaderIcon width={12} height={12} className="animate-spin" />
                Running phase {typeof pipeline.phase === 'number' ? pipeline.phase : ''}...
              </div>
            )}
            {pipeline.error && (
              <div className="flex items-center gap-2 mt-3 text-xs text-red-600 font-semibold">
                <AlertTriangleIcon width={12} height={12} />
                {pipeline.error}
              </div>
            )}
          </div>

          {/* Phase 1 result */}
          {pipeline.extracted && (
            <ExtractionResult
              data={pipeline.extracted}
              pipeline={pipeline}
              onNextPhase={() => { void handleMapPhase(); }}
            />
          )}

          {/* Phase 2 result */}
          {pipeline.mappedCompanies && (
            <MappingResult
              companies={pipeline.mappedCompanies}
              portfolioUrl={pipeline.portfolioUrl}
              pipeline={pipeline}
              onNextPhase={() => { void handleCrawlPhase(); }}
            />
          )}

          {/* Phase 3 result */}
          {(pipeline.phase === 4 || pipeline.phase === 'done') && (
            <CrawlResult
              emails={pipeline.crawledEmails}
              phones={pipeline.crawledPhones}
              pipeline={pipeline}
              onNextPhase={() => { void handleVerifyPhase(); }}
            />
          )}

          {/* Live SMTP verification during phase 4 */}
          {pipeline.phase === 4 && pipeline.running && pipeline.verifiedEmails.length > 0 && (
            <div className="border border-amber-200 bg-amber-50/20 rounded-lg p-4 space-y-2">
              <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider block">Verifying emails...</span>
              {pipeline.verifiedEmails.map((v, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="font-mono text-slate-700">{v.email}</span>
                  <SmtpBadge status={v.status} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Final completed lead cards */}
      {savedLeads.length > 0 && (
        <div className="space-y-4">
          <div className="text-sm font-bold text-slate-700 border-b border-slate-200 pb-2">
            Processed Candidate Records ({savedLeads.length})
          </div>
          {savedLeads.map((lead) => (
            <FinalLeadCard
              key={lead._id}
              lead={lead}
              onLeadUpdated={(u) => setSavedLeads((p) => p.map((x) => x._id === u._id ? u : x))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
