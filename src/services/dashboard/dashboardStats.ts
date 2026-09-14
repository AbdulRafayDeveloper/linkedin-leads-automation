import type { PipelineStage, Types } from 'mongoose';
import { connectToMongoDB } from '@/lib/db/connection';
import { LeadIngestion } from '@/lib/db/models/LeadIngestion';
import { Campaign, type CampaignItemStatus, type CampaignStatus } from '@/lib/db/models/Campaign';
import { buildBuckets, createBucketKey, pickGranularity, resolveTimeZone } from './timeBuckets';
import type { DashboardStats, FunnelStep, LeadStage, RecentCampaign, RecentLead, SeriesPoint } from './types';

const RECENT_LIMIT = 6;
const CONTACTED = new Set(['delivered', 'opened']);

interface DateRange {
  from: Date;
  to: Date;
}

// ── Lead cohort ──────────────────────────────────────────────────────────────

/** A LeadIngestion reduced to what the dashboard needs (no email bodies). */
export interface LeadStatDoc {
  _id: Types.ObjectId | string;
  fullName: string | null;
  companyName: string | null;
  createdAt: Date;
  status: string;
  crawlStatus: string;
  emailStatus?: string | null;
  campaignSendStatus?: string | null;
  inCampaign?: boolean | null;
  approved?: boolean | null;
  email: string | null;
  discoveredEmails?: string[] | null;
  discoveredPhones?: string[] | null;
  verifiedEmails?: { email: string; status: string }[] | null;
  hasPersonalDraft: boolean;
  companies: {
    companyName?: string | null;
    websiteUrl?: string | null;
    companyEmails?: string[] | null;
    approved?: boolean | null;
    inCampaign?: boolean | null;
    campaignSendStatus?: string | null;
    hasDraft: boolean;
  }[];
}

const hasText = (field: string) => ({ $gt: [{ $strLenCP: { $ifNull: [field, ''] } }, 0] });

function leadStatsPipeline(range: DateRange | null): PipelineStage[] {
  return [
    ...(range ? [{ $match: { createdAt: { $gte: range.from, $lte: range.to } } }] : []),
    { $sort: { createdAt: -1 } },
    {
      $project: {
        fullName: 1,
        companyName: 1,
        createdAt: 1,
        status: 1,
        crawlStatus: 1,
        emailStatus: 1,
        campaignSendStatus: 1,
        inCampaign: 1,
        approved: 1,
        email: 1,
        discoveredEmails: 1,
        discoveredPhones: 1,
        verifiedEmails: 1,
        hasPersonalDraft: { $and: [hasText('$emailSubject'), hasText('$emailBody')] },
        companies: {
          $map: {
            input: { $ifNull: ['$currentCompanies', []] },
            as: 'c',
            in: {
              companyName: '$$c.companyName',
              websiteUrl: '$$c.websiteUrl',
              companyEmails: '$$c.companyEmails',
              approved: '$$c.approved',
              inCampaign: '$$c.inCampaign',
              campaignSendStatus: '$$c.campaignSendStatus',
              hasDraft: { $and: [hasText('$$c.emailSubject'), hasText('$$c.emailBody')] },
            },
          },
        },
      },
    },
  ];
}

function emailsOf(lead: LeadStatDoc): Set<string> {
  const all = [
    lead.email,
    ...(lead.discoveredEmails ?? []),
    ...lead.companies.flatMap((c) => c.companyEmails ?? []),
  ];
  return new Set(all.filter((e): e is string => !!e && e.includes('@')).map((e) => e.trim().toLowerCase()));
}

