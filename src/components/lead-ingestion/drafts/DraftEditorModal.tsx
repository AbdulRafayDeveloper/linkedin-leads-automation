'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Modal from '@/components/ui/Modal';
import Button from '@/components/ui/Button';
import CopyButton from '@/components/ui/CopyButton';
import { Badge } from '@/components/ui/Badge';
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  EditIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LoaderIcon,
  MailIcon,
  PlusCircleIcon,
  RefreshIcon,
  SparklesIcon,
  TrashIcon,
  XIcon,
} from '@/components/ui/Icons';
import { cn } from '@/lib/utils/cn';
import { htmlToPlainText, withParagraphSpacing } from '@/services/lead-ingestion/emailHtml';
import { approvalEligibility, type DraftDetail, type DraftItem } from '@/services/lead-ingestion/draftItems';
import DraftBodyEditor from './DraftBodyEditor';
import { SendStatusBadge, SmtpBadge } from './statusBadges';
import {
  crawlDraftWebsite,
  fetchDraft,
  mutateDraftEmail,
  patchDraft,
  refineDraft,
} from './draftsApi';

const MAX_SUBJECT = 350;
const MAX_REFINE_PROMPT = 400;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Toast = { id: number; tone: 'success' | 'error' | 'info'; message: string };

function isLikelyUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.includes('.');
  } catch {
    return false;
  }
}

