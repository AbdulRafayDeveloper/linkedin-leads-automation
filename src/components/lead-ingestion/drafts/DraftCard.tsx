'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { EditIcon, ExternalLinkIcon, MailIcon } from '@/components/ui/Icons';
import { approvalEligibility, type DraftDetail, type DraftItem } from '@/services/lead-ingestion/draftItems';
import { SendStatusBadge, SmtpBadge } from './statusBadges';
import { patchDraft } from './draftsApi';

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export default function DraftCard({
  item,
  onOpen,
  onUpdated,
}: {
  item: DraftItem;
  onOpen: () => void;
  onUpdated: (draft: DraftDetail) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The card knows only the target address, so it can approve only when that
  // address is sendable; the server re-checks every address of the box.
  const canApprove =
    !item.inCampaign &&
    item.sendStatus === 'pending' &&
    approvalEligibility(
      item.targetEmail ? [{ email: item.targetEmail, status: item.smtpStatus ?? 'pending' }] : []
    ).ok;

  const toggleApproval = async () => {
    setBusy(true);
    setError(null);
    try {
      const { draft } = await patchDraft(item.leadId, item.companyIndex, { approved: !item.approved });
      onUpdated(draft);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this draft');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex h-full flex-col border-slate-200 transition-shadow hover:shadow-md">
      <CardContent className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-900">{item.candidateName}</h3>
            <p className="mt-0.5 truncate text-[11px] text-slate-500">
              <span className="font-mono text-indigo-600">{item.serial ?? '—'}</span>
              {item.clientName ? ` · ${item.clientName}` : ''}
              {item.createdAt ? ` · ${formatDate(item.createdAt)}` : ''}
            </p>
          </div>
          <Badge tone={item.companyIndex === -1 ? 'info' : 'neutral'}>
            {item.companyIndex === -1 ? 'Personal' : item.companyName}
          </Badge>
        </div>

        <div className="space-y-1">
          <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">Sends to</span>
          {item.targetEmail ? (
            <div className="flex flex-wrap items-center gap-1.5 rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5">
              <MailIcon width={12} height={12} className="shrink-0 text-slate-400" />
              <span className="min-w-0 font-mono text-[11px] break-all text-slate-800">{item.targetEmail}</span>
              {item.emailCount > 1 && (
                <span className="text-[10px] text-slate-500">+{item.emailCount - 1} more</span>
              )}
            </div>
          ) : (
            <div className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-900">
              No contact email yet
            </div>
          )}
          <SmtpBadge status={item.smtpStatus} />
        </div>

        <div className="space-y-1">
          <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">Subject</span>
          <p className="line-clamp-2 text-xs font-medium break-words text-slate-800">{item.subject}</p>
        </div>

        {error && (
          <p role="alert" className="rounded border border-red-200 bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
            {error}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <SendStatusBadge status={item.sendStatus} />
            {item.approved && <Badge tone="success">Approved</Badge>}
          </div>

          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant={item.approved ? 'outline' : 'primary'}
              isLoading={busy}
              disabled={busy || (!item.approved && !canApprove)}
              onClick={() => void toggleApproval()}
              title={
                !item.approved && !canApprove
                  ? 'Add and verify a contact email first, or open the draft for details'
                  : undefined
              }
            >
              {item.approved ? 'Unapprove' : 'Approve'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={onOpen}>
              <EditIcon width={12} height={12} /> Open
            </Button>
            <Link
              href={`/lead-ingestion/client/${item.leadId}`}
              aria-label={`Open the workspace for ${item.candidateName}`}
              className="rounded p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <ExternalLinkIcon width={13} height={13} />
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
