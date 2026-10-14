import type { PipelineStage } from 'mongoose';
import { connectToMongoDB } from '@/lib/db/connection';
import { LeadIngestion } from '@/lib/db/models/LeadIngestion';
import { Campaign } from '@/lib/db/models/Campaign';
import {
  buildBuckets,
  mongoBucketKey,
  pickGranularity,
  resolveTimeZone,
} from './timeBuckets';
import type {
  DashboardStats,
  FunnelStep,
  Granularity,
  LeadStage,
  RecentCampaign,
  RecentLead,
  SeriesPoint,
} from './types';

const RECENT_LEADS = 6;
const RECENT_CAMPAIGNS = 5;
const SENDABLE = ['valid', 'risky'];
const CONTACTED_STATUSES = ['delivered', 'opened'];

/** Company names the pipeline writes when it found nothing; never counted. */
const PLACEHOLDER_COMPANY_NAMES = ['', 'unspecified company', 'unknown company', 'n/a', 'none'];

export interface DateRange {
  from: Date;
  to: Date;
}

// ── Mongo expression helpers ─────────────────────────────────────────────────

const hasText = (field: string) => ({ $gt: [{ $strLenCP: { $ifNull: [field, ''] } }, 0] });

/** True when `field` holds a date inside the range (any date when unbounded). */
function dateWithin(field: string, range: DateRange | null) {
  if (!range) return { $ne: [field, null] };
  return {
    $and: [{ $ne: [field, null] }, { $gte: [field, range.from] }, { $lte: [field, range.to] }],
  };
}

const countIf = (condition: unknown) => ({ $sum: { $cond: [condition, 1, 0] } });

// ── Lead statistics ──────────────────────────────────────────────────────────

/**
 * Per-lead fields the facets below group on. Everything is derived in the
 * database so a big workspace never ships its documents to the app.
 */
const LEAD_DERIVED: PipelineStage[] = [
  {
    $addFields: {
      _emails: {
        $setUnion: [
          {
            $map: {
              input: {
                $filter: {
                  input: {
                    $concatArrays: [
                      { $ifNull: ['$discoveredEmails', []] },
                      { $cond: [{ $ifNull: ['$email', false] }, ['$email'], []] },
                      {
                        $reduce: {
                          input: { $ifNull: ['$currentCompanies', []] },
                          initialValue: [],
                          in: { $concatArrays: ['$$value', { $ifNull: ['$$this.companyEmails', []] }] },
                        },
                      },
                    ],
                  },
                  as: 'e',
                  cond: {
                    $and: [
                      { $eq: [{ $type: '$$e' }, 'string'] },
                      { $gt: [{ $indexOfCP: [{ $ifNull: ['$$e', ''] }, '@'] }, 0] },
                    ],
                  },
                },
              },
              as: 'e',
              in: { $toLower: { $trim: { input: '$$e' } } },
            },
          },
          [],
        ],
      },
      _sendable: {
        $setUnion: [
          {
            $map: {
              input: {
                $filter: {
                  input: { $ifNull: ['$verifiedEmails', []] },
                  as: 'v',
                  cond: { $in: ['$$v.status', SENDABLE] },
                },
              },
              as: 'v',
              in: { $toLower: { $ifNull: ['$$v.email', ''] } },
            },
          },
          [],
        ],
      },
      _boxes: {
        $concatArrays: [
          [
            {
              hasDraft: { $and: [hasText('$emailSubject'), hasText('$emailBody')] },
              approved: { $eq: ['$approved', true] },
              inCampaign: { $eq: ['$inCampaign', true] },
            },
          ],
          {
            $map: {
              input: { $ifNull: ['$currentCompanies', []] },
              as: 'c',
              in: {
                hasDraft: { $and: [hasText('$$c.emailSubject'), hasText('$$c.emailBody')] },
                approved: { $eq: ['$$c.approved', true] },
                inCampaign: { $eq: ['$$c.inCampaign', true] },
              },
            },
          },
        ],
      },
      // Placeholder company names are not companies that were found.
      _realCompanies: {
        $filter: {
          input: { $ifNull: ['$currentCompanies', []] },
          as: 'c',
          cond: {
            $not: {
              $in: [
                { $toLower: { $trim: { input: { $ifNull: ['$$c.companyName', ''] } } } },
                PLACEHOLDER_COMPANY_NAMES,
              ],
            },
          },
        },
      },
      _contacted: {
        $or: [
          { $in: [{ $ifNull: ['$campaignSendStatus', ''] }, CONTACTED_STATUSES] },
          { $in: [{ $ifNull: ['$emailStatus', ''] }, CONTACTED_STATUSES] },
          {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: { $ifNull: ['$currentCompanies', []] },
                    as: 'c',
                    cond: { $in: [{ $ifNull: ['$$c.campaignSendStatus', ''] }, CONTACTED_STATUSES] },
                  },
                },
              },
              0,
            ],
          },
        ],
      },
    },
  },
  {
    $addFields: {
      _verifiedCount: { $size: { $setIntersection: ['$_emails', '$_sendable'] } },
      _draftBoxes: { $filter: { input: '$_boxes', as: 'b', cond: '$$b.hasDraft' } },
    },
  },
  {
    $addFields: {
      _hasDraft: { $gt: [{ $size: '$_draftBoxes' }, 0] },
      _hasApprovedDraft: {
        $gt: [{ $size: { $filter: { input: '$_draftBoxes', as: 'b', cond: '$$b.approved' } } }, 0],
      },
    },
  },
];

