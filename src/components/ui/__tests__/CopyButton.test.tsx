import { act, fireEvent, render, screen } from '@testing-library/react';
import CopyButton from '../CopyButton';
import { copyToClipboard } from '@/lib/utils/clipboard';

type ClipboardMock = { write?: jest.Mock; writeText?: jest.Mock };

function mockClipboard(clipboard: ClipboardMock | undefined) {
  Object.defineProperty(navigator, 'clipboard', { value: clipboard, configurable: true });
}

class FakeClipboardItem {
  constructor(public items: Record<string, Blob>) {}
}

afterEach(() => {
  mockClipboard(undefined);
  delete (globalThis as { ClipboardItem?: unknown }).ClipboardItem;
  jest.useRealTimers();
});

describe('copyToClipboard', () => {
  it('writes HTML and plain text together when HTML is given', async () => {
    const write = jest.fn().mockResolvedValue(undefined);
    mockClipboard({ write });
    (globalThis as { ClipboardItem?: unknown }).ClipboardItem = FakeClipboardItem;

    await copyToClipboard({ text: 'Hi Abdul,', html: '<p>Hi Abdul,</p>' });

    const [items] = write.mock.calls[0] as [FakeClipboardItem[]];
    expect(Object.keys(items[0].items).sort()).toEqual(['text/html', 'text/plain']);
  });

  it('writes plain text when there is no HTML', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    mockClipboard({ writeText });
    await copyToClipboard({ text: 'Subject line' });
    expect(writeText).toHaveBeenCalledWith('Subject line');
  });

  it('falls back to a selection copy without the Clipboard API', async () => {
    const execCommand = jest.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
    await copyToClipboard({ text: 'Hi', html: '<p>Hi</p>' });
    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(document.body.innerHTML).toBe('');
  });
});

describe('CopyButton', () => {
  it('copies the content and shows "Copied" for 2 seconds', async () => {
    jest.useFakeTimers();
    const writeText = jest.fn().mockResolvedValue(undefined);
    mockClipboard({ writeText });

    render(<CopyButton label="Copy subject" getContent={() => ({ text: 'Hello' })} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy subject' }));
    });

    expect(writeText).toHaveBeenCalledWith('Hello');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: 'Copy subject' })).toBeInTheDocument();
  });
});