function stageOf(lead: LeadStatDoc, emails: Set<string>, verifiedCount: number): LeadStage {
  const contacted =
    CONTACTED.has(lead.campaignSendStatus ?? '') ||
    CONTACTED.has(lead.emailStatus ?? '') ||
    lead.companies.some((c) => CONTACTED.has(c.campaignSendStatus ?? ''));
  if (contacted) return 'contacted';
  if ((lead.approved && lead.hasPersonalDraft) || lead.companies.some((c) => c.approved && c.hasDraft)) return 'approved';
  if (lead.hasPersonalDraft || lead.companies.some((c) => c.hasDraft)) return 'drafted';
  if (verifiedCount > 0) return 'verified';
  if (emails.size > 0) return 'email_found';
  return lead.status === 'processing' ? 'processing' : 'imported';
}

const STAGE_ORDER: LeadStage[] = ['imported', 'email_found', 'verified', 'drafted', 'approved', 'contacted'];

export function summarizeLeads(leads: LeadStatDoc[]) {
  const verification = { valid: 0, risky: 0, invalid: 0, unknown: 0, pending: 0 };
  const drafts = { written: 0, awaitingReview: 0, approved: 0, inCampaign: 0 };
  const research = { companies: 0, withWebsite: 0, leadsWithPhone: 0, crawlsFailed: 0 };
  const reached: Record<string, number> = Object.fromEntries(STAGE_ORDER.map((s) => [s, 0]));
  let emailsFound = 0;
  const recent: RecentLead[] = [];

  for (const lead of leads) {
    const emails = emailsOf(lead);
    emailsFound += emails.size;

    // Every found email counts once; emails never checked count as pending.
    const statusByEmail = new Map((lead.verifiedEmails ?? []).map((v) => [v.email.trim().toLowerCase(), v.status]));
    let verifiedCount = 0;
    for (const email of emails) {
      const status = statusByEmail.get(email) ?? 'pending';
      const bucket = status in verification ? (status as keyof typeof verification) : 'unknown';
      verification[bucket] += 1;
      if (bucket === 'valid' || bucket === 'risky') verifiedCount += 1;
    }

    const boxes = [
      { hasDraft: lead.hasPersonalDraft, approved: !!lead.approved, inCampaign: !!lead.inCampaign },
      ...lead.companies.map((c) => ({ hasDraft: c.hasDraft, approved: !!c.approved, inCampaign: !!c.inCampaign })),
    ];
    for (const box of boxes) {
      if (box.inCampaign) drafts.inCampaign += 1;
      if (!box.hasDraft) continue;
      drafts.written += 1;
      if (box.approved) drafts.approved += 1;
      else if (!box.inCampaign) drafts.awaitingReview += 1;
    }

    research.companies += lead.companies.length;
    research.withWebsite += lead.companies.filter((c) => !!c.websiteUrl).length;
    if ((lead.discoveredPhones?.length ?? 0) > 0) research.leadsWithPhone += 1;
    if (lead.crawlStatus === 'failed') research.crawlsFailed += 1;

    // Each step is counted on its own: a personal draft is written even for
    // leads with no email, so "reached a later step" does not imply the earlier ones.
    const hasDraft = boxes.some((b) => b.hasDraft);
    const stage = stageOf(lead, emails, verifiedCount);
    reached.imported += 1;
    if (emails.size > 0) reached.email_found += 1;
    if (verifiedCount > 0) reached.verified += 1;
    if (hasDraft) reached.drafted += 1;
    if (boxes.some((b) => b.hasDraft && b.approved)) reached.approved += 1;
    if (stage === 'contacted') reached.contacted += 1;

    if (recent.length < RECENT_LIMIT) {
      recent.push({
        id: String(lead._id),
        fullName: lead.fullName || 'Unnamed lead',
        companyName: lead.companies[0]?.companyName ?? lead.companyName ?? null,
        createdAt: new Date(lead.createdAt).toISOString(),
        emailCount: emails.size,
        stage,
      });
    }
  }

  const funnelLabels: Record<FunnelStep['key'], string> = {
    imported: 'Imported',
    email_found: 'Email found',
    verified: 'Email verified',
    drafted: 'Draft written',
    approved: 'Approved',
    contacted: 'Contacted',
  };
  const funnel: FunnelStep[] = STAGE_ORDER.map((key) => ({
    key: key as FunnelStep['key'],
    label: funnelLabels[key as FunnelStep['key']],
    value: reached[key],
  }));

  return {
    leads: leads.length,
    emailsFound,
    verified: verification.valid + verification.risky,
    verification,
    drafts,
    research,
    funnel,
    recent,
  };
}