const STAGE_EXPRESSION = {
  $switch: {
    branches: [
      { case: '$_contacted', then: 'contacted' },
      { case: '$_hasApprovedDraft', then: 'approved' },
      { case: '$_hasDraft', then: 'drafted' },
      { case: { $gt: ['$_verifiedCount', 0] }, then: 'verified' },
      { case: { $gt: [{ $size: '$_emails' }, 0] }, then: 'email_found' },
      { case: { $eq: ['$status', 'processing'] }, then: 'processing' },
    ],
    default: 'imported',
  },
};

/** Rank per address so one shared mailbox is counted once, at its best status. */
const EMAIL_RANK = {
  $let: {
    vars: {
      hit: {
        $first: {
          $filter: {
            input: { $ifNull: ['$verifiedEmails', []] },
            as: 'v',
            cond: { $eq: [{ $toLower: { $ifNull: ['$$v.email', ''] } }, '$$e'] },
          },
        },
      },
    },
    in: {
      $switch: {
        branches: [
          { case: { $eq: ['$$hit.status', 'valid'] }, then: 5 },
          { case: { $eq: ['$$hit.status', 'risky'] }, then: 4 },
          { case: { $eq: ['$$hit.status', 'invalid'] }, then: 3 },
          { case: { $eq: ['$$hit.status', 'unknown'] }, then: 2 },
        ],
        default: 1,
      },
    },
  },
};

const RANK_TO_BUCKET: Record<number, keyof DashboardStats['verification']> = {
  5: 'valid',
  4: 'risky',
  3: 'invalid',
  2: 'unknown',
  1: 'pending',
};

interface LeadTotalsRow {
  leads: number;
  withEmail: number;
  withVerified: number;
  drafted: number;
  approved: number;
  contacted: number;
  companies: number;
  withWebsite: number;
  leadsWithPhone: number;
  crawlsFailed: number;
  draftsWritten: number;
  draftsApproved: number;
  draftsInCampaign: number;
}

interface LeadFacets {
  totals: LeadTotalsRow[];
  emails: { _id: number; count: number }[];
  series: { _id: string; leads: number }[];
  recent: {
    _id: unknown;
    fullName: string | null;
    companyName: string | null;
    createdAt: Date;
    emailCount: number;
    stage: LeadStage;
  }[];
}

