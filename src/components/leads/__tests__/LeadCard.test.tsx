import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LeadCard from '../LeadCard';
import { updateLeadApi } from '@/lib/api/client';
import type { LeadRecord } from '@/lib/types/lead';

jest.mock('@/lib/api/client', () => ({
  updateLeadApi: jest.fn(),
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
  emailSubject: 'Loved your work on growth automation',
  emailBody: 'Hi Gus,\n\nYour recent post stood out to me.',
  approvalStatus: 'PENDING',
  processingStatus: 'COMPLETE',
  sentStatus: 'NOT_SENT',
  errorMessage: null,
  createdAt: new Date('2026-01-01').toISOString(),
  updatedAt: new Date('2026-01-01').toISOString(),
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
    {
      email: 'sales@northwindrobotics.com',
      source: 'COMPANY_WEBSITE',
      sourceUrl: null,
      emailType: 'SALES',
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

const writeText = jest.fn().mockResolvedValue(undefined);
Object.assign(navigator, { clipboard: { writeText } });

describe('LeadCard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    writeText.mockClear();
  });

  it('renders the lead name, title, company, email, subject, and email body', () => {
    render(
      <LeadCard lead={lead} selected={false} onToggleSelect={jest.fn()} onOpenDetails={jest.fn()} onUpdated={jest.fn()} />
    );
    expect(screen.getByText('Gus Gollings')).toBeInTheDocument();
    expect(screen.getByText(/Head of Growth/)).toBeInTheDocument();
    expect(screen.getByText('gus@northwindrobotics.com')).toBeInTheDocument();
    expect(screen.getByText('Loved your work on growth automation')).toBeInTheDocument();
    expect(screen.getByText(/Your recent post stood out to me/)).toBeInTheDocument();
  });

  it('shows a count of additional emails beyond the primary one', () => {
    render(
      <LeadCard lead={lead} selected={false} onToggleSelect={jest.fn()} onOpenDetails={jest.fn()} onUpdated={jest.fn()} />
    );
    expect(screen.getByText('+1 more')).toBeInTheDocument();
  });

  it('calls onToggleSelect when the checkbox is clicked', () => {
    const onToggleSelect = jest.fn();
    render(
      <LeadCard lead={lead} selected={false} onToggleSelect={onToggleSelect} onOpenDetails={jest.fn()} onUpdated={jest.fn()} />
    );
    fireEvent.click(screen.getByLabelText('Select Gus Gollings'));
    expect(onToggleSelect).toHaveBeenCalledWith('1');
  });

  it('opens details when the card header (name/title area) is clicked, matching the previous row-click behavior', () => {
    const onOpenDetails = jest.fn();
    render(
      <LeadCard lead={lead} selected={false} onToggleSelect={jest.fn()} onOpenDetails={onOpenDetails} onUpdated={jest.fn()} />
    );
    fireEvent.click(screen.getByText('Gus Gollings'));
    expect(onOpenDetails).toHaveBeenCalledWith(lead);
  });

  it('does not open details when the selection checkbox is clicked', () => {
    const onOpenDetails = jest.fn();
    const onToggleSelect = jest.fn();
    render(
      <LeadCard lead={lead} selected={false} onToggleSelect={onToggleSelect} onOpenDetails={onOpenDetails} onUpdated={jest.fn()} />
    );
    fireEvent.click(screen.getByLabelText('Select Gus Gollings'));
    expect(onToggleSelect).toHaveBeenCalledWith('1');
    expect(onOpenDetails).not.toHaveBeenCalled();
  });

  it('calls onOpenDetails when "View details" is clicked', () => {
    const onOpenDetails = jest.fn();
    render(
      <LeadCard lead={lead} selected={false} onToggleSelect={jest.fn()} onOpenDetails={onOpenDetails} onUpdated={jest.fn()} />
    );
    fireEvent.click(screen.getByText('View details'));
    expect(onOpenDetails).toHaveBeenCalledWith(lead);
  });

  it('copies subject and body to the clipboard', async () => {
    render(
      <LeadCard lead={lead} selected={false} onToggleSelect={jest.fn()} onOpenDetails={jest.fn()} onUpdated={jest.fn()} />
    );
    fireEvent.click(screen.getByText('Copy'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining(lead.emailSubject!)));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(lead.emailBody!));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('edits and saves the subject inline without navigating away', async () => {
    (updateLeadApi as jest.Mock).mockResolvedValue({ lead: { ...lead, emailSubject: 'Updated subject' } });
    const onUpdated = jest.fn();
    render(
      <LeadCard lead={lead} selected={false} onToggleSelect={jest.fn()} onOpenDetails={jest.fn()} onUpdated={onUpdated} />
    );

    fireEvent.click(screen.getByLabelText('Edit subject'));
    const input = screen.getByLabelText('Email subject');
    fireEvent.change(input, { target: { value: 'Updated subject' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(updateLeadApi).toHaveBeenCalledWith('1', { emailSubject: 'Updated subject' })
    );
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ emailSubject: 'Updated subject' }));
  });

  it('edits and saves the email body inline without navigating away', async () => {
    (updateLeadApi as jest.Mock).mockResolvedValue({ lead: { ...lead, emailBody: 'Updated body text' } });
    const onUpdated = jest.fn();
    render(
      <LeadCard lead={lead} selected={false} onToggleSelect={jest.fn()} onOpenDetails={jest.fn()} onUpdated={onUpdated} />
    );

    fireEvent.click(screen.getByText('Edit'));
    const textarea = screen.getByLabelText('Email body');
    fireEvent.change(textarea, { target: { value: 'Updated body text' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(updateLeadApi).toHaveBeenCalledWith('1', { emailBody: 'Updated body text' })
    );
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ emailBody: 'Updated body text' }));
  });

  it('cancels an in-progress edit without saving', () => {
    render(
      <LeadCard lead={lead} selected={false} onToggleSelect={jest.fn()} onOpenDetails={jest.fn()} onUpdated={jest.fn()} />
    );
    fireEvent.click(screen.getByLabelText('Edit subject'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(updateLeadApi).not.toHaveBeenCalled();
    expect(screen.getByText('Loved your work on growth automation')).toBeInTheDocument();
  });

  it('shows an error message when saving fails', async () => {
    (updateLeadApi as jest.Mock).mockRejectedValue(new Error('Network error'));
    render(
      <LeadCard lead={lead} selected={false} onToggleSelect={jest.fn()} onOpenDetails={jest.fn()} onUpdated={jest.fn()} />
    );
    fireEvent.click(screen.getByLabelText('Edit subject'));
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
  });
});
