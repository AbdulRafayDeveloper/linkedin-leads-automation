import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Modal from '../Modal';

function renderModal(props: Partial<React.ComponentProps<typeof Modal>> = {}) {
  const onClose = jest.fn();
  const view = render(
    <Modal open onClose={onClose} title="Edit draft" {...props}>
      <input aria-label="Subject" />
    </Modal>
  );
  return { onClose, ...view };
}

/** Mirrors real usage: a trigger owns the open state, so focus restoration is observable. */
function Harness({ closeConfirm }: { closeConfirm?: () => boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Edit draft"
        subtitle="Personal outreach"
        closeConfirm={closeConfirm}
        footer={
          <button type="button" onClick={() => setOpen(false)}>
            Save
          </button>
        }
      >
        <input aria-label="Subject" />
      </Modal>
    </>
  );
}

describe('Modal', () => {
  it('renders nothing when closed', () => {
    render(
      <Modal open={false} onClose={jest.fn()} title="Edit draft">
        <p>body</p>
      </Modal>
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('body')).not.toBeInTheDocument();
  });

  it('is a modal dialog named by its title', () => {
    renderModal();
    const dialog = screen.getByRole('dialog', { name: 'Edit draft' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', screen.getByText('Edit draft').id);
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on a backdrop click and on the close button', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal();

    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps the modal open when closeConfirm returns false', async () => {
    const user = userEvent.setup();
    const closeConfirm = jest.fn().mockReturnValue(false);
    const { onClose } = renderModal({ closeConfirm });

    await user.keyboard('{Escape}');
    fireEvent.click(screen.getByTestId('modal-backdrop'));

    expect(closeConfirm).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes when closeConfirm returns true', async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal({ closeConfirm: () => true });
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the dialog on open and restores it on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Open' });
    await user.click(trigger);

    // First focusable element inside the dialog is the header close button.
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('keeps focus on the only focusable element when the dialog has just a close button', async () => {
    const user = userEvent.setup();
    render(
      <Modal open onClose={jest.fn()} title="Read only">
        <p>Nothing focusable in the body.</p>
      </Modal>
    );
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close).toHaveFocus();
    expect(screen.getByRole('dialog')).toHaveAttribute('tabindex', '-1');

    await user.tab();
    expect(close).toHaveFocus();
  });

  it('traps Tab and Shift+Tab inside the dialog', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Open' }));

    const close = screen.getByRole('button', { name: 'Close' });
    const subject = screen.getByLabelText('Subject');
    const save = screen.getByRole('button', { name: 'Save' });

    expect(close).toHaveFocus();
    await user.tab();
    expect(subject).toHaveFocus();
    await user.tab();
    expect(save).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus(); // wrapped, never reached the page behind

    await user.tab({ shift: true });
    expect(save).toHaveFocus();
  });

  it('locks body scroll while open and restores it on close', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(document.body.style.overflow).toBe('');

    await user.click(screen.getByRole('button', { name: 'Open' }));
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('renders the subtitle, header extra and footer, and sizes the panel', () => {
    render(
      <Modal
        open
        onClose={jest.fn()}
        title="Edit draft"
        subtitle="Personal outreach"
        headerExtra={<span>draft</span>}
        footer={<button type="button">Save</button>}
        size="full"
      >
        <p>body</p>
      </Modal>
    );
    expect(screen.getByText('Personal outreach')).toBeInTheDocument();
    expect(screen.getByText('draft')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('dialog').className).toContain('max-w-5xl');
  });

  it('scrolls the body, not the page, and never horizontally', () => {
    render(
      <Modal open onClose={jest.fn()} title="Edit draft" footer={<button type="button">Save</button>}>
        <p>body</p>
      </Modal>
    );
    const body = screen.getByText('body').parentElement as HTMLElement;
    expect(body.className).toContain('overflow-y-auto');
    expect(body.className).toContain('overflow-x-hidden');
    expect(body.className).toContain('min-h-0');
    expect(body.className).toContain('break-words');
  });
});
