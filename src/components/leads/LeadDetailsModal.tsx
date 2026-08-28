'use client';

import { useEffect, useRef, useState } from 'react';
import type { ApprovalStatus, EmailEntry, LeadRecord } from '@/lib/types/lead';
import { deleteLeadApi, enrichLeadApi, fetchLead, updateLeadApi } from '@/lib/api/client';
import { Field } from '@/components/ui/Field';
import { Input, Select, Textarea } from '@/components/ui/Input';
import Button from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/Badge';
import {
  AlertTriangleIcon,
  BuildingIcon,
  CheckCircleIcon,
  ExternalLinkIcon,
  LinkedInIcon,
  LoaderIcon,
  MapPinIcon,
  XIcon,
} from '@/components/ui/Icons';

interface LeadDetailsModalProps {
  lead: LeadRecord;
  onClose: () => void;
  onUpdated: (lead: LeadRecord) => void;
  onDeleted: (id: string) => void;
}

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
  LEAD_PROFILE: 'Lead email',
  COMPANY_WEBSITE: 'Company website',
  MANUAL: 'Added manually',
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

function EmailsSection({
  lead,
  onEnrich,
  enriching,
}: {
  lead: LeadRecord;
  onEnrich: () => void;
  enriching: boolean;
}) {
  const isTerminal = TERMINAL_ENRICHMENT_STATUSES.has(lead.enrichmentStatus);

  return (
    <div className="rounded-md border border-slate-200 p-3.5 text-sm">
      <div className="mb-2.5 flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Emails</p>
        <Button type="button" variant="outline" size="sm" onClick={onEnrich} disabled={enriching || !isTerminal}>
          {enriching && <LoaderIcon width={13} height={13} />}
          {enriching ? 'Queuing…' : 'Re-run enrichment'}
        </Button>
      </div>

      {!isTerminal && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-slate-500">
          <LoaderIcon width={12} height={12} />
          {ENRICHMENT_STATUS_LABEL[lead.enrichmentStatus] || lead.enrichmentStatus}…
        </p>
      )}
      {lead.enrichmentStatus === 'FAILED' && lead.enrichmentError && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-red-600">
          <AlertTriangleIcon width={12} height={12} />
          Enrichment failed: {lead.enrichmentError}
        </p>
      )}

      {lead.emails.length === 0 ? (
        <p className="text-slate-500">
          {isTerminal ? 'No public emails discovered yet.' : 'Searching for emails…'}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-slate-100">
          {lead.emails.map((entry) => (
            <li key={entry.email + entry.discoveredAt} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
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
              <StatusBadge value={entry.validationStatus} className="shrink-0" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function LeadDetailsModal({ lead, onClose, onUpdated, onDeleted }: LeadDetailsModalProps) {
  const [email, setEmail] = useState(lead.email || '');
  const [subject, setSubject] = useState(lead.emailSubject || '');
  const [body, setBody] = useState(lead.emailBody || '');
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>(lead.approvalStatus);
  const [saving, setSaving] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const onUpdatedRef = useRef(onUpdated);
  useEffect(() => {
    onUpdatedRef.current = onUpdated;
  });

  useEffect(() => {
    if (TERMINAL_ENRICHMENT_STATUSES.has(lead.enrichmentStatus)) return undefined;

    const interval = setInterval(async () => {
      try {
        const { lead: refreshed } = await fetchLead(lead._id);
        onUpdatedRef.current(refreshed);
      } catch {
        // Transient polling failures are not user-facing; the next tick retries.
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [lead._id, lead.enrichmentStatus]);

  const handleEnrich = async () => {
    setEnriching(true);
    setError(null);
    try {
      const { lead: updated } = await enrichLeadApi(lead._id);
      onUpdated(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue enrichment');
    } finally {
      setEnriching(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const { lead: updated } = await updateLeadApi(lead._id, {
        email: email || null,
        emailSubject: subject || null,
        emailBody: body || null,
        approvalStatus,
      });
      onUpdated(updated);
      setSuccess('Lead updated successfully');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setSaving(true);
    setError(null);
    try {
      await deleteLeadApi(lead._id);
      onDeleted(lead._id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete lead');
      setSaving(false);
    }
  };

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Lead details for ${lead.fullName}`}
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-600">
              {initials(lead.fullName)}
            </span>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{lead.fullName}</h2>
              <p className="text-sm text-slate-500">
                {lead.currentTitle} {lead.currentCompany ? `at ${lead.currentCompany}` : ''}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StatusBadge value={lead.validationStatus} />
                <StatusBadge value={lead.approvalStatus} />
                <StatusBadge value={lead.enrichmentStatus} />
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <XIcon width={16} height={16} />
          </button>
        </div>

        <div className="overflow-y-auto px-6 py-5">
          <div className="mb-5 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <div className="flex items-center gap-1.5 text-slate-500">
              <MapPinIcon width={14} height={14} />
              {lead.location || 'Location unknown'}
            </div>
            <div className="flex items-center gap-1.5 text-slate-500">
              <BuildingIcon width={14} height={14} />
              {lead.currentCompany || 'Company unknown'}
            </div>
            {lead.linkedinProfileUrl && (
              <a
                href={lead.linkedinProfileUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-indigo-600 hover:underline"
              >
                <LinkedInIcon width={14} height={14} />
                LinkedIn profile
                <ExternalLinkIcon width={12} height={12} />
              </a>
            )}
            {lead.currentCompanyWebsite && (
              <a
                href={lead.currentCompanyWebsite}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-indigo-600 hover:underline"
              >
                <ExternalLinkIcon width={14} height={14} />
                Company website
              </a>
            )}
          </div>

          <dl className="mb-4 grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-slate-500">Email Source</dt>
            <dd className="text-slate-700">{lead.emailSource}</dd>
            <dt className="text-slate-500">Email Confidence</dt>
            <dd className="text-slate-700">{lead.emailConfidence}</dd>
          </dl>

          <div className="mb-5">
            <EmailsSection lead={lead} onEnrich={handleEnrich} enriching={enriching} />
          </div>

          <div className="flex flex-col gap-4">
            <Field label="Email" htmlFor="lead-email">
              <Input id="lead-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>

            <Field label="Approval Status" htmlFor="lead-approval-status">
              <Select
                id="lead-approval-status"
                value={approvalStatus}
                onChange={(e) => setApprovalStatus(e.target.value as ApprovalStatus)}
              >
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </Select>
            </Field>

            <Field label="Email Subject" htmlFor="lead-email-subject">
              <Input
                id="lead-email-subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={350}
              />
            </Field>

            <Field label="Email Body" htmlFor="lead-email-body">
              <Textarea id="lead-email-body" value={body} onChange={(e) => setBody(e.target.value)} rows={6} />
            </Field>

            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Email Preview</p>
              <p className="font-semibold text-slate-900">{subject || '(no subject)'}</p>
              <p className="mt-1 whitespace-pre-wrap text-slate-600">{body || '(no body)'}</p>
            </div>
          </div>

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
          {success && (
            <p className="mt-4 flex items-center gap-1.5 text-sm text-emerald-600">
              <CheckCircleIcon width={14} height={14} />
              {success}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          {confirmingDelete ? (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span>Delete this lead permanently?</span>
              <Button type="button" variant="destructive" size="sm" onClick={handleDelete} disabled={saving}>
                Confirm delete
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmingDelete(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-red-200 text-red-600 hover:bg-red-50"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete lead
            </Button>
          )}

          <Button type="button" variant="primary" onClick={handleSave} isLoading={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  );
}
