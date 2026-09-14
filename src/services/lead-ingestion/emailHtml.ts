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
