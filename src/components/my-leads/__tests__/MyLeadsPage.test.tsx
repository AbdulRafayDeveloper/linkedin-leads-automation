import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MyLeadsPage from '../MyLeadsPage';
import type { LeadCardRecord } from '@/lib/leads/cards';

const replace = jest.fn();
let currentSearch = '';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: jest.fn(), prefetch: jest.fn() }),
  usePathname: () => '/my-leads',
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

function lead(overrides: Partial<LeadCardRecord> = {}): LeadCardRecord {
  return {
    _id: '650000000000000000000001',
    clientName: 'Jake Cook #01',
    fullName: 'Jake Cook',
    companyName: null,
    jobTitle: null,
    email: 'jake@steadmanchase.com',
    verifiedEmails: [{ email: 'jake@steadmanchase.com', status: 'valid' }],
    createdAt: '2026-10-14T08:00:00.000Z',
    currentCompanies: [],
    ...overrides,
  };
}

function listResponse(leads: LeadCardRecord[], extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    json: async () => ({
      success: true,
      leads,
      total: leads.length,
      hasMore: false,
      clients: [{ id: 'c1', name: 'Jake Cook #01' }],
      ...extra,
    }),
  };
}

const fetchMock = jest.fn();

beforeEach(() => {
  currentSearch = '';
  replace.mockClear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(listResponse([lead()]));
  global.fetch = fetchMock as unknown as typeof fetch;
});

const listCalls = () =>
  fetchMock.mock.calls.filter(([url]) => typeof url === 'string' && url.startsWith('/api/leads?'));

describe('MyLeadsPage loading', () => {
  it('asks the server once on mount, for the card view', async () => {
    render(<MyLeadsPage />);
    await screen.findByText('Jake Cook');
    expect(listCalls()).toHaveLength(1);
    expect(listCalls()[0][0]).toContain('view=cards');
  });

  it('shows the whole email address, its status and the real total', async () => {
    fetchMock.mockResolvedValue(listResponse([lead()], { total: 51, hasMore: true }));
    render(<MyLeadsPage />);

    expect(await screen.findByText('jake@steadmanchase.com')).toBeInTheDocument();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 51 leads')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
  });

  it('never invents a company box for a lead with no company', async () => {
    render(<MyLeadsPage />);
    await screen.findByText('Jake Cook');
    expect(screen.getByText(/no company captured/i)).toBeInTheDocument();
    expect(screen.queryByText('Corporate Profile')).not.toBeInTheDocument();
    expect(screen.queryByText('Professional')).not.toBeInTheDocument();
  });

  it('marks an address that was never checked instead of borrowing a status', async () => {
    fetchMock.mockResolvedValue(
      listResponse([
        lead({
          discoveredEmails: ['jake@steadmanchase.com', 'other@steadmanchase.com'],
        }),
      ])
    );
    render(<MyLeadsPage />);
    await screen.findByText('other@steadmanchase.com');
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText('Not checked')).toBeInTheDocument();
  });

  it('folds a long list of addresses so one card cannot run away', async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 8 }, (_, i) => `person${i}@acme.com`);
    fetchMock.mockResolvedValue(listResponse([lead({ email: null, discoveredEmails: many })]));
    render(<MyLeadsPage />);

    expect(await screen.findByText('person0@acme.com')).toBeInTheDocument();
    expect(screen.queryByText('person7@acme.com')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show 3 more addresses/i }));
    expect(screen.getByText('person7@acme.com')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show fewer/i }));
    expect(screen.queryByText('person7@acme.com')).not.toBeInTheDocument();
  });

  it('labels every checkbox', async () => {
    render(<MyLeadsPage />);
    await screen.findByText('Jake Cook');
    expect(screen.getByRole('checkbox', { name: 'Select Jake Cook' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /select all/i })).toBeInTheDocument();
  });
});