export default function DraftEditorModal({
  item,
  onClose,
  onSaved,
}: {
  item: DraftItem;
  onClose: () => void;
  onSaved: (draft: DraftDetail) => void;
}) {
  const [detail, setDetail] = useState<DraftDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [subject, setSubject] = useState(item.subject);
  const [bodyHtml, setBodyHtml] = useState(item.bodyHtml);
  const [busy, setBusy] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [websiteUrl, setWebsiteUrl] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [addingEmail, setAddingEmail] = useState(false);
  const [editingEmail, setEditingEmail] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const [refinePrompt, setRefinePrompt] = useState('');

  const toastId = useRef(0);
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  const toast = useCallback((message: string, tone: Toast['tone'] = 'info') => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, tone, message }]);
    timers.current.push(
      setTimeout(() => setToasts((prev) => prev.filter((entry) => entry.id !== id)), 6000)
    );
  }, []);

  useEffect(() => {
    const timeouts = timers.current;
    return () => timeouts.forEach(clearTimeout);
  }, []);

  // Always edit the stored draft, never a copy that went stale in the list.
  const applyDetail = useCallback((draft: DraftDetail) => {
    setDetail(draft);
    setSubject(draft.subject);
    setBodyHtml(draft.bodyHtml);
    setWebsiteUrl(draft.websiteUrl ?? '');
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchDraft(item.leadId, item.companyIndex, controller.signal)
      .then(({ draft }) => applyDetail(draft))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : 'Could not load this draft');
      });
    return () => controller.abort();
  }, [applyDetail, item.companyIndex, item.leadId]);

  const canEdit = detail?.canEdit ?? false;
  const approved = detail?.approved ?? false;
  const locked = !canEdit || approved;
  const dirty = Boolean(detail) && (subject !== detail?.subject || bodyHtml !== detail?.bodyHtml);
  const eligibility = approvalEligibility(detail?.emails ?? []);

  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Something went wrong', 'error');
    } finally {
      setBusy(null);
    }
  };

  const handleSave = () =>
    run('save', async () => {
      const { draft } = await patchDraft(item.leadId, item.companyIndex, { subject, bodyHtml });
      applyDetail(draft);
      onSaved(draft);
      toast('Draft saved', 'success');
    });

  const handleApproval = (next: boolean) =>
    run('approve', async () => {
      const { draft } = await patchDraft(item.leadId, item.companyIndex, {
        approved: next,
        ...(dirty ? { subject, bodyHtml } : {}),
      });
      applyDetail(draft);
      onSaved(draft);
      toast(next ? 'Draft approved and ready to send' : 'Draft moved back to editing', 'success');
    });

  const handleEmail = (
    action: 'add' | 'remove' | 'replace' | 'verify',
    email: string,
    replacement?: string
  ) =>
    run(`email:${email}`, async () => {
      const { draft, status } = await mutateDraftEmail(
        item.leadId,
        item.companyIndex,
        action,
        email,
        replacement
      );
      applyDetail(draft);
      onSaved(draft);
      setAddingEmail(false);
      setNewEmail('');
      setEditingEmail(null);

      if (action === 'remove') toast(`Removed ${email}`, 'info');
      else if (status === 'valid' || status === 'risky') toast(`${replacement ?? email} is verified`, 'success');
      else if (status === 'invalid') toast(`${replacement ?? email} does not exist`, 'error');
      else toast(`${replacement ?? email} could not be verified (${status ?? 'unknown'})`, 'error');
    });

  const handleCrawl = () =>
    run('crawl', async () => {
      if (!isLikelyUrl(websiteUrl)) {
        toast('Enter a valid website URL, for example https://acme.com', 'error');
        return;
      }
      await patchDraft(item.leadId, item.companyIndex, { websiteUrl: websiteUrl.trim() });
      await crawlDraftWebsite(item.leadId, item.companyIndex);
      const { draft } = await fetchDraft(item.leadId, item.companyIndex);
      applyDetail(draft);
      onSaved(draft);
      toast(`Crawl finished: ${draft.emails.length} contact email(s) on this draft`, 'success');
    });

  const handleRefine = () =>
    run('refine', async () => {
      const prompt = refinePrompt.trim();
      if (!prompt) return;
      await refineDraft(item.leadId, item.companyIndex, prompt);
      const { draft } = await fetchDraft(item.leadId, item.companyIndex);
      applyDetail(draft);
      onSaved(draft);
      setRefinePrompt('');
      toast('AI rewrote the draft', 'success');
    });

  const confirmClose = () => {
    if (busy) {
      return window.confirm('An action is still running. Close anyway?');
    }
    if (dirty) {
      return window.confirm('You have unsaved changes to this draft. Discard them?');
    }
    return true;
  };

  const footer = (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={approved ? 'primary' : 'outline'}
          disabled={!detail || !canEdit || (!approved && !eligibility.ok) || busy !== null}
          isLoading={busy === 'approve'}
          onClick={() => void handleApproval(!approved)}
          title={!approved && !eligibility.ok ? eligibility.reason ?? undefined : undefined}
        >
          {approved ? 'Approved — move back to editing' : 'Approve draft'}
        </Button>
        <CopyButton
          label="Copy email"
          getContent={() => ({
            text: `Subject: ${subject}\n\n${htmlToPlainText(bodyHtml)}`,
            html: withParagraphSpacing(bodyHtml),
          })}
        />
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onClose} disabled={busy !== null}>
          Cancel
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSave()}
          disabled={!detail || locked || !dirty || busy !== null}
          isLoading={busy === 'save'}
        >
          Save changes
        </Button>
      </div>
    </div>
  );

  return (
    <Modal
      open
      onClose={onClose}
      closeConfirm={confirmClose}
      size="lg"
      title={item.candidateName}
      subtitle={
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-indigo-600">{item.serial ?? item.clientName}</span>
          <Badge tone={item.companyIndex === -1 ? 'info' : 'neutral'}>
            {item.companyIndex === -1 ? 'Personal draft' : item.companyName}
          </Badge>
          <SendStatusBadge status={item.sendStatus} />
        </span>
      }
      headerExtra={
        <Link
          href={`/lead-ingestion/client/${item.leadId}`}
          aria-label="Open this lead's workspace"
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        >
          <ExternalLinkIcon width={16} height={16} />
        </Link>
      }
      footer={footer}
    >
      {!detail ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16">
          {loadError ? (
            <p role="alert" className="text-sm font-medium text-red-600">
              {loadError}
            </p>
          ) : (
            <>
              <LoaderIcon width={26} height={26} className="animate-spin text-indigo-600" />
              <p className="text-sm text-slate-500">Loading the latest version of this draft…</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          {!canEdit && (
            <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              {detail.sendStatus === 'failed'
                ? 'The last send for this draft failed. Re-run it from its campaign; the content is locked here so the campaign keeps its record.'
                : 'This draft is in a campaign, so its content and contacts are locked.'}
            </p>
          )}
          {canEdit && approved && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-900">
              <span>Approved and waiting in Ready to Send. Move it back to editing to make changes.</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy !== null}
                isLoading={busy === 'approve'}
                onClick={() => void handleApproval(false)}
              >
                Move back to editing
              </Button>
            </div>
          )}

          {(detail.leadSummary || detail.roleSummary) && (
            <section className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-indigo-900 uppercase">
                <SparklesIcon width={12} height={12} /> What we know
              </h3>
              {detail.leadSummary && <p className="mt-2 text-xs leading-relaxed text-slate-700">{detail.leadSummary}</p>}
              {detail.roleSummary && (
                <p className="mt-2 text-xs leading-relaxed text-slate-700">
                  <span className="font-semibold">{detail.companyName}: </span>
                  {detail.roleSummary}
                </p>
              )}
            </section>
          )}

          {/* Website + crawl */}
          <section className="rounded-lg border border-slate-200 p-3">
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
              <GlobeIcon width={12} height={12} /> Website
            </h3>
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                type="url"
                value={websiteUrl}
                onChange={(event) => setWebsiteUrl(event.target.value)}
                disabled={locked || busy !== null}
                aria-label="Website URL"
                placeholder="https://acme.com"
                className="min-w-0 flex-1 rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none disabled:bg-slate-50"
              />
              <div className="flex items-center gap-2">
                {detail.websiteUrl && (
                  <a
                    href={detail.websiteUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
                  >
                    Open <ExternalLinkIcon width={11} height={11} />
                  </a>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={locked || busy !== null || !websiteUrl.trim()}
                  isLoading={busy === 'crawl'}
                  onClick={() => void handleCrawl()}
                >
                  <RefreshIcon width={12} height={12} /> Save and crawl
                </Button>
              </div>
            </div>
            {busy === 'crawl' && (
              <p className="mt-2 text-xs text-slate-500">Crawling the site for contact addresses. This can take a minute.</p>
            )}
          </section>

          {/* Contact emails */}
          <section className="rounded-lg border border-slate-200 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                <MailIcon width={12} height={12} /> Contact emails ({detail.emails.length})
              </h3>
              {!locked && !addingEmail && (
                <Button type="button" size="sm" variant="outline" onClick={() => setAddingEmail(true)} disabled={busy !== null}>
                  <PlusCircleIcon width={12} height={12} /> Add email
                </Button>
              )}
            </div>

            <p className="mt-1 text-[11px] text-slate-500">
              The first address is the one a campaign sends to. Every address must be verified before the draft can be approved.
            </p>

            <ul className="mt-2 space-y-2">
              {detail.emails.map((entry, index) => {
                const rowBusy = busy === `email:${entry.email}`;
                const isEditing = editingEmail === entry.email;
                return (
                  <li
                    key={entry.email}
                    className="rounded-md border border-slate-200 bg-slate-50/60 p-2"
                  >
                    {isEditing ? (
                      <div className="flex flex-col gap-2">
                        <input
                          type="email"
                          autoFocus
                          value={editingValue}
                          onChange={(event) => setEditingValue(event.target.value)}
                          aria-label={`New address for ${entry.email}`}
                          aria-invalid={Boolean(editingValue) && !EMAIL_PATTERN.test(editingValue.trim())}
                          className="w-full rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            disabled={!EMAIL_PATTERN.test(editingValue.trim()) || busy !== null}
                            isLoading={rowBusy}
                            onClick={() => void handleEmail('replace', entry.email, editingValue.trim())}
                          >
                            Save and verify
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setEditingEmail(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="font-mono text-xs break-all text-slate-900">{entry.email}</span>
                          {index === 0 && <Badge tone="info">Sends to this</Badge>}
                          <SmtpBadge status={entry.status} />
                        </div>
                        {!locked && (
                          <div className="flex shrink-0 items-center gap-1">
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={busy !== null}
                              isLoading={rowBusy}
                              onClick={() => void handleEmail('verify', entry.email)}
                            >
                              Verify
                            </Button>
                            <button
                              type="button"
                              aria-label={`Edit ${entry.email}`}
                              disabled={busy !== null}
                              onClick={() => {
                                setEditingEmail(entry.email);
                                setEditingValue(entry.email);
                              }}
                              className="rounded p-1.5 text-slate-500 hover:bg-indigo-50 hover:text-indigo-700 disabled:opacity-40"
                            >
                              <EditIcon width={14} height={14} />
                            </button>
                            <button
                              type="button"
                              aria-label={`Remove ${entry.email}`}
                              disabled={busy !== null}
                              onClick={() => {
                                if (window.confirm(`Remove ${entry.email} from this draft?`)) {
                                  void handleEmail('remove', entry.email);
                                }
                              }}
                              className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                            >
                              <TrashIcon width={14} height={14} />
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}

              {detail.emails.length === 0 && (
                <li className="rounded-md border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                  No contact email yet. Add one, or crawl the website above.
                </li>
              )}
            </ul>

            {addingEmail && !locked && (
              <div className="mt-2 flex flex-col gap-2 rounded-md border border-indigo-100 bg-indigo-50/40 p-2.5">
                <label htmlFor="draft-new-email" className="text-[11px] font-semibold text-indigo-900">
                  New contact email
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    id="draft-new-email"
                    type="email"
                    autoFocus
                    value={newEmail}
                    onChange={(event) => setNewEmail(event.target.value)}
                    placeholder="name@company.com"
                    aria-invalid={Boolean(newEmail) && !EMAIL_PATTERN.test(newEmail.trim())}
                    aria-describedby="draft-new-email-error"
                    className="min-w-0 flex-1 rounded border border-slate-300 px-2.5 py-1.5 font-mono text-xs focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      disabled={!EMAIL_PATTERN.test(newEmail.trim()) || busy !== null}
                      isLoading={busy === `email:${newEmail.trim().toLowerCase()}`}
                      onClick={() => void handleEmail('add', newEmail.trim())}
                    >
                      Add and verify
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setAddingEmail(false);
                        setNewEmail('');
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
                {Boolean(newEmail) && !EMAIL_PATTERN.test(newEmail.trim()) && (
                  <p id="draft-new-email-error" className="flex items-center gap-1 text-[11px] font-medium text-red-600">
                    <AlertTriangleIcon width={12} height={12} /> Enter a valid address, for example name@company.com
                  </p>
                )}
              </div>
            )}
          </section>

          {/* The draft itself */}
          <section className="space-y-3 rounded-lg border border-slate-200 p-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label htmlFor="draft-subject" className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
                  Subject
                </label>
                <span className={cn('text-[11px]', subject.length > MAX_SUBJECT ? 'text-red-600' : 'text-slate-400')}>
                  {subject.length}/{MAX_SUBJECT}
                </span>
              </div>
              <input
                id="draft-subject"
                type="text"
                value={subject}
                maxLength={MAX_SUBJECT}
                disabled={locked || busy !== null}
                onChange={(event) => setSubject(event.target.value)}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none disabled:bg-slate-50"
              />
            </div>

            <div className="space-y-1">
              <span className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">Email body</span>
              <DraftBodyEditor value={bodyHtml} onChange={setBodyHtml} readOnly={locked} />
            </div>
          </section>

          {/* AI refine */}
          {!locked && (
            <section className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
              <label htmlFor="draft-refine" className="text-[11px] font-semibold tracking-wide text-indigo-700 uppercase">
                Rewrite with AI
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  id="draft-refine"
                  type="text"
                  value={refinePrompt}
                  maxLength={MAX_REFINE_PROMPT}
                  onChange={(event) => setRefinePrompt(event.target.value)}
                  placeholder="e.g. shorter, and mention their hiring post"
                  disabled={busy !== null}
                  className="min-w-0 flex-1 rounded border border-slate-200 px-3 py-1.5 text-xs focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!refinePrompt.trim() || busy !== null}
                  isLoading={busy === 'refine'}
                  onClick={() => void handleRefine()}
                >
                  <SparklesIcon width={12} height={12} /> Rewrite
                </Button>
              </div>
              {busy === 'refine' && (
                <p className="mt-2 text-xs text-slate-500">The AI is rewriting and re-checking the format…</p>
              )}
              {dirty && (
                <p className="mt-2 text-[11px] text-amber-700">
                  Rewriting replaces the draft in the database; your unsaved edits here would be lost.
                </p>
              )}
            </section>
          )}
        </div>
      )}

      {/* Toasts live inside the dialog so they are announced and never cover the page */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-4 z-10 flex flex-col gap-2 sm:absolute sm:right-4 sm:bottom-20 sm:left-auto sm:max-w-sm">
        {toasts.map((entry) => (
          <div
            key={entry.id}
            role="status"
            className={cn(
              'pointer-events-auto flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-xs font-medium shadow-lg',
              entry.tone === 'success'
                ? 'border-green-200 bg-green-50 text-green-800'
                : entry.tone === 'error'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : 'border-slate-200 bg-white text-slate-700'
            )}
          >
            <span className="flex items-start gap-1.5">
              {entry.tone === 'success' ? (
                <CheckCircleIcon width={13} height={13} className="mt-0.5 shrink-0" />
              ) : entry.tone === 'error' ? (
                <AlertTriangleIcon width={13} height={13} className="mt-0.5 shrink-0" />
              ) : null}
              <span className="break-words">{entry.message}</span>
            </span>
            <button
              type="button"
              aria-label="Dismiss message"
              onClick={() => setToasts((prev) => prev.filter((toastEntry) => toastEntry.id !== entry.id))}
              className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-700"
            >
              <XIcon width={12} height={12} />
            </button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
