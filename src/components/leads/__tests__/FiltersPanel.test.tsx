import { render, screen, fireEvent } from '@testing-library/react';
import FiltersPanel, { EMPTY_FILTERS } from '../FiltersPanel';

describe('FiltersPanel', () => {
  it('renders all filter controls', () => {
    render(<FiltersPanel filters={EMPTY_FILTERS} onChange={jest.fn()} />);
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
    expect(screen.getByLabelText('Approval Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Validation Status')).toBeInTheDocument();
    expect(screen.getByLabelText('Sent Status')).toBeInTheDocument();
  });

  it('calls onChange with updated search value', () => {
    const onChange = jest.fn();
    render(<FiltersPanel filters={EMPTY_FILTERS} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'gus' } });
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, search: 'gus' });
  });

  it('calls onChange with updated approval status', () => {
    const onChange = jest.fn();
    render(<FiltersPanel filters={EMPTY_FILTERS} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Approval Status'), { target: { value: 'APPROVED' } });
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY_FILTERS, approvalStatus: 'APPROVED' });
  });

  it('resets filters when Reset button is clicked', () => {
    const onChange = jest.fn();
    render(
      <FiltersPanel filters={{ ...EMPTY_FILTERS, search: 'gus' }} onChange={onChange} />
    );
    fireEvent.click(screen.getByText('Reset filters'));
    expect(onChange).toHaveBeenCalledWith(EMPTY_FILTERS);
  });
});
