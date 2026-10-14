import mongoose, { type AnyBulkWriteOperation } from 'mongoose';
import {
  Campaign,
  type CampaignDocument,
  type CampaignItem,
  type CampaignItemStatus,
  type CampaignStatus,
} from '@/lib/db/models/Campaign';
import { LeadIngestion, type LeadIngestionDocument } from '@/lib/db/models/LeadIngestion';
import { RUNNER_GRACE_MS, SENDING_TIMEOUT_MS } from './campaignRunner';

export const SENDING_TIMEOUT_MESSAGE =
  'Timed out while sending. The message may or may not have been delivered; check the inbox before retrying.';

export interface ItemCounts {
  total: number;
  pending: number;
  sending: number;
  delivered: number;
  opened: number;
  failed: number;
}

/** Fields the browser receives for a campaign. Counts are always derived from the items. */
export interface SerializedCampaign {
  _id: string;
  name: string;
  status: CampaignStatus;
  totalEmails: number;
  sentCount: number;
  deliveredCount: number;
  openedCount: number;
  failedCount: number;
  pendingCount: number;
  sendingCount: number;
  minDelaySeconds: number;
  maxDelaySeconds: number;
  isRunnerActive: boolean;
  activeRunnerId: string | null;
  lastDispatchAt: string | null;
  runnerHeartbeatAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  items?: SerializedCampaignItem[];
}

export interface SerializedCampaignItem {
  _id: string;
  leadId: string;
  companyIndex: number;
  candidateName: string;
  clientName: string;
  companyName: string;
  recipientEmail: string;
  subject: string;
  bodyHtml: string;
  status: CampaignItemStatus;
  errorMessage: string | null;
  attempts: number;
  sendingStartedAt: string | null;
  sentAt: string | null;
  openedAt: string | null;
  failedAt: string | null;
}

type ItemLike = Pick<CampaignItem, 'status'>;

