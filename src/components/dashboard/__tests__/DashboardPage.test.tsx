import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DashboardPage from '../DashboardPage';
import { getDashboardStatsApi } from '@/services/dashboard/apiClient';
import type { DashboardStats } from '@/services/dashboard/types';

const replace = jest.fn();
let currentSearch = '';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

jest.mock('@/services/dashboard/apiClient', () => ({ getDashboardStatsApi: jest.fn() }));
const loadStats = getDashboardStatsApi as jest.MockedFunction<typeof getDashboardStatsApi>;

function stats(overrides: Partial<DashboardStats> = {}): DashboardStats {
  return {
    range: {
      from: '2026-10-08T00:00:00.000Z',
      to: '2026-10-14T12:00:00.000Z',
      granularity: 'day',
      isAllTime: false,
      timeZone: 'UTC',
      comparison: { from: '2026-10-01T00:00:00.000Z', to: '2026-10-07T12:00:00.000Z' },
    },
    generatedAt: '2026-10-14T12:00:00.000Z',
    trackingEnabled: false,
    hasAnyData: true,
    kpis: {
      leads: { value: 9, previous: 0 },
      emailsFound: { value: 14, previous: 2 },
      verified: { value: 11, previous: 11 },
      sent: { value: 0, previous: 0 },
      opened: { value: 0, previous: 0 },
    },
    funnel: [
      { key: 'imported', label: 'Leads imported', value: 9 },
      { key: 'email_found', label: 'With an email', value: 3 },
      { key: 'verified', label: 'With a verified email', value: 3 },
      { key: 'drafted', label: 'With a draft', value: 5 },
      { key: 'approved', label: 'With an approved draft', value: 1 },
      { key: 'contacted', label: 'Contacted', value: 0 },
    ],
    verification: { valid: 1, risky: 10, invalid: 1, unknown: 2, pending: 0 },
    drafts: { written: 8, awaitingReview: 7, approved: 1, inCampaign: 1 },
    research: { companies: 9, withWebsite: 4, leadsWithPhone: 5, crawlsFailed: 0 },
    delivery: { delivered: 0, opened: 0, failed: 0, queued: 3, deliveryRate: null, openRate: null },
    campaigns: {
      running: 0,
      paused: 1,
      completed: 4,
      draft: 2,
      recent: [
        {
          id: 'c1',
          name: 'Campaign #133',
          status: 'paused',
          total: 1,
          processed: 0,
          delivered: 0,
          opened: 0,
          failed: 0,
          updatedAt: '2026-10-14T06:00:00.000Z',
        },
      ],
    },
    recentLeads: [
      {
        id: 'l1',
        fullName: null,
        companyName: 'Unspecified Company',
        createdAt: '2026-10-14T05:00:00.000Z',
        emailCount: 0,
        stage: 'imported',
      },
    ],
    series: [
      { key: '2026-10-13', label: 'Oct 13', fullLabel: 'Tue, Oct 13, 2026', leads: 2, sent: 0, opened: 0 },
      { key: '2026-10-14', label: 'Oct 14', fullLabel: 'Wed, Oct 14, 2026', leads: 7, sent: 0, opened: 0 },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  currentSearch = '';
  replace.mockClear();
  loadStats.mockReset();
  loadStats.mockResolvedValue(stats());
});

describe('DashboardPage loading', () => {
  it('loads once and shows the numbers with their units', async () => {
    render(<DashboardPage />);
    // The label appears on the KPI tile, the chart tab and the funnel.
    await screen.findAllByText('Leads imported');
    expect(loadStats).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText('9').length).toBeGreaterThan(0);
    expect(screen.getAllByText('addresses')).toHaveLength(2);
  });

  it('does not print a zero for opens when tracking is off', async () => {
    render(<DashboardPage />);
    // The KPI tile is the one carrying the "tracking is off" note.
    const note = await screen.findAllByText('Open tracking is off');
    const tile = note[0].closest<HTMLElement>('div.flex.min-w-0.flex-col')!;
    expect(within(tile).getByText('–')).toBeInTheDocument();
    expect(within(tile).queryByText('0')).not.toBeInTheDocument();
  });

  it('says the campaign panel ignores the date range', async () => {
    render(<DashboardPage />);
    await screen.findByText('Campaigns');
    expect(screen.getByText(/any date/i)).toBeInTheDocument();
  });

  it('hides placeholder values in the recent leads list', async () => {
    render(<DashboardPage />);
    await screen.findByText('Recent leads');
    expect(screen.getByText('Unnamed lead')).toBeInTheDocument();
    expect(screen.queryByText(/Unspecified Company/)).not.toBeInTheDocument();
    expect(screen.getByText(/No company/)).toBeInTheDocument();
  });

  it('offers an import when the workspace is empty', async () => {
    loadStats.mockResolvedValue(stats({ hasAnyData: false }));
    render(<DashboardPage />);
    expect(await screen.findByText('No data yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /import a lead/i })).toBeInTheDocument();
  });
});

describe('DashboardPage range handling', () => {
  it('refuses a backwards custom range, explains why and asks for nothing', async () => {
    currentSearch = 'range=custom&from=2026-10-14&to=2026-10-01';
    render(<DashboardPage />);

    expect(await screen.findByText(/on or before/i)).toBeInTheDocument();
    expect(loadStats).not.toHaveBeenCalled();
  });

  it('asks for a start date instead of quietly showing all time', async () => {
    currentSearch = 'range=custom&from=&to=';
    render(<DashboardPage />);

    expect(await screen.findByText(/pick a start date/i)).toBeInTheDocument();
    expect(loadStats).not.toHaveBeenCalled();
  });

  it('cleans an unknown range out of the URL', async () => {
    currentSearch = 'range=forever';
    render(<DashboardPage />);
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/dashboard', { scroll: false })
    );
  });

  it('moves between presets with the arrow keys', async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);
    await screen.findAllByText('Leads imported');

    const selected = screen.getByRole('radio', { name: '7 days' });
    expect(selected).toHaveAttribute('aria-checked', 'true');
    selected.focus();
    await user.keyboard('{ArrowRight}');

    expect(replace).toHaveBeenCalledWith('/dashboard?range=30d', { scroll: false });
  });

  it('keeps the chart metric and table view in the URL', async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);
    await screen.findByText('Activity');

    await user.click(screen.getByRole('tab', { name: 'Emails sent' }));
    expect(replace).toHaveBeenCalledWith('/dashboard?metric=sent', { scroll: false });

    await user.click(screen.getByRole('button', { name: 'Table' }));
    expect(replace).toHaveBeenCalledWith('/dashboard?view=table', { scroll: false });
  });
});

describe('DashboardPage failures', () => {
  it('announces the failure, keeps the numbers and offers a retry', async () => {
    const user = userEvent.setup();
    render(<DashboardPage />);
    await screen.findAllByText('Leads imported');

    loadStats.mockRejectedValueOnce(new Error('Failed to load dashboard stats'));
    await user.click(screen.getByRole('button', { name: /refresh/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to load dashboard stats');
    expect(alert).toHaveTextContent(/last numbers that loaded/i);
    expect(screen.getAllByText('Leads imported').length).toBeGreaterThan(0);

    loadStats.mockResolvedValueOnce(stats());
    await user.click(within(alert).getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});

describe('DashboardPage accessibility', () => {
  it('wires the chart tabs to a panel and announces updates', async () => {
    render(<DashboardPage />);
    await screen.findByText('Activity');

    const tab = screen.getByRole('tab', { name: 'Leads imported' });
    const panel = screen.getByRole('tabpanel');
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    expect(tab).toHaveAttribute('aria-controls', panel.id);

    expect(screen.getByRole('radiogroup', { name: 'Date range' })).toBeInTheDocument();
    await waitFor(() =>
      expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent(/dashboard updated/i)
    );
  });
});