describe('MyLeadsPage filtering', () => {
  it('debounces typing into one request and puts it in the URL', async () => {
    const user = userEvent.setup();
    render(<MyLeadsPage />);
    await screen.findByText('Jake Cook');

    await user.type(screen.getByLabelText('Search'), 'jane');

    await waitFor(() => expect(listCalls()).toHaveLength(2), { timeout: 3000 });
    expect(listCalls()[1][0]).toContain('search=jane');
    expect(replace).toHaveBeenCalledWith('/my-leads?q=jane', { scroll: false });
  });

  it('starts from the filters in the URL', async () => {
    currentSearch = 'q=ana&status=missing_or_unverified';
    render(<MyLeadsPage />);
    await screen.findByText('Jake Cook');
    const url = listCalls()[0][0] as string;
    expect(url).toContain('search=ana');
    expect(url).toContain('emailStatus=missing_or_unverified');
  });

  it('refuses a backwards custom range, explains why and does not refetch', async () => {
    const user = userEvent.setup();
    currentSearch = 'range=custom&from=2027-01-01&to=2020-01-01';
    render(<MyLeadsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/on or before/i);
    expect(listCalls()).toHaveLength(0);

    // Fixing the range lets it load.
    await user.clear(screen.getByLabelText('From'));
    await user.type(screen.getByLabelText('From'), '2020-01-01');
    await waitFor(() => expect(listCalls().length).toBeGreaterThan(0));
  });

  it('offers a way out when filters match nothing', async () => {
    currentSearch = 'q=zzz';
    fetchMock.mockResolvedValue(listResponse([], { total: 0 }));
    render(<MyLeadsPage />);

    expect(await screen.findByText('No leads match these filters')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /clear filters/i }).length).toBeGreaterThan(0);
  });

  it('invites an import when there are no leads at all', async () => {
    fetchMock.mockResolvedValue(listResponse([], { total: 0 }));
    render(<MyLeadsPage />);

    expect(await screen.findByText('No leads yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /import your first lead/i })).toBeInTheDocument();
  });
});

describe('MyLeadsPage deleting', () => {
  it('confirms first, then reports what was removed', async () => {
    const user = userEvent.setup();
    render(<MyLeadsPage />);
    await screen.findByText('Jake Cook');

    await user.click(screen.getByRole('checkbox', { name: 'Select Jake Cook' }));
    await user.click(screen.getByRole('button', { name: /delete 1/i }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        deletedCount: 1,
        removedCampaignItems: 2,
        removedClients: 1,
      }),
    });
    fetchMock.mockResolvedValueOnce(listResponse([], { total: 0 }));

    await user.click(within(dialog).getByRole('button', { name: /delete 1 lead/i }));

    await waitFor(() =>
      expect(screen.getByText(/1 lead deleted/i, { selector: 'p' })).toHaveTextContent(
        '2 campaign email(s) removed · 1 empty client(s) cleaned up'
      )
    );
    const deleteCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'DELETE');
    expect(JSON.parse(deleteCall![1].body)).toEqual({ ids: ['650000000000000000000001'] });
  });

  it('cancels without deleting anything', async () => {
    const user = userEvent.setup();
    render(<MyLeadsPage />);
    await screen.findByText('Jake Cook');

    await user.click(screen.getByRole('button', { name: 'Delete Jake Cook' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
  });

  it('reports a failed delete instead of claiming success', async () => {
    const user = userEvent.setup();
    render(<MyLeadsPage />);
    await screen.findByText('Jake Cook');

    await user.click(screen.getByRole('button', { name: 'Delete Jake Cook' }));
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ success: false, error: 'Failed to delete leads' }),
    });
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: /delete lead/i })
    );

    expect(await screen.findByText('Failed to delete leads')).toBeInTheDocument();
    // The row is still there, and the dialog stays open so the delete can be retried.
    expect(screen.getByRole('heading', { name: 'Jake Cook' })).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('MyLeadsPage failures', () => {
  it('keeps the rows on screen and offers a retry', async () => {
    const user = userEvent.setup();
    render(<MyLeadsPage />);
    await screen.findByText('Jake Cook');

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ success: false, error: 'Failed to fetch leads' }),
    });
    await user.click(screen.getByRole('button', { name: /refresh/i }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to fetch leads');
    expect(alert).toHaveTextContent(/last results that loaded/i);
    expect(screen.getByText('Jake Cook')).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(listResponse([lead()]));
    await user.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
