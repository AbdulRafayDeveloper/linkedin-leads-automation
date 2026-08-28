import { render, screen, fireEvent } from '@testing-library/react';
import LeadsCards from '../LeadsCards';
import type { LeadRecord } from '@/lib/types/lead';

jest.mock('@/lib/api/client', () => ({
  updateLeadApi: jest.fn(),
}));

function makeLead(overrides: Partial<LeadRecord> = {}): LeadRecord {
  return {
    _id: '1',
    fullName: 'Gus Gollings',
    linkedinProfileUrl: null,
    headline: null,
    currentTitle: 'Head of Growth',
    currentCompany: 'Northwind Robotics',
    currentCompanyLinkedInUrl: null,
    currentCompanyWebsite: null,
    currentCompanyLocation: null,
    location: null,
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
    emailSubject: null,
    emailBody: null,
    approvalStatus: 'PENDING',
    processingStatus: 'COMPLETE',
    sentStatus: 'NOT_SENT',
    errorMessage: null,
    createdAt: new Date('2026-01-01').toISOString(),
    updatedAt: new Date('2026-01-01').toISOString(),
    sentAt: null,
    processingTimeMs: 1000,
    sourceText: null,
    emails: [],
    websiteStatus: 'not_started',
    websiteVerified: null,
    crawlStatus: 'not_started',
    emailDiscoveryStatus: 'not_started',
    enrichmentStatus: 'COMPLETED',
    enrichmentError: null,
    ...overrides,
  };
}

const noop = () => {};

describe('LeadsCards', () => {
  it('shows a loading state', () => {
    render(
      <LeadsCards
        leads={[]}
        isLoading
        page={1}
        pages={1}
        onPageChange={noop}
        onOpenDetails={noop}
        onUpdated={noop}
        selectedIds={new Set()}
        onToggleSelect={noop}
        onToggleSelectAll={noop}
      />
    );
    expect(screen.getByText('Loading leads…')).toBeInTheDocument();
  });

  it('shows an empty state when there are no leads', () => {
    render(
      <LeadsCards
        leads={[]}
        isLoading={false}
        page={1}
        pages={1}
        onPageChange={noop}
        onOpenDetails={noop}
        onUpdated={noop}
        selectedIds={new Set()}
        onToggleSelect={noop}
        onToggleSelectAll={noop}
      />
    );
    expect(screen.getByText(/No leads found/)).toBeInTheDocument();
  });

  it('renders one card per lead', () => {
    render(
      <LeadsCards
        leads={[makeLead({ _id: '1', fullName: 'Gus Gollings' }), makeLead({ _id: '2', fullName: 'Jane Doe' })]}
        isLoading={false}
        page={1}
        pages={1}
        onPageChange={noop}
        onOpenDetails={noop}
        onUpdated={noop}
        selectedIds={new Set()}
        onToggleSelect={noop}
        onToggleSelectAll={noop}
      />
    );
    expect(screen.getByText('Gus Gollings')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('calls onToggleSelectAll from the header checkbox', () => {
    const onToggleSelectAll = jest.fn();
    render(
      <LeadsCards
        leads={[makeLead()]}
        isLoading={false}
        page={1}
        pages={1}
        onPageChange={noop}
        onOpenDetails={noop}
        onUpdated={noop}
        selectedIds={new Set()}
        onToggleSelect={noop}
        onToggleSelectAll={onToggleSelectAll}
      />
    );
    fireEvent.click(screen.getByLabelText('Select all leads'));
    expect(onToggleSelectAll).toHaveBeenCalled();
  });

  it('disables Previous on the first page and enables Next when more pages exist', () => {
    render(
      <LeadsCards
        leads={[makeLead()]}
        isLoading={false}
        page={1}
        pages={3}
        onPageChange={noop}
        onOpenDetails={noop}
        onUpdated={noop}
        selectedIds={new Set()}
        onToggleSelect={noop}
        onToggleSelectAll={noop}
      />
    );
    expect(screen.getByText('Previous')).toBeDisabled();
    expect(screen.getByText('Next')).not.toBeDisabled();
  });

  it('calls onPageChange when Next is clicked', () => {
    const onPageChange = jest.fn();
    render(
      <LeadsCards
        leads={[makeLead()]}
        isLoading={false}
        page={1}
        pages={3}
        onPageChange={onPageChange}
        onOpenDetails={noop}
        onUpdated={noop}
        selectedIds={new Set()}
        onToggleSelect={noop}
        onToggleSelectAll={noop}
      />
    );
    fireEvent.click(screen.getByText('Next'));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});