// ── Campaign sending ─────────────────────────────────────────────────────────

export interface CampaignStatDoc {
  _id: Types.ObjectId | string;
  name: string;
  status: CampaignStatus;
  totalEmails: number;
  updatedAt: Date;
  items: {
    status: CampaignItemStatus;
    sentAt?: Date | null;
    openedAt?: Date | null;
    failedAt?: Date | null;
  }[];
}

const within = (date: Date | null | undefined, range: DateRange | null) =>
  !!date && (!range || (date >= range.from && date <= range.to));

export function summarizeCampaigns(campaigns: CampaignStatDoc[], range: DateRange | null, previous: DateRange | null) {
  let delivered = 0;
  let opened = 0;
  let openedOfDelivered = 0;
  let failed = 0;
  let queued = 0;
  let previousDelivered = 0;
  let previousOpened = 0;
  const statusCounts = { running: 0, paused: 0, completed: 0, draft: 0 };

  for (const campaign of campaigns) {
    statusCounts[campaign.status] += 1;
    for (const item of campaign.items) {
      const wasDelivered = item.status === 'delivered' || item.status === 'opened';
      if (item.status === 'pending' || item.status === 'sending') queued += 1;
      if (wasDelivered && within(item.sentAt, range)) {
        delivered += 1;
        if (item.status === 'opened') openedOfDelivered += 1;
      }
      if (within(item.openedAt, range)) opened += 1;
      // Items that failed before `failedAt` existed fall back to the campaign's last update.
      if (item.status === 'failed' && within(item.failedAt ?? campaign.updatedAt, range)) failed += 1;
      if (previous) {
        if (wasDelivered && within(item.sentAt, previous)) previousDelivered += 1;
        if (within(item.openedAt, previous)) previousOpened += 1;
      }
    }
  }

  const recent: RecentCampaign[] = [...campaigns]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5)
    .map((c) => ({
      id: String(c._id),
      name: c.name,
      status: c.status,
      total: c.totalEmails || c.items.length,
      processed: c.items.filter((i) => i.status !== 'pending' && i.status !== 'sending').length,
      delivered: c.items.filter((i) => i.status === 'delivered' || i.status === 'opened').length,
      opened: c.items.filter((i) => i.status === 'opened').length,
      failed: c.items.filter((i) => i.status === 'failed').length,
      updatedAt: new Date(c.updatedAt).toISOString(),
    }));

  return {
    delivered,
    opened,
    failed,
    queued,
    previousDelivered,
    previousOpened,
    deliveryRate: delivered + failed > 0 ? delivered / (delivered + failed) : null,
    openRate: delivered > 0 ? openedOfDelivered / delivered : null,
    statusCounts,
    recent,
  };
}

// ── Time series ──────────────────────────────────────────────────────────────

export function buildSeries(
  range: DateRange,
  timeZone: string,
  leads: LeadStatDoc[],
  campaigns: CampaignStatDoc[]
): { granularity: DashboardStats['range']['granularity']; series: SeriesPoint[] } {
  const granularity = pickGranularity(range.from, range.to);
  const keyOf = createBucketKey(granularity, timeZone);
  const points = new Map<string, SeriesPoint>(
    buildBuckets(range.from, range.to, granularity, timeZone).map((b) => [b.key, { ...b, leads: 0, sent: 0, opened: 0 }])
  );
  const bump = (date: Date | null | undefined, field: 'leads' | 'sent' | 'opened') => {
    if (!within(date, range)) return;
    const point = points.get(keyOf(new Date(date!)));
    if (point) point[field] += 1;
  };

  for (const lead of leads) bump(lead.createdAt, 'leads');
  for (const campaign of campaigns) {
    for (const item of campaign.items) {
      if (item.status === 'delivered' || item.status === 'opened') bump(item.sentAt, 'sent');
      bump(item.openedAt, 'opened');
    }
  }
  return { granularity, series: [...points.values()] };
}