function leadPipeline(
  range: DateRange | null,
  timeZone: string,
  granularity: Granularity
): PipelineStage[] {
  return [
    ...(range ? [{ $match: { createdAt: { $gte: range.from, $lte: range.to } } } as PipelineStage] : []),
    ...LEAD_DERIVED,
    {
      $facet: {
        totals: [
          {
            $group: {
              _id: null,
              leads: { $sum: 1 },
              withEmail: countIf({ $gt: [{ $size: '$_emails' }, 0] }),
              withVerified: countIf({ $gt: ['$_verifiedCount', 0] }),
              drafted: countIf('$_hasDraft'),
              approved: countIf('$_hasApprovedDraft'),
              contacted: countIf('$_contacted'),
              companies: { $sum: { $size: '$_realCompanies' } },
              withWebsite: {
                $sum: {
                  $size: {
                    $filter: {
                      input: '$_realCompanies',
                      as: 'c',
                      cond: hasText('$$c.websiteUrl'),
                    },
                  },
                },
              },
              leadsWithPhone: countIf({
                $gt: [{ $size: { $ifNull: ['$discoveredPhones', []] } }, 0],
              }),
              crawlsFailed: countIf({ $eq: ['$crawlStatus', 'failed'] }),
              draftsWritten: { $sum: { $size: '$_draftBoxes' } },
              draftsApproved: {
                $sum: {
                  $size: { $filter: { input: '$_draftBoxes', as: 'b', cond: '$$b.approved' } },
                },
              },
              draftsInCampaign: {
                $sum: {
                  $size: { $filter: { input: '$_draftBoxes', as: 'b', cond: '$$b.inCampaign' } },
                },
              },
            },
          },
        ],
        emails: [
          { $project: { pairs: { $map: { input: '$_emails', as: 'e', in: { email: '$$e', rank: EMAIL_RANK } } } } },
          { $unwind: '$pairs' },
          // One row per address across the whole cohort, at its strongest status.
          { $group: { _id: '$pairs.email', rank: { $max: '$pairs.rank' } } },
          { $group: { _id: '$rank', count: { $sum: 1 } } },
        ],
        series: [
          { $group: { _id: mongoBucketKey(granularity, timeZone, '$createdAt'), leads: { $sum: 1 } } },
        ],
        recent: [
          { $sort: { createdAt: -1 } },
          { $limit: RECENT_LEADS },
          {
            $project: {
              fullName: 1,
              companyName: {
                $ifNull: [{ $first: '$_realCompanies.companyName' }, '$companyName'],
              },
              createdAt: 1,
              emailCount: { $size: '$_emails' },
              stage: STAGE_EXPRESSION,
            },
          },
        ],
      },
    },
  ];
}

const EMPTY_TOTALS: LeadTotalsRow = {
  leads: 0,
  withEmail: 0,
  withVerified: 0,
  drafted: 0,
  approved: 0,
  contacted: 0,
  companies: 0,
  withWebsite: 0,
  leadsWithPhone: 0,
  crawlsFailed: 0,
  draftsWritten: 0,
  draftsApproved: 0,
  draftsInCampaign: 0,
};

const FUNNEL_LABELS: Record<FunnelStep['key'], string> = {
  imported: 'Leads imported',
  email_found: 'With an email',
  verified: 'With a verified email',
  drafted: 'With a draft',
  approved: 'With an approved draft',
  contacted: 'Contacted',
};

function buildFunnel(totals: LeadTotalsRow): FunnelStep[] {
  const values: Record<FunnelStep['key'], number> = {
    imported: totals.leads,
    email_found: totals.withEmail,
    verified: totals.withVerified,
    drafted: totals.drafted,
    approved: totals.approved,
    contacted: totals.contacted,
  };
  return (Object.keys(FUNNEL_LABELS) as FunnelStep['key'][]).map((key) => ({
    key,
    label: FUNNEL_LABELS[key],
    value: values[key],
  }));
}

