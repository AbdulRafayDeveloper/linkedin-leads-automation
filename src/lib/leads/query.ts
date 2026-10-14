import mongoose, { type PipelineStage } from 'mongoose';
import { readyToSendQuery } from '@/services/lead-ingestion/readyToSend';

/**
 * Query parsing and Mongo pipeline building for GET /api/leads.
 *
 * Everything the list needs is decided here, on the server: the page, the
 * filters and the two "box level" statuses that used to be re-filtered in the
 * browser (which made the counts disagree with the rows).
 */

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 200;
export const MAX_SEARCH_TOKENS = 6;

/** Statuses that need per-box maths, so they run as aggregation stages. */
export const COMPUTED_STATUSES = ['unapproved_verified_smtp', 'missing_or_unverified'] as const;
export type ComputedStatus = (typeof COMPUTED_STATUSES)[number];

/** A verified email: SMTP said valid, or risky (which the app treats as sendable). */
export const SENDABLE_STATUSES = ['valid', 'risky'] as const;

export type LeadListView = 'full' | 'cards';

export interface LeadListQuery {
  page: number;
  limit: number;
  /** Search words; a lead must match every one of them. */
  search: string[];
  clientId?: string;
  approved?: boolean;
  emailStatus?: string;
  computedStatus?: ComputedStatus;
  from?: Date;
  to?: Date;
  /** Only leads with at least one approved draft not yet queued in a campaign (Ready to Send page). */
  readyToSend?: boolean;
  view: LeadListView;
}

/** A bad request, reported as 400 instead of being silently ignored. */
export class LeadQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LeadQueryError';
  }
}

function parseCount(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function parseDate(raw: string | null, label: string, endOfDay: boolean): Date | undefined {
  if (!raw || !raw.trim()) return undefined;
  const value = new Date(raw.trim());
  if (Number.isNaN(value.getTime())) {
    throw new LeadQueryError(`${label} is not a valid date`);
  }
  // A plain "2026-10-14" is midnight UTC; stretch it to the whole day so a
  // one-day range isn't empty. ISO instants from the UI are used as given.
  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    value.setUTCHours(23, 59, 59, 999);
  }
  return value;
}

