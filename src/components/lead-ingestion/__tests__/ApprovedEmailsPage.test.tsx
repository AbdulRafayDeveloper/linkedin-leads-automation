import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ApprovedEmailsPage, { defaultCampaignName, localDayBounds, matchesSearch } from '../ApprovedEmailsPage';
import { getReadyToSendLeadsApi, type ReadyLeadRecord } from '@/services/lead-ingestion/readyToSendApi';
import { ApiError, createCampaignApi } from '@/services/lead-ingestion/apiClient';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

jest.mock('@/services/lead-ingestion/readyToSendApi', () => ({
  getReadyToSendLeadsApi: jest.fn(),
}));

jest.mock('@/services/lead-ingestion/apiClient', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { createCampaignApi: jest.fn(), ApiError };
});

jest.mock('@/lib/utils/sanitizeHtml', () => ({
  sanitizeEmailHtml: (html: string) => `<!--sanitized-->${html}`,
}));

function lead(overrides: Partial<ReadyLeadRecord> & { _id: string }): ReadyLeadRecord {
  return {
    clientId: 'client-1',
    clientName: 'Jane Doe #01',
    rawText: '',
    summary: null,
    fullName: 'Jane Doe',
    companyName: null,
    jobTitle: null,
    workPeriod: null,
    email: null,
    phoneNumber: null,
    websiteUrl: null,
    portfolioUrl: null,
    siteType: 'unknown',
    additionalUrls: [],
    currentCompanies: [],
    status: 'completed',
    discoveredEmails: [],
    discoveredPhones: [],
    verifiedEmails: [],
    emailValidationStatus: 'pending',
    emailValidationDetails: null,
    crawlStatus: 'completed',
    emailSubject: null,
    emailBody: null,
    approved: false,
    emailStatus: 'pending',
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    ...overrides,
  };
}

const company = (over: Partial<ReadyLeadRecord['currentCompanies'][number]>) => ({
  companyName: 'Acme',
  jobTitle: 'CTO',
  workPeriod: null,
  websiteUrl: null,
  summary: '',
  companyEmails: ['info@acme.io'],
  emailSubject: 'Hello Acme',
  emailBody: '<p>Hi Jane,</p><p>Body</p>',
  approved: true,
  ...over,
});

const leads: ReadyLeadRecord[] = [
  lead({
    _id: 'lead-1',
    verifiedEmails: [{ email: 'INFO@ACME.IO', status: 'valid' }],
    currentCompanies: [
      company({}),
      company({ companyName: 'Queued Co', companyEmails: ['x@queued.io'], inCampaign: true, campaignSendStatus: 'pending' }),
      company({ companyName: 'Sent Co', companyEmails: ['x@sent.io'], campaignSendStatus: 'delivered' }),
      company({ companyName: 'Unapproved Co', approved: false }),
      company({ companyName: 'No Mail Co', companyEmails: [] }),
    ],
  }),
  lead({
    _id: 'lead-2',
    fullName: 'Bob Stone',
    clientName: 'Bob Stone #02',
    email: 'bob@gmail.com',
    discoveredEmails: ['bob@gmail.com', 'bob.stone@outlook.com'],
    emailValidationStatus: 'invalid',
    emailSubject: 'Hello Bob',
    emailBody: '<p>Hi Bob,</p>',
    approved: true,
  }),
];

const page = (over: Partial<Awaited<ReturnType<typeof getReadyToSendLeadsApi>>> = {}) => ({
  leads,
  total: 2,
  page: 1,
  limit: 50,
  pages: 1,
  hasMore: false,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getReadyToSendLeadsApi).mockResolvedValue(page());
  jest.mocked(createCampaignApi).mockResolvedValue({
    campaign: { _id: 'camp-1', name: 'My campaign', totalEmails: 2 } as never,
  });
});

async function renderLoaded() {
  render(<ApprovedEmailsPage />);
  await screen.findByRole('heading', { name: 'Acme' });
}

