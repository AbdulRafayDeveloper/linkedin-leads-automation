export interface ClipboardContent {
  /** Plain text, used by apps that can't paste formatting. */
  text: string;
  /** Rich HTML, so pasting into Gmail or Outlook keeps paragraphs, bold and links. */
  html?: string;
}

// Copies by selecting a hidden element. The fallback for pages without the
// async Clipboard API (plain http on a LAN address, older browsers).
function copyWithSelection({ text, html }: ClipboardContent): void {
  const node = document.createElement('div');
  if (html) node.innerHTML = html;
  else node.textContent = text;
  node.setAttribute('aria-hidden', 'true');
  Object.assign(node.style, { position: 'fixed', left: '-9999px', top: '0', whiteSpace: 'pre-wrap' });
  document.body.appendChild(node);

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(node);
  selection?.removeAllRanges();
  selection?.addRange(range);
  try {
    if (!document.execCommand('copy')) throw new Error('Copy command was rejected');
  } finally {
    selection?.removeAllRanges();
    node.remove();
  }
}

/** Copies text, plus HTML when given. Throws if the browser refuses. */
export async function copyToClipboard(content: ClipboardContent): Promise<void> {
  const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;

  try {
    if (content.html && clipboard?.write && typeof ClipboardItem !== 'undefined') {
      await clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([content.html], { type: 'text/html' }),
          'text/plain': new Blob([content.text], { type: 'text/plain' }),
        }),
      ]);
      return;
    }
    if (!content.html && clipboard?.writeText) {
      await clipboard.writeText(content.text);
      return;
    }
  } catch {
    // Permission denied or unsupported format: fall back to a selection copy.
  }

  copyWithSelection(content);
}
