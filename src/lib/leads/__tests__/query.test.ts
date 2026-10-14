/** @jest-environment node */
import mongoose from 'mongoose';
import {
  LeadQueryError,
  buildLeadFilter,
  buildLeadPipeline,
  parseLeadListQuery,
  searchPattern,
} from '../query';

const parse = (qs: string) => parseLeadListQuery(new URLSearchParams(qs));

describe('parseLeadListQuery', () => {
  it('keeps paging inside safe bounds', () => {
    expect(parse('').limit).toBe(100);
    expect(parse('limit=24&page=3')).toMatchObject({ limit: 24, page: 3 });
    expect(parse('limit=100000').limit).toBe(200);
    expect(parse('limit=0').limit).toBe(1);
    expect(parse('limit=abc').limit).toBe(100);
    expect(parse('page=-4').page).toBe(1);
  });

  it('splits the search into words and caps how many count', () => {
    expect(parse('search=  john   smith ').search).toEqual(['john', 'smith']);
    expect(parse('search=a b c d e f g h').search).toHaveLength(6);
  });

  it('refuses input it cannot honour instead of ignoring it', () => {
    expect(() => parse('from=notadate')).toThrow(LeadQueryError);
    expect(() => parse('from=2027-01-01&to=2020-01-01')).toThrow(/on or before/);
    expect(() => parse('clientId=nope')).toThrow(/valid id/);
  });

  it('stretches a plain end date over the whole day', () => {
    const { to } = parse('to=2026-03-02');
    expect(to?.toISOString()).toBe('2026-03-02T23:59:59.999Z');
  });

  it('separates the two computed statuses from the plain ones', () => {
    expect(parse('emailStatus=missing_or_unverified')).toMatchObject({
      computedStatus: 'missing_or_unverified',
      emailStatus: undefined,
    });
    expect(parse('emailStatus=delivered')).toMatchObject({
      computedStatus: undefined,
      emailStatus: 'delivered',
    });
    expect(parse('emailStatus=all').emailStatus).toBeUndefined();
  });
});

describe('searchPattern', () => {
  it('matches across accents, in both directions', () => {
    expect(searchPattern('Jose').test('José Álvarez')).toBe(true);
    expect(searchPattern('José').test('Jose Alvarez')).toBe(true);
    expect(searchPattern('muller').test('Müller')).toBe(true);
  });

  it('ignores case but still needs the word', () => {
    expect(searchPattern('ACME').test('acme corp')).toBe(true);
    expect(searchPattern('acme').test('globex')).toBe(false);
  });

  it('treats regex characters as plain text', () => {
    expect(searchPattern('a+b').test('a+b')).toBe(true);
    expect(searchPattern('a+b').test('aaab')).toBe(false);
    expect(() => searchPattern('([')).not.toThrow();
  });
});

describe('buildLeadFilter', () => {
  it('requires every search word to match somewhere', () => {
    const filter = buildLeadFilter(parse('search=john smith')) as { $and: unknown[] };
    expect(filter.$and).toHaveLength(2);
  });

  it('does not treat an approved lead without companies as awaiting approval', () => {
    const filter = JSON.stringify(buildLeadFilter(parse('approved=false')));
    expect(filter).toContain('"currentCompanies.approved":false');
    expect(filter).not.toContain('$exists');
  });

  it('filters on the client as an ObjectId', () => {
    const id = new mongoose.Types.ObjectId().toString();
    const filter = buildLeadFilter(parse(`clientId=${id}`)) as { $and: { clientId: unknown }[] };
    expect(filter.$and[0].clientId).toBeInstanceOf(mongoose.Types.ObjectId);
  });

  it('is empty when nothing is asked for', () => {
    expect(buildLeadFilter(parse(''))).toEqual({});
  });
});

describe('buildLeadPipeline', () => {
  it('adds the per-box maths only when a computed status needs it', () => {
    const plain = JSON.stringify(buildLeadPipeline(parse('')));
    expect(plain).not.toContain('_personalVerified');

    const computed = JSON.stringify(buildLeadPipeline(parse('emailStatus=unapproved_verified_smtp')));
    expect(computed).toContain('_personalVerified');
    expect(computed).toContain('_allCompaniesVerified');
  });

  it('returns rows and the total in one pass, and trims the card view', () => {
    const [, facet] = buildLeadPipeline(parse('view=cards&limit=24')) as [
      unknown,
      { $facet: { rows: unknown[]; total: unknown[] } },
    ];
    expect(facet.$facet.total).toEqual([{ $count: 'count' }]);
    expect(JSON.stringify(facet.$facet.rows)).toContain('rawLinkedinUrl');
    expect(JSON.stringify(facet.$facet.rows)).not.toContain('"rawText":1');
  });

  it('skips the right number of rows for a later page', () => {
    const stages = JSON.stringify(buildLeadPipeline(parse('page=3&limit=24')));
    expect(stages).toContain('"$skip":48');
    expect(stages).toContain('"$limit":24');
  });
});