function verificationFrom(rows: { _id: number; count: number }[]) {
  const verification = { valid: 0, risky: 0, invalid: 0, unknown: 0, pending: 0 };
  for (const row of rows) {
    const bucket = RANK_TO_BUCKET[row._id];
    if (bucket) verification[bucket] += row.count;
  }
  return verification;
}

// ── Campaign statistics ──────────────────────────────────────────────────────

interface CampaignFacets {
  statuses: { _id: RecentCampaign['status']; count: number }[];
  totals: {
    delivered: number;
    openedOfDelivered: number;
    opened: number;
    failed: number;
    queued: number;
    previousDelivered: number;
    previousOpened: number;
  }[];
  sentSeries: { _id: string; sent: number }[];
  openedSeries: { _id: string; opened: number }[];
  recent: (Omit<RecentCampaign, 'id' | 'updatedAt'> & { _id: unknown; updatedAt: Date })[];
}

function campaignPipeline(
  range: DateRange | null,
  previous: DateRange | null,
  timeZone: string,
  granularity: Granularity
): PipelineStage[] {
  const wasDelivered = { $in: ['$items.status', CONTACTED_STATUSES] };
  // Without a range, items that predate the sentAt/openedAt fields still count.
  const deliveredIn = (window: DateRange | null) =>
    window ? { $and: [wasDelivered, dateWithin('$items.sentAt', window)] } : wasDelivered;
  const openedIn = (window: DateRange | null) =>
    window ? dateWithin('$items.openedAt', window) : { $eq: ['$items.status', 'opened'] };

  const countItems = (status: string) => ({
    $size: { $filter: { input: '$items', as: 'i', cond: { $eq: ['$$i.status', status] } } },
  });

  return [
    {
      $facet: {
        statuses: [{ $group: { _id: '$status', count: { $sum: 1 } } }],
        totals: [
          { $unwind: { path: '$items', preserveNullAndEmptyArrays: false } },
          {
            $group: {
              _id: null,
              delivered: countIf(deliveredIn(range)),
              openedOfDelivered: countIf({
                $and: [deliveredIn(range), { $eq: ['$items.status', 'opened'] }],
              }),
              opened: countIf(openedIn(range)),
              // A failure with no timestamp can't be placed in a period.
              failed: countIf(
                range
                  ? { $and: [{ $eq: ['$items.status', 'failed'] }, dateWithin('$items.failedAt', range)] }
                  : { $eq: ['$items.status', 'failed'] }
              ),
              queued: countIf({ $in: ['$items.status', ['pending', 'sending']] }),
              previousDelivered: countIf(previous ? deliveredIn(previous) : false),
              previousOpened: countIf(previous ? openedIn(previous) : false),
            },
          },
        ],
        sentSeries: [
          { $unwind: '$items' },
          { $match: { 'items.status': { $in: CONTACTED_STATUSES }, 'items.sentAt': { $ne: null } } },
          { $group: { _id: mongoBucketKey(granularity, timeZone, '$items.sentAt'), sent: { $sum: 1 } } },
        ],
        openedSeries: [
          { $unwind: '$items' },
          { $match: { 'items.openedAt': { $ne: null } } },
          { $group: { _id: mongoBucketKey(granularity, timeZone, '$items.openedAt'), opened: { $sum: 1 } } },
        ],
        recent: [
          { $sort: { updatedAt: -1 } },
          { $limit: RECENT_CAMPAIGNS },
          {
            $project: {
              name: 1,
              status: 1,
              updatedAt: 1,
              total: { $max: [{ $ifNull: ['$totalEmails', 0] }, { $size: { $ifNull: ['$items', []] } }] },
              processed: {
                $size: {
                  $filter: {
                    input: { $ifNull: ['$items', []] },
                    as: 'i',
                    cond: { $not: { $in: ['$$i.status', ['pending', 'sending']] } },
                  },
                },
              },
              delivered: {
                $size: {
                  $filter: {
                    input: { $ifNull: ['$items', []] },
                    as: 'i',
                    cond: { $in: ['$$i.status', CONTACTED_STATUSES] },
                  },
                },
              },
              opened: countItems('opened'),
              failed: countItems('failed'),
            },
          },
        ],
      },
    },
  ];
}

