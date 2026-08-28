'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Input';
import { StatusBadge } from '@/components/ui/Badge';
import { CopyIcon, EditIcon, MapPinIcon } from '@/components/ui/Icons';
import { updateLeadApi } from '@/lib/api/client';
import type { LeadRecord } from '@/lib/types/lead';

interface LeadCardProps {
  lead: LeadRecord;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onOpenDetails: (lead: LeadRecord) => void;
  onUpdated: (lead: LeadRecord) => void;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export default function LeadCard({ lead, selected, onToggleSelect, onOpenDetails, onUpdated }: LeadCardProps) {
  const [editingSubject, setEditingSubject] = useState(false);
  const [editingBody, setEditingBody] = useState(false);
  const [draftSubject, setDraftSubject] = useState(lead.emailSubject || '');
  const [draftBody, setDraftBody] = useState(lead.emailBody || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const startEditSubject = () => {
    setDraftSubject(lead.emailSubject || '');
    setError(null);
    setEditingSubject(true);
  };

  const startEditBody = () => {
    setDraftBody(lead.emailBody || '');
    setError(null);
    setEditingBody(true);
  };

  const saveSubject = async () => {
    setSaving(true);
    setError(null);
    try {
      const { lead: updated } = await updateLeadApi(lead._id, { emailSubject: draftSubject });
      onUpdated(updated);
      setEditingSubject(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save subject');
    } finally {
      setSaving(false);
    }
  };

  const saveBody = async () => {
    setSaving(true);
    setError(null);
    try {
      const { lead: updated } = await updateLeadApi(lead._id, { emailBody: draftBody });
      onUpdated(updated);
      setEditingBody(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save email');
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    const text = `Subject: ${lead.emailSubject || ''}\n\n${lead.emailBody || ''}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Failed to copy to clipboard');
    }
  };

  const extraEmailCount = Math.max((lead.emails?.length ?? 0) - (lead.email ? 1 : 0), 0);

  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 pt-4">
        <div
          className="flex cursor-pointer items-start gap-3"
          onClick={() => onOpenDetails(lead)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onOpenDetails(lead);
          }}
        >
          <input
            type="checkbox"
            aria-label={`Select ${lead.fullName}`}
            checked={selected}
            onChange={() => onToggleSelect(lead._id)}
            onClick={(e) => e.stopPropagation()}
            className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          />
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-sm font-semibold text-indigo-600">
            {initials(lead.fullName)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-slate-900">{lead.fullName}</p>
            <p className="truncate text-sm text-slate-500">
              {lead.currentTitle}
              {lead.currentCompany ? ` at ${lead.currentCompany}` : ''}
            </p>
            {lead.location && (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-400">
                <MapPinIcon width={12} height={12} />
                {lead.location}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <StatusBadge value={lead.approvalStatus} />
            <StatusBadge value={lead.validationStatus} />
          </div>
        </div>

        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
          {lead.email ? (
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-slate-700">{lead.email}</span>
              {extraEmailCount > 0 && (
                <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                  +{extraEmailCount} more
                </span>
              )}
            </div>
          ) : (
            <span className="text-slate-400">No email found yet</span>
          )}
        </div>

        <div className="border-t border-slate-100 pt-3">
          <div className="mb-1 flex items-center justify-between">
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Subject</p>
            {!editingSubject && (
              <button
                type="button"
                onClick={startEditSubject}
                aria-label="Edit subject"
                className="text-slate-400 hover:text-slate-600"
              >
                <EditIcon width={14} height={14} />
              </button>
            )}
          </div>
          {editingSubject ? (
            <div className="flex flex-col gap-2">
              <Input
                value={draftSubject}
                onChange={(e) => setDraftSubject(e.target.value)}
                maxLength={350}
                aria-label="Email subject"
              />
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={saveSubject} isLoading={saving}>
                  Save
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setEditingSubject(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm font-medium text-slate-800">{lead.emailSubject || '—'}</p>
          )}
        </div>

        <div>
          <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase">Generated Email</p>
          {editingBody ? (
            <div className="flex flex-col gap-2">
              <Textarea
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                rows={5}
                className="text-sm"
                aria-label="Email body"
              />
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={saveBody} isLoading={saving}>
                  Save
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setEditingBody(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="line-clamp-4 whitespace-pre-wrap text-sm text-slate-600">{lead.emailBody || '—'}</p>
              <div className="mt-2 flex gap-2">
                <Button type="button" size="sm" variant="outline" onClick={startEditBody}>
                  <EditIcon width={13} height={13} />
                  Edit
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={handleCopy}>
                  <CopyIcon width={13} height={13} />
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </>
          )}
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3">
          <span className="text-xs text-slate-400">{new Date(lead.createdAt).toLocaleDateString()}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => onOpenDetails(lead)}>
            View details
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