describe('ApprovedEmailsPage', () => {
  it('asks the API for ready-to-send leads only', async () => {
    await renderLoaded();
    expect(getReadyToSendLeadsApi).toHaveBeenCalledWith(
      { search: '', from: undefined, to: undefined, page: 1, limit: 50 },
      expect.any(AbortSignal)
    );
  });

  it('shows only approved drafts that are not in a campaign', async () => {
    await renderLoaded();
    expect(screen.getByRole('heading', { name: 'Acme' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No Mail Co' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Personal / Direct Email' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Queued Co' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sent Co' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Unapproved Co' })).not.toBeInTheDocument();
    expect(screen.getByTestId('draft-count')).toHaveTextContent('3 drafts from 2 of 2 leads');
  });

  it('marks drafts without an email as not selectable and keeps them out of Select all', async () => {
    await renderLoaded();
    const noMail = screen.getByRole('checkbox', { name: 'Select draft for No Mail Co (Jane Doe)' });
    expect(noMail).toBeDisabled();
    expect(screen.getByText(/No contact email/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Select all (2)' }));
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('2drafts selected');
  });

  it('shows the verification status case-insensitively and lets you pick among several addresses', async () => {
    await renderLoaded();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText('Invalid')).toBeInTheDocument();

    const select = screen.getByRole('combobox', { name: 'Recipient for Personal / Direct Email' });
    expect(select).toHaveValue('bob@gmail.com');
    fireEvent.change(select, { target: { value: 'bob.stone@outlook.com' } });
    expect(select).toHaveValue('bob.stone@outlook.com');
  });

  it('toggles a card by clicking it, but not when clicking a control inside it', async () => {
    await renderLoaded();
    const checkbox = screen.getByRole('checkbox', { name: 'Select draft for Acme (Jane Doe)' });
    fireEvent.click(screen.getByRole('heading', { name: 'Acme' }));
    expect(checkbox).toBeChecked();
    fireEvent.click(screen.getAllByRole('button', { name: 'Copy email' })[0]);
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });

  it('creates a draft campaign with the full draft payload and opens the runner', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select draft for Acme (Jane Doe)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));

    const dialog = screen.getByRole('dialog', { name: 'Create campaign' });
    expect(within(dialog).getByLabelText(/Campaign name/)).toHaveValue(defaultCampaignName());
    fireEvent.change(within(dialog).getByLabelText(/Campaign name/), { target: { value: '  October push  ' } });
    fireEvent.change(within(dialog).getByLabelText('Minimum (seconds)'), { target: { value: '30' } });
    fireEvent.change(within(dialog).getByLabelText('Maximum (seconds)'), { target: { value: '90' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create and open runner' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/lead-ingestion/campaigns/camp-1'));
    expect(createCampaignApi).toHaveBeenCalledWith({
      name: 'October push',
      status: 'draft',
      minDelaySeconds: 30,
      maxDelaySeconds: 90,
      items: [
        {
          leadId: 'lead-1',
          companyIndex: 0,
          candidateName: 'Jane Doe',
          clientName: 'Jane Doe #01',
          companyName: 'Acme',
          recipientEmail: 'info@acme.io',
          subject: 'Hello Acme',
          bodyHtml: '<p>Hi Jane,</p><p>Body</p>',
        },
      ],
    });
  });

  it('saves as draft without leaving the page, clears the selection and reloads', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: 'Select all (2)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }));

    expect(await screen.findByRole('status')).toHaveTextContent('Campaign "My campaign" saved as a draft with 2 emails.');
    expect(screen.getByRole('link', { name: 'Open campaign' })).toHaveAttribute('href', '/lead-ingestion/campaigns/camp-1');
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByText('drafts selected')).not.toBeInTheDocument();
    expect(getReadyToSendLeadsApi).toHaveBeenCalledTimes(2);
  });

  it('validates the name and the delay range inside the modal', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select draft for Acme (Jane Doe)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
    const dialog = screen.getByRole('dialog', { name: 'Create campaign' });

    fireEvent.change(within(dialog).getByLabelText(/Campaign name/), { target: { value: '   ' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as draft' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter a campaign name.');

    fireEvent.change(within(dialog).getByLabelText(/Campaign name/), { target: { value: 'X' } });
    fireEvent.change(within(dialog).getByLabelText('Minimum (seconds)'), { target: { value: '600' } });
    fireEvent.change(within(dialog).getByLabelText('Maximum (seconds)'), { target: { value: '60' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create and open runner' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Minimum delay cannot be greater than maximum delay.');

    fireEvent.change(within(dialog).getByLabelText('Minimum (seconds)'), { target: { value: '' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create and open runner' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Delays must be whole numbers of seconds.');
    expect(createCampaignApi).not.toHaveBeenCalled();
  });

  it('shows a server error inside the modal and refreshes the list on a 409', async () => {
    jest.mocked(createCampaignApi).mockRejectedValueOnce(new ApiError('Already in another campaign: info@acme.io', 409));
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select draft for Acme (Jane Doe)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
    const dialog = screen.getByRole('dialog', { name: 'Create campaign' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as draft' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Already in another campaign: info@acme.io');
    await waitFor(() => expect(getReadyToSendLeadsApi).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('dialog', { name: 'Create campaign' })).toBeInTheDocument();
  });

  it('warns when a selected address was verified as invalid', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select draft for Personal / Direct Email (Bob Stone)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create campaign' }));
    expect(screen.getByText(/1 selected address was marked invalid/)).toBeInTheDocument();
  });

  it('previews the sanitized email body', async () => {
    await renderLoaded();
    fireEvent.click(screen.getAllByRole('button', { name: 'Preview email' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Hello Acme' });
    expect(within(dialog).getByText('info@acme.io')).toBeInTheDocument();
    expect(dialog.querySelector('.email-body')?.innerHTML).toContain('<!--sanitized--><p>Hi Jane,</p>');
    expect(within(dialog).getByRole('link', { name: 'Edit on lead page' })).toHaveAttribute('href', '/lead-ingestion/client/lead-1');
  });

  it('narrows the cards to drafts that match the search and clears the filters', async () => {
    await renderLoaded();
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'acme' } });
    await waitFor(() =>
      expect(getReadyToSendLeadsApi).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'acme' }),
        expect.any(AbortSignal)
      )
    );
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Personal / Direct Email' })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Acme' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByRole('heading', { name: 'Personal / Direct Email' })).toBeInTheDocument();
  });

  it('sends the date range as whole local days and rejects an inverted range', async () => {
    await renderLoaded();
    fireEvent.change(screen.getByLabelText('Imported from'), { target: { value: '2026-10-01' } });
    await waitFor(() =>
      expect(getReadyToSendLeadsApi).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: new Date(2026, 9, 1, 0, 0, 0, 0).toISOString(), to: undefined }),
        expect.any(AbortSignal)
      )
    );
    const callsBefore = jest.mocked(getReadyToSendLeadsApi).mock.calls.length;
    fireEvent.change(screen.getByLabelText('Imported until'), { target: { value: '2026-09-01' } });
    expect(screen.getByRole('alert')).toHaveTextContent('The start date must be on or before the end date.');
    expect(jest.mocked(getReadyToSendLeadsApi).mock.calls.length).toBe(callsBefore);
  });

  it('applies a custom count, clamped to the selectable drafts', async () => {
    await renderLoaded();
    fireEvent.change(screen.getByLabelText('Select first'), { target: { value: '99' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('2drafts selected');
    expect(screen.getByLabelText('Select first')).toHaveValue(2);
    expect(screen.queryByRole('button', { name: /First 10/ })).not.toBeInTheDocument();
  });

  it('loads more leads and appends them', async () => {
    jest.mocked(getReadyToSendLeadsApi).mockResolvedValueOnce(page({ total: 3, hasMore: true }));
    jest.mocked(getReadyToSendLeadsApi).mockResolvedValueOnce(
      page({
        leads: [lead({ _id: 'lead-3', fullName: 'Cara Li', email: 'cara@li.io', emailSubject: 'Hello Cara', emailBody: '<p>x</p>', approved: true })],
        total: 3,
        page: 2,
        hasMore: false,
      })
    );
    await renderLoaded();
    fireEvent.click(screen.getByRole('button', { name: /Load more leads/ }));
    expect(await screen.findByText('Cara Li')).toBeInTheDocument();
    expect(getReadyToSendLeadsApi).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2 }), expect.any(AbortSignal));
    expect(screen.getByTestId('draft-count')).toHaveTextContent('4 drafts from 3 of 3 leads');
    expect(screen.queryByRole('button', { name: /Load more leads/ })).not.toBeInTheDocument();
  });

  it('shows the list error with a retry button', async () => {
    jest.mocked(getReadyToSendLeadsApi).mockRejectedValueOnce(new Error('boom'));
    render(<ApprovedEmailsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Acme' })).toBeInTheDocument();
  });

  it('shows an empty state that points to the Drafts page', async () => {
    jest.mocked(getReadyToSendLeadsApi).mockResolvedValueOnce(page({ leads: [], total: 0 }));
    render(<ApprovedEmailsPage />);
    expect(await screen.findByText('Nothing is waiting to be sent.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Drafts' })).toHaveAttribute('href', '/lead-ingestion/emails');
  });
});

