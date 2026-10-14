import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LeadIngestionPage from '../LeadIngestionPage';
import type { IngestionPreview } from '@/services/lead-ingestion/intakeApi';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const previewLeadApi = jest.fn();
const confirmLeadApi = jest.fn();
jest.mock('@/services/lead-ingestion/intakeApi', () => {
  const actual = jest.requireActual('@/services/lead-ingestion/intakeApi');
  return {
    ...actual,
    previewLeadApi: (...args: unknown[]) => previewLeadApi(...args),
    confirmLeadApi: (...args: unknown[]) => confirmLeadApi(...args),
  };
});

const PROFILE = 'Priya Nandakumar\nVP Engineering at Solstice Robotics\nMelbourne, Australia';

const preview: IngestionPreview = {
  extraction: {
    usedFallback: false,
    fullName: 'Priya Nandakumar',
    personSummary: 'VP Engineering at Solstice Robotics.',
    currentCompanies: [
      {
        companyName: 'Solstice Robotics',
        jobTitle: 'VP Engineering',
        workPeriod: null,
        websiteUrl: 'https://solstice-robotics.com',
        roleSummary: '',
      },
    ],
    rawUrls: ['https://solstice-robotics.com'],
    rawEmails: ['priya@solstice-robotics.com'],
    rawPhones: [],
  },
  warnings: [],
  summary: {
    fullName: 'Priya Nandakumar',
    companies: [
      { companyName: 'Solstice Robotics', jobTitle: 'VP Engineering', websiteUrl: 'https://solstice-robotics.com' },
    ],
    emails: ['priya@solstice-robotics.com'],
    phones: [],
    urls: ['https://solstice-robotics.com'],
  },
  duplicate: null,
};

const textarea = () => screen.getByLabelText('Profile text');
const extractButton = () => screen.getByRole('button', { name: /extract details/i });

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  previewLeadApi.mockResolvedValue(preview);
  confirmLeadApi.mockResolvedValue({ leadId: 'lead-1', clientId: 'c1', clientName: 'Priya Nandakumar #01', warnings: [] });
});

describe('New Lead page', () => {
  it('labels the textarea and shows the character limit', () => {
    render(<LeadIngestionPage />);
    expect(textarea()).toBeInTheDocument();
    expect(screen.getByText(/0 \/ 50,000/)).toBeInTheDocument();
  });

  it('keeps the extract button disabled until something is typed', async () => {
    render(<LeadIngestionPage />);
    expect(extractButton()).toBeDisabled();
    await userEvent.type(textarea(), 'hello');
    expect(extractButton()).toBeEnabled();
  });

  it('explains why short or meaningless text is refused, instead of doing nothing', async () => {
    render(<LeadIngestionPage />);
    await userEvent.type(textarea(), 'x y z');
    await userEvent.click(extractButton());

    expect(await screen.findByText(/too short for a profile/i)).toBeInTheDocument();
    expect(previewLeadApi).not.toHaveBeenCalled();
    expect(textarea()).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows what was found and saves nothing until confirmed', async () => {
    render(<LeadIngestionPage />);
    await userEvent.type(textarea(), PROFILE);
    await userEvent.click(extractButton());

    expect(await screen.findByText('Check what was found')).toBeInTheDocument();
    expect(screen.getByText('Priya Nandakumar')).toBeInTheDocument();
    expect(screen.getAllByText(/Solstice Robotics/).length).toBeGreaterThan(0);
    expect(confirmLeadApi).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /save lead/i }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/lead-ingestion/client/lead-1'));
  });

  it('can go back to editing with the text still there', async () => {
    render(<LeadIngestionPage />);
    await userEvent.type(textarea(), PROFILE);
    await userEvent.click(extractButton());
    await screen.findByText('Check what was found');

    await userEvent.click(screen.getByRole('button', { name: /back to editing/i }));

    expect(textarea()).toHaveValue(PROFILE);
  });

  it('warns about a profile that is already saved and offers both choices', async () => {
    previewLeadApi.mockResolvedValue({
      ...preview,
      duplicate: {
        leadId: 'old-1',
        clientName: 'Priya Nandakumar #01',
        fullName: 'Priya Nandakumar',
        createdAt: '2026-10-01T09:00:00.000Z',
      },
    });
    render(<LeadIngestionPage />);
    await userEvent.type(textarea(), PROFILE);
    await userEvent.click(extractButton());

    const banner = await screen.findByText('This profile is already saved');
    const panel = banner.closest('div[role="alert"]') as HTMLElement;
    expect(within(panel).getByRole('link', { name: /open the existing lead/i })).toHaveAttribute(
      'href',
      '/lead-ingestion/client/old-1'
    );

    await userEvent.click(within(panel).getByRole('button', { name: /import again anyway/i }));
    await waitFor(() => expect(confirmLeadApi).toHaveBeenCalledWith(expect.objectContaining({ force: true }), expect.anything()));
  });

  it('surfaces extraction warnings before saving', async () => {
    previewLeadApi.mockResolvedValue({ ...preview, warnings: ['No email address in the text.'] });
    render(<LeadIngestionPage />);
    await userEvent.type(textarea(), PROFILE);
    await userEvent.click(extractButton());

    expect(await screen.findByText('No email address in the text.')).toBeInTheDocument();
  });

  it('shows a dismissible error with a retry when extraction fails', async () => {
    previewLeadApi.mockRejectedValue(new Error('Could not reach the server. Check your connection and try again.'));
    render(<LeadIngestionPage />);
    await userEvent.type(textarea(), PROFILE);
    await userEvent.click(extractButton());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not reach the server/i);
    expect(within(alert).getByRole('button', { name: /try again/i })).toBeInTheDocument();

    await userEvent.click(within(alert).getByRole('button', { name: /dismiss message/i }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    // the pasted text survives a failure
    expect(textarea()).toHaveValue(PROFILE);
  });

  it('lets the user cancel a slow extraction', async () => {
    let abortSignal: AbortSignal | undefined;
    previewLeadApi.mockImplementation(
      (_text: string, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          abortSignal = signal;
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        })
    );

    render(<LeadIngestionPage />);
    await userEvent.type(textarea(), PROFILE);
    await userEvent.click(extractButton());

    const cancel = await screen.findByRole('button', { name: /^cancel$/i });
    await userEvent.click(cancel);

    expect(abortSignal?.aborted).toBe(true);
    expect(await screen.findByText(/Extraction stopped/i)).toBeInTheDocument();
    expect(extractButton()).toBeEnabled();
  });

  it('keeps a draft across a remount and clears it after saving', async () => {
    const { unmount } = render(<LeadIngestionPage />);
    await userEvent.type(textarea(), PROFILE);
    unmount();

    render(<LeadIngestionPage />);
    await waitFor(() => expect(textarea()).toHaveValue(PROFILE));

    await userEvent.click(extractButton());
    await screen.findByText('Check what was found');
    await userEvent.click(screen.getByRole('button', { name: /save lead/i }));

    await waitFor(() => expect(sessionStorage.getItem('leadforge:new-lead-draft')).toBeNull());
  });

  it('submits with Ctrl+Enter', async () => {
    render(<LeadIngestionPage />);
    await userEvent.type(textarea(), PROFILE);
    await userEvent.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(previewLeadApi).toHaveBeenCalled());
  });

  it('links to drafts without nesting a button inside a link', () => {
    render(<LeadIngestionPage />);
    const link = screen.getByRole('link', { name: /view drafts/i });
    expect(link).toHaveAttribute('href', '/lead-ingestion/emails');
    expect(link.querySelector('button')).toBeNull();
  });
});
