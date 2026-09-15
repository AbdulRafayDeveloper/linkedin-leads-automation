/** @jest-environment node */
import { htmlToPlainText, withParagraphSpacing } from '../emailHtml';

describe('htmlToPlainText', () => {
  it('keeps one blank line between paragraphs and line breaks inside them', () => {
    const html =
      '<p>Hi Abdul,</p>\n<p></p>\n<p>Delivering 29+ projects &amp; <strong>SaaS</strong>.</p>\n<p></p>\n' +
      '<p>Best regards,<br>Abdul Rafay</p>\n<p>Portfolio: https://rafaydev.vercel.app<br>Phone:&nbsp;+92 306</p>';
    expect(htmlToPlainText(html)).toBe(
      'Hi Abdul,\n\nDelivering 29+ projects & SaaS.\n\nBest regards,\nAbdul Rafay\n\n' +
        'Portfolio: https://rafaydev.vercel.app\nPhone: +92 306'
    );
  });

  it('treats editor divs as lines', () => {
    expect(htmlToPlainText('<div>One</div><div>Two</div>')).toBe('One\nTwo');
  });
});

describe('withParagraphSpacing', () => {
  it('adds the gap to every plain <p> and keeps all content, including empty spacer paragraphs', () => {
    const html = '<p>Hi Abdul,</p>\n<p></p>\n<p>Body line.</p>\n<p>Best regards,<br>Abdul Rafay</p>';
    expect(withParagraphSpacing(html)).toBe(
      '<p style="margin:0 0 16px 0;">Hi Abdul,</p>\n' +
        '<p style="margin:0 0 16px 0;"></p>\n' +
        '<p style="margin:0 0 16px 0;">Body line.</p>\n' +
        '<p style="margin:0 0 16px 0;">Best regards,<br>Abdul Rafay</p>'
    );
  });

  it('keeps other attributes and leaves styled paragraphs alone', () => {
    expect(withParagraphSpacing('<p class="lead">A</p>')).toBe(
      '<p class="lead" style="margin:0 0 16px 0;">A</p>'
    );
    expect(withParagraphSpacing('<p style="color:red">A</p>')).toBe('<p style="color:red">A</p>');
  });

  it('does not touch tags that only start with p', () => {
    const html = '<pre>code</pre><param name="x">';
    expect(withParagraphSpacing(html)).toBe(html);
  });
});