// ── Entry point ──────────────────────────────────────────────────────────────

export interface DashboardQuery {
  from?: Date | null;
  to?: Date | null;
  timeZone?: string | null;
  now?: Date;
}

/**
 * Stats for the dashboard. With `from`, lead metrics cover leads imported in
 * the range and sending metrics cover emails sent or opened in the range; the
 * previous period of equal length feeds the deltas. Without `from` it is all
 * time. Queue size and campaign statuses are always the current state.
 */
export async function getDashboardStats(query: DashboardQuery = {}): Promise<DashboardStats> {
  await connectToMongoDB();
  const now = query.now ?? new Date();
  const timeZone = resolveTimeZone(query.timeZone);
  const isAllTime = !query.from;

  const campaignsPromise = Campaign.find()
    .select('name status totalEmails updatedAt createdAt items.status items.sentAt items.openedAt items.failedAt')
    .lean<(CampaignStatDoc & { createdAt: Date })[]>()
    .exec(); // a real promise: it is awaited in two places below

  let range: DateRange;
  let previous: DateRange | null = null;
  if (isAllTime) {
    const [firstLead, campaigns] = await Promise.all([
      LeadIngestion.findOne().sort({ createdAt: 1 }).select('createdAt').lean<{ createdAt: Date }>(),
      campaignsPromise,
    ]);
    const firstCampaign = campaigns.reduce<Date | null>(
      (min, c) => (!min || c.createdAt < min ? c.createdAt : min),
      null
    );
    const earliest = [firstLead?.createdAt, firstCampaign].filter(Boolean) as Date[];
    const from = earliest.length ? new Date(Math.min(...earliest.map((d) => d.getTime()))) : now;
    range = { from, to: now };
  } else {
    const to = query.to ?? now;
    range = { from: query.from!, to };
    const span = to.getTime() - range.from.getTime();
    previous = { from: new Date(range.from.getTime() - span - 1), to: new Date(range.from.getTime() - 1) };
  }

  const [leads, previousLeads, campaigns] = await Promise.all([
    LeadIngestion.aggregate<LeadStatDoc>(leadStatsPipeline(isAllTime ? null : range)),
    previous ? LeadIngestion.aggregate<LeadStatDoc>(leadStatsPipeline(previous)) : Promise.resolve(null),
    campaignsPromise,
  ]);

  const current = summarizeLeads(leads);
  const before = previousLeads ? summarizeLeads(previousLeads) : null;
  const sending = summarizeCampaigns(campaigns, isAllTime ? null : range, previous);
  const { granularity, series } = buildSeries(range, timeZone, leads, campaigns);

  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString(), granularity, isAllTime },
    trackingEnabled: process.env.ENABLE_OPEN_TRACKING === 'true',
    kpis: {
      leads: { value: current.leads, previous: before?.leads ?? null },
      emailsFound: { value: current.emailsFound, previous: before?.emailsFound ?? null },
      verified: { value: current.verified, previous: before?.verified ?? null },
      sent: { value: sending.delivered, previous: previous ? sending.previousDelivered : null },
      opened: { value: sending.opened, previous: previous ? sending.previousOpened : null },
    },
    funnel: current.funnel,
    verification: current.verification,
    drafts: current.drafts,
    research: current.research,
    delivery: {
      delivered: sending.delivered,
      opened: sending.opened,
      failed: sending.failed,
      queued: sending.queued,
      deliveryRate: sending.deliveryRate,
      openRate: sending.openRate,
    },
    campaigns: { ...sending.statusCounts, recent: sending.recent },
    recentLeads: current.recent,
    series,
  };
}
