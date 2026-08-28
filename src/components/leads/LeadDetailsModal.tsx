'use client';

import { useState } from 'react';
import type { ApprovalStatus, LeadRecord } from '@/lib/types/lead';
import { deleteLeadApi, updateLeadApi } from '@/lib/api/client';

interface LeadDetailsModalProps {
  lead: LeadRecord;
  onClose: () => void;
  onUpdated: (lead: LeadRecord) => void;
  onDeleted: (id: string) => void;
}

export default function LeadDetailsModal({ lead, onClose, onUpdated, onDeleted }: LeadDetailsModalProps) {
  const [email, setEmail] = useState(lead.email || '');
  const [subject, setSubject] = useState(lead.emailSubject || '');
  const [body, setBody] = useState(lead.emailBody || '');
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>(lead.approvalStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Lead details for ${lead.fullName}`}
    >
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white p-6 shadow-xl dark:bg-neutral-900">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold">{lead.fullName}</h2>
            <p className="text-sm text-neutral-500">
              {lead.currentTitle} {lead.currentCompany ? `at ${lead.currentCompany}` : ''}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
            ✕
          </button>
        </div>

        <dl className="mb-4 grid grid-cols-2 gap-2 text-sm">
          <dt className="text-neutral-500">Location</dt>
          <dd>{lead.location || '—'}</dd>
          <dt className="text-neutral-500">Validation Status</dt>
          <dd>{lead.validationStatus}</dd>
          <dt className="text-neutral-500">Email Source</dt>
          <dd>{lead.emailSource}</dd>
          <dt className="text-neutral-500">Email Confidence</dt>
          <dd>{lead.emailConfidence}</dd>
        </dl>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-md border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-800"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Approval Status</span>
            <select
              value={approvalStatus}
              onChange={(e) => setApprovalStatus(e.target.value as ApprovalStatus)}
              className="rounded-md border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-800"
            >
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Email Subject</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              maxLength={350}
              className="rounded-md border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-800"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Email Body</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              className="rounded-md border border-neutral-300 px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-800"
            />
          </label>

          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-800/50">
            <p className="mb-1 font-medium">Email Preview</p>
            <p className="font-semibold">{subject || '(no subject)'}</p>
            <p className="whitespace-pre-wrap text-neutral-600 dark:text-neutral-300">
              {body || '(no body)'}
            </p>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {success && <p className="mt-3 text-sm text-green-600">{success}</p>}

        <div className="mt-6 flex items-center justify-between">
          {confirmingDelete ? (
            <div className="flex items-center gap-2 text-sm">
              <span>Delete this lead permanently?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="rounded-md bg-red-600 px-3 py-1.5 font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                Confirm delete
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-md border border-neutral-300 px-3 py-1.5 dark:border-neutral-700"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950"
            >
              Delete lead
            </button>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-50 dark:bg-white dark:text-neutral-900"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
