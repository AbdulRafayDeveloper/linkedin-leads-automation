/** @jest-environment node */
import { buildLeadFilter, parseLeadListQuery } from '../query';
import { readyToSendQuery } from '@/services/lead-ingestion/readyToSend';

describe('GET /api/leads readyToSend filter', () => {
  it('is off unless readyToSend=true', () => {
    expect(parseLeadListQuery(new URLSearchParams('')).readyToSend).toBe(false);
    expect(parseLeadListQuery(new URLSearchParams('readyToSend=yes')).readyToSend).toBe(false);
    expect(parseLeadListQuery(new URLSearchParams('readyToSend=true')).readyToSend).toBe(true);
  });

  it('adds the shared ready-to-send condition to the match', () => {
    const query = parseLeadListQuery(new URLSearchParams('readyToSend=true&search=acme'));
    const filter = buildLeadFilter(query) as { $and: Record<string, unknown>[] };
    expect(filter.$and).toContainEqual(readyToSendQuery());
  });

  it('leaves the match alone otherwise', () => {
    const filter = buildLeadFilter(parseLeadListQuery(new URLSearchParams('approved=true'))) as {
      $and: Record<string, unknown>[];
    };
    expect(filter.$and).not.toContainEqual(readyToSendQuery());
  });
});
