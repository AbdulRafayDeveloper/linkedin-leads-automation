import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DraftEditorModal from '../DraftEditorModal';
import { crawlDraftWebsite, fetchDraft, mutateDraftEmail, patchDraft, refineDraft } from '../draftsApi';
import type { DraftDetail, DraftItem } from '@/services/lead-ingestion/draftItems';

jest.mock('../draftsApi', () => ({
  fetchDraft: jest.fn(),
  patchDraft: jest.fn(),
  mutateDraftEmail: jest.fn(),
  crawlDraftWebsite: jest.fn(),
  refineDraft: jest.fn(),
}));

const item: DraftItem = {
  id: 'lead1:0',
  leadId: 'lead1',
  companyIndex: 0,
  clientId: 'client1',
  clientName: 'Abdul Wadood #24',
  serial: '#24',
  candidateName: 'Abdul Wadood',
  companyName: 'MantiqSoft',
  jobTitle: 'CEO',
  subject: 'Company subject',
  bodyHtml: '<p>Hi Abdul,</p>',
  approved: false,
  targetEmail: 'info@mantiqsoft.com',
  emailCount: 1,
  smtpStatus: 'pending',
  sendStatus: 'pending',
  inCampaign: false,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
};

function detail(overrides: Partial<DraftDetail> = {}): DraftDetail {
  return {
    ...item,
    emails: [{ email: 'info@mantiqsoft.com', status: 'pending' }],
    websiteUrl: 'https://mantiqsoft.com',
    leadSummary: 'Founder and CEO of MantiqSoft.',
    roleSummary: 'Runs delivery.',
    canEdit: true,
    ...overrides,
  };
}

const noop = () => undefined;

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fetchDraft).mockResolvedValue({ draft: detail() });
});

describe('DraftEditorModal', () => {
  it('loads the stored draft when it opens instead of trusting the list', async () => {
    jest.mocked(fetchDraft).mockResolvedValue({
      draft: detail({ subject: 'Subject from the database' }),
    });
    render(<DraftEditorModal item={item} onClose={noop} onSaved={noop} />);

    await waitFor(() => expect(fetchDraft).toHaveBeenCalledWith('lead1', 0, expect.anything()));
    expect(await screen.findByDisplayValue('Subject from the database')).toBeInTheDocument();
    expect(screen.getByText('Founder and CEO of MantiqSoft.')).toBeInTheDocument();
  });

  it('blocks approval while an address is unverified and explains why', async () => {
    render(<DraftEditorModal item={item} onClose={noop} onSaved={noop} />);
    await screen.findByDisplayValue('Company subject');
    const approve = screen.getByRole('button', { name: 'Approve draft' });

    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute('title', expect.stringContaining('info@mantiqsoft.com'));
  });

  it('allows approval once every address is sendable', async () => {
    jest.mocked(fetchDraft).mockResolvedValue({
      draft: detail({ emails: [{ email: 'info@mantiqsoft.com', status: 'risky' }] }),
    });
    jest.mocked(patchDraft).mockResolvedValue({ draft: detail({ approved: true }) });

    render(<DraftEditorModal item={item} onClose={noop} onSaved={noop} />);
    await screen.findByDisplayValue('Company subject');
    fireEvent.click(screen.getByRole('button', { name: 'Approve draft' }));

    await waitFor(() =>
      expect(patchDraft).toHaveBeenCalledWith('lead1', 0, expect.objectContaining({ approved: true }))
    );
  });

  it('really verifies a company address and reports the result', async () => {
    jest.mocked(mutateDraftEmail).mockResolvedValue({
      draft: detail({ emails: [{ email: 'info@mantiqsoft.com', status: 'invalid' }] }),
      status: 'invalid',
    });

    render(<DraftEditorModal item={item} onClose={noop} onSaved={noop} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Verify' }));

    await waitFor(() =>
      expect(mutateDraftEmail).toHaveBeenCalledWith('lead1', 0, 'verify', 'info@mantiqsoft.com', undefined)
    );
    expect(await screen.findByText(/does not exist/)).toBeInTheDocument();
  });

  it('refuses an invalid new address before calling the server', async () => {
    render(<DraftEditorModal item={item} onClose={noop} onSaved={noop} />);
    fireEvent.click(await screen.findByRole('button', { name: /Add email/ }));

    const input = screen.getByLabelText('New contact email');
    fireEvent.change(input, { target: { value: 'not-an-email' } });

    expect(screen.getByRole('button', { name: /Add and verify/ })).toBeDisabled();
    expect(screen.getByText(/Enter a valid address/)).toBeInTheDocument();
    expect(mutateDraftEmail).not.toHaveBeenCalled();
  });

  it('will not crawl a URL that is not a public website', async () => {
    render(<DraftEditorModal item={item} onClose={noop} onSaved={noop} />);
    const url = await screen.findByLabelText('Website URL');
    fireEvent.change(url, { target: { value: 'not a url' } });
    fireEvent.click(screen.getByRole('button', { name: /Save and crawl/ }));

    expect(await screen.findByText(/Enter a valid website URL/)).toBeInTheDocument();
    expect(crawlDraftWebsite).not.toHaveBeenCalled();
  });

  it('saves subject and body together', async () => {
    jest.mocked(patchDraft).mockResolvedValue({ draft: detail({ subject: 'Edited subject' }) });
    render(<DraftEditorModal item={item} onClose={noop} onSaved={noop} />);

    const subject = await screen.findByLabelText('Subject');
    fireEvent.change(subject, { target: { value: 'Edited subject' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(patchDraft).toHaveBeenCalledWith('lead1', 0, {
        subject: 'Edited subject',
        bodyHtml: '<p>Hi Abdul,</p>',
      })
    );
    expect(await screen.findByText('Draft saved')).toBeInTheDocument();
  });

  it('asks before throwing away unsaved edits', async () => {
    const onClose = jest.fn();
    const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);

    render(<DraftEditorModal item={item} onClose={onClose} onSaved={noop} />);
    fireEvent.change(await screen.findByLabelText('Subject'), { target: { value: 'Changed' } });
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(confirmSpy).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('locks a draft that is already in a campaign', async () => {
    jest.mocked(fetchDraft).mockResolvedValue({
      draft: detail({ canEdit: false, sendStatus: 'delivered', inCampaign: true }),
    });

    render(<DraftEditorModal item={item} onClose={noop} onSaved={noop} />);

    expect(await screen.findByText(/in a campaign, so its content and contacts are locked/)).toBeInTheDocument();
    expect(screen.getByLabelText('Subject')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Verify' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Rewrite/ })).not.toBeInTheDocument();
  });

  it('rewrites with AI and reloads the stored draft', async () => {
    jest.mocked(refineDraft).mockResolvedValue(undefined);
    jest.mocked(fetchDraft)
      .mockResolvedValueOnce({ draft: detail() })
      .mockResolvedValueOnce({ draft: detail({ subject: 'AI rewritten subject' }) });

    render(<DraftEditorModal item={item} onClose={noop} onSaved={noop} />);
    fireEvent.change(await screen.findByLabelText('Rewrite with AI'), { target: { value: 'make it shorter' } });
    fireEvent.click(screen.getByRole('button', { name: /Rewrite/ }));

    await waitFor(() => expect(refineDraft).toHaveBeenCalledWith('lead1', 0, 'make it shorter'));
    expect(await screen.findByDisplayValue('AI rewritten subject')).toBeInTheDocument();
  });

  it('shows the dialog with an accessible name and a close button', async () => {
    render(<DraftEditorModal item={item} onClose={noop} onSaved={noop} />);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
