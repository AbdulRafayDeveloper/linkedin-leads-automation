import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LeadDetailsModal from '../LeadDetailsModal';
import { deleteLeadApi, enrichLeadApi, fetchLead, updateLeadApi } from '@/lib/api/client';
import type { LeadRecord } from '@/lib/types/lead';

jest.mock('@/lib/api/client', () => ({
  updateLeadApi: jest.fn(),
  deleteLeadApi: jest.fn(),
  enrichLeadApi: jest.fn(),
  fetchLead: jest.fn(),
}));

const lead: LeadRecord = {
  _id: '1',
  fullName: 'Gus Gollings',
  linkedinProfileUrl: null,
  headline: null,
  currentTitle: 'Head of Growth',
  currentCompany: 'Northwind Robotics',
  currentCompanyLinkedInUrl: null,
  currentCompanyWebsite: null,
  currentCompanyLocation: null,
  location: 'San Francisco',
  currentRoleStartDate: null,
  about: null,
  experience: [],
  education: [],
  skills: [],
  recentActivity: [],
  email: 'gus@northwindrobotics.com',
  emailSource: 'LINKEDIN',
  emailConfidence: 'HIGH',
  validationStatus: 'PASS',
  validationDetails: null,
  personalizationSignals: {},
  emailSubject: 'Hello Gus',
  emailBody: 'Gus, hello there.',
  approvalStatus: 'PENDING',
  processingStatus: 'COMPLETE',
  sentStatus: 'NOT_SENT',
  errorMessage: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  sentAt: null,
  processingTimeMs: 1000,
  sourceText: null,
  emails: [
    {
      email: 'gus@northwindrobotics.com',
      source: 'LEAD_PROFILE',
      sourceUrl: null,
      emailType: 'PERSONAL',
      validationStatus: 'valid',
      validationDetails: null,
      discoveredAt: new Date().toISOString(),
      validatedAt: new Date().toISOString(),
    },
  ],
  websiteStatus: 'found',
  crawlStatus: 'completed',
  emailDiscoveryStatus: 'emails_found',
  enrichmentStatus: 'COMPLETED',
  enrichmentError: null,
};

describe('LeadDetailsModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders lead details and editable fields', () => {
    render(<LeadDetailsModal lead={lead} onClose={jest.fn()} onUpdated={jest.fn()} onDeleted={jest.fn()} />);
    expect(screen.getByText('Gus Gollings')).toBeInTheDocument();
    expect(screen.getByDisplayValue('gus@northwindrobotics.com')).toBeInTheDocument();
  });

  it('saves changes and calls onUpdated', async () => {
    (updateLeadApi as jest.Mock).mockResolvedValue({ lead: { ...lead, approvalStatus: 'APPROVED' } });
    const onUpdated = jest.fn();
    render(<LeadDetailsModal lead={lead} onClose={jest.fn()} onUpdated={onUpdated} onDeleted={jest.fn()} />);
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(onUpdated).toHaveBeenCalled());
  });

  it('shows an error message when saving fails', async () => {
    (updateLeadApi as jest.Mock).mockRejectedValue(new Error('Network error'));
    render(<LeadDetailsModal lead={lead} onClose={jest.fn()} onUpdated={jest.fn()} onDeleted={jest.fn()} />);
    fireEvent.click(screen.getByText('Save changes'));
    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
  });

  it('requires confirmation before deleting', async () => {
    (deleteLeadApi as jest.Mock).mockResolvedValue({ lead });
    const onDeleted = jest.fn();
    render(<LeadDetailsModal lead={lead} onClose={jest.fn()} onUpdated={jest.fn()} onDeleted={onDeleted} />);
    fireEvent.click(screen.getByText('Delete lead'));
    expect(screen.getByText('Confirm delete')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Confirm delete'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith('1'));
  });

  it('closes the modal when the close button is clicked', () => {
    const onClose = jest.fn();
    render(<LeadDetailsModal lead={lead} onClose={onClose} onUpdated={jest.fn()} onDeleted={jest.fn()} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('lists discovered emails with their validation status and source', () => {
    const leadWithEmails: LeadRecord = {
      ...lead,
      emails: [
        ...lead.emails,
        {
          email: 'sales@northwindrobotics.com',
          source: 'COMPANY_WEBSITE',
          sourceUrl: 'https://northwindrobotics.com/contact',
          emailType: 'SALES',
          validationStatus: 'invalid',
          validationDetails: null,
          discoveredAt: new Date().toISOString(),
          validatedAt: new Date().toISOString(),
        },
      ],
    };
    render(<LeadDetailsModal lead={leadWithEmails} onClose={jest.fn()} onUpdated={jest.fn()} onDeleted={jest.fn()} />);
    expect(screen.getByText('sales@northwindrobotics.com')).toBeInTheDocument();
    expect(screen.getByText(/Invalid/)).toBeInTheDocument();
    expect(screen.getByText(/https:\/\/northwindrobotics\.com\/contact/)).toBeInTheDocument();
  });

  it('shows an in-progress enrichment status and disables re-run while active', () => {
    const enrichingLead: LeadRecord = { ...lead, enrichmentStatus: 'CRAWLING' };
    render(<LeadDetailsModal lead={enrichingLead} onClose={jest.fn()} onUpdated={jest.fn()} onDeleted={jest.fn()} />);
    expect(screen.getByText(/Crawling company website/)).toBeInTheDocument();
    expect(screen.getByText('Re-run enrichment')).toBeDisabled();
  });

  it('shows the enrichment error when enrichment failed', () => {
    const failedLead: LeadRecord = {
      ...lead,
      enrichmentStatus: 'FAILED',
      enrichmentError: 'Website unreachable',
    };
    render(<LeadDetailsModal lead={failedLead} onClose={jest.fn()} onUpdated={jest.fn()} onDeleted={jest.fn()} />);
    expect(screen.getByText(/Website unreachable/)).toBeInTheDocument();
  });

  it('re-runs enrichment and reports the updated lead', async () => {
    (enrichLeadApi as jest.Mock).mockResolvedValue({ lead: { ...lead, enrichmentStatus: 'QUEUED' } });
    const onUpdated = jest.fn();
    render(<LeadDetailsModal lead={lead} onClose={jest.fn()} onUpdated={onUpdated} onDeleted={jest.fn()} />);
    fireEvent.click(screen.getByText('Re-run enrichment'));
    await waitFor(() => expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ enrichmentStatus: 'QUEUED' })));
  });

  it('polls for updates while enrichment is still in progress', async () => {
    jest.useFakeTimers({ legacyFakeTimers: false });
    (fetchLead as jest.Mock).mockResolvedValue({ lead: { ...lead, enrichmentStatus: 'CRAWLING' } });
    const onUpdated = jest.fn();
    const inProgressLead: LeadRecord = { ...lead, enrichmentStatus: 'CRAWLING' };

    render(<LeadDetailsModal lead={inProgressLead} onClose={jest.fn()} onUpdated={onUpdated} onDeleted={jest.fn()} />);

    await jest.advanceTimersByTimeAsync(3000);

    expect(fetchLead).toHaveBeenCalledWith('1');
    expect(onUpdated).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it('does not poll once enrichment has reached a terminal status', async () => {
    jest.useFakeTimers({ legacyFakeTimers: false });
    render(<LeadDetailsModal lead={lead} onClose={jest.fn()} onUpdated={jest.fn()} onDeleted={jest.fn()} />);

    await jest.advanceTimersByTimeAsync(5000);

    expect(fetchLead).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});
