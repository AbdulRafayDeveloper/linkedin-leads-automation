/**
 * Filter state for /my-leads: what lives in the URL, and how a preset becomes a
 * real instant. The range is resolved in the viewer's time zone, so "Today"
 * means their today and not the server's UTC day.
 */

export const RANGE_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: '7days', label: 'Last 7 days' },
  { value: '30days', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
] as const;

export type RangeKey = (typeof RANGE_OPTIONS)[number]['value'];

export const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'unapproved_verified_smtp', label: 'Verified & not approved' },
  { value: 'missing_or_unverified', label: 'Missing or unverified email' },
  { value: 'approved', label: 'Approved drafts' },
  { value: 'not_approved', label: 'Awaiting approval' },
] as const;

export type StatusKey = (typeof STATUS_OPTIONS)[number]['value'];

export interface LeadFilters {
  search: string;
  status: StatusKey;
  clientId: string;
  range: RangeKey;
  /** yyyy-mm-dd, only used when range is 'custom'. */
  from: string;
  to: string;
}

export const EMPTY_FILTERS: LeadFilters = {
  search: '',
  status: 'all',
  clientId: 'all',
  range: 'all',
  from: '',
  to: '',
};

const isRange = (value: string | null): value is RangeKey =>
  RANGE_OPTIONS.some((option) => option.value === value);
const isStatus = (value: string | null): value is StatusKey =>
  STATUS_OPTIONS.some((option) => option.value === value);

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Reads the filters out of the address bar, ignoring anything unknown. */
export function parseFilters(params: URLSearchParams): LeadFilters {
  const range = params.get('range');
  const status = params.get('status');
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  return {
    search: params.get('q')?.slice(0, 200) ?? '',
    status: isStatus(status) ? status : 'all',
    clientId: params.get('client') || 'all',
    range: isRange(range) ? range : 'all',
    from: DATE_ONLY.test(from) ? from : '',
    to: DATE_ONLY.test(to) ? to : '',
  };
}

/** The address-bar query for these filters, so a view can be shared or bookmarked. */
export function filtersToSearchParams(filters: LeadFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.search.trim()) params.set('q', filters.search.trim());
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.clientId !== 'all') params.set('client', filters.clientId);
  if (filters.range !== 'all') params.set('range', filters.range);
  if (filters.range === 'custom') {
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
  }
  return params;
}

export function hasActiveFilters(filters: LeadFilters): boolean {
  return filtersToSearchParams(filters).toString().length > 0;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

export interface ResolvedRange {
  from?: string;
  to?: string;
  /** Set when the custom range can't be used; the list is not refetched. */
  error?: string;
}

/** Turns a preset or a custom range into ISO instants in the viewer's time zone. */
export function resolveRange(filters: LeadFilters, now: Date = new Date()): ResolvedRange {
  const days = (count: number): ResolvedRange => {
    const start = startOfDay(new Date(now));
    start.setDate(start.getDate() - (count - 1));
    return { from: start.toISOString(), to: endOfDay(now).toISOString() };
  };

  switch (filters.range) {
    case 'today':
      return days(1);
    case '7days':
      return days(7);
    case '30days':
      return days(30);
    case 'custom': {
      if (!filters.from && !filters.to) return {};
      const from = filters.from ? new Date(`${filters.from}T00:00:00`) : null;
      const to = filters.to ? new Date(`${filters.to}T00:00:00`) : null;
      if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
        return { error: 'Enter a valid date.' };
      }
      if (from && to && from.getTime() > to.getTime()) {
        return { error: 'The start date must be on or before the end date.' };
      }
      return {
        from: from ? startOfDay(from).toISOString() : undefined,
        to: to ? endOfDay(to).toISOString() : undefined,
      };
    }
    default:
      return {};
  }
}

export interface ApiParamsResult {
  params?: URLSearchParams;
  error?: string;
}

/** The request for one page of leads, or the reason it can't be built. */
export function buildListRequest(
  filters: LeadFilters,
  options: { page: number; limit: number; now?: Date }
): ApiParamsResult {
  const range = resolveRange(filters, options.now ?? new Date());
  if (range.error) return { error: range.error };

  const params = new URLSearchParams({
    view: 'cards',
    page: String(options.page),
    limit: String(options.limit),
  });

  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (filters.clientId !== 'all') params.set('clientId', filters.clientId);
  if (filters.status === 'approved') params.set('approved', 'true');
  else if (filters.status === 'not_approved') params.set('approved', 'false');
  else if (filters.status !== 'all') params.set('emailStatus', filters.status);
  if (range.from) params.set('from', range.from);
  if (range.to) params.set('to', range.to);

  return { params };
}

/** yyyy-mm-dd for today in the viewer's time zone, used as the date inputs' max. */
export function todayAsInputValue(now: Date = new Date()): string {
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}
