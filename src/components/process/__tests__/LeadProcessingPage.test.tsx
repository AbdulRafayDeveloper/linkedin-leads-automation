import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LeadProcessingPage from '../LeadProcessingPage';
import { processLeadApi } from '@/lib/api/client';

jest.mock('@/lib/api/client', () => ({
  processLeadApi: jest.fn(),
}));

const mockResult = {
  result: {
    lead: {
      fullName: 'Gus Gollings',
      currentCompany: 'Northwind Robotics',
    },
    company: {},
    emailDiscovery: { email: 'gus@northwindrobotics.com' },
    validation: { status: 'PASS' },
    generatedEmail: { subject: 'Hello Gus', body: 'Gus, hello there.' },
    totalProcessingTimeMs: 5000,
  },
  lead: { _id: '1' },
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
    expect(screen.getByText('Hello Gus')).toBeInTheDocument();
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
});
