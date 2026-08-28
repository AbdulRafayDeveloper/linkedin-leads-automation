'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { enrichLeadApi, fetchLead, findCompanyWebsiteApi, processLeadApi } from '@/lib/api/client';
import type { EmailEntry, LeadRecord, ProcessingResult } from '@/lib/types/lead';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Input';
import Button, { buttonClasses } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import { AlertTriangleIcon, ArrowRightIcon, CheckCircleIcon, CopyIcon, LoaderIcon } from '@/components/ui/Icons';
import { cn } from '@/lib/utils/cn';

const STEPS = [
  'Parsing profile content',
  'Researching company',
  'Discovering email',
  'Validating email',
  'Generating personalized email',
  'Saving to database',
  'Awaiting approval',
];

const TERMINAL_ENRICHMENT_STATUSES = new Set(['COMPLETED', 'FAILED']);

const ENRICHMENT_STATUS_LABEL: Record<string, string> = {
  QUEUED: 'Queued',
  IDENTIFYING_COMPANY: 'Identifying current company',
  FINDING_WEBSITE: 'Finding official website',
  CRAWLING: 'Crawling company website',
  EXTRACTING: 'Extracting emails',
  VALIDATING: 'Validating emails',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
};

const EMAIL_SOURCE_LABEL: Record<EmailEntry['source'], string> = {
  LEAD_PROFILE: 'Lead profile',
  COMPANY_WEBSITE: 'Company website',
};

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-800">{value}</dd>
    </>
  );
}

function InfoLinkRow({ label, href }: { label: string; href: string | null | undefined }) {
  if (!href) return null;
  const normalizedHref = /^https?:\/\//i.test(href) ? href : `https://${href}`;
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-800">
        <a
          href={normalizedHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-600 underline decoration-indigo-200 underline-offset-2 hover:text-indigo-700"
        >
          {href}
        </a>
      </dd>
    </>
  );
}

