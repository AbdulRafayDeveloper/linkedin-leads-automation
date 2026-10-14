/**
 * @jest-environment node
 */
import {
  buildBuckets,
  createBucketKey,
  isValidTimeZone,
  mongoBucketKey,
  pickGranularity,
  resolveTimeZone,
} from '../timeBuckets';

describe('timeBuckets', () => {
  it('falls back to UTC for unknown time zones', () => {
    expect(resolveTimeZone('Asia/Karachi')).toBe('Asia/Karachi');
    expect(resolveTimeZone('Not/AZone')).toBe('UTC');
    expect(resolveTimeZone(null)).toBe('UTC');
    expect(isValidTimeZone('Asia/Karachi')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('coarsens the buckets as the range grows, so the chart stays readable', () => {
    const from = new Date('2026-09-01T00:00:00Z');
    expect(pickGranularity(from, new Date('2026-09-01T23:59:00Z'))).toBe('hour');
    expect(pickGranularity(from, new Date('2026-09-30T00:00:00Z'))).toBe('day');
    // Three months to two years is weekly, not one bar per day.
    expect(pickGranularity(from, new Date('2027-06-01T00:00:00Z'))).toBe('week');
    expect(pickGranularity(from, new Date('2036-09-01T00:00:00Z'))).toBe('month');
  });

  it('keys dates in the viewer time zone, not UTC', () => {
    const keyOf = createBucketKey('day', 'Asia/Karachi');
    // 20:30 UTC on Sep 14 is already Sep 15 in Karachi (UTC+5).
    expect(keyOf(new Date('2026-09-14T20:30:00Z'))).toBe('2026-09-15');
  });

  it('keys a week by the Monday it starts on', () => {
    const keyOf = createBucketKey('week', 'UTC');
    // Sep 2026: the 14th is a Monday, the 20th the Sunday that closes that week.
    expect(keyOf(new Date('2026-09-14T00:00:00Z'))).toBe('2026-09-14');
    expect(keyOf(new Date('2026-09-20T23:00:00Z'))).toBe('2026-09-14');
    expect(keyOf(new Date('2026-09-21T00:00:00Z'))).toBe('2026-09-21');
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

  it('lists one bucket per week, labelled by its Monday', () => {
    const buckets = buildBuckets(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-28T00:00:00Z'), 'week', 'UTC');
    expect(buckets.map((b) => b.key)).toEqual(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
    expect(buckets[1]).toMatchObject({ label: 'Sep 7', fullLabel: 'Week of Mon, Sep 7, 2026' });
  });

  it('lists months for long ranges', () => {
    const buckets = buildBuckets(new Date('2026-01-15T00:00:00Z'), new Date('2026-09-14T00:00:00Z'), 'month', 'UTC');
    expect(buckets).toHaveLength(9);
    expect(buckets[0]).toMatchObject({ key: '2026-01', label: 'Jan 2026' });
  });
});

describe('mongoBucketKey', () => {
  it('asks the database for the same key the app builds', () => {
    expect(mongoBucketKey('day', 'Asia/Karachi', '$createdAt')).toEqual({
      $dateToString: { date: '$createdAt', format: '%Y-%m-%d', timezone: 'Asia/Karachi' },
    });
    expect(mongoBucketKey('hour', 'UTC', '$createdAt')).toMatchObject({
      $dateToString: { format: '%Y-%m-%d %H' },
    });
    expect(mongoBucketKey('month', 'UTC', '$createdAt')).toMatchObject({
      $dateToString: { format: '%Y-%m' },
    });
    expect(mongoBucketKey('week', 'UTC', '$items.sentAt')).toEqual({
      $dateToString: {
        date: { $dateTrunc: { date: '$items.sentAt', unit: 'week', startOfWeek: 'monday', timezone: 'UTC' } },
        format: '%Y-%m-%d',
        timezone: 'UTC',
      },
    });
  });
});
