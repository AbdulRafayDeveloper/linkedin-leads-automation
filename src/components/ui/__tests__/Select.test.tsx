import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Select from '../Select';

type Status = 'all' | 'approved' | 'pending' | 'sent';

const OPTIONS: Array<{ value: Status; label: string; hint?: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'approved', label: 'Approved', hint: 'ready to send' },
  { value: 'pending', label: 'Pending' },
  { value: 'sent', label: 'Sent' },
];

function renderSelect(props: Partial<React.ComponentProps<typeof Select<Status>>> = {}) {
  const onChange = jest.fn();
  const view = render(
    <Select<Status>
      value="all"
      options={OPTIONS}
      onChange={onChange}
      label="Status"
      {...props}
    />
  );
  return { onChange, ...view };
}

/** Controlled wrapper, the way pages use it. */
function SelectHarness() {
  const [value, setValue] = useState<Status>('all');
  return (
    <>
      <Select<Status> value={value} options={OPTIONS} onChange={setValue} label="Status" />
      <p>Picked: {value}</p>
    </>
  );
}

const trigger = () => screen.getByRole('button', { name: /Status/ });

describe('Select', () => {
  it('shows the active option and opens on click', async () => {
    const user = userEvent.setup();
    renderSelect();

    const button = trigger();
    expect(button).toHaveAttribute('aria-haspopup', 'listbox');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveAccessibleName('Status All statuses');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.click(button);

    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(OPTIONS.length);
  });

  it('marks only the selected option as selected', async () => {
    const user = userEvent.setup();
    renderSelect({ value: 'pending' });
    await user.click(trigger());

    expect(screen.getByRole('option', { name: /Pending/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('option', { name: /All statuses/ })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('moves the active option with the arrow keys and selects with Enter', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSelect();

    await user.click(trigger());
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledWith('approved');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('wraps with the arrow keys and jumps with Home/End', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSelect();

    await user.click(trigger());
    await user.keyboard('{ArrowUp}'); // wraps from "All statuses" to the last option
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('sent');

    await user.click(trigger());
    await user.keyboard('{End}');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('sent');

    await user.click(trigger());
    await user.keyboard('{Home}');
    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('all');
  });

  it('selects with Space and with a click, and reflects the new value', async () => {
    const user = userEvent.setup();
    render(<SelectHarness />);

    await user.click(trigger());
    await user.click(screen.getByRole('option', { name: /Pending/ }));
    expect(screen.getByText('Picked: pending')).toBeInTheDocument();

    await user.click(trigger());
    await user.keyboard('{ArrowDown}'); // pending -> sent
    await user.keyboard(' ');
    expect(screen.getByText('Picked: sent')).toBeInTheDocument();
  });

  it('jumps to the first option starting with a typed letter', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSelect();

    await user.click(trigger());
    await user.keyboard('p');
    await user.keyboard('{Enter}');

    expect(onChange).toHaveBeenCalledWith('pending');
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    const user = userEvent.setup();
    renderSelect();
    const button = trigger();

    await user.click(button);
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });

  it('closes on Tab and on an outside click', async () => {
    const user = userEvent.setup();
    renderSelect();

    await user.click(trigger());
    await user.tab();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    await user.click(trigger());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('opens from the keyboard without selecting anything', async () => {
    const user = userEvent.setup();
    const { onChange } = renderSelect();

    trigger().focus();
    await user.keyboard('{ArrowDown}');

    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports search queries without filtering locally', async () => {
    const user = userEvent.setup();
    const onSearch = jest.fn();
    renderSelect({ searchable: true, onSearch });

    await user.click(trigger());
    const search = screen.getByLabelText('Search Status');
    expect(search).toHaveFocus();

    await user.type(search, 'ap');

    expect(onSearch).toHaveBeenNthCalledWith(1, 'a');
    expect(onSearch).toHaveBeenNthCalledWith(2, 'ap');
    // Filtering is the caller's job: every option is still rendered.
    expect(screen.getAllByRole('option')).toHaveLength(OPTIONS.length);
  });

  it('fires onScrollEnd when the list is scrolled to the bottom', async () => {
    const user = userEvent.setup();
    const onScrollEnd = jest.fn();
    renderSelect({ onScrollEnd });

    await user.click(trigger());
    fireEvent.scroll(screen.getByRole('listbox'));

    expect(onScrollEnd).toHaveBeenCalled();
  });

  it('renders the loading row, the empty text and a footer', async () => {
    const user = userEvent.setup();
    const { rerender } = renderSelect({
      options: [],
      emptyText: 'No clients yet',
      footer: <span>footer slot</span>,
    });

    await user.click(trigger());
    expect(screen.getByText('No clients yet')).toBeInTheDocument();
    expect(screen.getByText('footer slot')).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).not.toBeInTheDocument();

    rerender(
      <Select<Status>
        value="all"
        options={[]}
        onChange={jest.fn()}
        label="Status"
        loading
        emptyText="No clients yet"
      />
    );
    expect(screen.getByText('Loading...')).toBeInTheDocument();
    expect(screen.queryByText('No clients yet')).not.toBeInTheDocument();
  });

  it('keeps the popup inside the viewport on small screens', async () => {
    const user = userEvent.setup();
    renderSelect();
    await user.click(trigger());

    const list = screen.getByRole('listbox');
    expect(list.className).toContain('max-h-64');
    expect(list.className).toContain('overflow-y-auto');
    expect((list.parentElement as HTMLElement).className).toContain('max-w-[calc(100vw-2rem)]');
  });
});
