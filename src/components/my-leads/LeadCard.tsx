'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { buttonClasses } from '@/components/ui/buttonClasses';
import { Card } from '@/components/ui/Card';
import CopyButton from '@/components/ui/CopyButton';
import {
  ArrowRightIcon,
  BuildingIcon,
  CheckCircleIcon,
  ClockIcon,
  ExternalLinkIcon,
  LinkedInIcon,
  LoaderIcon,
  TrashIcon,
  UsersIcon,
} from '@/components/ui/Icons';
import { cn } from '@/lib/utils/cn';
import {
  buildLeadBoxes,
  emailStatusMeta,
  formatLeadDate,
  looksUnreliableName,
  pickLinkedInUrl,
  realValue,
  type EmailRow,
  type LeadBox,
  type LeadCardRecord,
} from '@/lib/leads/cards';

function EmailLine({ row }: { row: EmailRow }) {
  const meta = emailStatusMeta(row.status);
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-slate-200 bg-white px-2 py-1.5">
      {/* break-all, never truncate: the address is the point of this page. */}
      <span className="min-w-0 flex-1 font-mono text-xs break-all text-slate-800">{row.email}</span>
      <span className="flex shrink-0 items-center gap-1">
        {row.shared && (
          <span title="This address is also listed in another box on this lead">
            <Badge tone="neutral">Shared</Badge>
          </span>
        )}
        <span title={meta.description}>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </span>
        <CopyButton
          getContent={() => ({ text: row.email })}
          label={`Copy ${row.email}`}
          className="h-6 w-6"
        />
      </span>
    </li>
  );
}

/** Emails shown before the box collapses the rest, so one card can't run away. */
const EMAILS_BEFORE_FOLD = 5;

function BoxView({ box }: { box: LeadBox }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = box.kind === 'personal' ? UsersIcon : BuildingIcon;
  const hidden = Math.max(0, box.emails.length - EMAILS_BEFORE_FOLD);
  const shown = expanded ? box.emails : box.emails.slice(0, EMAILS_BEFORE_FOLD);
  return (
    <section
      className={cn(
        'min-w-0 rounded-lg border p-3',
        box.kind === 'personal' ? 'border-indigo-100 bg-indigo-50/40' : 'border-slate-200 bg-slate-50/70'
      )}
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-x-2 gap-y-1 border-b border-slate-200/80 pb-2">
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-900">
            <Icon width={13} height={13} className="shrink-0 text-slate-500" />
            <span className="truncate" title={box.title}>
              {box.title}
            </span>
          </p>
          {box.subtitle && (
            <p className="mt-0.5 truncate text-xs text-slate-500" title={box.subtitle}>
              {box.subtitle}
            </p>
          )}
        </div>
        <Badge
          tone={box.approved ? 'success' : 'neutral'}
          icon={
            box.approved ? (
              <CheckCircleIcon width={11} height={11} />
            ) : (
              <ClockIcon width={11} height={11} />
            )
          }
        >
          {box.approved ? 'Draft approved' : 'Approval pending'}
        </Badge>
      </div>

      {box.emails.length > 0 ? (
        <>
          <ul className="space-y-1.5">
            {shown.map((row) => (
              <EmailLine key={`${box.key}-${row.email.toLowerCase()}`} row={row} />
            ))}
          </ul>
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              className="mt-1.5 rounded text-xs font-medium text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              {expanded ? 'Show fewer addresses' : `Show ${hidden} more address${hidden === 1 ? '' : 'es'}`}
            </button>
          )}
        </>
      ) : (
        <p className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50/80 px-2 py-1.5 text-xs text-amber-800">
          {box.kind === 'personal' ? 'No personal email found' : 'No company email found'}
          <Badge tone="warning">Needs crawling</Badge>
        </p>
      )}
    </section>
  );
}

export default function LeadCard({
  lead,
  selected,
  onToggleSelect,
  onRequestDelete,
  deleting,
}: {
  lead: LeadCardRecord;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onRequestDelete: (lead: LeadCardRecord) => void;
  deleting: boolean;
}) {
  const name = realValue(lead.fullName) ?? 'Unnamed lead';
  const boxes = buildLeadBoxes(lead);
  const linkedinUrl = pickLinkedInUrl(lead);
  const created = formatLeadDate(lead.createdAt);
  const clientName = realValue(lead.clientName);
  const hasCompanies = (lead.currentCompanies?.length ?? 0) > 0;

  return (
    <Card className="flex min-w-0 flex-col">
      <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(lead._id)}
          aria-label={`Select ${name}`}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        />

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-slate-900" title={name}>
            {name}
          </h2>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
            {clientName && (
              <span className="max-w-full truncate rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                {clientName}
              </span>
            )}
            {created && <span>{created}</span>}
            {looksUnreliableName(lead.fullName) && (
              <span title="This name does not look like a person; the extraction may need a check">
                <Badge tone="warning">Check extraction</Badge>
              </span>
            )}
          </div>

          {linkedinUrl && (
            <a
              href={linkedinUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1.5 inline-flex max-w-full items-center gap-1 text-xs font-medium text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              <LinkedInIcon width={12} height={12} className="shrink-0" />
              <span className="truncate">{linkedinUrl.replace(/^https?:\/\/(www\.)?/, '')}</span>
              <ExternalLinkIcon width={10} height={10} className="shrink-0" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </div>

        <button
          type="button"
          onClick={() => onRequestDelete(lead)}
          disabled={deleting}
          aria-label={`Delete ${name}`}
          title={`Delete ${name}`}
          className="-mr-1 shrink-0 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-40"
        >
          {deleting ? (
            <LoaderIcon width={15} height={15} className="animate-spin text-red-500" />
          ) : (
            <TrashIcon width={15} height={15} />
          )}
        </button>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2.5 px-4 py-3">
        {boxes.map((box) => (
          <BoxView key={box.key} box={box} />
        ))}
        {!hasCompanies && (
          <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2 text-xs text-slate-500">
            No company captured for this lead yet.
          </p>
        )}
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-2.5">
        <span className="flex items-center gap-1 text-xs text-slate-500">
          <span title={`Lead ID ${lead._id}`}>ID {lead._id.slice(-6)}</span>
          <CopyButton
            getContent={() => ({ text: lead._id })}
            label="Copy full lead ID"
            className="h-6 w-6"
          />
        </span>
        <Link
          href={`/lead-ingestion/client/${lead._id}`}
          className={buttonClasses('outline', 'sm')}
          aria-label={`Open ${name}`}
        >
          Open lead
          <ArrowRightIcon width={13} height={13} />
        </Link>
      </div>
    </Card>
  );
}