// ── Series assembly ──────────────────────────────────────────────────────────

function mergeSeries(
  range: DateRange,
  timeZone: string,
  granularity: Granularity,
  leads: { _id: string; leads: number }[],
  sent: { _id: string; sent: number }[],
  opened: { _id: string; opened: number }[]
): SeriesPoint[] {
  const points = new Map<string, SeriesPoint>(
    buildBuckets(range.from, range.to, granularity, timeZone).map((bucket) => [
      bucket.key,
      { ...bucket, leads: 0, sent: 0, opened: 0 },
    ])
  );
  for (const row of leads) {
    const point = points.get(row._id);
    if (point) point.leads += row.leads;
  }
  for (const row of sent) {
    const point = points.get(row._id);
    if (point) point.sent += row.sent;
  }
  for (const row of opened) {
    const point = points.get(row._id);
    if (point) point.opened += row.opened;
  }
  return [...points.values()];
}

// ── Entry point ──────────────────────────────────────────────────────────────

export interface DashboardQuery {
  from?: Date | null;
  to?: Date | null;
  /** Window the deltas compare against; defaults to the span just before `from`. */
  compare?: DateRange | null;
  timeZone?: string | null;
  now?: Date;
}

/**
 * Stats for the dashboard. With `from`, lead metrics cover leads imported in
 * the range and sending metrics cover emails sent or opened in the range; the
 * comparison window feeds the deltas. Without `from` it is all time. Queue size
 * and campaign statuses are always the current state.
 */
