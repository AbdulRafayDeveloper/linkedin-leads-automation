/** @jest-environment node */
import { toSafePublicUrl } from '../safeUrl';

describe('toSafePublicUrl', () => {
  it('accepts public http(s) sites and adds the missing scheme', () => {
    expect(toSafePublicUrl('acme.com')).toEqual({ ok: true, url: 'https://acme.com/' });
    expect(toSafePublicUrl(' https://acme.com/contact ')).toMatchObject({ ok: true });
    expect(toSafePublicUrl('http://blog.acme.co.uk/path?x=1')).toMatchObject({ ok: true });
  });

  it.each([
    ['localhost:3000'],
    ['http://127.0.0.1/admin'],
    ['http://10.0.0.5'],
    ['http://192.168.1.1'],
    ['http://172.16.0.9'],
    ['http://169.254.169.254/latest/meta-data'],
    ['http://metadata.google.internal'],
    ['https://printer.local'],
    ['http://[::1]/'],
  ])('refuses the internal host %s', (input) => {
    expect(toSafePublicUrl(input).ok).toBe(false);
  });

  it.each([['javascript:alert(1)'], ['file:///etc/passwd'], ['ftp://acme.com'], ['data:text/html,<script>']])(
    'refuses the scheme in %s',
    (input) => {
      expect(toSafePublicUrl(input).ok).toBe(false);
    }
  );

  it('refuses empty input and hostnames without a dot', () => {
    expect(toSafePublicUrl('')).toMatchObject({ ok: false });
    expect(toSafePublicUrl('   ')).toMatchObject({ ok: false });
    expect(toSafePublicUrl(null)).toMatchObject({ ok: false });
    expect(toSafePublicUrl('intranet')).toMatchObject({ ok: false });
  });

  it('always explains why it refused', () => {
    const result = toSafePublicUrl('http://127.0.0.1');
    expect(result.error).toBeTruthy();
  });
});
