import {
  EMPTY_FILTERS,
  buildListRequest,
  filtersToSearchParams,
  hasActiveFilters,
  parseFilters,
  resolveRange,
  todayAsInputValue,
  type LeadFilters,
} from '../listFilters';

const filters = (overrides: Partial<LeadFilters> = {}): LeadFilters => ({
  ...EMPTY_FILTERS,
  ...overrides,
});

describe('parseFilters', () => {
  it('reads the filters out of the URL', () => {
    const parsed = parseFilters(
      new URLSearchParams('q=jane&status=approved&client=abc&range=custom&from=2026-01-01&to=2026-02-01')
    );
    expect(parsed).toEqual({
      search: 'jane',
      status: 'approved',
      clientId: 'abc',
      range: 'custom',
      from: '2026-01-01',
      to: '2026-02-01',
    });
  });

  it('ignores values it does not recognise', () => {
    const parsed = parseFilters(new URLSearchParams('status=hacked&range=forever&from=yesterday'));
    expect(parsed).toEqual(EMPTY_FILTERS);
  });
});

describe('filtersToSearchParams', () => {
  it('writes only what is set, and keeps custom dates out of other ranges', () => {
    expect(filtersToSearchParams(EMPTY_FILTERS).toString()).toBe('');
    expect(filtersToSearchParams(filters({ search: ' jane ', status: 'approved' })).toString()).toBe(
      'q=jane&status=approved'
    );
    expect(
      filtersToSearchParams(filters({ range: '7days', from: '2026-01-01' })).toString()
    ).toBe('range=7days');
  });

  it('round-trips through parseFilters', () => {
    const original = filters({ search: 'ana', range: 'custom', from: '2026-01-01', to: '2026-01-05' });
    expect(parseFilters(filtersToSearchParams(original))).toEqual(original);
  });

  it('knows when any filter is on', () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters(filters({ status: 'missing_or_unverified' }))).toBe(true);
  });
});

describe('resolveRange', () => {
  // 14 Oct 2026, 02:30 local: before 05:00, so a UTC day boundary would miss it.
  const now = new Date(2026, 9, 14, 2, 30, 0);

  it('uses the viewer’s local midnight for Today', () => {
    const { from, to } = resolveRange(filters({ range: 'today' }), now);
    const start = new Date(from!);
    const end = new Date(to!);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(9);
    expect(start.getDate()).toBe(14);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
    // A lead created at 02:30 local today is inside the range.
    expect(now.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(now.getTime()).toBeLessThanOrEqual(end.getTime());
    expect(end.getHours()).toBe(23);
  });

  it('counts 7 and 30 days back from local midnight', () => {
    const week = new Date(resolveRange(filters({ range: '7days' }), now).from!);
    expect(week.getDate()).toBe(8);
    const month = new Date(resolveRange(filters({ range: '30days' }), now).from!);
    expect(month.getMonth()).toBe(8);
    expect(month.getDate()).toBe(15);
  });

  it('returns nothing for All time, and for an empty custom range', () => {
    expect(resolveRange(filters({ range: 'all' }), now)).toEqual({});
    expect(resolveRange(filters({ range: 'custom' }), now)).toEqual({});
  });

  it('covers whole days for a custom range', () => {
    const { from, to } = resolveRange(
      filters({ range: 'custom', from: '2026-03-02', to: '2026-03-02' }),
      now
    );
    const start = new Date(from!);
    const end = new Date(to!);
    expect(start.getHours()).toBe(0);
    expect(end.getHours()).toBe(23);
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000 - 1);
  });

  it('reports a backwards range instead of returning nothing', () => {
    expect(
      resolveRange(filters({ range: 'custom', from: '2027-01-01', to: '2020-01-01' }), now).error
    ).toMatch(/on or before/);
  });

  it('accepts a one-sided custom range', () => {
    expect(resolveRange(filters({ range: 'custom', from: '2026-03-02' }), now).to).toBeUndefined();
    expect(resolveRange(filters({ range: 'custom', to: '2026-03-02' }), now).from).toBeUndefined();
  });
});

describe('buildListRequest', () => {
  const now = new Date(2026, 9, 14, 12, 0, 0);

  it('always asks for the card view with explicit paging', () => {
    const { params } = buildListRequest(EMPTY_FILTERS, { page: 2, limit: 24, now });
    expect(params!.get('view')).toBe('cards');
    expect(params!.get('page')).toBe('2');
    expect(params!.get('limit')).toBe('24');
    expect(params!.get('search')).toBeNull();
  });

  it('maps the approval options onto the approved flag', () => {
    expect(
      buildListRequest(filters({ status: 'approved' }), { page: 1, limit: 24, now }).params!.get(
        'approved'
      )
    ).toBe('true');
    expect(
      buildListRequest(filters({ status: 'not_approved' }), { page: 1, limit: 24, now }).params!.get(
        'approved'
      )
    ).toBe('false');
  });

  it('passes the box statuses through as emailStatus', () => {
    const { params } = buildListRequest(filters({ status: 'unapproved_verified_smtp' }), {
      page: 1,
      limit: 24,
      now,
    });
    expect(params!.get('emailStatus')).toBe('unapproved_verified_smtp');
    expect(params!.get('approved')).toBeNull();
  });

  it('sends search, client and the resolved range', () => {
    const { params } = buildListRequest(
      filters({ search: '  jane doe ', clientId: 'c1', range: 'today' }),
      { page: 1, limit: 24, now }
    );
    expect(params!.get('search')).toBe('jane doe');
    expect(params!.get('clientId')).toBe('c1');
    expect(params!.get('from')).toBeTruthy();
    expect(params!.get('to')).toBeTruthy();
  });

  it('refuses to build a request for a broken range', () => {
    const result = buildListRequest(
      filters({ range: 'custom', from: '2027-01-01', to: '2020-01-01' }),
      { page: 1, limit: 24, now }
    );
    expect(result.params).toBeUndefined();
    expect(result.error).toBeTruthy();
  });
});

describe('todayAsInputValue', () => {
  it('formats the local day for a date input', () => {
    expect(todayAsInputValue(new Date(2026, 9, 14, 23, 30))).toBe('2026-10-14');
  });
});