function CompanyWebsiteRow({
  leadId,
  initialWebsite,
}: {
  leadId: string;
  initialWebsite: string | null;
}) {
  const [website, setWebsite] = useState<string | null>(initialWebsite);
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (website) {
    return <InfoLinkRow label="Company Website" href={website} />;
  }

  const handleSearch = async () => {
    setSearching(true);
    setError(null);
    setNotFound(false);
    try {
      const { website: found } = await findCompanyWebsiteApi(leadId);
      if (found) {
        setWebsite(found);
      } else {
        setNotFound(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search for company website');
    } finally {
      setSearching(false);
    }
  };

  return (
    <>
      <dt className="text-slate-500">Company Website</dt>
      <dd className="text-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-slate-500">Not found</span>
          <Button type="button" variant="outline" size="sm" onClick={handleSearch} disabled={searching}>
            {searching && <LoaderIcon width={12} height={12} />}
            {searching ? 'Searching…' : 'Search'}
          </Button>
        </div>
        {notFound && (
          <p className="mt-1 text-xs text-slate-500">No official website could be found on the web.</p>
        )}
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </dd>
    </>
  );
}

function CopyEmailButton({ email }: { email: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can fail in unsupported contexts; no user-facing error needed for a copy button.
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
    >
      <CopyIcon width={12} height={12} />
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function FindEmailsSection({ leadId, initialLead }: { leadId: string; initialLead: LeadRecord }) {
  const [lead, setLead] = useState<LeadRecord>(initialLead);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const leadIdRef = useRef(leadId);
  useEffect(() => {
    leadIdRef.current = leadId;
  });

  useEffect(() => {
    if (!started) return undefined;
    if (TERMINAL_ENRICHMENT_STATUSES.has(lead.enrichmentStatus)) return undefined;

    const interval = setInterval(async () => {
      try {
        const { lead: refreshed } = await fetchLead(leadIdRef.current);
        setLead(refreshed);
      } catch {
        // Transient polling failures are not user-facing; the next tick retries.
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [started, lead.enrichmentStatus]);

  const handleFindEmails = async () => {
    setStarting(true);
    setError(null);
    try {
      const { lead: queued } = await enrichLeadApi(leadId);
      setLead(queued);
      setStarted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start email search');
    } finally {
      setStarting(false);
    }
  };

  const inProgress = started && !TERMINAL_ENRICHMENT_STATUSES.has(lead.enrichmentStatus);

  return (
    <div className="mt-4 rounded-md border border-slate-200 p-3.5 text-sm">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Company Emails</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleFindEmails}
          disabled={starting || inProgress}
        >
          {(starting || inProgress) && <LoaderIcon width={13} height={13} />}
          {inProgress ? 'Searching…' : starting ? 'Starting…' : 'Find Emails'}
        </Button>
      </div>

      {error && <p className="mb-2 text-xs text-red-600">{error}</p>}

      {started && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-slate-500">
          {inProgress && <LoaderIcon width={12} height={12} />}
          {ENRICHMENT_STATUS_LABEL[lead.enrichmentStatus] || lead.enrichmentStatus}
          {inProgress ? '…' : ''}
        </p>
      )}

      {started && lead.enrichmentStatus === 'COMPLETED' && lead.emails.length === 0 && (
        <p className="text-slate-500">No public emails were found on the company website.</p>
      )}

      {lead.emails.length > 0 && (
        <ul className="flex flex-col divide-y divide-slate-100">
          {lead.emails.map((entry) => (
            <li
              key={entry.email + entry.discoveredAt}
              className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-900">{entry.email}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {EMAIL_SOURCE_LABEL[entry.source]}
                  {entry.emailType !== 'UNKNOWN' ? ` · ${entry.emailType}` : ''}
                </p>
                {entry.sourceUrl && (
                  <p className="mt-0.5 truncate text-xs text-slate-400">Source: {entry.sourceUrl}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <CopyEmailButton email={entry.email} />
                <StatusBadge value={entry.validationStatus} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LeadProcessingPage() {
  const [content, setContent] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [result, setResult] = useState<{ result: ProcessingResult; lead: LeadRecord } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    setIsProcessing(true);
    setError(null);
    setResult(null);
    setCurrentStep(0);

    const interval = setInterval(() => {
      setCurrentStep((step) => Math.min(step + 1, STEPS.length - 2));
    }, 700);

    try {
      const response = await processLeadApi(content);
      setCurrentStep(STEPS.length - 1);
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process lead');
    } finally {
      clearInterval(interval);
      setIsProcessing(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="Process New Lead"
        description="Paste the full content of a Sales Navigator lead page below."
      />

      <Card>
        <CardContent className="pt-5">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={12}
              placeholder="Paste Sales Navigator lead content here..."
              className="font-mono text-xs leading-relaxed"
            />
            <Button type="submit" size="md" className="self-start" disabled={!content.trim()} isLoading={isProcessing}>
              {isProcessing ? 'Processing…' : 'Process Lead'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {isProcessing && (
        <Card className="mt-4">
          <CardContent className="py-4">
            <ol className="flex flex-col gap-3 text-sm">
              {STEPS.map((step, index) => {
                const done = index < currentStep;
                const active = index === currentStep;
                return (
                  <li key={step} className="flex items-center gap-2.5">
                    {done ? (
                      <CheckCircleIcon width={16} height={16} className="shrink-0 text-emerald-600" />
                    ) : active ? (
                      <LoaderIcon width={16} height={16} className="shrink-0 text-indigo-600" />
                    ) : (
                      <span className="h-4 w-4 shrink-0 rounded-full border-2 border-slate-200" />
                    )}
                    <span className={cn(done || active ? 'font-medium text-slate-800' : 'text-slate-400')}>
                      {step}
                    </span>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      )}

      {error && (
        <div className="mt-4 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangleIcon width={16} height={16} />
          {error}
        </div>
      )}

      {result && (
        <Card data-testid="processing-result" className="mt-6">
          <CardHeader
            title="Processing Complete"
            action={<StatusBadge value={result.result.validation.status} />}
          />
          <CardContent>
            <FindEmailsSection key={result.lead._id} leadId={result.lead._id} initialLead={result.lead} />

            <dl className="grid grid-cols-2 gap-y-2 text-sm mt-4">
              <InfoRow label="Name" value={result.result.lead.fullName} />
              <InfoRow label="Title" value={result.result.lead.currentTitle} />
              <InfoRow label="Company" value={result.result.lead.currentCompany} />
              <InfoRow label="Location" value={result.result.lead.location} />
              <InfoRow label="Company Location" value={result.result.lead.currentCompanyLocation} />
              <CompanyWebsiteRow
                key={result.lead._id}
                leadId={result.lead._id}
                initialWebsite={result.result.company.officialWebsite || result.result.lead.currentCompanyWebsite}
              />
              <InfoRow label="Lead Email" value={result.result.emailDiscovery.email || 'Not found'} />
              <InfoRow
                label="Processing Time"
                value={`${(result.result.totalProcessingTimeMs / 1000).toFixed(1)}s`}
              />
            </dl>

            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-semibold text-slate-900">{result.result.generatedEmail.subject}</p>
              <p className="mt-1 whitespace-pre-wrap text-slate-600">{result.result.generatedEmail.body}</p>
            </div>

            <Link
              href="/dashboard"
              className={cn(buttonClasses('outline', 'sm'), 'mt-4')}
            >
              View in dashboard
              <ArrowRightIcon width={14} height={14} />
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
