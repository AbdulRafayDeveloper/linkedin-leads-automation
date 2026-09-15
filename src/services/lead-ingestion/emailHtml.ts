/**
 * Gap under every paragraph of a sent email. Mail clients don't agree on a
 * default margin for <p> (Outlook often renders none), so it is set inline,
 * the one styling every client honors. Matches `.email-body p` in globals.css.
 */
const PARAGRAPH_STYLE = 'margin:0 0 16px 0;';

/**
 * Adds the paragraph gap to each <p> tag that has no style of its own. The
 * content is left untouched: no paragraph, line break or empty <p> is removed.
 */
export function withParagraphSpacing(html: string): string {
  return html.replace(/<p(\s[^>]*)?>/gi, (tag: string, attrs: string = '') =>
    /\sstyle\s*=/i.test(attrs) ? tag : `<p${attrs} style="${PARAGRAPH_STYLE}">`
  );
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
};

/**
 * The plain-text version of an email body: one blank line between paragraphs,
 * <br> as a line break, tags removed and common entities decoded. Used for the
 * text part of sent emails and for "Copy" in the app.
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|blockquote)>/gi, '\n\n')
    .replace(/<\/(div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? entity)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