export function parseLeadListQuery(searchParams: URLSearchParams): LeadListQuery {
  const page = parseCount(searchParams.get('page'), 1, 1, Number.MAX_SAFE_INTEGER);
  const limit = parseCount(searchParams.get('limit'), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);

  const search = (searchParams.get('search') ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, MAX_SEARCH_TOKENS)
    .map((token) => token.slice(0, 64));

  const clientIdRaw = searchParams.get('clientId');
  const clientId = clientIdRaw && clientIdRaw !== 'all' ? clientIdRaw : undefined;
  if (clientId && !mongoose.Types.ObjectId.isValid(clientId)) {
    throw new LeadQueryError('clientId is not a valid id');
  }

  const approvedRaw = searchParams.get('approved');
  const approved = approvedRaw === 'true' ? true : approvedRaw === 'false' ? false : undefined;

  const statusRaw = searchParams.get('emailStatus');
  const status = statusRaw && statusRaw !== 'all' ? statusRaw : undefined;
  const computedStatus = COMPUTED_STATUSES.find((s) => s === status);

  // `from`/`to` are ISO instants resolved in the viewer's time zone, so "today"
  // means their today. `startDate`/`endDate` stay supported for older callers.
  const from = parseDate(searchParams.get('from') ?? searchParams.get('startDate'), 'from', false);
  const to = parseDate(searchParams.get('to') ?? searchParams.get('endDate'), 'to', true);
  if (from && to && from.getTime() > to.getTime()) {
    throw new LeadQueryError('from must be on or before to');
  }

  return {
    page,
    limit,
    search,
    clientId,
    approved,
    emailStatus: computedStatus ? undefined : status,
    computedStatus,
    from,
    to,
    readyToSend: searchParams.get('readyToSend') === 'true',
    view: searchParams.get('view') === 'cards' ? 'cards' : 'full',
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Latin letters and the accented forms that should still match them, so
// searching "Jose" finds "Jose\u0301" and the other way round.
const ACCENT_CLASSES: Record<string, string> = {
  a: 'a\u00e0\u00e1\u00e2\u00e3\u00e4\u00e5\u0101\u0103\u0105',
  c: 'c\u00e7\u0107\u010d\u0109',
  e: 'e\u00e8\u00e9\u00ea\u00eb\u0113\u0115\u0117\u0119\u011b',
  g: 'g\u011d\u011f\u0121\u0123',
  i: 'i\u00ec\u00ed\u00ee\u00ef\u0129\u012b\u012d\u012f\u0131',
  l: 'l\u0142\u013a\u013c\u013e',
  n: 'n\u00f1\u0144\u0146\u0148',
  o: 'o\u00f2\u00f3\u00f4\u00f5\u00f6\u00f8\u014d\u014f\u0151',
  r: 'r\u0155\u0157\u0159',
  s: 's\u00df\u015b\u015d\u015f\u0161',
  t: 't\u0163\u0165\u0167',
  u: 'u\u00f9\u00fa\u00fb\u00fc\u0169\u016b\u016d\u016f\u0171\u0173',
  y: 'y\u00fd\u00ff\u0177',
  z: 'z\u017a\u017c\u017e',
};

/** Drops the accents a user typed, so both spellings reach the same pattern. */
function foldAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** A pattern that ignores case and accents on both sides of the comparison. */
export function searchPattern(token: string): RegExp {
  const expanded = foldAccents(token)
    .split('')
    .map((char) => {
      const variants = ACCENT_CLASSES[char.toLowerCase()];
      return variants ? `[${variants}]` : escapeRegex(char);
    })
    .join('');
  return new RegExp(expanded, 'i');
}

const SEARCH_FIELDS = [
  'fullName',
  'email',
  'discoveredEmails',
  'companyName',
  'jobTitle',
  'portfolioUrl',
  'websiteUrl',
  'additionalUrls',
  'currentCompanies.companyName',
  'currentCompanies.companyEmails',
] as const;

/** The plain `$match` for a query: everything except the computed statuses. */
export function buildLeadFilter(query: LeadListQuery): Record<string, unknown> {
  const and: Record<string, unknown>[] = [];

  if (query.clientId) {
    and.push({ clientId: new mongoose.Types.ObjectId(query.clientId) });
  }

  if (query.readyToSend) {
    and.push(readyToSendQuery());
  }

  if (query.approved === true) {
    and.push({ $or: [{ approved: true }, { 'currentCompanies.approved': true }] });
  } else if (query.approved === false) {
    // `approved: false` on a company, not `$ne: true`: a missing path also
    // matches $ne, which used to list approved leads that had no company box.
    and.push({ $or: [{ approved: { $ne: true } }, { 'currentCompanies.approved': false }] });
  }

  const status = query.emailStatus;
  if (status) {
    if (status === 'valid' || status === 'verified_smtp') {
      and.push({
        $or: [
          { emailValidationStatus: { $in: SENDABLE_STATUSES } },
          { 'verifiedEmails.status': { $in: SENDABLE_STATUSES } },
        ],
      });
    } else if (status === 'invalid') {
      and.push({
        $or: [{ emailValidationStatus: 'invalid' }, { 'verifiedEmails.status': 'invalid' }],
      });
    } else if (status === 'unverified') {
      and.push({
        $nor: [
          { emailValidationStatus: { $in: SENDABLE_STATUSES } },
          { 'verifiedEmails.status': { $in: SENDABLE_STATUSES } },
        ],
      });
    } else if (status === 'no_contact_email') {
      and.push({
        $or: [
          { email: null },
          { email: '' },
          { email: { $exists: false } },
          { emailStatus: 'no_contact_email' },
        ],
      });
    } else if (status === 'pending') {
      and.push({
        $or: [
          { emailStatus: 'pending' },
          { emailStatus: { $exists: false } },
          { emailStatus: null },
        ],
      });
    } else {
      and.push({ emailStatus: status });
    }
  }

  if (query.from || query.to) {
    const createdAt: Record<string, Date> = {};
    if (query.from) createdAt.$gte = query.from;
    if (query.to) createdAt.$lte = query.to;
    and.push({ createdAt });
  }

  // Each word must match somewhere, so "john smith" finds John Smith.
  for (const token of query.search) {
    const regex = searchPattern(token);
    and.push({ $or: SEARCH_FIELDS.map((field) => ({ [field]: regex })) });
  }

  return and.length > 0 ? { $and: and } : {};
}

const lowerEmails = (input: unknown) => ({
  $map: { input: { $ifNull: [input, []] }, as: 'e', in: { $toLower: '$$e' } },
});

/** Per-lead booleans the two computed statuses are filtered on. */
const COMPUTED_FIELDS = [
  {
    $addFields: {
      _verifiedEmails: {
        $setUnion: [
          {
            $map: {
              input: {
                $filter: {
                  input: { $ifNull: ['$verifiedEmails', []] },
                  as: 'v',
                  cond: { $in: ['$$v.status', SENDABLE_STATUSES] },
                },
              },
              as: 'v',
              in: { $toLower: { $ifNull: ['$$v.email', ''] } },
            },
          },
          {
            $cond: [
              {
                $and: [
                  { $in: ['$emailValidationStatus', SENDABLE_STATUSES] },
                  { $gt: [{ $strLenCP: { $ifNull: ['$email', ''] } }, 0] },
                ],
              },
              [{ $toLower: '$email' }],
              [],
            ],
          },
        ],
      },
      _personalEmails: {
        $setUnion: [
          lowerEmails('$discoveredEmails'),
          {
            $cond: [
              { $gt: [{ $strLenCP: { $ifNull: ['$email', ''] } }, 0] },
              [{ $toLower: '$email' }],
              [],
            ],
          },
        ],
      },
    },
  },
  {
    $addFields: {
      _personalVerified: {
        $gt: [{ $size: { $setIntersection: ['$_personalEmails', '$_verifiedEmails'] } }, 0],
      },
      _companyStates: {
        $map: {
          input: { $ifNull: ['$currentCompanies', []] },
          as: 'c',
          in: {
            approved: { $eq: ['$$c.approved', true] },
            hasEmail: { $gt: [{ $size: { $ifNull: ['$$c.companyEmails', []] } }, 0] },
            verified: {
              $gt: [
                {
                  $size: {
                    $setIntersection: [lowerEmails('$$c.companyEmails'), '$_verifiedEmails'],
                  },
                },
                0,
              ],
            },
          },
        },
      },
    },
  },
  {
    $addFields: {
      _allCompaniesVerified: {
        $eq: [
          { $size: { $filter: { input: '$_companyStates', as: 's', cond: { $not: '$$s.verified' } } } },
          0,
        ],
      },
      _anyCompanyApproved: {
        $gt: [
          { $size: { $filter: { input: '$_companyStates', as: 's', cond: '$$s.approved' } } },
          0,
        ],
      },
      _anyBoxIncomplete: {
        $or: [
          { $eq: [{ $size: '$_personalEmails' }, 0] },
          { $not: '$_personalVerified' },
          {
            $gt: [
              {
                $size: {
                  $filter: {
                    input: '$_companyStates',
                    as: 's',
                    cond: { $or: [{ $not: '$$s.hasEmail' }, { $not: '$$s.verified' }] },
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
] as const;

const COMPUTED_FIELD_NAMES = [
  '_verifiedEmails',
  '_personalEmails',
  '_personalVerified',
  '_companyStates',
  '_allCompaniesVerified',
  '_anyCompanyApproved',
  '_anyBoxIncomplete',
];

function computedMatch(status: ComputedStatus): Record<string, unknown> {
  if (status === 'unapproved_verified_smtp') {
    // Nothing approved yet, and every box (personal + each company) is verified.
    return {
      approved: { $ne: true },
      _anyCompanyApproved: false,
      _personalVerified: true,
      _allCompaniesVerified: true,
    };
  }
  // Any box missing an email, or holding one SMTP never confirmed.
  return { _anyBoxIncomplete: true };
}

/** Only the fields the lead cards render, plus the LinkedIn URL found in rawText. */
const CARD_PROJECTION = {
  clientId: 1,
  fullName: 1,
  companyName: 1,
  jobTitle: 1,
  email: 1,
  discoveredEmails: 1,
  verifiedEmails: 1,
  emailValidationStatus: 1,
  emailStatus: 1,
  approved: 1,
  portfolioUrl: 1,
  websiteUrl: 1,
  additionalUrls: 1,
  createdAt: 1,
  currentCompanies: {
    $map: {
      input: { $ifNull: ['$currentCompanies', []] },
      as: 'c',
      in: {
        companyName: '$$c.companyName',
        jobTitle: '$$c.jobTitle',
        websiteUrl: '$$c.websiteUrl',
        companyEmails: { $ifNull: ['$$c.companyEmails', []] },
        approved: { $eq: ['$$c.approved', true] },
      },
    },
  },
  rawLinkedinUrl: {
    $let: {
      vars: {
        found: {
          $regexFind: {
            input: { $ifNull: ['$rawText', ''] },
            regex: 'https?://[a-z0-9.-]*linkedin\\.com/[^\\s"\'<>]+',
            options: 'i',
          },
        },
      },
      in: '$$found.match',
    },
  },
} as const;

/**
 * One pipeline returning both the page of rows and the matching total, so the
 * count on screen always belongs to the rows on screen.
 */
export function buildLeadPipeline(query: LeadListQuery): PipelineStage[] {
  const needsComputed = Boolean(query.computedStatus);
  const skip = (query.page - 1) * query.limit;

  const rows: Record<string, unknown>[] = [
    { $sort: { createdAt: -1, _id: -1 } },
    { $skip: skip },
    { $limit: query.limit },
  ];
  if (query.view === 'cards') {
    rows.push({ $project: CARD_PROJECTION });
  } else if (needsComputed) {
    // Only needed when the stages above actually added these fields.
    rows.push({ $unset: COMPUTED_FIELD_NAMES });
  }

  const stages: Record<string, unknown>[] = [
    { $match: buildLeadFilter(query) },
    ...(needsComputed ? (COMPUTED_FIELDS as readonly Record<string, unknown>[]) : []),
    ...(query.computedStatus ? [{ $match: computedMatch(query.computedStatus) }] : []),
    { $facet: { rows, total: [{ $count: 'count' }] } },
  ];

  // The stages are built dynamically; Mongoose's union type can't narrow them.
  return stages as unknown as PipelineStage[];
}
