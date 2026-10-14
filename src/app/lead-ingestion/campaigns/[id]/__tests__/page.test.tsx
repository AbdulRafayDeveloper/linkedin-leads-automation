import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CampaignDetailPage from '../page';
import {
  deleteCampaignApi,
  dispatchCampaignBatchApi,
  getCampaignDetailsApi,
  updateCampaignApi,
  type CampaignItemRecord,
  type CampaignRecord,
  type DispatchBatchResponse,
} from '@/services/lead-ingestion/apiClient';

const push = jest.fn();
const replace = jest.fn();
let search = '';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => new URLSearchParams(search),
}));

jest.mock('@/services/lead-ingestion/apiClient', () => ({
  getCampaignDetailsApi: jest.fn(),
  dispatchCampaignBatchApi: jest.fn(),
  updateCampaignApi: jest.fn(),
  deleteCampaignApi: jest.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));

const ID = '6500000000000000000000b1';

function item(n: number, status: CampaignItemRecord['status'], extra: Partial<CampaignItemRecord> = {}): CampaignItemRecord {
  return {
    _id: `item-${n}`,
    leadId: `lead-${n}`,
    companyIndex: -1,
    candidateName: `Person ${n}`,
    clientName: `Person ${n} #01`,
    companyName: `Company ${n}`,
    recipientEmail: `p${n}@example.com`,
    subject: `Subject ${n}`,
    bodyHtml: '<p>Hi</p>',
    status,
    errorMessage: null,
    attempts: 0,
    sendingStartedAt: null,
    sentAt: null,
    openedAt: null,
    failedAt: null,
    ...extra,
  };
}

function campaign(items: CampaignItemRecord[], overrides: Partial<CampaignRecord> = {}): CampaignRecord {
  const count = (s: CampaignItemRecord['status']) => items.filter((i) => i.status === s).length;
  const delivered = count('delivered') + count('opened');
  return {
    _id: ID,
    name: 'October outreach',
    status: 'draft',
    totalEmails: items.length,
    sentCount: delivered,
    deliveredCount: delivered,
    openedCount: count('opened'),
    failedCount: count('failed'),
    pendingCount: count('pending'),
    sendingCount: count('sending'),
    minDelaySeconds: 5,
    maxDelaySeconds: 5,
    isRunnerActive: false,
    activeRunnerId: null,
    lastDispatchAt: null,
    runnerHeartbeatAt: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    items,
    ...overrides,
  };
}

function dispatchResponse(c: CampaignRecord, sent: CampaignItemRecord, remaining: number, extra: Partial<DispatchBatchResponse> = {}): DispatchBatchResponse {
  return {
    processedCount: 1,
    successCount: sent.status === 'delivered' ? 1 : 0,
    failedCount: sent.status === 'failed' ? 1 : 0,
    remainingCount: remaining,
    pendingCount: c.pendingCount,
    item: sent,
    campaign: c,
    ...extra,
  };
}

const getMock = jest.mocked(getCampaignDetailsApi);
const dispatchMock = jest.mocked(dispatchCampaignBatchApi);
const updateMock = jest.mocked(updateCampaignApi);
const deleteMock = jest.mocked(deleteCampaignApi);

/**
 * React's `use()` reads an already-settled thenable synchronously when it
 * carries `status` and `value`, so the page renders without suspending here.
 */
function settledParams(): Promise<{ id: string }> {
  const value = { id: ID };
  return Object.assign(Promise.resolve(value), { status: 'fulfilled', value });
}

function renderPage() {
  return render(<CampaignDetailPage params={settledParams()} />);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  search = '';
  const initial = campaign([item(1, 'pending'), item(2, 'pending'), item(3, 'failed', { errorMessage: 'SMTP down', failedAt: '2026-10-01T10:00:00.000Z' })]);
  getMock.mockResolvedValue({ campaign: initial, openTrackingEnabled: true });
  updateMock.mockImplementation(async (_id, updates) => ({
    campaign: campaign([item(1, 'pending'), item(2, 'pending'), item(3, 'failed')], { status: updates.status === 'paused' ? 'paused' : 'draft', name: updates.name ?? 'October outreach' }),
  }));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('CampaignDetailPage', () => {
  it('renders the campaign header, counts and recipients with real delay values', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'October outreach' })).toBeInTheDocument();
    expect(screen.getByText(/delay 5s to 5s/)).toBeInTheDocument();
    expect(screen.getByText('2 emails waiting to be sent')).toBeInTheDocument();
    expect(screen.getAllByText('p1@example.com').length).toBeGreaterThan(0);
    expect(screen.getAllByText('SMTP down').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Retry failed \(1\)/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^(Start|Resume) sending$/ })).toBeEnabled();
  });

  it('asks for confirmation, then sends one email at a time with the tab id and waits between sends', async () => {
    jest.useFakeTimers();
    const afterFirst = campaign([item(1, 'delivered', { sentAt: '2026-10-01T10:00:00.000Z' }), item(2, 'pending'), item(3, 'failed')], { status: 'running', isRunnerActive: true, activeRunnerId: 'me' });
    const afterSecond = campaign([item(1, 'delivered'), item(2, 'delivered'), item(3, 'failed')], { status: 'completed' });
    dispatchMock
      .mockResolvedValueOnce(dispatchResponse(afterFirst, afterFirst.items[0], 1))
      .mockResolvedValueOnce(dispatchResponse(afterSecond, afterSecond.items[1], 0));

    renderPage();
    await flush();
    await flush();
    fireEvent.click(await screen.findByRole('button', { name: /^(Start|Resume) sending$/ }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/2 emails go out one at a time/)).toBeInTheDocument();
    expect(dispatchMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: /^(Start|Resume) sending$/ }));

    await flush();
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    const firstCall = dispatchMock.mock.calls[0][1]!;
    expect(firstCall.rerunFailed).toBe(false);
    expect(typeof firstCall.runnerId).toBe('string');
    expect(screen.getByText(/Sent to p1@example.com. 1 left. Next email in 5s./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Pause/ })).toBeInTheDocument();

    // Not yet: 4 seconds in, still waiting.
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(dispatchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1600);
    });
    await flush();
    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock.mock.calls[1][1]!.runnerId).toBe(firstCall.runnerId);
    expect(await screen.findByText(/Finished: 2 delivered, 1 failed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pause/ })).not.toBeInTheDocument();
  });

  it('stops the loop and pauses the campaign on the server when the page unmounts mid-countdown', async () => {
    jest.useFakeTimers();
    const afterFirst = campaign([item(1, 'delivered'), item(2, 'pending'), item(3, 'failed')], { status: 'running', isRunnerActive: true });
    dispatchMock.mockResolvedValue(dispatchResponse(afterFirst, afterFirst.items[0], 1));

    const view = renderPage();
    await flush();
    await flush();
    fireEvent.click(await screen.findByRole('button', { name: /^(Start|Resume) sending$/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^(Start|Resume) sending$/ }));
    await flush();
    expect(dispatchMock).toHaveBeenCalledTimes(1);

    view.unmount();
    await flush();
    expect(updateMock).toHaveBeenCalledWith(ID, expect.objectContaining({ status: 'paused', runnerId: expect.any(String) }));

    await act(async () => {
      jest.advanceTimersByTime(20_000);
    });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it('does not loop when the server reports nothing to send', async () => {
    jest.useFakeTimers();
    const unchanged = campaign([item(1, 'pending'), item(2, 'pending'), item(3, 'failed')]);
    dispatchMock.mockResolvedValue({
      processedCount: 0,
      successCount: 0,
      failedCount: 0,
      remainingCount: 0,
      pendingCount: 2,
      message: 'Nothing left to send.',
      campaign: unchanged,
    });

    renderPage();
    await flush();
    await flush();
    fireEvent.click(await screen.findByRole('button', { name: /^(Start|Resume) sending$/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^(Start|Resume) sending$/ }));
    await flush();
    expect(screen.getByText('Nothing left to send.')).toBeInTheDocument();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(dispatchMock).toHaveBeenCalledTimes(1);
  });

  it('retries failed emails with rerunFailed and keeps going while failed ones remain', async () => {
    jest.useFakeTimers();
    const afterRetry = campaign([item(1, 'pending'), item(2, 'pending'), item(3, 'delivered')], { status: 'running', isRunnerActive: true });
    dispatchMock.mockResolvedValue(dispatchResponse(afterRetry, afterRetry.items[2], 0));

    renderPage();
    await flush();
    await flush();
    fireEvent.click(await screen.findByRole('button', { name: /Retry failed \(1\)/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Retry 1 failed email?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry failed' }));
    await flush();
    expect(dispatchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ rerunFailed: true }));
    expect(await screen.findByText(/Retry finished: every failed email was delivered/)).toBeInTheDocument();
  });

  it('offers to take over when another tab holds the runner', async () => {
    const { ApiError } = jest.requireMock('@/services/lead-ingestion/apiClient') as { ApiError: new (m: string, s: number) => Error };
    dispatchMock.mockRejectedValueOnce(new ApiError('This campaign is being run in another tab. Pause it there, or take over the runner here.', 409));

    renderPage();
    await flush();
    await flush();
    fireEvent.click(await screen.findByRole('button', { name: /^(Start|Resume) sending$/ }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^(Start|Resume) sending$/ }));

    expect(await screen.findByRole('button', { name: 'Take over here' })).toBeInTheDocument();
    const afterTakeover = campaign([item(1, 'delivered'), item(2, 'delivered'), item(3, 'failed')], { status: 'completed' });
    dispatchMock.mockResolvedValueOnce(dispatchResponse(afterTakeover, afterTakeover.items[0], 0));
    fireEvent.click(screen.getByRole('button', { name: 'Take over here' }));
    await waitFor(() => expect(dispatchMock).toHaveBeenCalledTimes(2));
    expect(dispatchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ takeover: true }));
  });

  it('sends a single recipient on demand after confirmation', async () => {
    const after = campaign([item(1, 'pending'), item(2, 'delivered'), item(3, 'failed')]);
    dispatchMock.mockResolvedValue(dispatchResponse(after, after.items[1], 0));

    renderPage();
    await flush();
    await flush();
    fireEvent.click((await screen.findAllByRole('button', { name: /Send now/ }))[1]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Send to p2@example.com now?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send now' }));
    await waitFor(() => expect(dispatchMock).toHaveBeenCalledWith(ID, expect.objectContaining({ itemIds: ['item-2'] })));
    expect(await screen.findByText('Sent to p2@example.com.')).toBeInTheDocument();
  });

  it('starts automatically without a dialog when opened with ?autostart=1', async () => {
    search = 'autostart=1';
    const done = campaign([item(1, 'delivered'), item(2, 'delivered'), item(3, 'failed')], { status: 'completed' });
    dispatchMock.mockResolvedValue(dispatchResponse(done, done.items[0], 0));
    renderPage();
    await waitFor(() => expect(dispatchMock).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith(`/lead-ingestion/campaigns/${ID}`);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('edits name and delays through the dialog and rejects an inverted range', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'October outreach' });
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }));
    const dialog = screen.getByRole('dialog', { name: 'Edit campaign' });
    fireEvent.change(within(dialog).getByLabelText('Min delay (seconds)'), { target: { value: '90' } });
    fireEvent.change(within(dialog).getByLabelText('Max delay (seconds)'), { target: { value: '30' } });
    expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText('Max delay (seconds)'), { target: { value: '120' } });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Renamed' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateMock).toHaveBeenCalledWith(ID, { name: 'Renamed', minDelaySeconds: 90, maxDelaySeconds: 120 }));
    expect(await screen.findByRole('heading', { name: 'Renamed' })).toBeInTheDocument();
  });

  it('deletes the campaign after confirmation and goes back to the list', async () => {
    deleteMock.mockResolvedValue({ message: 'ok', releasedDrafts: 3 });
    renderPage();
    await screen.findByRole('heading', { name: 'October outreach' });
    fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/3 unsent drafts go back to Ready to Send/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete campaign' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/lead-ingestion/campaigns'));
  });

  it('shows the not-found state with a way back', async () => {
    const { ApiError } = jest.requireMock('@/services/lead-ingestion/apiClient') as { ApiError: new (m: string, s: number) => Error };
    getMock.mockRejectedValue(new ApiError('Campaign not found', 404));
    renderPage();
    expect(await screen.findByText('Campaign not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Campaigns/ })).toHaveAttribute('href', '/lead-ingestion/campaigns');
  });
});
