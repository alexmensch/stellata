import { describe, expect, it } from 'vitest';

import { creditCount, recordCountOf, versionOf } from './site-metrics';

describe('the catalogue size with no built artifact', () => {
  it('is the count snapshot beside the build', () => {
    expect(recordCountOf(null, () => '{"recordCount":12345}', 'quote-snapshot')).toBe(12345);
    expect(recordCountOf(null, () => '{"stages":{"records":{"recordCount":12345}}}', 'quote-snapshot')).toBe(12345);
  });

  it.each([
    ['no recordCount', '{}'],
    ['a non-integer recordCount', '{"recordCount":"12,345"}'],
    ['a zero recordCount', '{"recordCount":0}'],
  ])('refuses a snapshot with %s', (_, snapshot) => {
    expect(() => recordCountOf(null, () => snapshot, 'quote-snapshot')).toThrow(/states no recordCount/);
  });

  it('stops a production build rather than quoting the snapshot', () => {
    const snapshot = (): string => { throw new Error('read the snapshot'); };
    expect(() => recordCountOf(null, snapshot, 'refuse')).toThrow(/catalog\.bin\.0 is not built — run pnpm run build:catalog/);
  });
});

describe('a figure that cannot be read stops the build', () => {
  it.each(['quote-snapshot', 'refuse'] as const)(
    'refuses a catalogue that is present but unreadable, rather than quoting the snapshot (%s)',
    (absent) => {
      const snapshot = (): string => { throw new Error('read the snapshot'); };
      expect(() => recordCountOf(Buffer.from('version https://git-lfs'), snapshot, absent)).toThrow(/magic/i);
    },
  );

  it('refuses a Credits tab it finds no sources in', () => {
    const html = '<div class="modal-credits"><div class="credit-entry"><div class="credit-label">Stars</div></div></div>';
    expect(() => creditCount(html)).toThrow(/no credited sources/);
  });

  it.each([
    ['no version', '{}'],
    ['an empty version', '{"version":""}'],
  ])('refuses a package.json with %s', (_, manifest) => {
    expect(() => versionOf(manifest)).toThrow(/states no version/);
  });

  it('reads the version package.json states', () => {
    expect(versionOf('{"version":"7.0.0"}')).toBe('7.0.0');
  });
});

describe('the Credits count reads structure, not layout', () => {
  it('counts the same sources however the markup is indented', () => {
    const entry = (label: string, n: number): string =>
      `<div class="credit-entry"><div class="credit-label">${label}</div>${'<div>a source</div>'.repeat(n)}</div>`;
    expect(creditCount(`<div class="modal-credits">${entry('Stars', 3)}\n\n\t${entry('Dust', 2)}</div>`)).toBe(5);
  });
});
