import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DraftsPage from '../DraftsPage';
import { fetchClients, fetchDraft, fetchDrafts, patchDraft } from '../draftsApi';
import type { DraftItem } from '@/services/lead-ingestion/draftItems';

jest.mock('../draftsApi', () => ({
  fetchDrafts: jest.fn(),
  fetchClients: jest.fn(),
  patchDraft: jest.fn(),
  fetchDraft: jest.fn(),
  mutateDraftEmail: jest.fn(),
  crawlDraftWebsite: jest.fn(),
  refineDraft: jest.fn(),
}));

const replace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

class FakeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}
globalThis.IntersectionObserver = FakeObserver as unknown as typeof IntersectionObserver;

function item(overrides: Partial<DraftItem> = {}): DraftItem {
  return {
    id: 'lead1:-1',
    leadId: 'lead1',
    companyIndex: -1,
    clientId: 'client1',
    clientName: 'Abdul Wadood #24',
    serial: '#24',
    candidateName: 'Abdul Wadood',
    companyName: 'Personal / Direct Email',
    jobTitle: 'Founder',
    subject: 'MantiqSoft SaaS and Web3 work?',
    bodyHtml: '<p>Hi Abdul,</p>',
    approved: false,
    targetEmail: 'abdul@gmail.com',
    emailCount: 2,
    smtpStatus: 'valid',
    sendStatus: 'pending',
    inCampaign: false,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    ...overrides,
  };
}

const counts = { total: 3, approved: 1, draft: 2, valid: 2, unverified: 1, invalid: 0, no_contact_email: 0 };

function listResponse(items: DraftItem[], extra: Record<string, unknown> = {}) {
  return {
    items,
    total: items.length,
    page: 1,
    limit: 12,
    pages: 1,
    hasMore: false,
    counts,
    truncated: false,
    ...extra,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchClients).mockResolvedValue({ clients: [{ _id: 'client1', name: 'Abdul Wadood #24' }], hasMore: false });
  jest.mocked(fetchDrafts).mockResolvedValue(
    listResponse([item(), item({ id: 'lead1:0', companyIndex: 0, companyName: 'MantiqSoft', subject: 'Company subject line' })])
  );
  jest.mocked(fetchDraft).mockResolvedValue({
    draft: {
      ...item(),
      emails: [{ email: 'abdul@gmail.com', status: 'valid' }],
      websiteUrl: null,
      leadSummary: null,
      roleSummary: null,
      canEdit: true,
    },
  });
});

describe('DraftsPage', () => {
  it('lists one card per draft with its contact email and client', async () => {
    render(<DraftsPage />);
    expect(await screen.findByText('MantiqSoft SaaS and Web3 work?')).toBeInTheDocument();
    expect(screen.getByText('Company subject line')).toBeInTheDocument();
    expect(screen.getAllByText('abdul@gmail.com')).toHaveLength(2);
    expect(screen.getAllByText((_, element) => element?.textContent?.includes('Abdul Wadood #24') ?? false).length).toBeGreaterThan(0);
    expect(screen.getByText('Showing 2 of 2 drafts')).toBeInTheDocument();
  });

  it('asks the server for drafts only by default and keeps filters in the URL', async () => {
    render(<DraftsPage />);
    await waitFor(() => expect(fetchDrafts).toHaveBeenCalled());
    expect(jest.mocked(fetchDrafts).mock.calls[0][0]).toMatchObject({
      page: 1,
      approval: 'draft',
      smtp: 'all',
      sendStatus: 'all',
    });
    expect(replace).toHaveBeenCalled();
  });

  it('refetches with the chosen SMTP filter instead of an unknown status', async () => {
    render(<DraftsPage />);
    await screen.findByText('Showing 2 of 2 drafts');

    fireEvent.click(screen.getByRole('button', { name: /Email status/ }));
    fireEvent.click(await screen.findByRole('option', { name: /Not verified/ }));

    await waitFor(() =>
      expect(jest.mocked(fetchDrafts).mock.calls.at(-1)?.[0]).toMatchObject({ smtp: 'unverified' })
    );
  });

  it('shows how many drafts each filter holds', async () => {
    render(<DraftsPage />);
    await screen.findByText('Showing 2 of 2 drafts');
    fireEvent.click(screen.getByRole('button', { name: /Approval/ }));
    expect(await screen.findByRole('option', { name: 'Drafts (2)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Approved (1)' })).toBeInTheDocument();
  });

  it('offers a retry when loading fails', async () => {
    jest.mocked(fetchDrafts).mockRejectedValueOnce(new Error('Server exploded'));
    render(<DraftsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Server exploded');
    jest.mocked(fetchDrafts).mockResolvedValueOnce(listResponse([item()]));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Showing 1 of 1 draft')).toBeInTheDocument();
  });

  it('shows an empty state with a reset when filters match nothing', async () => {
    jest.mocked(fetchDrafts).mockResolvedValue(listResponse([]));
    render(<DraftsPage />);
    expect(await screen.findByText('No drafts match these filters')).toBeInTheDocument();
  });

  it('approves from the card and moves the draft out of the Drafts filter', async () => {
    jest.mocked(patchDraft).mockResolvedValue({
      draft: {
        ...item({ approved: true }),
        emails: [{ email: 'abdul@gmail.com', status: 'valid' }],
        websiteUrl: null,
        leadSummary: null,
        roleSummary: null,
        canEdit: true,
      },
    });

    render(<DraftsPage />);
    await screen.findByText('Showing 2 of 2 drafts');

    const card = screen.getAllByRole('button', { name: 'Approve' })[0];
    fireEvent.click(card);

    await waitFor(() => expect(patchDraft).toHaveBeenCalledWith('lead1', -1, { approved: true }));
    expect(await screen.findByRole('status')).toHaveTextContent('moved to Ready to Send');
  });

  it('surfaces the server reason when approval is refused', async () => {
    jest.mocked(patchDraft).mockRejectedValue(new Error('Verify or remove these addresses before approving: b@x.com.'));
    render(<DraftsPage />);
    await screen.findByText('Showing 2 of 2 drafts');

    fireEvent.click(screen.getAllByRole('button', { name: 'Approve' })[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('b@x.com');
  });

  it('cannot approve a draft whose address is not verified', async () => {
    jest.mocked(fetchDrafts).mockResolvedValue(listResponse([item({ smtpStatus: 'pending' })]));
    render(<DraftsPage />);
    await screen.findByText('Showing 1 of 1 draft');
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });

  it('warns when the search only covered part of the database', async () => {
    jest.mocked(fetchDrafts).mockResolvedValue(listResponse([item()], { truncated: true }));
    render(<DraftsPage />);
    expect(await screen.findByText(/Only the newest 1000 leads were searched/)).toBeInTheDocument();
  });

  it('opens the editor for a card', async () => {
    render(<DraftsPage />);
    await screen.findByText('Showing 2 of 2 drafts');
    fireEvent.click(screen.getAllByRole('button', { name: /Open/ })[0]);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Abdul Wadood')).toBeInTheDocument();
  });
});
