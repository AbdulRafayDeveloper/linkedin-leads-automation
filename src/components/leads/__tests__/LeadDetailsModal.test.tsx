import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LeadDetailsModal from '../LeadDetailsModal';
import { deleteLeadApi, updateLeadApi } from '@/lib/api/client';
import type { LeadRecord } from '@/lib/types/lead';

jest.mock('@/lib/api/client', () => ({
  updateLeadApi: jest.fn(),
  deleteLeadApi: jest.fn(),
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
});