export async function getDashboardStats(query: DashboardQuery = {}): Promise<DashboardStats> {
  await connectToMongoDB();
  const now = query.now ?? new Date();
  const timeZone = resolveTimeZone(query.timeZone);
  const isAllTime = !query.from;

  let range: DateRange;
  let previous: DateRange | null = null;

  if (isAllTime) {
    const [firstLead, lastLead, firstCampaign] = await Promise.all([
      LeadIngestion.findOne().sort({ createdAt: 1 }).select('createdAt').lean<{ createdAt: Date }>(),
      LeadIngestion.findOne().sort({ createdAt: -1 }).select('createdAt').lean<{ createdAt: Date }>(),
      Campaign.findOne().sort({ createdAt: 1 }).select('createdAt').lean<{ createdAt: Date }>(),
    ]);
    const starts = [firstLead?.createdAt, firstCampaign?.createdAt].filter(Boolean) as Date[];
    const from = starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : now;
    // A lead dated in the future (clock skew) still belongs on the chart.
    const latest = lastLead?.createdAt;
    const to = latest && latest > now ? latest : now;
    range = { from, to };
  } else {
    const to = query.to ?? now;
    range = { from: query.from!, to };
    const span = to.getTime() - range.from.getTime();
    previous =
      query.compare ?? {
        from: new Date(range.from.getTime() - span - 1),
        to: new Date(range.from.getTime() - 1),
      };
  }

  const granularity = pickGranularity(range.from, range.to);

  const [leadFacets, previousFacets, campaignFacets, leadCount, campaignCount] = await Promise.all([
    LeadIngestion.aggregate<LeadFacets>(leadPipeline(isAllTime ? null : range, timeZone, granularity)),
    previous
      ? LeadIngestion.aggregate<LeadFacets>(leadPipeline(previous, timeZone, granularity))
      : Promise.resolve(null),
    Campaign.aggregate<CampaignFacets>(
      campaignPipeline(isAllTime ? null : range, previous, timeZone, granularity)
    ),
    LeadIngestion.estimatedDocumentCount(),
    Campaign.estimatedDocumentCount(),
  ]);

  const leadsFacet = leadFacets[0];
  const totals = leadsFacet?.totals?.[0] ?? EMPTY_TOTALS;
  const verification = verificationFrom(leadsFacet?.emails ?? []);
  const emailsFound = Object.values(verification).reduce((sum, count) => sum + count, 0);
  const verified = verification.valid + verification.risky;

  const previousTotals = previousFacets?.[0]?.totals?.[0] ?? (previous ? EMPTY_TOTALS : null);
  const previousVerification = previousFacets ? verificationFrom(previousFacets[0]?.emails ?? []) : null;
  const previousEmails = previousVerification
    ? Object.values(previousVerification).reduce((sum, count) => sum + count, 0)
    : null;

  const campaigns = campaignFacets[0];
  const sending = campaigns?.totals?.[0] ?? {
    delivered: 0,
    openedOfDelivered: 0,
    opened: 0,
    failed: 0,
    queued: 0,
    previousDelivered: 0,
    previousOpened: 0,
  };
  const statusCounts = { running: 0, paused: 0, completed: 0, draft: 0 };
  for (const row of campaigns?.statuses ?? []) {
    if (row._id in statusCounts) statusCounts[row._id] += row.count;
  }

  const recentLeads: RecentLead[] = (leadsFacet?.recent ?? []).map((lead) => ({
    id: String(lead._id),
    fullName: lead.fullName?.trim() || null,
    companyName: lead.companyName?.trim() || null,
    createdAt: new Date(lead.createdAt).toISOString(),
    emailCount: lead.emailCount,
    stage: lead.stage,
  }));

  const recentCampaigns: RecentCampaign[] = (campaigns?.recent ?? []).map((campaign) => ({
    id: String(campaign._id),
    name: campaign.name,
    status: campaign.status,
    total: campaign.total,
    processed: campaign.processed,
    delivered: campaign.delivered,
    opened: campaign.opened,
    failed: campaign.failed,
    updatedAt: new Date(campaign.updatedAt).toISOString(),
  }));

  return {
    range: {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      granularity,
      isAllTime,
      timeZone,
      comparison: previous
        ? { from: previous.from.toISOString(), to: previous.to.toISOString() }
        : null,
    },
    generatedAt: now.toISOString(),
    trackingEnabled: process.env.ENABLE_OPEN_TRACKING === 'true',
    hasAnyData: leadCount > 0 || campaignCount > 0,
    kpis: {
      leads: { value: totals.leads, previous: previousTotals?.leads ?? null },
      emailsFound: { value: emailsFound, previous: previousEmails },
      verified: {
        value: verified,
        previous: previousVerification
          ? previousVerification.valid + previousVerification.risky
          : null,
      },
      sent: { value: sending.delivered, previous: previous ? sending.previousDelivered : null },
      opened: { value: sending.opened, previous: previous ? sending.previousOpened : null },
    },
    funnel: buildFunnel(totals),
    verification,
    drafts: {
      written: totals.draftsWritten,
      // Every draft that is not approved is still awaiting review, queued or not.
      awaitingReview: Math.max(0, totals.draftsWritten - totals.draftsApproved),
      approved: totals.draftsApproved,
      inCampaign: totals.draftsInCampaign,
    },
    research: {
      companies: totals.companies,
      withWebsite: totals.withWebsite,
      leadsWithPhone: totals.leadsWithPhone,
      crawlsFailed: totals.crawlsFailed,
    },
    delivery: {
      delivered: sending.delivered,
      opened: sending.opened,
      failed: sending.failed,
      queued: sending.queued,
      deliveryRate:
        sending.delivered + sending.failed > 0
          ? sending.delivered / (sending.delivered + sending.failed)
          : null,
      openRate: sending.delivered > 0 ? sending.openedOfDelivered / sending.delivered : null,
    },
    campaigns: { ...statusCounts, recent: recentCampaigns },
    recentLeads,
    series: mergeSeries(
      range,
      timeZone,
      granularity,
      leadsFacet?.series ?? [],
      campaigns?.sentSeries ?? [],
      campaigns?.openedSeries ?? []
    ),
  };
}
