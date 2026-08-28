import { render, screen, fireEvent } from '@testing-library/react';
import LeadsTable from '../LeadsTable';
import type { LeadRecord } from '@/lib/types/lead';

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
    ...overrides,
  };
}

const noop = () => {};

describe('LeadsTable', () => {
  it('shows a loading state', () => {
    render(
      <LeadsTable
        leads={[]}
        isLoading
        page={1}
        pages={1}
        onPageChange={noop}
        onRowClick={noop}
        selectedIds={new Set()}
        onToggleSelect={noop}
        onToggleSelectAll={noop}
      />
    );
    expect(screen.getByText('Loading leads…')).toBeInTheDocument();
  });

  it('shows an empty state when there are no leads', () => {
    render(
      <LeadsTable
        leads={[]}
        isLoading={false}
        page={1}
        pages={1}
        onPageChange={noop}
        onRowClick={noop}
        selectedIds={new Set()}
        onToggleSelect={noop}
        onToggleSelectAll={noop}
      />
    );
    expect(screen.getByText(/No leads found/)).toBeInTheDocument();
  });

  it('renders lead rows with key columns', () => {
    render(
      <LeadsTable
        leads={[makeLead()]}
        isLoading={false}
        page={1}
        pages={1}
        onPageChange={noop}
        onRowClick={noop}
        selectedIds={new Set()}
        onToggleSelect={noop}
        onToggleSelectAll={noop}
      />
    );
    expect(screen.getByText('Gus Gollings')).toBeInTheDocument();
    expect(screen.getByText('Northwind Robotics')).toBeInTheDocument();
  });

  it('calls onRowClick when a row is clicked', () => {
    const onRowClick = jest.fn();
    const lead = makeLead();
    render(
      <LeadsTable
        leads={[lead]}
        isLoading={false}
        page={1}
        pages={1}
        onPageChange={noop}
        onRowClick={onRowClick}
        selectedIds={new Set()}
        onToggleSelect={noop}
        onToggleSelectAll={noop}
      />
    );
    fireEvent.click(screen.getByText('Gus Gollings'));
    expect(onRowClick).toHaveBeenCalledWith(lead);
  });

  it('disables the Previous button on the first page', () => {
    render(
      <LeadsTable
        leads={[makeLead()]}
        isLoading={false}
        page={1}
        pages={3}
        onPageChange={noop}
        onRowClick={noop}
        selectedIds={new Set()}
        onToggleSelect={noop}
        onToggleSelectAll={noop}
      />
    );
    expect(screen.getByText('Previous')).toBeDisabled();
    expect(screen.getByText('Next')).not.toBeDisabled();
  });

  it('calls onToggleSelect when a row checkbox is clicked', () => {
    const onToggleSelect = jest.fn();
    const lead = makeLead();
    render(
      <LeadsTable
        leads={[lead]}
        isLoading={false}
        page={1}
        pages={1}
        onPageChange={noop}
        onRowClick={noop}
        selectedIds={new Set()}
        onToggleSelect={onToggleSelect}
        onToggleSelectAll={noop}
      />
    );
    fireEvent.click(screen.getByLabelText('Select Gus Gollings'));
    expect(onToggleSelect).toHaveBeenCalledWith('1');
  });
});
