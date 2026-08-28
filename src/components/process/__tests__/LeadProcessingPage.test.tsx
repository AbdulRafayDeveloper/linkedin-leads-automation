import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LeadProcessingPage from '../LeadProcessingPage';
import { enrichLeadApi, fetchLead, processLeadApi } from '@/lib/api/client';
import type { LeadRecord } from '@/lib/types/lead';

jest.mock('@/lib/api/client', () => ({
  processLeadApi: jest.fn(),
  enrichLeadApi: jest.fn(),
  fetchLead: jest.fn(),
}));

const savedLead: LeadRecord = {
  _id: '1',
  fullName: 'Gus Gollings',
  linkedinProfileUrl: null,
  headline: 'Head of Growth at Northwind Robotics',
  currentTitle: 'Head of Growth',
  currentCompany: 'Northwind Robotics',
  currentCompanyLinkedInUrl: null,
  currentCompanyWebsite: 'https://northwindrobotics.com',
  currentCompanyLocation: null,
  location: 'San Francisco, California',
  currentRoleStartDate: null,
  about: 'Leads growth at Northwind Robotics.',
  experience: ['Head of Growth at Northwind Robotics'],
  education: ['University of Michigan'],
  skills: ['Growth Marketing'],
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
  processingTimeMs: 5000,
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
  crawlStatus: 'not_started',
  emailDiscoveryStatus: 'emails_found',
  enrichmentStatus: 'QUEUED',
  enrichmentError: null,
};

const mockResult = {
  result: {
    lead: {
      fullName: 'Gus Gollings',
      currentTitle: 'Head of Growth',
      currentCompany: 'Northwind Robotics',
      currentCompanyWebsite: 'https://northwindrobotics.com',
      currentCompanyLocation: null,
      location: 'San Francisco, California',
      about: 'Leads growth at Northwind Robotics.',
      experience: ['Head of Growth at Northwind Robotics'],
      education: ['University of Michigan'],
      skills: ['Growth Marketing'],
    },
    company: { officialWebsite: 'https://northwindrobotics.com' },
    emailDiscovery: { email: 'gus@northwindrobotics.com' },
    validation: { status: 'PASS' },
    generatedEmail: { subject: 'Hello Gus', body: 'Gus, hello there.' },
    totalProcessingTimeMs: 5000,
  },
  lead: savedLead,
};

describe('LeadProcessingPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('disables submit until content is entered', () => {
    render(<LeadProcessingPage />);
    expect(screen.getByText('Process Lead')).toBeDisabled();
  });

  it('processes content and displays results on success', async () => {
    (processLeadApi as jest.Mock).mockResolvedValue(mockResult);
    render(<LeadProcessingPage />);
    fireEvent.change(screen.getByPlaceholderText(/Paste Sales Navigator/), {
      target: { value: 'Gus Gollings\nHead of Growth at Northwind Robotics' },
    });
    fireEvent.click(screen.getByText('Process Lead'));

    await waitFor(() => expect(screen.getByText('Processing Complete')).toBeInTheDocument());
    expect(screen.getByText('Gus Gollings')).toBeInTheDocument();
  });

  it('displays the full parsed lead profile, not just name/company/email', async () => {
    (processLeadApi as jest.Mock).mockResolvedValue(mockResult);
    render(<LeadProcessingPage />);
    fireEvent.change(screen.getByPlaceholderText(/Paste Sales Navigator/), {
      target: { value: 'Gus Gollings\nHead of Growth at Northwind Robotics' },
    });
    fireEvent.click(screen.getByText('Process Lead'));

    await waitFor(() => expect(screen.getByText('Processing Complete')).toBeInTheDocument());
    expect(screen.getByText('San Francisco, California')).toBeInTheDocument();
    expect(screen.getByText('https://northwindrobotics.com')).toBeInTheDocument();
  });

  it('shows an error message when processing fails', async () => {
    (processLeadApi as jest.Mock).mockRejectedValue(new Error('Processing failed'));
    render(<LeadProcessingPage />);
    fireEvent.change(screen.getByPlaceholderText(/Paste Sales Navigator/), {
      target: { value: 'Gus Gollings' },
    });
    fireEvent.click(screen.getByText('Process Lead'));

    await waitFor(() => expect(screen.getByText('Processing failed')).toBeInTheDocument());
  });

  it('starts async email discovery when "Find Emails" is clicked', async () => {
    (processLeadApi as jest.Mock).mockResolvedValue(mockResult);
    (enrichLeadApi as jest.Mock).mockResolvedValue({ lead: { ...savedLead, enrichmentStatus: 'CRAWLING' } });
    render(<LeadProcessingPage />);
    fireEvent.change(screen.getByPlaceholderText(/Paste Sales Navigator/), {
      target: { value: 'content' },
    });
    fireEvent.click(screen.getByText('Process Lead'));
    await waitFor(() => expect(screen.getByText('Processing Complete')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Find Emails'));

    await waitFor(() => expect(enrichLeadApi).toHaveBeenCalledWith('1'));
    expect(await screen.findByText(/Crawling company website/)).toBeInTheDocument();
  });

  it('polls and displays discovered emails once the search completes', async () => {
    jest.useFakeTimers({ legacyFakeTimers: false });
    (processLeadApi as jest.Mock).mockResolvedValue(mockResult);
    (enrichLeadApi as jest.Mock).mockResolvedValue({ lead: { ...savedLead, enrichmentStatus: 'CRAWLING' } });
    (fetchLead as jest.Mock).mockResolvedValue({
      lead: {
        ...savedLead,
        enrichmentStatus: 'COMPLETED',
        emails: [
          ...savedLead.emails,
          {
            email: 'sales@northwindrobotics.com',
            source: 'COMPANY_WEBSITE',
            sourceUrl: 'https://northwindrobotics.com/contact',
            emailType: 'SALES',
            validationStatus: 'valid',
            validationDetails: null,
            discoveredAt: new Date().toISOString(),
            validatedAt: new Date().toISOString(),
          },
        ],
      },
    });

    render(<LeadProcessingPage />);
    fireEvent.change(screen.getByPlaceholderText(/Paste Sales Navigator/), { target: { value: 'content' } });

    await fireEvent.click(screen.getByText('Process Lead'));
    // Advance past the fake progress-step interval used while processing.
    await jest.advanceTimersByTimeAsync(3500);

    fireEvent.click(screen.getByText('Find Emails'));
    await jest.advanceTimersByTimeAsync(0);

    await jest.advanceTimersByTimeAsync(2000);

    expect(fetchLead).toHaveBeenCalledWith('1');
    expect(await screen.findByText('sales@northwindrobotics.com')).toBeInTheDocument();
    jest.useRealTimers();
  });
});
