/** @jest-environment node */
import {
  ALLOWED_EMAIL_ATTRIBUTES,
  ALLOWED_EMAIL_TAGS,
  sanitizeEmailHtml,
} from '../sanitizeHtml';

describe('sanitizeEmailHtml', () => {
  it('runs without a DOM, so it is safe on the server', () => {
    expect(typeof document).toBe('undefined');
    expect(sanitizeEmailHtml('<p>Hi</p>')).toBe('<p>Hi</p>');
  });

  describe('empty and non-string input', () => {
    it('returns an empty string for empty input', () => {
      expect(sanitizeEmailHtml('')).toBe('');
    });

    it('returns an empty string for undefined-ish input', () => {
      const loose = sanitizeEmailHtml as unknown as (value: unknown) => string;
      expect(loose(undefined)).toBe('');
      expect(loose(null)).toBe('');
      expect(loose(0)).toBe('');
      expect(loose({})).toBe('');
    });
  });

  describe('clean input is left alone', () => {
    it('round-trips an already-clean body byte for byte', () => {
      const clean = '<p>Hi Abdul,</p>\n<p>Body <strong>x</strong></p>';
      expect(sanitizeEmailHtml(clean)).toBe(clean);
    });

    it('keeps every allowed tag', () => {
      const html =
        '<h1>A</h1><h2>B</h2><h3>C</h3><h4>D</h4>' +
        '<p>p <strong>strong</strong> <b>b</b> <em>em</em> <i>i</i> <u>u</u> <span>span</span></p>' +
        '<div>div</div><ul><li>one</li></ul><ol><li>two</li></ol><blockquote>quote</blockquote>';
      expect(sanitizeEmailHtml(html)).toBe(html);
    });

    it('keeps text content and already-encoded entities untouched', () => {
      const html = '<p>Tom &amp; Jerry &lt;3 &#39;quoted&#39; &nbsp;end</p>';
      expect(sanitizeEmailHtml(html)).toBe(html);
    });
  });

  describe('tag allowlist', () => {
    it('unwraps an unknown tag but keeps its text', () => {
      expect(sanitizeEmailHtml('<section>hi</section>')).toBe('hi');
      expect(sanitizeEmailHtml('<h5>x</h5>')).toBe('x');
      expect(sanitizeEmailHtml('<table><tr><td>cell</td></tr></table>')).toBe('cell');
      expect(sanitizeEmailHtml('<form><button>Send</button></form>')).toBe('Send');
    });

    it('lower-cases tag names', () => {
      expect(sanitizeEmailHtml('<P>Hi</P>')).toBe('<p>Hi</p>');
      expect(sanitizeEmailHtml('<STRONG>x</STRONG>')).toBe('<strong>x</strong>');
    });

    it('drops stray end tags of tags that are not allowed', () => {
      expect(sanitizeEmailHtml('<p>a</p></section></td>')).toBe('<p>a</p>');
    });

    it('drops HTML comments, doctypes and processing instructions', () => {
      expect(sanitizeEmailHtml('<!-- secret -->keep')).toBe('keep');
      expect(sanitizeEmailHtml('<!DOCTYPE html><p>x</p>')).toBe('<p>x</p>');
      expect(sanitizeEmailHtml('<?php echo 1; ?>x')).toBe('x');
      expect(sanitizeEmailHtml('<!-- unterminated')).toBe('');
    });
  });

  describe('tags dropped together with their content', () => {
    it('drops a script element and everything inside it', () => {
      expect(sanitizeEmailHtml('<script>alert(1)</script>')).toBe('');
      expect(sanitizeEmailHtml('<p>a</p><script>alert(1)</script><p>b</p>')).toBe('<p>a</p><p>b</p>');
    });

    it('drops an uppercase script element', () => {
      expect(sanitizeEmailHtml('<SCRIPT>alert(1)</SCRIPT>')).toBe('');
      expect(sanitizeEmailHtml('before<ScRiPt type="text/javascript">alert(1)</sCrIpT>after')).toBe(
        'beforeafter',
      );
    });

    it('drops a style block and its CSS', () => {
      expect(sanitizeEmailHtml('<style>p{color:red}</style>hi')).toBe('hi');
      expect(sanitizeEmailHtml('<style media="all">@import url(evil.css);</style>')).toBe('');
    });

    it('drops an iframe and its content', () => {
      expect(sanitizeEmailHtml('<iframe src="https://evil.example"></iframe>ok')).toBe('ok');
      expect(sanitizeEmailHtml('<iframe>fallback</iframe>')).toBe('');
    });

    it('drops the remaining content-dropping tags', () => {
      expect(sanitizeEmailHtml('<object data="x.swf">fallback</object>z')).toBe('z');
      expect(sanitizeEmailHtml('<noscript><img src="https://x.example/p.gif"></noscript>z')).toBe('z');
      expect(sanitizeEmailHtml('<template><p>tpl</p></template>z')).toBe('z');
      expect(sanitizeEmailHtml('<svg><script>alert(1)</script></svg>z')).toBe('z');
      expect(sanitizeEmailHtml('<math><mi>x</mi></math>z')).toBe('z');
      expect(sanitizeEmailHtml('<head><title>t</title></head>z')).toBe('z');
      expect(sanitizeEmailHtml('<title>t</title>z')).toBe('z');
    });

    it('drops only the tag for void content-dropping tags', () => {
      expect(sanitizeEmailHtml('<link rel="stylesheet" href="evil.css">after')).toBe('after');
      expect(sanitizeEmailHtml('<meta http-equiv="refresh" content="0;url=evil">after')).toBe('after');
      expect(sanitizeEmailHtml('<embed src="evil.swf">after')).toBe('after');
    });

    it('drops everything after an unclosed script', () => {
      expect(sanitizeEmailHtml('<p>a</p><script>alert(1)')).toBe('<p>a</p>');
    });
  });

  describe('attribute allowlist', () => {
    it('drops every on* event handler', () => {
      expect(sanitizeEmailHtml('<div onclick="x">hi</div>')).toBe('<div>hi</div>');
      expect(sanitizeEmailHtml('<p onmouseover="alert(1)">hi</p>')).toBe('<p>hi</p>');
      expect(sanitizeEmailHtml('<img src=x onerror=alert(1)>')).toBe('<img />');
      expect(sanitizeEmailHtml('<a href="https://x.example" ONCLICK="alert(1)">x</a>')).toBe(
        '<a href="https://x.example">x</a>',
      );
    });

    it('drops id, class, data-* and other non-allowlisted attributes', () => {
      expect(sanitizeEmailHtml('<p id="a" class="b" data-x="c" contenteditable="true">hi</p>')).toBe(
        '<p>hi</p>',
      );
      expect(sanitizeEmailHtml('<img src="/a.png" srcset="/b.png 2x" loading="lazy">')).toBe(
        '<img src="/a.png" />',
      );
      expect(sanitizeEmailHtml('<a href="/x" formaction="https://evil.example" download>x</a>')).toBe(
        '<a href="/x">x</a>',
      );
    });

    it('keeps the allowed attributes of a and img', () => {
      expect(sanitizeEmailHtml('<a href="https://x.example" title="T">x</a>')).toBe(
        '<a href="https://x.example" title="T">x</a>',
      );
      expect(sanitizeEmailHtml('<img src="/logo.png" alt="Logo" width="24" height="24">')).toBe(
        '<img src="/logo.png" alt="Logo" width="24" height="24" />',
      );
    });

    it('allows style only on p, div and span', () => {
      expect(sanitizeEmailHtml('<p style="color: red">x</p>')).toBe('<p style="color: red">x</p>');
      expect(sanitizeEmailHtml('<div style="color: red">x</div>')).toBe('<div style="color: red">x</div>');
      expect(sanitizeEmailHtml('<span style="color: red">x</span>')).toBe(
        '<span style="color: red">x</span>',
      );
      expect(sanitizeEmailHtml('<li style="color: red">x</li>')).toBe('<li>x</li>');
      expect(sanitizeEmailHtml('<h1 style="color: red">x</h1>')).toBe('<h1>x</h1>');
    });

    it('parses an attribute without quotes', () => {
      expect(sanitizeEmailHtml('<a href=https://example.com>x</a>')).toBe(
        '<a href="https://example.com">x</a>',
      );
      expect(sanitizeEmailHtml('<img src=/logo.png width=10>')).toBe('<img src="/logo.png" width="10" />');
    });

    it('parses single quotes and quote characters inside a value', () => {
      expect(sanitizeEmailHtml("<a href='https://example.com' title=\"it's fine\">x</a>")).toBe(
        '<a href="https://example.com" title="it\'s fine">x</a>',
      );
    });

    it('escapes quotes and angle brackets when writing a value back out', () => {
      expect(sanitizeEmailHtml('<a href="/x" title=\'say "hi" <b>\'>x</a>')).toBe(
        '<a href="/x" title="say &quot;hi&quot; &lt;b&gt;">x</a>',
      );
    });

    it('keeps the first of a duplicated attribute', () => {
      expect(sanitizeEmailHtml('<a href="https://good.example" href="javascript:alert(1)">x</a>')).toBe(
        '<a href="https://good.example">x</a>',
      );
    });

    it('tolerates whitespace and newlines inside a tag', () => {
      expect(sanitizeEmailHtml('<a\n   href="/x"\n   title="T"\n>x</a>')).toBe(
        '<a href="/x" title="T">x</a>',
      );
      expect(sanitizeEmailHtml('<p   >x</p   >')).toBe('<p>x</p>');
    });
  });

  describe('URL attributes', () => {
    it.each([
      ['https://example.com/a?b=1&amp;c=2', 'https://example.com/a?b=1&amp;c=2'],
      ['http://example.com', 'http://example.com'],
      ['mailto:abdul@example.com', 'mailto:abdul@example.com'],
      ['tel:+15550001111', 'tel:+15550001111'],
      ['/relative/path', '/relative/path'],
      ['#anchor', '#anchor'],
    ])('keeps the safe href %s', (href, expected) => {
      expect(sanitizeEmailHtml(`<a href="${href}">x</a>`)).toBe(`<a href="${expected}">x</a>`);
    });

    it.each([
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      'java&#115;cript:alert(1)',
      'java&#x73;cript:alert(1)',
      '&#106;avascript:alert(1)',
      'javascript&colon;alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'vbscript:msgbox(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'data:image/png;base64,AAAA',
      'ftp://example.com/x',
      'file:///etc/passwd',
      'relative/without/slash',
      '',
    ])('drops the unsafe href %j', (href) => {
      expect(sanitizeEmailHtml(`<a href="${href}">x</a>`)).toBe('<a>x</a>');
    });

    it('drops a javascript: value hidden behind a control character', () => {
      expect(sanitizeEmailHtml('<a href="jav\u0000ascript:alert(1)">x</a>')).toBe('<a>x</a>');
    });

    it('keeps a data:image source on img only', () => {
      expect(sanitizeEmailHtml('<img src="data:image/png;base64,iVBORw0KGgo=">')).toBe(
        '<img src="data:image/png;base64,iVBORw0KGgo=" />',
      );
      expect(sanitizeEmailHtml('<img src="data:image/gif;base64,R0lGOD">')).toBe(
        '<img src="data:image/gif;base64,R0lGOD" />',
      );
      expect(sanitizeEmailHtml('<a href="data:image/png;base64,iVBORw0KGgo=">x</a>')).toBe('<a>x</a>');
    });

    it('drops a data:image/svg+xml source, because SVG can script', () => {
      expect(sanitizeEmailHtml('<img src="data:image/svg+xml;base64,PHN2Zz4=">')).toBe('<img />');
    });

    it('drops a non-image data: source on img', () => {
      expect(sanitizeEmailHtml('<img src="data:text/html,<b>x</b>">')).toBe('<img />');
    });
  });

  describe('style attribute', () => {
    it('keeps only safe declarations and drops the rest', () => {
      expect(
        sanitizeEmailHtml(
          '<div style="color:#333;text-align:left;position:fixed;top:0;font-size: 14px">x</div>',
        ),
      ).toBe('<div style="color:#333; text-align:left; font-size: 14px">x</div>');
    });

    it('keeps every property on the safe list', () => {
      const style =
        'color: red; background-color: #fff; font-weight: bold; font-style: italic; ' +
        'text-decoration: underline; text-align: center; margin: 0; margin-top: 1px; ' +
        'margin-bottom: 2px; margin-left: 3px; margin-right: 4px; padding: 5px; ' +
        'line-height: 1.5; font-size: 12px; font-family: Arial, sans-serif';
      expect(sanitizeEmailHtml(`<p style="${style}">x</p>`)).toBe(`<p style="${style}">x</p>`);
    });

    it('drops a declaration whose value is dangerous', () => {
      expect(sanitizeEmailHtml('<p style="background:url(javascript:alert(1))">x</p>')).toBe('<p>x</p>');
      expect(sanitizeEmailHtml('<p style="background-color: url(javascript:alert(1))">x</p>')).toBe(
        '<p>x</p>',
      );
      expect(sanitizeEmailHtml('<span style="color: expression(alert(1))">x</span>')).toBe(
        '<span>x</span>',
      );
      expect(sanitizeEmailHtml('<span style="color: EXPRESSION (alert(1))">x</span>')).toBe(
        '<span>x</span>',
      );
      expect(sanitizeEmailHtml('<p style="font-family: javascript:alert(1)">x</p>')).toBe('<p>x</p>');
      expect(sanitizeEmailHtml('<p style="font-size: 12px; color: url(&#106;avascript:x)">x</p>')).toBe(
        '<p style="font-size: 12px">x</p>',
      );
    });

    it('drops the attribute when nothing survives', () => {
      expect(sanitizeEmailHtml('<p style="">x</p>')).toBe('<p>x</p>');
      expect(sanitizeEmailHtml('<p style="   ;  ;">x</p>')).toBe('<p>x</p>');
      expect(sanitizeEmailHtml('<p style="position:absolute">x</p>')).toBe('<p>x</p>');
      expect(sanitizeEmailHtml('<p style="color">x</p>')).toBe('<p>x</p>');
      expect(sanitizeEmailHtml('<p style="color:">x</p>')).toBe('<p>x</p>');
    });
  });

  describe('target and rel on links', () => {
    it('adds rel="noopener noreferrer" to a target="_blank" link', () => {
      expect(sanitizeEmailHtml('<a href="https://x.example" target="_blank">x</a>')).toBe(
        '<a href="https://x.example" target="_blank" rel="noopener noreferrer">x</a>',
      );
    });

    it('completes an existing rel without losing its tokens', () => {
      expect(
        sanitizeEmailHtml('<a href="https://x.example" target="_blank" rel="nofollow">x</a>'),
      ).toBe('<a href="https://x.example" target="_blank" rel="nofollow noopener noreferrer">x</a>');
      expect(
        sanitizeEmailHtml('<a href="/x" target="_BLANK" rel="noreferrer noopener">x</a>'),
      ).toBe('<a href="/x" target="_BLANK" rel="noreferrer noopener">x</a>');
    });

    it('leaves rel alone when there is no target="_blank"', () => {
      expect(sanitizeEmailHtml('<a href="https://x.example">x</a>')).toBe(
        '<a href="https://x.example">x</a>',
      );
      expect(sanitizeEmailHtml('<a href="https://x.example" target="_self">x</a>')).toBe(
        '<a href="https://x.example" target="_self">x</a>',
      );
    });

    it('adds no rel when the href was dropped', () => {
      expect(sanitizeEmailHtml('<a href="javascript:alert(1)" target="_blank">x</a>')).toBe(
        '<a target="_blank">x</a>',
      );
    });
  });

  describe('self-closing normalization', () => {
    it.each(['<br>', '<br/>', '<br />', '<BR>', '<br   />'])('normalizes %s to <br />', (input) => {
      expect(sanitizeEmailHtml(input)).toBe('<br />');
    });

    it('drops attributes from br and ignores its end tag', () => {
      expect(sanitizeEmailHtml('<p>a<br class="x">b</br></p>')).toBe('<p>a<br />b</p>');
    });

    it('normalizes img to a self-closing tag', () => {
      expect(sanitizeEmailHtml('<img src="/a.png">')).toBe('<img src="/a.png" />');
      expect(sanitizeEmailHtml('<img src="/a.png"/>')).toBe('<img src="/a.png" />');
      expect(sanitizeEmailHtml('<img src="/a.png" />')).toBe('<img src="/a.png" />');
    });
  });

  describe('bare angle brackets and malformed input', () => {
    it('escapes a bare < that is not part of a tag', () => {
      expect(sanitizeEmailHtml('<p>5 < 10</p>')).toBe('<p>5 &lt; 10</p>');
      expect(sanitizeEmailHtml('I <3 LeadForge')).toBe('I &lt;3 LeadForge');
      expect(sanitizeEmailHtml('<')).toBe('&lt;');
      expect(sanitizeEmailHtml('a <- b')).toBe('a &lt;- b');
    });

    it('drops a truncated tag at the end of the string', () => {
      expect(sanitizeEmailHtml('<p>hi</p><p')).toBe('<p>hi</p>');
      expect(sanitizeEmailHtml('<p>hi</p></p')).toBe('<p>hi</p>');
      expect(sanitizeEmailHtml('<p>hi</p><a href="https://x.example')).toBe('<p>hi</p>');
    });

    it('leaves an unclosed tag unbalanced rather than throwing', () => {
      expect(sanitizeEmailHtml('<p>hi')).toBe('<p>hi');
      expect(sanitizeEmailHtml('<div><p>hi</div>')).toBe('<div><p>hi</div>');
    });

    it.each([
      '<',
      '>',
      '<>',
      '</>',
      '< p >',
      '</ p>',
      '<p',
      '<p ',
      '<p =',
      '<p ="x">y</p>',
      '<<p>>x<</p>>',
      '<a href=">x</a>',
      '<a href="\'\'">x</a>',
      '<a href=\'"\'>x</a>',
      '<script',
      '<script>',
      '<!',
      '<!-',
      '<![CDATA[x]]>',
      '<p style=>x</p>',
      '<p style="color:red;;;">x</p>',
      '<img src=x y=1 /',
      '\u0000<p>\u0000</p>',
      'plain text only',
    ])('does not throw on %j', (input) => {
      expect(() => sanitizeEmailHtml(input)).not.toThrow();
      expect(typeof sanitizeEmailHtml(input)).toBe('string');
    });

    it('never leaves a script, iframe or event handler in the output', () => {
      const nasty = [
        '<script>alert(1)</script>',
        '<SCRIPT SRC=//evil.example></SCRIPT>',
        '<img src=x onerror=alert(1)>',
        '<a href="javascript:alert(1)">x</a>',
        '<div onclick="x">y</div>',
        '<iframe src="javascript:alert(1)"></iframe>',
        '<style>body{background:url(javascript:alert(1))}</style>',
        '<svg onload=alert(1)><circle /></svg>',
        '<body onload=alert(1)>',
        '<object data="javascript:alert(1)"></object>',
        '<p style="background:url(javascript:alert(1))">x</p>',
      ].join('');
      const out = sanitizeEmailHtml(nasty);
      expect(out.toLowerCase()).not.toContain('javascript');
      expect(out.toLowerCase()).not.toContain('<script');
      expect(out.toLowerCase()).not.toContain('<iframe');
      expect(out.toLowerCase()).not.toContain('onerror');
      expect(out.toLowerCase()).not.toContain('onload');
      expect(out.toLowerCase()).not.toContain('onclick');
    });
  });

  describe('exported allowlists', () => {
    it('lists exactly the documented tags', () => {
      expect([...ALLOWED_EMAIL_TAGS].sort()).toEqual(
        [
          'a',
          'b',
          'blockquote',
          'br',
          'div',
          'em',
          'h1',
          'h2',
          'h3',
          'h4',
          'i',
          'img',
          'li',
          'ol',
          'p',
          'span',
          'strong',
          'u',
          'ul',
        ].sort(),
      );
    });

    it('lists the attributes for a, img and the style-bearing tags', () => {
      expect(ALLOWED_EMAIL_ATTRIBUTES.a).toEqual(['href', 'title', 'target', 'rel']);
      expect(ALLOWED_EMAIL_ATTRIBUTES.img).toEqual(['src', 'alt', 'width', 'height']);
      expect(ALLOWED_EMAIL_ATTRIBUTES.p).toEqual(['style']);
      expect(ALLOWED_EMAIL_ATTRIBUTES.div).toEqual(['style']);
      expect(ALLOWED_EMAIL_ATTRIBUTES.span).toEqual(['style']);
    });

    it('has an entry for every allowed tag and nothing else', () => {
      expect(Object.keys(ALLOWED_EMAIL_ATTRIBUTES).sort()).toEqual([...ALLOWED_EMAIL_TAGS].sort());
      for (const tag of ALLOWED_EMAIL_TAGS) {
        if (['a', 'img', 'p', 'div', 'span'].includes(tag)) continue;
        expect(ALLOWED_EMAIL_ATTRIBUTES[tag]).toEqual([]);
      }
    });
  });

  it('is idempotent', () => {
    const inputs = [
      '<p>Hi Abdul,</p>\n<p>Body <strong>x</strong></p>',
      '<a href="https://x.example" target="_blank">x</a>',
      '<p>5 < 10</p>',
      '<section><img src=x onerror=alert(1)>hi</section>',
      '<div style="color:#333;position:fixed">x</div>',
    ];
    for (const input of inputs) {
      const once = sanitizeEmailHtml(input);
      expect(sanitizeEmailHtml(once)).toBe(once);
    }
  });
});
