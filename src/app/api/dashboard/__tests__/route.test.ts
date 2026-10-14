/**
 * @jest-environment node
 */
import { NextRequest } from 'next/server';
import { GET } from '../route';
import { getDashboardStats } from '@/services/dashboard/dashboardStats';
import type { DashboardStats } from '@/services/dashboard/types';

jest.mock('@/services/dashboard/dashboardStats', () => ({
  getDashboardStats: jest.fn(),
}));

const mocked = getDashboardStats as jest.MockedFunction<typeof getDashboardStats>;

const stub = { range: { from: 'x', to: 'y' } } as unknown as DashboardStats;

async function get(query: string) {
  const response = await GET(new NextRequest(`http://localhost/api/dashboard${query}`));
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  mocked.mockReset();
  mocked.mockResolvedValue(stub);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /api/dashboard validation', () => {
  it('accepts a range and passes it on with the comparison window', async () => {
    const { status, body } = await get(
      '?tz=Asia/Karachi&from=2026-10-01T00:00:00.000Z&to=2026-10-08T00:00:00.000Z' +
        '&compareFrom=2026-09-24T00:00:00.000Z&compareTo=2026-10-01T00:00:00.000Z'
    );
    expect(status).toBe(200);
    expect(body.stats).toEqual(stub);
    expect(mocked).toHaveBeenCalledWith(
      expect.objectContaining({
        from: new Date('2026-10-01T00:00:00.000Z'),
        to: new Date('2026-10-08T00:00:00.000Z'),
        timeZone: 'Asia/Karachi',
        compare: {
          from: new Date('2026-09-24T00:00:00.000Z'),
          to: new Date('2026-10-01T00:00:00.000Z'),
        },
      })
    );
  });

  it('treats no dates as all time', async () => {
    const { status } = await get('?tz=UTC');
    expect(status).toBe(200);
    expect(mocked).toHaveBeenCalledWith(expect.objectContaining({ from: null, to: null, compare: null }));
  });

  it('refuses an end date without a start instead of answering with all time', async () => {
    const { status, body } = await get('?to=2026-10-08T00:00:00.000Z');
    expect(status).toBe(422);
    expect(body.error).toMatch(/from/i);
    expect(mocked).not.toHaveBeenCalled();
  });

  it('refuses a start after the end, including a start in the future', async () => {
    expect((await get('?from=2026-10-08T00:00:00.000Z&to=2026-10-01T00:00:00.000Z')).status).toBe(422);

    const future = new Date(Date.now() + 30 * 864e5).toISOString();
    const { status, body } = await get(`?from=${future}`);
    expect(status).toBe(422);
    expect(body.error).toMatch(/after its end/i);
  });

  it('refuses dates that are not ISO', async () => {
    for (const query of ['?from=2026', '?from=notadate', '?from=last%20tuesday', '?to=2026-13-45']) {
      const { status } = await get(query);
      expect(status).toBe(422);
    }
    expect(mocked).not.toHaveBeenCalled();
  });

  it('accepts a plain date as well as a full instant', async () => {
    expect((await get('?from=2026-10-01&to=2026-10-08')).status).toBe(200);
  });

  it('refuses an unknown time zone rather than silently charting UTC', async () => {
    const { status, body } = await get('?tz=Mars/Olympus&from=2026-10-01');
    expect(status).toBe(422);
    expect(body.error).toMatch(/time zone/i);
  });

  it('refuses half a comparison window and a backwards one', async () => {
    expect((await get('?from=2026-10-01&compareFrom=2026-09-01')).status).toBe(422);
    expect(
      (await get('?from=2026-10-01&compareFrom=2026-09-10&compareTo=2026-09-01')).status
    ).toBe(422);
  });

  it('refuses a range longer than ten years', async () => {
    const { status, body } = await get('?from=1990-01-01&to=2026-10-01');
    expect(status).toBe(422);
    expect(body.error).toMatch(/years or less/i);
  });
});

describe('GET /api/dashboard behaviour', () => {
  it('serves a repeated request from the short-lived cache', async () => {
    const query = '?tz=UTC&from=2026-10-02T00:00:00.000Z&to=2026-10-03T00:00:00.000Z';
    await get(query);
    await get(query);
    expect(mocked).toHaveBeenCalledTimes(1);

    await get('?tz=UTC&from=2026-10-04T00:00:00.000Z&to=2026-10-05T00:00:00.000Z');
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it('hides internal errors behind a plain message', async () => {
    mocked.mockRejectedValue(new Error('connect ECONNREFUSED mongo-primary.internal:27017'));
    const { status, body } = await get('?tz=UTC&from=2026-10-06T00:00:00.000Z&to=2026-10-07T00:00:00.000Z');
    expect(status).toBe(500);
    expect(body.error).toBe('Failed to load dashboard stats');
    expect(body.error).not.toMatch(/mongo/i);
  });
});
