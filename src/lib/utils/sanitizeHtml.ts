/**
 * Dependency-free allowlist sanitizer for outreach email HTML.
 *
 * Email bodies are stored as HTML, edited in a `contentEditable`, rendered with
 * `dangerouslySetInnerHTML` and sent over SMTP, so the same sanitizer has to run
 * on the server (Node, no DOM) and in the browser. It is a small hand-rolled
 * tokenizer: no npm dependency, no `DOMParser`, no `document`.
 *
 * Everything is an allowlist: unknown tags, unknown attributes and unknown URL
 * schemes are dropped rather than patched.
 */

/** Tags kept in the output. Anything else is dropped (its text usually stays). */
export const ALLOWED_EMAIL_TAGS: readonly string[] = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'a',
  'span',
  'div',
  'ul',
  'ol',
  'li',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'img',
];

/** Attributes kept per tag. A tag missing from this map keeps no attributes. */
export const ALLOWED_EMAIL_ATTRIBUTES: Readonly<Record<string, readonly string[]>> = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'width', 'height'],
  p: ['style'],
  div: ['style'],
  span: ['style'],
  br: [],
  strong: [],
  b: [],
  em: [],
  i: [],
  u: [],
  ul: [],
  ol: [],
  li: [],
  blockquote: [],
  h1: [],
  h2: [],
  h3: [],
  h4: [],
};

const ALLOWED_TAGS = new Set(ALLOWED_EMAIL_TAGS);

/** Tags rendered as `<tag />`, never with a closing tag. */
const VOID_TAGS = new Set(['br', 'img']);

/** Tags whose element *and* content are dropped, because the content is code. */
const DROP_CONTENT_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'svg',
  'math',
  'link',
  'meta',
  'title',
  'head',
]);

/** Of the above, the void ones: there is no end tag to skip to. */
const DROP_CONTENT_VOID_TAGS = new Set(['link', 'meta', 'embed']);

/** Attributes whose value is a URL and therefore scheme-checked. */
const URL_ATTRIBUTES = new Set(['href', 'src']);

const SAFE_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

const SAFE_STYLE_PROPERTIES = new Set([
  'color',
  'background-color',
  'font-weight',
  'font-style',
  'text-decoration',
  'text-align',
  'margin',
  'margin-top',
  'margin-bottom',
  'margin-left',
  'margin-right',
  'padding',
  'line-height',
  'font-size',
  'font-family',
]);

/** Declaration values containing any of these are dropped. */
const UNSAFE_STYLE_VALUE = /expression\(|url\(|javascript:|@import/;

/** Entities an attacker can hide a scheme behind (`java&#115;cript:`, `&colon;`). */
const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  apos: "'",
  colon: ':',
  gt: '>',
  lt: '<',
  nbsp: ' ',
  newline: '\n',
  num: '#',
  quot: '"',
  semi: ';',
  sol: '/',
  tab: '\t',
};

const ENTITY_RE = /&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);?/g;

