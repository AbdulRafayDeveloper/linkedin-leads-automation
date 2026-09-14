import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils/cn';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  CheckCircleIcon,
  ClockIcon,
  XCircleIcon,
  type IconProps,
} from '@/components/ui/Icons';
import type { DashboardStats, LeadStage, RecentCampaign } from '@/services/dashboard/types';
import { formatNumber, formatPercent, share, timeAgo } from './format';

export function Panel({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'flex flex-col rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]',
        className
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-slate-500">{description}</p>}
        </div>
        {action}
      </div>
      <div className="flex-1 px-5 py-4">{children}</div>
    </section>
  );
}

function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-indigo-600 transition-colors hover:text-indigo-800"
    >
      {children}
      <ArrowRightIcon width={12} height={12} />
    </Link>
  );
}

function EmptyNote({ text, href, linkText }: { text: string; href: string; linkText: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <p className="text-[13px] text-slate-500">{text}</p>
      <PanelLink href={href}>{linkText}</PanelLink>
    </div>
  );
}

// ── Funnel ───────────────────────────────────────────────────────────────────

export function FunnelPanel({ funnel }: { funnel: DashboardStats['funnel'] }) {
  const base = funnel[0]?.value ?? 0;
  return (
    <Panel title="Lead progress" description="Leads from this period at each step">
      <ol className="space-y-3.5">
        {funnel.map((step) => {
          const ratio = share(step.value, base);
          return (
            <li key={step.key}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-slate-600">{step.label}</span>
                <span className="tabular-nums">
                  <span className="font-semibold text-slate-900">{formatNumber(step.value)}</span>
                  <span className="ml-1.5 inline-block w-9 text-right text-xs text-slate-400">
                    {step.key === 'imported' ? '' : formatPercent(ratio)}
                  </span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-indigo-50">
                <div
                  className="h-full rounded-full bg-indigo-500 transition-[width] duration-500"
                  style={{ width: `${(ratio ?? 0) * 100}%` }}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

// ── Email verification ───────────────────────────────────────────────────────

const VERIFICATION_ROWS: {
  key: keyof DashboardStats['verification'];
  label: string;
  color: string;
  Icon: (props: IconProps) => ReactNode;
}[] = [
  { key: 'valid', label: 'Valid', color: '#0ca30c', Icon: CheckCircleIcon },
  { key: 'risky', label: 'Risky', color: '#fab219', Icon: AlertTriangleIcon },
  { key: 'invalid', label: 'Invalid', color: '#d03b3b', Icon: XCircleIcon },
  { key: 'unknown', label: 'Unknown', color: '#94a3b8', Icon: AlertTriangleIcon },
  { key: 'pending', label: 'Not checked', color: '#cbd5e1', Icon: ClockIcon },
];

export function VerificationPanel({ verification }: { verification: DashboardStats['verification'] }) {
  const total = VERIFICATION_ROWS.reduce((sum, row) => sum + verification[row.key], 0);
  const segments = VERIFICATION_ROWS.filter((row) => verification[row.key] > 0);

  return (
    <Panel title="Email verification" description={`${formatNumber(total)} emails found`}>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        {segments.map((row) => (
          <div key={row.key} style={{ flexGrow: verification[row.key], backgroundColor: row.color }} />
        ))}
      </div>
      <ul className="mt-4 space-y-2.5">
        {VERIFICATION_ROWS.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-3 text-[13px]">
            <span className="flex items-center gap-2 text-slate-600">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: row.color }} />
              <row.Icon width={13} height={13} className="text-slate-400" />
              {row.label}
            </span>
            <span className="tabular-nums">
              <span className="font-semibold text-slate-900">{formatNumber(verification[row.key])}</span>
              <span className="ml-1.5 inline-block w-9 text-right text-xs text-slate-400">
                {formatPercent(share(verification[row.key], total))}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ── Small stat grids ─────────────────────────────────────────────────────────

function StatGrid({ items }: { items: { label: string; value: ReactNode; hint?: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="text-xs text-slate-500">{item.label}</dt>
          <dd className="mt-1 text-xl font-semibold tracking-tight text-slate-900">{item.value}</dd>
          {item.hint && <dd className="mt-0.5 text-xs text-slate-400">{item.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

export function DraftsPanel({ drafts }: { drafts: DashboardStats['drafts'] }) {
  return (
    <Panel
      title="Drafts"
      description="Personal and company emails"
      action={<PanelLink href="/lead-ingestion/emails">Review</PanelLink>}
    >
      <StatGrid
        items={[
          { label: 'Written', value: formatNumber(drafts.written) },
          { label: 'Awaiting review', value: formatNumber(drafts.awaitingReview) },
          { label: 'Approved', value: formatNumber(drafts.approved), hint: `${formatPercent(share(drafts.approved, drafts.written))} of written` },
          { label: 'In campaigns', value: formatNumber(drafts.inCampaign) },
        ]}
      />
    </Panel>
  );
}

export function ResearchPanel({ research, leads }: { research: DashboardStats['research']; leads: number }) {
  return (
    <Panel title="Research" description="What was found on company websites">
      <StatGrid
        items={[
          { label: 'Companies', value: formatNumber(research.companies) },
          { label: 'With a website', value: formatNumber(research.withWebsite), hint: `${formatPercent(share(research.withWebsite, research.companies))} of companies` },
          { label: 'Leads with a phone', value: formatNumber(research.leadsWithPhone), hint: `${formatPercent(share(research.leadsWithPhone, leads))} of leads` },
          { label: 'Failed crawls', value: formatNumber(research.crawlsFailed) },
        ]}
      />
    </Panel>
  );
}

export function DeliveryPanel({
  delivery,
  trackingEnabled,
}: {
  delivery: DashboardStats['delivery'];
  trackingEnabled: boolean;
}) {
  return (
    <Panel title="Delivery" description="Emails sent in this period">
      <StatGrid
        items={[
          { label: 'Delivered', value: formatNumber(delivery.delivered), hint: delivery.deliveryRate === null ? undefined : `${formatPercent(delivery.deliveryRate)} success rate` },
          { label: 'Failed', value: formatNumber(delivery.failed) },
          {
            label: 'Opened',
            value: trackingEnabled ? formatNumber(delivery.opened) : '–',
            hint: trackingEnabled ? (delivery.openRate === null ? undefined : `${formatPercent(delivery.openRate)} open rate`) : 'Open tracking is off',
          },
          { label: 'Waiting in queue', value: formatNumber(delivery.queued), hint: 'Right now' },
        ]}
      />
    </Panel>
  );
}

// ── Recent lists ─────────────────────────────────────────────────────────────

const STAGE_BADGE: Record<LeadStage, { label: string; tone: BadgeTone }> = {
  processing: { label: 'Processing', tone: 'info' },
  imported: { label: 'No email', tone: 'neutral' },
  email_found: { label: 'Email found', tone: 'neutral' },
  verified: { label: 'Verified', tone: 'info' },
  drafted: { label: 'Draft ready', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  contacted: { label: 'Contacted', tone: 'success' },
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function RecentLeadsPanel({ leads }: { leads: DashboardStats['recentLeads'] }) {
  return (
    <Panel
      title="Recent leads"
      description="Newest leads in this period"
      action={<PanelLink href="/my-leads">All leads</PanelLink>}
    >
      {leads.length === 0 ? (
        <EmptyNote text="No leads imported in this period." href="/lead-ingestion" linkText="Import a lead" />
      ) : (
        <ul className="-mx-2 divide-y divide-slate-100">
          {leads.map((lead) => {
            const badge = STAGE_BADGE[lead.stage];
            return (
              <li key={lead.id}>
                <Link
                  href={`/lead-ingestion/client/${lead.id}`}
                  className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-slate-50"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                    {initials(lead.fullName)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-slate-900">{lead.fullName}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {lead.companyName ?? 'No company'} · {lead.emailCount} {lead.emailCount === 1 ? 'email' : 'emails'}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                    <span className="text-[11px] text-slate-400">{timeAgo(lead.createdAt)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

const CAMPAIGN_BADGE: Record<RecentCampaign['status'], { label: string; tone: BadgeTone }> = {
  running: { label: 'Running', tone: 'info' },
  paused: { label: 'Paused', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  draft: { label: 'Draft', tone: 'neutral' },
};

export function CampaignsPanel({ campaigns }: { campaigns: DashboardStats['campaigns'] }) {
  const summary = [
    campaigns.running && `${campaigns.running} running`,
    campaigns.paused && `${campaigns.paused} paused`,
    campaigns.completed && `${campaigns.completed} completed`,
    campaigns.draft && `${campaigns.draft} draft`,
  ].filter(Boolean);

  return (
    <Panel
      title="Campaigns"
      description={summary.length ? summary.join(' · ') : 'Latest activity, any date'}
      action={<PanelLink href="/lead-ingestion/campaigns">All campaigns</PanelLink>}
    >
      {campaigns.recent.length === 0 ? (
        <EmptyNote text="No campaigns yet." href="/lead-ingestion/approved" linkText="Start one from Ready to Send" />
      ) : (
        <ul className="-mx-2 divide-y divide-slate-100">
          {campaigns.recent.map((campaign) => {
            const badge = CAMPAIGN_BADGE[campaign.status];
            const progress = share(campaign.processed, campaign.total) ?? 0;
            return (
              <li key={campaign.id}>
                <Link
                  href={`/lead-ingestion/campaigns/${campaign.id}`}
                  className="block rounded-lg px-2 py-2.5 transition-colors hover:bg-slate-50"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-[13px] font-medium text-slate-900">{campaign.name}</span>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-indigo-50">
                    <div className="h-full rounded-full bg-indigo-500" style={{ width: `${progress * 100}%` }} />
                  </div>
                  <p className="mt-1.5 flex flex-wrap gap-x-3 text-xs text-slate-500 tabular-nums">
                    <span>
                      {formatNumber(campaign.processed)}/{formatNumber(campaign.total)} sent
                    </span>
                    <span>{formatNumber(campaign.delivered)} delivered</span>
                    {campaign.opened > 0 && <span>{formatNumber(campaign.opened)} opened</span>}
                    {campaign.failed > 0 && <span className="text-red-600">{formatNumber(campaign.failed)} failed</span>}
                    <span className="ml-auto text-slate-400">{timeAgo(campaign.updatedAt)}</span>
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