describe('helpers', () => {
  it('matchesSearch needs every word somewhere on the draft itself', () => {
    const item = {
      id: 'x',
      leadId: 'l',
      companyIndex: 0,
      candidateName: 'Jane Doe',
      clientName: 'Jane Doe #01',
      companyName: 'Acme Robotics',
      jobTitle: 'CTO',
      emails: ['info@acme.io'],
      subject: 'Quick question',
      bodyHtml: '',
    };
    expect(matchesSearch(item, 'acme jane')).toBe(true);
    expect(matchesSearch(item, 'ACME.io')).toBe(true);
    expect(matchesSearch(item, 'acme bob')).toBe(false);
  });

  it('localDayBounds covers whole local days and validates the range', () => {
    const bounds = localDayBounds('2026-10-14', '2026-10-14');
    expect(bounds.error).toBeNull();
    expect(bounds.from).toBe(new Date(2026, 9, 14, 0, 0, 0, 0).toISOString());
    expect(bounds.to).toBe(new Date(2026, 9, 14, 23, 59, 59, 999).toISOString());
    expect(localDayBounds('', '')).toEqual({ from: undefined, to: undefined, error: null });
    expect(localDayBounds('2026-02-30', '').error).toBe('Enter a valid date.');
    expect(localDayBounds('2026-10-15', '2026-10-14').error).toBe('The start date must be on or before the end date.');
  });

  it('defaultCampaignName uses the local date and time', () => {
    expect(defaultCampaignName(new Date(2026, 9, 14, 9, 5))).toBe('Campaign 2026-10-14 09:05');
  });
});