interface CampaignLike {
  _id: unknown;
  name: string;
  status: CampaignStatus;
  totalEmails?: number;
  minDelaySeconds?: number;
  maxDelaySeconds?: number;
  items?: CampaignItem[];
  lastDispatchAt?: Date | null;
  activeRunnerId?: string | null;
  runnerHeartbeatAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export function countItems(items: ItemLike[] | undefined | null): ItemCounts {
  const counts: ItemCounts = { total: 0, pending: 0, sending: 0, delivered: 0, opened: 0, failed: 0 };
  for (const item of items ?? []) {
    counts.total += 1;
    if (item.status in counts) counts[item.status as keyof ItemCounts] += 1;
  }
  return counts;
}

/** Milliseconds of silence after which the runner for this campaign is treated as gone. */
export function runnerStaleAfterMs(campaign: Pick<CampaignLike, 'maxDelaySeconds'>): number {
  return (campaign.maxDelaySeconds ?? 600) * 1000 + RUNNER_GRACE_MS;
}

export function isRunnerActive(
  campaign: Pick<CampaignLike, 'status' | 'activeRunnerId' | 'runnerHeartbeatAt' | 'maxDelaySeconds' | 'updatedAt'>,
  now: Date = new Date()
): boolean {
  if (campaign.status !== 'running') return false;
  const heartbeat = campaign.runnerHeartbeatAt ?? campaign.updatedAt ?? null;
  if (!heartbeat) return false;
  return now.getTime() - new Date(heartbeat).getTime() < runnerStaleAfterMs(campaign);
}

/** Writes the derived counters back onto the document. */
export function recomputeCounters(campaign: CampaignDocument): ItemCounts {
  const counts = countItems(campaign.items);
  campaign.totalEmails = counts.total;
  campaign.deliveredCount = counts.delivered + counts.opened;
  campaign.sentCount = campaign.deliveredCount;
  campaign.openedCount = counts.opened;
  campaign.failedCount = counts.failed;
  return counts;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function serializeItem(item: CampaignItem): SerializedCampaignItem {
  return {
    _id: item._id ? item._id.toString() : '',
    leadId: item.leadId ? item.leadId.toString() : '',
    companyIndex: item.companyIndex ?? 0,
    candidateName: item.candidateName,
    clientName: item.clientName,
    companyName: item.companyName,
    recipientEmail: item.recipientEmail,
    subject: item.subject,
    bodyHtml: item.bodyHtml,
    status: item.status,
    errorMessage: item.errorMessage ?? null,
    attempts: item.attempts ?? 0,
    sendingStartedAt: toIso(item.sendingStartedAt),
    sentAt: toIso(item.sentAt),
    openedAt: toIso(item.openedAt),
    failedAt: toIso(item.failedAt),
  };
}

/**
 * Plain JSON for the browser. Works for hydrated documents and lean objects.
 * Counts come from the items so they can never drift from the real state.
 */
export function serializeCampaign(
  campaign: CampaignLike | CampaignDocument,
  options: { includeItems?: boolean; now?: Date } = {}
): SerializedCampaign {
  const raw = (
    typeof (campaign as CampaignDocument).toObject === 'function'
      ? (campaign as CampaignDocument).toObject()
      : campaign
  ) as CampaignLike;
  const items = raw.items ?? [];
  const counts = countItems(items);
  const now = options.now ?? new Date();

  return {
    _id: String(raw._id),
    name: raw.name,
    status: raw.status,
    totalEmails: counts.total,
    sentCount: counts.delivered + counts.opened,
    deliveredCount: counts.delivered + counts.opened,
    openedCount: counts.opened,
    failedCount: counts.failed,
    pendingCount: counts.pending,
    sendingCount: counts.sending,
    minDelaySeconds: raw.minDelaySeconds ?? 60,
    maxDelaySeconds: raw.maxDelaySeconds ?? 600,
    isRunnerActive: isRunnerActive(raw, now),
    activeRunnerId: raw.activeRunnerId ?? null,
    lastDispatchAt: toIso(raw.lastDispatchAt),
    runnerHeartbeatAt: toIso(raw.runnerHeartbeatAt),
    createdAt: toIso(raw.createdAt),
    updatedAt: toIso(raw.updatedAt),
    ...(options.includeItems === false ? {} : { items: items.map(serializeItem) }),
  };
}

/**
 * Repairs state left behind by a crashed send or a closed tab, across all
 * campaigns, with two cheap bulk updates:
 *  - items stuck in `sending` for longer than SENDING_TIMEOUT_MS become `failed`;
 *  - `running` campaigns whose runner stopped calling the API become `paused`
 *    (or `completed` when nothing is left to send).
 */
export async function repairStaleCampaigns(now: Date = new Date()): Promise<void> {
  const sendingCutoff = new Date(now.getTime() - SENDING_TIMEOUT_MS);

  // Two passes because an array filter must be a plain field match: items that
  // started long ago, and legacy items that never recorded a start time.
  for (const startedAt of [{ $lt: sendingCutoff }, null]) {
    await Campaign.updateMany(
      { items: { $elemMatch: { status: 'sending', sendingStartedAt: startedAt } } },
      {
        $set: {
          'items.$[it].status': 'failed',
          'items.$[it].errorMessage': SENDING_TIMEOUT_MESSAGE,
          'items.$[it].failedAt': now,
          'items.$[it].sendingStartedAt': null,
        },
      },
      { arrayFilters: [{ 'it.status': 'sending', 'it.sendingStartedAt': startedAt }] }
    );
  }

  // A runner is stale when its last heartbeat (or, for old documents, the last
  // update) is older than the campaign's own maximum delay plus a grace period.
  const staleRunner = {
    status: 'running' as const,
    $expr: {
      $lt: [
        { $ifNull: ['$runnerHeartbeatAt', '$updatedAt'] },
        {
          $subtract: [now, { $add: [{ $multiply: [{ $ifNull: ['$maxDelaySeconds', 600] }, 1000] }, RUNNER_GRACE_MS] }],
        },
      ],
    },
  };

  await Campaign.updateMany(
    { ...staleRunner, 'items.status': { $nin: ['pending', 'sending'] } },
    { $set: { status: 'completed', activeRunnerId: null } }
  );
  await Campaign.updateMany(
    { ...staleRunner, 'items.status': { $in: ['pending', 'sending'] } },
    { $set: { status: 'paused', activeRunnerId: null } }
  );
}

/** Statuses an item may be in to be picked up for a given dispatch mode. */
export function eligibleStatuses(mode: 'pending' | 'rerunFailed' | 'explicit'): CampaignItemStatus[] {
  return mode === 'pending' ? ['pending'] : ['pending', 'failed'];
}

/**
 * Builds the LeadIngestion update that mirrors a campaign item's state onto the
 * lead's personal box (companyIndex -1) or a company box.
 */
export function leadBoxUpdate(
  item: Pick<CampaignItem, 'leadId' | 'companyIndex'>,
  fields: { inCampaign: boolean; campaignSendStatus: string | null; emailStatus?: LeadIngestionDocument['emailStatus'] }
): AnyBulkWriteOperation<LeadIngestionDocument> | null {
  if (!item.leadId || !mongoose.Types.ObjectId.isValid(item.leadId.toString())) return null;
  const idx = item.companyIndex ?? 0;
  const set: Record<string, unknown> = {};

  if (idx === -1) {
    set.inCampaign = fields.inCampaign;
    set.campaignSendStatus = fields.campaignSendStatus;
    if (fields.emailStatus) set.emailStatus = fields.emailStatus;
  } else if (idx >= 0) {
    set[`currentCompanies.${idx}.inCampaign`] = fields.inCampaign;
    set[`currentCompanies.${idx}.campaignSendStatus`] = fields.campaignSendStatus;
  } else {
    return null;
  }

  return {
    updateOne: {
      filter: { _id: new mongoose.Types.ObjectId(item.leadId.toString()) },
      update: { $set: set },
    },
  };
}

/** Marks every item's lead box as queued in a campaign. */
export async function markLeadBoxesQueued(items: CampaignItem[]): Promise<void> {
  const ops = items
    .map((item) =>
      leadBoxUpdate(item, { inCampaign: true, campaignSendStatus: 'pending', emailStatus: 'in_progress' })
    )
    .filter((op): op is AnyBulkWriteOperation<LeadIngestionDocument> => op !== null);
  if (ops.length > 0) await LeadIngestion.bulkWrite(ops, { ordered: false });
}

/**
 * Frees the drafts of items that were never delivered so they show up again
 * on the Ready to Send page. Delivered and opened items keep their state.
 * Returns the number of drafts released.
 */
export async function releaseUndeliveredLeadBoxes(items: CampaignItem[]): Promise<number> {
  const ops = items
    .filter((item) => item.status === 'pending' || item.status === 'sending' || item.status === 'failed')
    .map((item) => leadBoxUpdate(item, { inCampaign: false, campaignSendStatus: null, emailStatus: 'pending' }))
    .filter((op): op is AnyBulkWriteOperation<LeadIngestionDocument> => op !== null);
  if (ops.length > 0) await LeadIngestion.bulkWrite(ops, { ordered: false });
  return ops.length;
}

/** Mirrors one item's outcome onto its lead box. Errors are swallowed: the send already happened. */
export async function mirrorItemOutcome(item: CampaignItem): Promise<void> {
  const emailStatus: LeadIngestionDocument['emailStatus'] | undefined =
    item.companyIndex === -1 ? (item.status === 'delivered' || item.status === 'opened' ? 'delivered' : 'failed') : undefined;
  const op = leadBoxUpdate(item, { inCampaign: true, campaignSendStatus: item.status, emailStatus });
  if (!op) return;
  await LeadIngestion.bulkWrite([op]).catch(() => undefined);
}

/**
 * Finds the lead boxes among the given items that are already queued in another
 * campaign. Returns the recipient emails so the API can name them.
 */
export async function findAlreadyQueued(
  items: Array<Pick<CampaignItem, 'leadId' | 'companyIndex' | 'recipientEmail'>>
): Promise<string[]> {
  const ids = Array.from(new Set(items.map((i) => i.leadId.toString())));
  const leads = await LeadIngestion.find({ _id: { $in: ids } })
    .select('inCampaign currentCompanies.inCampaign')
    .lean();
  const byId = new Map(leads.map((lead) => [String(lead._id), lead]));

  const clashes: string[] = [];
  for (const item of items) {
    const lead = byId.get(item.leadId.toString());
    if (!lead) continue;
    const queued =
      item.companyIndex === -1
        ? Boolean(lead.inCampaign)
        : Boolean(lead.currentCompanies?.[item.companyIndex]?.inCampaign);
    if (queued) clashes.push(item.recipientEmail);
  }
  return clashes;
}

export function openTrackingEnabled(): boolean {
  return process.env.ENABLE_OPEN_TRACKING === 'true';
}