/** Decodes numeric and a few named entities once. Unknown entities are kept. */
function decodeEntitiesOnce(value: string): string {
  return value.replace(ENTITY_RE, (match, body: string) => {
    if (body.charAt(0) === '#') {
      const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
      const code = Number.parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

/**
 * Normalizes a value before pattern-matching it: entities decoded (a few rounds,
 * so `&amp;#115;` cannot hide anything), whitespace and control characters
 * stripped, lower-cased. Only ever used for *checks* - the original text is what
 * gets written out.
 */
function normalizeForChecks(value: string): string {
  let out = value;
  for (let round = 0; round < 3; round += 1) {
    const next = decodeEntitiesOnce(out);
    if (next === out) break;
    out = next;
  }
  return out.replace(/[\s\u0000- \u007f]/g, '').toLowerCase();
}

/** `data:image/...` is allowed for `img src` only, and never SVG (it can script). */
function isSafeDataImage(cleaned: string): boolean {
  const match = /^data:image\/([a-z0-9.+-]+)[;,]/.exec(cleaned);
  if (!match) return false;
  return !match[1].includes('svg');
}

function isSafeUrl(tag: string, attribute: string, rawValue: string): boolean {
  const cleaned = normalizeForChecks(rawValue);
  if (cleaned === '') return false;

  const scheme = /^([a-z][a-z0-9+.-]*):/.exec(cleaned);
  if (scheme) {
    if (SAFE_URL_SCHEMES.has(scheme[1])) return true;
    if (scheme[1] === 'data' && attribute === 'src' && tag === 'img') return isSafeDataImage(cleaned);
    return false;
  }
  // No scheme: only root-relative paths and fragments.
  return cleaned.startsWith('/') || cleaned.startsWith('#');
}

/**
 * Keeps only safe declarations, each in its original spelling, joined with `; `.
 * Returns '' when nothing survives, which drops the attribute.
 */
function sanitizeStyle(value: string): string {
  const kept: string[] = [];
  for (const raw of value.split(';')) {
    const declaration = raw.trim();
    if (declaration === '') continue;
    const colon = declaration.indexOf(':');
    if (colon <= 0) continue;
    const property = declaration.slice(0, colon).trim().toLowerCase();
    const propertyValue = declaration.slice(colon + 1).trim();
    if (propertyValue === '' || !SAFE_STYLE_PROPERTIES.has(property)) continue;
    if (UNSAFE_STYLE_VALUE.test(normalizeForChecks(propertyValue))) continue;
    kept.push(declaration);
  }
  return kept.join('; ');
}

/** `&` is left alone so already-encoded entities are not double-encoded. */
function escapeAttributeValue(value: string): string {
  return value.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isWhitespace(char: string): boolean {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '\f' || char === '\v';
}

interface ParsedAttribute {
  name: string;
  value: string;
}

interface ParsedTagRest {
  attributes: ParsedAttribute[];
  /** Index just past the tag, or the end of the string when unterminated. */
  end: number;
  selfClosing: boolean;
  /** False when the string ran out before the closing `>`. */
  terminated: boolean;
}

/** Reads attributes from just after a start tag's name up to its `>` or `/>`. */
function parseTagRest(html: string, from: number): ParsedTagRest {
  const attributes: ParsedAttribute[] = [];
  const length = html.length;
  let index = from;
  let selfClosing = false;
  let terminated = false;

  while (index < length) {
    const char = html[index];
    if (isWhitespace(char)) {
      index += 1;
      continue;
    }
    if (char === '>') {
      terminated = true;
      index += 1;
      break;
    }
    if (char === '/') {
      if (html[index + 1] === '>') {
        selfClosing = true;
        terminated = true;
        index += 2;
        break;
      }
      index += 1;
      continue;
    }

    const nameStart = index;
    while (index < length) {
      const nameChar = html[index];
      if (isWhitespace(nameChar) || nameChar === '>' || nameChar === '/' || nameChar === '=') break;
      index += 1;
    }
    if (index === nameStart) {
      // A stray '=' or similar: skip it so we always make progress.
      index += 1;
      continue;
    }
    const name = html.slice(nameStart, index);

    while (index < length && isWhitespace(html[index])) index += 1;

    let value = '';
    if (html[index] === '=') {
      index += 1;
      while (index < length && isWhitespace(html[index])) index += 1;
      const quote = html[index];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, index + 1);
        if (close === -1) {
          value = html.slice(index + 1);
          index = length;
        } else {
          value = html.slice(index + 1, close);
          index = close + 1;
        }
      } else {
        const valueStart = index;
        while (index < length && !isWhitespace(html[index]) && html[index] !== '>') index += 1;
        value = html.slice(valueStart, index);
      }
    }

    attributes.push({ name, value });
  }

  return { attributes, end: index, selfClosing, terminated };
}

/** Index just past the matching end tag, or the end of the string. */
function skipToEndTag(html: string, tag: string, from: number): number {
  const closeRe = new RegExp(`</\\s*${tag}[^>]*>`, 'gi');
  closeRe.lastIndex = from;
  const match = closeRe.exec(html);
  return match ? match.index + match[0].length : html.length;
}

function renderStartTag(tag: string, attributes: ParsedAttribute[]): string {
  const allowed = ALLOWED_EMAIL_ATTRIBUTES[tag] ?? [];
  const kept: ParsedAttribute[] = [];
  const seen = new Set<string>();

  for (const attribute of attributes) {
    const name = attribute.name.toLowerCase();
    // The allowlist is what drops on*, id, class, srcset, formaction and data-*.
    if (!allowed.includes(name) || seen.has(name)) continue;

    if (URL_ATTRIBUTES.has(name)) {
      if (!isSafeUrl(tag, name, attribute.value)) continue;
      seen.add(name);
      kept.push({ name, value: attribute.value });
      continue;
    }
    if (name === 'style') {
      const style = sanitizeStyle(attribute.value);
      if (style === '') continue;
      seen.add(name);
      kept.push({ name, value: style });
      continue;
    }
    seen.add(name);
    kept.push({ name, value: attribute.value });
  }

  if (tag === 'a' && seen.has('href')) {
    const target = kept.find((attribute) => attribute.name === 'target');
    if (target && target.value.trim().toLowerCase() === '_blank') {
      const relIndex = kept.findIndex((attribute) => attribute.name === 'rel');
      const tokens = (relIndex === -1 ? '' : kept[relIndex].value).split(/\s+/).filter(Boolean);
      const present = new Set(tokens.map((token) => token.toLowerCase()));
      for (const token of ['noopener', 'noreferrer']) {
        if (!present.has(token)) tokens.push(token);
      }
      const value = tokens.join(' ');
      if (relIndex === -1) kept.push({ name: 'rel', value });
      else kept[relIndex] = { name: 'rel', value };
    }
  }

  let out = `<${tag}`;
  for (const attribute of kept) out += ` ${attribute.name}="${escapeAttributeValue(attribute.value)}"`;
  return out + (VOID_TAGS.has(tag) ? ' />' : '>');
}

const END_TAG_RE = /<\/\s*([a-zA-Z][a-zA-Z0-9]*)[^>]*>/y;
const START_TAG_NAME_RE = /<([a-zA-Z][a-zA-Z0-9]*)/y;

/**
 * Sanitizes an outreach email body against the tag/attribute allowlists above.
 *
 * - Unknown tags are unwrapped (`<section>hi</section>` -> `hi`); the tags in
 *   `DROP_CONTENT_TAGS` are removed together with their content.
 * - `href`/`src` keep only http(s), mailto, tel, `/`- or `#`-relative URLs, plus
 *   `data:image/*` (not SVG) on `img src`.
 * - `style` keeps only a safe subset of declarations.
 * - `<a target="_blank" href=...>` always gets `rel="noopener noreferrer"`.
 * - Text and existing entities pass through untouched; a bare `<` is escaped.
 *
 * Never throws: malformed input is dropped, not reported.
 */
export function sanitizeEmailHtml(html: string): string {
  if (typeof html !== 'string' || html === '') return '';

  const length = html.length;
  let out = '';
  let index = 0;

  while (index < length) {
    const lt = html.indexOf('<', index);
    if (lt === -1) {
      out += html.slice(index);
      break;
    }
    out += html.slice(index, lt);

    // Comments, doctypes, CDATA and processing instructions: dropped outright.
    if (html.startsWith('<!--', lt)) {
      const close = html.indexOf('-->', lt + 4);
      index = close === -1 ? length : close + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const close = html.indexOf('>', lt + 2);
      index = close === -1 ? length : close + 1;
      continue;
    }

    if (html.startsWith('</', lt)) {
      END_TAG_RE.lastIndex = lt;
      const match = END_TAG_RE.exec(html);
      if (!match) {
        // Not a real end tag ('</ x', or truncated): drop the remainder of a
        // truncated tag, otherwise treat the '<' as text.
        if (html.indexOf('>', lt) === -1) {
          index = length;
        } else {
          out += '&lt;';
          index = lt + 1;
        }
        continue;
      }
      const tag = match[1].toLowerCase();
      if (ALLOWED_TAGS.has(tag) && !VOID_TAGS.has(tag)) out += `</${tag}>`;
      index = END_TAG_RE.lastIndex;
      continue;
    }

    START_TAG_NAME_RE.lastIndex = lt;
    const nameMatch = START_TAG_NAME_RE.exec(html);
    if (!nameMatch) {
      // A bare '<' in text ('5 < 10', '<-', '< p').
      out += '&lt;';
      index = lt + 1;
      continue;
    }

    const tag = nameMatch[1].toLowerCase();
    const rest = parseTagRest(html, START_TAG_NAME_RE.lastIndex);
    if (!rest.terminated) {
      // '<p' / '<a href="x' at the end of the string: drop the partial tag.
      index = length;
      continue;
    }

    if (DROP_CONTENT_TAGS.has(tag)) {
      index =
        rest.selfClosing || DROP_CONTENT_VOID_TAGS.has(tag)
          ? rest.end
          : skipToEndTag(html, tag, rest.end);
      continue;
    }

    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap: the tag goes, the content stays.
      index = rest.end;
      continue;
    }

    out += renderStartTag(tag, rest.attributes);
    index = rest.end;
  }

  return out;
}
