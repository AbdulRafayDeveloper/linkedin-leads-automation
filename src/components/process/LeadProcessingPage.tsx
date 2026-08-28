'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  addLeadEmailApi,
  enrichLeadApi,
  fetchLead,
  findCompanyWebsiteApi,
  processLeadApi,
  updateLeadApi,
} from '@/lib/api/client';
import type { EmailEntry, LeadRecord, ProcessingResult } from '@/lib/types/lead';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Input, Textarea } from '@/components/ui/Input';
import Button, { buttonClasses } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  CopyIcon,
  EditIcon,
  LoaderIcon,
} from '@/components/ui/Icons';
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
  MANUAL: 'Added manually',
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

function CompanyWebsiteRow({
  leadId,
  initialWebsite,
}: {
  leadId: string;
  initialWebsite: string | null;
}) {
  const [website, setWebsite] = useState<string | null>(initialWebsite);
  const [verified, setVerified] = useState<boolean | null>(null);
  // Always starts "searching" (via lazy initializer, not an effect): even a
  // website that already came back from processing still needs the
  // crawl-and-AI-verify pass below before it can be trusted.
  const [searching, setSearching] = useState(true);
  const [searchTried, setSearchTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const runSearch = async () => {
    setSearching(true);
    setError(null);
    try {
      const { website: found, verified: isVerified } = await findCompanyWebsiteApi(leadId);
      setWebsite(found);
      setVerified(found ? isVerified : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search for company website');
    } finally {
      setSearching(false);
      setSearchTried(true);
    }
  };

  // Whether a website already came back from processing or not, always
  // crawl its homepage and ask AI to confirm it actually belongs to this
  // company (matching name and location) with no click needed. If it
  // doesn't match, a fresh candidate is searched for and checked instead,
  // automatically, until one verifies or the attempts run out.
  useEffect(() => {
    let cancelled = false;

    findCompanyWebsiteApi(leadId)
      .then(({ website: found, verified: isVerified }) => {
        if (!cancelled) {
          setWebsite(found);
          setVerified(found ? isVerified : null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to verify company website');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSearching(false);
          setSearchTried(true);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startEdit = () => {
    setError(null);
    setDraft(website || '');
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setError(null);
  };

  const saveEdit = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const { lead: updated } = await updateLeadApi(leadId, {
        currentCompanyWebsite: trimmed,
        websiteStatus: 'found',
        websiteVerified: null,
      });
      setWebsite(updated.currentCompanyWebsite);
      // A manually entered URL is trusted as-is, not AI-verified.
      setVerified(null);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save website');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <dt className="text-slate-500">Company Website</dt>
      <dd className="text-slate-800">
        {editing ? (
          <div className="flex items-center gap-2">
            <Input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="https://example.com"
              className="h-8 py-1"
              autoFocus
            />
            <Button type="button" size="sm" onClick={saveEdit} disabled={saving || !draft.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={cancelEdit} disabled={saving}>
              Cancel
            </Button>
          </div>
        ) : website ? (
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={/^https?:\/\//i.test(website) ? website : `https://${website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="truncate text-indigo-600 underline decoration-indigo-200 underline-offset-2 hover:text-indigo-700"
            >
              {website}
            </a>
            {verified === true && (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                <CheckCircleIcon width={10} height={10} />
                Verified
              </span>
            )}
            {searching && <LoaderIcon width={12} height={12} className="shrink-0 text-slate-400" />}
            <button
              type="button"
              onClick={startEdit}
              className="shrink-0 text-slate-400 hover:text-slate-600"
              aria-label="Edit company website"
            >
              <EditIcon width={13} height={13} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              {searching ? (
                <>
                  <LoaderIcon width={12} height={12} />
                  <span className="text-slate-500">Searching & verifying…</span>
                </>
              ) : (
                <>
                  <span className="text-slate-500">Not found</span>
                  <Button type="button" variant="outline" size="sm" onClick={runSearch}>
                    Search
                  </Button>
                </>
              )}
              <button
                type="button"
                onClick={startEdit}
                className="shrink-0 text-slate-400 hover:text-slate-600"
                aria-label="Edit company website"
              >
                <EditIcon width={13} height={13} />
              </button>
            </div>
            {searchTried && !searching && (
              <p className="text-xs text-slate-500">No official website could be found on the web.</p>
            )}
          </div>
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
  const [manualEmail, setManualEmail] = useState('');
  const [addingEmail, setAddingEmail] = useState(false);
  const [addEmailError, setAddEmailError] = useState<string | null>(null);
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

  const handleAddEmail = async () => {
    const trimmed = manualEmail.trim();
    if (!trimmed) return;
    setAddingEmail(true);
    setAddEmailError(null);
    try {
      const { lead: updated } = await addLeadEmailApi(leadId, trimmed);
      setLead(updated);
      setManualEmail('');
    } catch (err) {
      setAddEmailError(err instanceof Error ? err.message : 'Failed to add email');
    } finally {
      setAddingEmail(false);
    }
  };

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

      <div className="mb-2.5 flex items-center gap-2">
        <Input
          type="email"
          value={manualEmail}
          onChange={(e) => setManualEmail(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAddEmail();
            }
          }}
          placeholder="Add an email address"
          className="h-8 py-1"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddEmail}
          disabled={addingEmail || !manualEmail.trim()}
        >
          {addingEmail && <LoaderIcon width={12} height={12} />}
          {addingEmail ? 'Adding…' : 'Add'}
        </Button>
      </div>
      {addEmailError && <p className="mb-2 text-xs text-red-600">{addEmailError}</p>}

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
              <CompanyWebsiteRow
                key={result.lead._id}
                leadId={result.lead._id}
                initialWebsite={result.result.company.officialWebsite || result.result.lead.currentCompanyWebsite}
              />
              <InfoRow label="Lead Email" value={result.result.emailDiscovery.email || 'Not found'} />
              <InfoRow label="Company" value={result.result.lead.currentCompany} />
              <InfoRow label="Company Location" value={result.result.lead.currentCompanyLocation} />
              <InfoRow label="Name" value={result.result.lead.fullName} />
              <InfoRow label="Title" value={result.result.lead.currentTitle} />
              <InfoRow label="Location" value={result.result.lead.location} />
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
