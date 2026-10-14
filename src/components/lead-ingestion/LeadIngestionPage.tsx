'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { buttonClasses } from '@/components/ui/buttonClasses';
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckCircleIcon,
  InboxIcon,
  LoaderIcon,
  MailIcon,
  SparklesIcon,
  XCircleIcon,
} from '@/components/ui/Icons';
import DummyDataModal from './DummyDataModal';
import { cn } from '@/lib/utils/cn';
import { MAX_PROFILE_CHARS, checkIngestionInput } from '@/lib/validation/ingestionInput';
import {
  IngestionApiError,
  confirmLeadApi,
  previewLeadApi,
  type DuplicateLead,
  type IngestionPreview,
} from '@/services/lead-ingestion/intakeApi';

const DRAFT_KEY = 'leadforge:new-lead-draft';
const EXTRACT_TIMEOUT_MS = 90_000;

type Phase = 'idle' | 'extracting' | 'preview' | 'saving';

function readDraft(): string {
  try {
    return sessionStorage.getItem(DRAFT_KEY) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(text: string): void {
  try {
    if (text) sessionStorage.setItem(DRAFT_KEY, text);
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Private mode or a full quota: the draft is a convenience, not a requirement.
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function Banner({
  tone,
  title,
  children,
  onDismiss,
}: {
  tone: 'error' | 'warning';
  title?: string;
  children: React.ReactNode;
  onDismiss?: () => void;
}) {
  const styles =
    tone === 'error'
      ? 'border-red-200 bg-red-50 text-red-800'
      : 'border-amber-200 bg-amber-50 text-amber-900';
  return (
    <div role="alert" className={cn('flex gap-2.5 rounded-lg border px-4 py-3 text-sm', styles)}>
      <AlertTriangleIcon width={16} height={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className={cn(title && 'mt-0.5')}>{children}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss message"
          className="-m-1 shrink-0 self-start rounded p-1 opacity-70 transition-opacity hover:opacity-100"
        >
          <XCircleIcon width={15} height={15} />
        </button>
      )}
    </div>
  );
}

export default function LeadIngestionPage() {
  const router = useRouter();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [rawText, setRawText] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [preview, setPreview] = useState<IngestionPreview | null>(null);
  const [duplicate, setDuplicate] = useState<DuplicateLead | null>(null);
  const [dummyOpen, setDummyOpen] = useState(false);

  const busy = phase === 'extracting' || phase === 'saving';
  const trimmed = rawText.trim();
  const overLimit = rawText.length > MAX_PROFILE_CHARS;

  // Restore anything typed before a reload or a Back navigation. sessionStorage
  // is an external store, so the read happens after paint rather than during render.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const draft = readDraft();
      if (draft) setRawText(draft);
      textareaRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  // Grow the box with the pasted profile instead of leaving a tiny window.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 560)}px`;
  }, [rawText, phase]);

  useEffect(() => {
    if (!busy) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  // Never leave a request running after the page is gone.
  useEffect(() => () => abortRef.current?.abort(), []);

  const updateText = (value: string) => {
    setRawText(value);
    writeDraft(value);
    if (inputError) setInputError(null);
  };

  const runWithAbort = useCallback(async <T,>(work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);
    try {
      return await work(controller.signal);
    } finally {
      clearTimeout(timeout);
      abortRef.current = null;
    }
  }, []);

  const handleExtract = async () => {
    const check = checkIngestionInput(rawText);
    if (!check.ok) {
      setInputError(check.message!);
      textareaRef.current?.focus();
      return;
    }

    setError(null);
    setInputError(null);
    setDuplicate(null);
    setElapsed(0);
    setPhase('extracting');

    try {
      const result = await runWithAbort((signal) => previewLeadApi(trimmed, signal));
      setPreview(result);
      setDuplicate(result.duplicate);
      setPhase('preview');
    } catch (err) {
      setPhase('idle');
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Extraction stopped. Nothing was saved — you can try again.');
        return;
      }
      setError(err instanceof Error ? err.message : 'Extraction failed. Please try again.');
    }
  };

  const handleSave = async (force = false) => {
    if (!preview) return;
    setError(null);
    setElapsed(0);
    setPhase('saving');

    try {
      const created = await runWithAbort((signal) =>
        confirmLeadApi({ content: trimmed, extraction: preview.extraction, force }, signal)
      );
      writeDraft('');
      router.push(`/lead-ingestion/client/${created.leadId}`);
      // If the next page fails to load, give the form back instead of hanging.
      setTimeout(() => setPhase('preview'), 15_000);
    } catch (err) {
      setPhase('preview');
      if (err instanceof IngestionApiError && err.status === 409 && err.duplicate) {
        setDuplicate(err.duplicate);
        setError(null);
        return;
      }
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('Saving stopped. The lead may not have been created — check your leads before retrying.');
        return;
      }
      setError(err instanceof Error ? err.message : 'The lead could not be saved. Please try again.');
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setPhase(preview ? 'preview' : 'idle');
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      if (!busy) void handleExtract();
    }
  };

  const counterTone = overLimit
    ? 'text-red-600'
    : rawText.length > MAX_PROFILE_CHARS * 0.9
      ? 'text-amber-600'
      : 'text-slate-400';

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="New Lead"
          description="Paste a LinkedIn or Sales Navigator profile. You'll see what was found before anything is saved."
        />
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => setDummyOpen(true)}>
            <InboxIcon width={15} height={15} />
            Dummy data
          </Button>
          <Link
            href="/lead-ingestion/emails"
            className={buttonClasses('outline', 'md', 'border-indigo-200 text-indigo-700 hover:bg-indigo-50')}
          >
            <MailIcon width={15} height={15} />
            View drafts
          </Link>
        </div>
      </div>

      {error && (
        <Banner tone="error" onDismiss={() => setError(null)}>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{error}</span>
            <button
              type="button"
              onClick={() => void (preview ? handleSave() : handleExtract())}
              className="font-semibold underline underline-offset-2"
            >
              Try again
            </button>
          </div>
        </Banner>
      )}

      {/* Live status for screen readers; the visible state is below. */}
      <p aria-live="polite" className="sr-only">
        {phase === 'extracting' && 'Reading the profile with AI.'}
        {phase === 'saving' && 'Saving the lead.'}
        {phase === 'preview' && 'Profile details ready to review.'}
      </p>

      {phase !== 'preview' && (
        <Card className="border-indigo-100 bg-linear-to-br from-indigo-50/30 to-white">
          <CardHeader
            title="Paste the profile text"
            description="Open the profile, select the page (Ctrl+A), copy and paste it here. The name, current role and company matter most."
            action={<SparklesIcon width={16} height={16} className="hidden text-indigo-400 sm:block" />}
          />
          <CardContent className="space-y-3 pt-2">
            <div>
              <label htmlFor="profile-text" className="mb-1.5 block text-sm font-medium text-slate-700">
                Profile text
              </label>
              <textarea
                id="profile-text"
                ref={textareaRef}
                rows={8}
                value={rawText}
                readOnly={busy}
                maxLength={MAX_PROFILE_CHARS}
                spellCheck={false}
                aria-describedby="profile-text-counter profile-text-error"
                aria-invalid={!!inputError}
                onChange={(e) => updateText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Paste the full profile text here…"
                className={cn(
                  'w-full resize-y rounded-md border bg-white p-4 text-sm leading-relaxed text-slate-800',
                  'placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500 focus:outline-none',
                  inputError ? 'border-red-300' : 'border-slate-200',
                  busy && 'bg-slate-50 text-slate-600'
                )}
              />
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <p id="profile-text-error" className="text-xs text-red-600">
                  {inputError}
                </p>
                <p id="profile-text-counter" className={cn('ml-auto text-xs tabular-nums', counterTone)}>
                  {rawText.length.toLocaleString('en-US')} / {MAX_PROFILE_CHARS.toLocaleString('en-US')}
                </p>
              </div>
            </div>

            {phase === 'extracting' ? (
              <div className="flex flex-col gap-3 rounded-lg border border-indigo-100 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <LoaderIcon width={16} height={16} className="animate-spin text-indigo-600" />
                  Reading the profile with AI… <span className="tabular-nums text-slate-400">{elapsed}s</span>
                </p>
                <Button type="button" variant="outline" size="sm" onClick={handleCancel} className="sm:ml-auto">
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
                <p className="text-xs text-slate-400 sm:mr-auto">Nothing is saved until you confirm.</p>
                <Button
                  type="button"
                  onClick={() => void handleExtract()}
                  disabled={!trimmed || overLimit}
                  className="w-full justify-center sm:w-auto"
                >
                  <SparklesIcon width={16} height={16} />
                  Extract details
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {phase === 'preview' || phase === 'saving' ? (
        <div className="space-y-4">
          {duplicate && (
            <Banner tone="warning" title="This profile is already saved">
              <p>
                Imported {formatDate(duplicate.createdAt)}
                {duplicate.clientName ? ` as ${duplicate.clientName}` : ''}.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Link
                  href={`/lead-ingestion/client/${duplicate.leadId}`}
                  className={buttonClasses('secondary', 'sm')}
                >
                  Open the existing lead
                </Link>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  isLoading={phase === 'saving'}
                  onClick={() => void handleSave(true)}
                >
                  Import again anyway
                </Button>
              </div>
            </Banner>
          )}

          {preview?.warnings.map((warning) => (
            <Banner key={warning} tone="warning">
              {warning}
            </Banner>
          ))}

          <Card>
            <CardHeader
              title="Check what was found"
              description="Nothing is saved yet. Go back and paste again if this looks wrong."
              action={<CheckCircleIcon width={16} height={16} className="hidden text-emerald-500 sm:block" />}
            />
            <CardContent className="space-y-4">
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-slate-500">Name</dt>
                  <dd className="mt-0.5 text-sm font-semibold break-words text-slate-900">
                    {preview?.summary.fullName ?? 'Not found'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-slate-500">Emails in the text</dt>
                  <dd className="mt-0.5 text-sm break-all text-slate-900">
                    {preview?.summary.emails.length ? preview.summary.emails.join(', ') : 'None yet'}
                  </dd>
                </div>
              </dl>

              <div>
                <p className="text-xs font-medium text-slate-500">Current companies</p>
                {preview?.summary.companies.length ? (
                  <ul className="mt-1.5 space-y-1.5">
                    {preview.summary.companies.map((company, index) => (
                      <li
                        key={`${company.companyName}-${index}`}
                        className="rounded-md border border-slate-200 px-3 py-2 text-sm"
                      >
                        <span className="font-medium text-slate-900">{company.companyName}</span>
                        <span className="text-slate-500"> · {company.jobTitle}</span>
                        {company.websiteUrl && (
                          <span className="block truncate text-xs text-slate-400">{company.websiteUrl}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-slate-500">None found</p>
                )}
              </div>

              <p className="text-sm text-slate-600">{preview?.extraction.personSummary}</p>

              <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setPreview(null);
                    setDuplicate(null);
                    setPhase('idle');
                  }}
                  disabled={phase === 'saving'}
                  className="w-full justify-center sm:w-auto"
                >
                  <ArrowLeftIcon width={15} height={15} />
                  Back to editing
                </Button>
                {!duplicate && (
                  <Button
                    type="button"
                    onClick={() => void handleSave()}
                    isLoading={phase === 'saving'}
                    className="w-full justify-center sm:w-auto"
                  >
                    {phase === 'saving' ? 'Saving…' : 'Save lead & open workspace'}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <DummyDataModal
        open={dummyOpen}
        onClose={() => setDummyOpen(false)}
        onUse={(content) => {
          updateText(content);
          setPreview(null);
          setDuplicate(null);
          setPhase('idle');
          setDummyOpen(false);
          textareaRef.current?.focus();
        }}
      />
    </div>
  );
}
