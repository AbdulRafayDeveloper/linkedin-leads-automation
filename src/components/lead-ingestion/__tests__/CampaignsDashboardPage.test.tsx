import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CampaignsDashboardPage from '../CampaignsDashboardPage';
import {
  deleteCampaignApi,
  getCampaignsApi,
  type CampaignListResponse,
  type CampaignSummaryRecord,
} from '@/services/lead-ingestion/apiClient';

const push = jest.fn();
const replace = jest.fn();
let search = '';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(search),
}));

jest.mock('@/services/lead-ingestion/apiClient', () => ({
  getCampaignsApi: jest.fn(),
  deleteCampaignApi: jest.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

function campaign(overrides: Partial<CampaignSummaryRecord> = {}): CampaignSummaryRecord {
  return {
    _id: '6500000000000000000000a1',
    name: 'October outreach',
    status: 'draft',
    totalEmails: 10,
    sentCount: 4,
    deliveredCount: 4,
    openedCount: 1,
    failedCount: 2,
    pendingCount: 4,
    sendingCount: 0,
    minDelaySeconds: 60,
    maxDelaySeconds: 600,
    isRunnerActive: false,
    activeRunnerId: null,
    lastDispatchAt: null,
    runnerHeartbeatAt: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    ...overrides,
  };
}

function listResponse(campaigns: CampaignSummaryRecord[], extra: Partial<CampaignListResponse> = {}): CampaignListResponse {
  return {
    campaigns,
    total: campaigns.length,
    page: 1,
    limit: 20,
    pages: 1,
    hasMore: false,
    sort: 'createdAt',
    order: 'desc',
    openTrackingEnabled: true,
    ...extra,
  };
}

const getMock = jest.mocked(getCampaignsApi);
const deleteMock = jest.mocked(deleteCampaignApi);

beforeEach(() => {
  jest.clearAllMocks();
  search = '';
  getMock.mockResolvedValue(listResponse([campaign(), campaign({ _id: '6500000000000000000000a2', name: 'Second run', status: 'completed', pendingCount: 0, deliveredCount: 10, failedCount: 0 })]));
  deleteMock.mockResolvedValue({ message: 'ok', releasedDrafts: 6 });
});

describe('CampaignsDashboardPage', () => {
  it('lists campaigns with counts, pagination summary and a pending column', async () => {
    render(<CampaignsDashboardPage />);
    // jsdom applies no CSS, so both the desktop table and the mobile cards render.
    expect((await screen.findAllByRole('link', { name: 'October outreach' })).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Second run' }).length).toBeGreaterThan(0);
    expect(screen.getByText('Showing 1–2 of 2')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Pending' })).toBeInTheDocument();
    expect(getMock).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, limit: 20, status: 'all', sort: 'createdAt', order: 'desc' }),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('describes progress with delivered and failed counts, not a single percentage', async () => {
    render(<CampaignsDashboardPage />);
    await screen.findAllByRole('link', { name: 'October outreach' });
    const bars = screen.getAllByRole('progressbar', { name: '4 of 10 delivered, 2 failed, 4 pending' });
    expect(bars.length).toBeGreaterThan(0);
    expect(bars[0]).toHaveAttribute('aria-valuenow', '6');
  });

  it('shows a different empty state when filters are active', async () => {
    getMock.mockResolvedValue(listResponse([]));
    render(<CampaignsDashboardPage />);
    expect(await screen.findByText('No campaigns yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Ready to Send' })).toHaveAttribute('href', '/lead-ingestion/approved');

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'paused' } });
    expect(await screen.findByText('No campaigns match these filters')).toBeInTheDocument();
    expect(getMock).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'paused', page: 1 }), expect.anything());
  });

  it('debounces the search box and sends the trimmed query', async () => {
    jest.useFakeTimers();
    try {
      render(<CampaignsDashboardPage />);
      await act(async () => {
        await Promise.resolve();
      });
      fireEvent.change(screen.getByLabelText('Search campaigns by name'), { target: { value: '  oct' } });
      fireEvent.change(screen.getByLabelText('Search campaigns by name'), { target: { value: '  octo ' } });
      await act(async () => {
        jest.advanceTimersByTime(350);
      });
      const searches = getMock.mock.calls.map((call) => call[0]?.search).filter(Boolean);
      expect(searches).toEqual(['octo']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('sorts by a column when its header is clicked', async () => {
    render(<CampaignsDashboardPage />);
    await screen.findAllByRole('link', { name: 'October outreach' });
    fireEvent.click(screen.getByRole('button', { name: /^Failed/ }));
    await waitFor(() =>
      expect(getMock).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'failedCount', order: 'desc', page: 1 }), expect.anything())
    );
    expect(screen.getByRole('columnheader', { name: /Failed/ })).toHaveAttribute('aria-sort', 'descending');
  });

  it('confirms deletion in a dialog naming the campaign and reports released drafts', async () => {
    render(<CampaignsDashboardPage />);
    await screen.findAllByRole('link', { name: 'October outreach' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete campaign October outreach' })[0]);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Delete "October outreach"?')).toBeInTheDocument();
    expect(within(dialog).getByText(/6 unsent drafts go back to Ready to Send/)).toBeInTheDocument();
    expect(deleteMock).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete campaign' }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('6500000000000000000000a1'));
    expect(await screen.findByText(/Deleted "October outreach". 6 unsent drafts are back in Ready to Send./)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the server refusal inside the dialog when a campaign is still sending', async () => {
    const { ApiError } = jest.requireMock('@/services/lead-ingestion/apiClient') as { ApiError: new (m: string, s: number) => Error };
    deleteMock.mockRejectedValue(new ApiError('This campaign is still sending. Pause it before deleting it.', 409));
    render(<CampaignsDashboardPage />);
    await screen.findAllByRole('link', { name: 'October outreach' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete campaign October outreach' })[0]);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete campaign' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('still sending');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('redirects old ?id= links straight to the campaign page without a history entry', async () => {
    search = 'id=6500000000000000000000a1';
    render(<CampaignsDashboardPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/lead-ingestion/campaigns/6500000000000000000000a1'));
    expect(push).not.toHaveBeenCalled();
  });

  it('shows pagination controls when there is more than one page', async () => {
    getMock.mockResolvedValue(listResponse([campaign()], { total: 45, pages: 3, hasMore: true }));
    render(<CampaignsDashboardPage />);
    expect(await screen.findByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Previous/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    await waitFor(() => expect(getMock).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.anything()));
  });

  it('marks the Opened column when open tracking is off', async () => {
    getMock.mockResolvedValue(listResponse([campaign()], { openTrackingEnabled: false }));
    render(<CampaignsDashboardPage />);
    await screen.findAllByRole('link', { name: 'October outreach' });
    expect(screen.getAllByTitle(/Open tracking is off/).length).toBeGreaterThan(0);
  });
});
