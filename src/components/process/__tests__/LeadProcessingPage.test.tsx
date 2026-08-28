import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LeadProcessingPage from '../LeadProcessingPage';
import {
  addLeadEmailApi,
  enrichLeadApi,
  fetchLead,
  findCompanyWebsiteApi,
  processLeadApi,
  updateLeadApi,
} from '@/lib/api/client';
import type { LeadRecord } from '@/lib/types/lead';

jest.mock('@/lib/api/client', () => ({
  processLeadApi: jest.fn(),
  enrichLeadApi: jest.fn(),
  fetchLead: jest.fn(),
  findCompanyWebsiteApi: jest.fn(),
  updateLeadApi: jest.fn(),
  addLeadEmailApi: jest.fn(),
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
  websiteVerified: null,
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
    // CompanyWebsiteRow always auto-verifies on mount; default to "already
    // verified, nothing changes" so tests unrelated to that flow don't need
    // to configure it themselves.
    (findCompanyWebsiteApi as jest.Mock).mockResolvedValue({
      lead: savedLead,
      website: savedLead.currentCompanyWebsite,
      verified: true,
    });
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

  it('automatically searches for and verifies the company website when none was found, with no click needed', async () => {
    const noWebsiteResult = {
      result: { ...mockResult.result, company: { officialWebsite: null }, lead: { ...mockResult.result.lead, currentCompanyWebsite: null } },
      lead: { ...savedLead, currentCompanyWebsite: null, websiteStatus: 'not_started' as const },
    };
    (processLeadApi as jest.Mock).mockResolvedValue(noWebsiteResult);
    (findCompanyWebsiteApi as jest.Mock).mockResolvedValue({
      lead: { ...savedLead, currentCompanyWebsite: 'https://northwindrobotics.com', websiteVerified: true },
      website: 'https://northwindrobotics.com',
      verified: true,
    });

    render(<LeadProcessingPage />);
    fireEvent.change(screen.getByPlaceholderText(/Paste Sales Navigator/), { target: { value: 'content' } });
    fireEvent.click(screen.getByText('Process Lead'));
    await waitFor(() => expect(screen.getByText('Processing Complete')).toBeInTheDocument());

    await waitFor(() => expect(findCompanyWebsiteApi).toHaveBeenCalledWith('1'));
    expect(await screen.findByText('https://northwindrobotics.com')).toBeInTheDocument();
    expect(await screen.findByText('Verified')).toBeInTheDocument();
  });

  it('runs the same automatic crawl-and-verify pass even when a website already came back from processing', async () => {
    (processLeadApi as jest.Mock).mockResolvedValue(mockResult);
    (findCompanyWebsiteApi as jest.Mock).mockResolvedValue({
      lead: savedLead,
      website: 'https://northwindrobotics.com',
      verified: true,
    });

    render(<LeadProcessingPage />);
    fireEvent.change(screen.getByPlaceholderText(/Paste Sales Navigator/), { target: { value: 'content' } });
    fireEvent.click(screen.getByText('Process Lead'));
    await waitFor(() => expect(screen.getByText('Processing Complete')).toBeInTheDocument());

    await waitFor(() => expect(findCompanyWebsiteApi).toHaveBeenCalledWith('1'));
    expect(await screen.findByText('Verified')).toBeInTheDocument();
  });

  it('falls back to "Not found" when the website that was present cannot be AI-verified after retries', async () => {
    (processLeadApi as jest.Mock).mockResolvedValue(mockResult);
    (findCompanyWebsiteApi as jest.Mock).mockResolvedValue({
      lead: { ...savedLead, currentCompanyWebsite: null, websiteStatus: 'not_found', websiteVerified: false },
      website: null,
      verified: false,
    });

    render(<LeadProcessingPage />);
    fireEvent.change(screen.getByPlaceholderText(/Paste Sales Navigator/), { target: { value: 'content' } });
    fireEvent.click(screen.getByText('Process Lead'));
    await waitFor(() => expect(screen.getByText('Processing Complete')).toBeInTheDocument());

    expect(await screen.findByText('Not found')).toBeInTheDocument();
  });

  it('lets the company website be manually edited and saved', async () => {
    (processLeadApi as jest.Mock).mockResolvedValue(mockResult);
    (updateLeadApi as jest.Mock).mockResolvedValue({
      lead: { ...savedLead, currentCompanyWebsite: 'https://custom-site.example.com' },
    });

    render(<LeadProcessingPage />);
    fireEvent.change(screen.getByPlaceholderText(/Paste Sales Navigator/), { target: { value: 'content' } });
    fireEvent.click(screen.getByText('Process Lead'));
    await waitFor(() => expect(screen.getByText('Processing Complete')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Edit company website'));
    const input = screen.getByPlaceholderText('https://example.com');
    fireEvent.change(input, { target: { value: 'https://custom-site.example.com' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() =>
      expect(updateLeadApi).toHaveBeenCalledWith('1', {
        currentCompanyWebsite: 'https://custom-site.example.com',
        websiteStatus: 'found',
        websiteVerified: null,
      })
    );
    expect(await screen.findByText('https://custom-site.example.com')).toBeInTheDocument();
  });

  it('lets an email be added manually from the same Company Emails section', async () => {
    (processLeadApi as jest.Mock).mockResolvedValue(mockResult);
    (addLeadEmailApi as jest.Mock).mockResolvedValue({
      lead: {
        ...savedLead,
        emails: [
          ...savedLead.emails,
          {
            email: 'manual@northwindrobotics.com',
            source: 'MANUAL',
            sourceUrl: null,
            emailType: 'GENERAL',
            validationStatus: 'pending',
            validationDetails: null,
            discoveredAt: new Date().toISOString(),
            validatedAt: null,
          },
        ],
      },
    });

    render(<LeadProcessingPage />);
    fireEvent.change(screen.getByPlaceholderText(/Paste Sales Navigator/), { target: { value: 'content' } });
    fireEvent.click(screen.getByText('Process Lead'));
    await waitFor(() => expect(screen.getByText('Processing Complete')).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText('Add an email address'), {
      target: { value: 'manual@northwindrobotics.com' },
    });
    fireEvent.click(screen.getByText('Add'));

    await waitFor(() => expect(addLeadEmailApi).toHaveBeenCalledWith('1', 'manual@northwindrobotics.com'));
    expect(await screen.findByText('manual@northwindrobotics.com')).toBeInTheDocument();
  });
});
