/**
 * @jest-environment node
 */
import { buildBuckets, createBucketKey, pickGranularity, resolveTimeZone } from '../timeBuckets';

describe('timeBuckets', () => {
  it('falls back to UTC for unknown time zones', () => {
    expect(resolveTimeZone('Asia/Karachi')).toBe('Asia/Karachi');
    expect(resolveTimeZone('Not/AZone')).toBe('UTC');
    expect(resolveTimeZone(null)).toBe('UTC');
  });

  it('picks hourly, daily or monthly buckets by span', () => {
    const from = new Date('2026-09-01T00:00:00Z');
    expect(pickGranularity(from, new Date('2026-09-01T23:59:00Z'))).toBe('hour');
    expect(pickGranularity(from, new Date('2026-09-30T00:00:00Z'))).toBe('day');
    expect(pickGranularity(from, new Date('2027-06-01T00:00:00Z'))).toBe('month');
  });

  it('keys dates in the viewer time zone, not UTC', () => {
    const keyOf = createBucketKey('day', 'Asia/Karachi');
    // 20:30 UTC on Sep 14 is already Sep 15 in Karachi (UTC+5).
    expect(keyOf(new Date('2026-09-14T20:30:00Z'))).toBe('2026-09-15');
  });

  it('lists 24 hourly buckets for one local day', () => {
    const buckets = buildBuckets(
      new Date('2026-09-13T19:00:00Z'),
      new Date('2026-09-14T18:59:59Z'),
      'hour',
      'Asia/Karachi'
    );
    expect(buckets).toHaveLength(24);
    expect(buckets[0].key).toBe('2026-09-14 00');
    expect(buckets[0].label).toBe('12 AM');
    expect(buckets[23].key).toBe('2026-09-14 23');
  });

  it('lists one bucket per day for a week', () => {
    const buckets = buildBuckets(new Date('2026-09-08T00:00:00Z'), new Date('2026-09-14T12:00:00Z'), 'day', 'UTC');
    expect(buckets.map((b) => b.key)).toEqual([
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
      '2026-09-14',
    ]);
    expect(buckets[6].label).toBe('Sep 14');
  });

  it('lists months for long ranges', () => {
    const buckets = buildBuckets(new Date('2026-01-15T00:00:00Z'), new Date('2026-09-14T00:00:00Z'), 'month', 'UTC');
    expect(buckets).toHaveLength(9);
    expect(buckets[0]).toMatchObject({ key: '2026-01', label: 'Jan 2026' });
  });
});
