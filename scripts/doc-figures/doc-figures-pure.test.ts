import { describe, expect, it } from 'vitest';
import {
  catalogueSizeFigures,
  formatFigure,
  markerlessSizeForms,
  maskCode,
  parseFormat,
  parseMarkers,
  parseSizeExemptions,
  renderFigures,
  resolveFigure,
} from './doc-figures-pure';

const snapshots = new Map<string, unknown>([
  ['membership-manifest', { rows: 975573, bindingByClass: { none: 1977 }, additionsByReason: { 'admitted:hd_omitted': 5063 } }],
  ['build-binaries-rates', { share: 0.125, label: 'x' }],
]);

const mark = (key: string, body: string, format = '') =>
  `<!-- count:${key}${format ? ` ${format}` : ''} -->${body}<!-- /count -->`;

describe('parseMarkers', () => {
  it('reads key, format, figure and line of each marker', () => {
    const text = `a\nrows ${mark('membership-manifest/rows', '975,573')} and ${mark('membership-manifest/rows', '980k', 'k2')}`;
    const { markers, problems } = parseMarkers(text);
    expect(problems).toEqual([]);
    expect(markers.map((m) => [m.key, m.format, m.body, m.line])).toEqual([
      ['membership-manifest/rows', { kind: 'exact' }, '975,573', 2],
      ['membership-manifest/rows', { kind: 'thousands', digits: 2 }, '980k', 2],
    ]);
  });

  it('reads a marker inside a table cell', () => {
    expect(parseMarkers(`| none | ${mark('membership-manifest/bindingByClass.none', '1,977')} |`).markers).toHaveLength(1);
  });

  it('refuses an unclosed marker, a stray close, a line break and an unknown format', () => {
    expect(parseMarkers('<!-- count:a/b -->1').problems).toEqual(['line 1: count:a/b is never closed']);
    expect(parseMarkers('1<!-- /count -->').problems).toEqual(['line 1: <!-- /count --> with no open marker']);
    expect(parseMarkers(`${mark('a/b', '1')}\n<!-- /count -->`).problems).toEqual([
      'line 2: <!-- /count --> with no open marker',
    ]);
    expect(parseMarkers('<!-- count:a/b -->1\n2<!-- /count -->').problems).toEqual(['line 1: count:a/b spans a line break']);
    expect(parseMarkers(mark('a/b', '1', 'sig0')).problems).toEqual(["line 1: count:a/b has unknown format 'sig0'"]);
  });

  it('reports a missing close once, and still reads the markers after it', () => {
    const { markers, problems } = parseMarkers(`<!-- count:a/b -->1 then ${mark('c/d', '2')} and ${mark('e/f', '3')}`);
    expect(problems).toEqual(['line 1: count:a/b is never closed']);
    expect(markers.map((m) => m.key)).toEqual(['c/d', 'e/f']);
  });

  it('reads a nested open as the outer marker never closing', () => {
    const { markers, problems } = parseMarkers(`<!-- count:a/b -->${mark('c/d', '2')}`);
    expect(problems).toEqual(['line 1: count:a/b is never closed']);
    expect(markers.map((m) => m.key)).toEqual(['c/d']);
  });
});

describe('parseFormat', () => {
  it('knows exact, sigN and kN', () => {
    expect(parseFormat(undefined)).toEqual({ kind: 'exact' });
    expect(parseFormat('sig2')).toEqual({ kind: 'significant', digits: 2 });
    expect(parseFormat('k3')).toEqual({ kind: 'thousands', digits: 3 });
    expect(parseFormat('pct')).toBeNull();
  });
});

describe('resolveFigure', () => {
  it('walks the snapshot by dotted path, keys with colons included', () => {
    expect(resolveFigure('membership-manifest/bindingByClass.none', snapshots)).toEqual({ ok: true, value: 1977 });
    expect(resolveFigure('membership-manifest/additionsByReason.admitted:hd_omitted', snapshots)).toEqual({
      ok: true,
      value: 5063,
    });
  });

  it('names what is missing rather than yielding a number', () => {
    expect(resolveFigure('nope/rows', snapshots)).toEqual({ ok: false, reason: 'no snapshot nope-expected.json' });
    expect(resolveFigure('membership-manifest/bindingByClass.gone', snapshots)).toEqual({
      ok: false,
      reason: 'membership-manifest-expected.json has no bindingByClass.gone',
    });
    expect(resolveFigure('membership-manifest/bindingByClass', snapshots)).toEqual({
      ok: false,
      reason: 'membership-manifest/bindingByClass is not a number',
    });
    expect(resolveFigure('build-binaries-rates/label', snapshots).ok).toBe(false);
    expect(resolveFigure('membership-manifest', snapshots).ok).toBe(false);
  });
});

describe('formatFigure', () => {
  it('groups exact figures and keeps fractions', () => {
    expect(formatFigure(975573, { kind: 'exact' })).toBe('975,573');
    expect(formatFigure(0.125, { kind: 'exact' })).toBe('0.125');
  });

  it('rounds to significant figures, grouped', () => {
    expect(formatFigure(2635, { kind: 'significant', digits: 2 })).toBe('2,600');
    expect(formatFigure(12380, { kind: 'significant', digits: 3 })).toBe('12,400');
    expect(formatFigure(120.5, { kind: 'significant', digits: 2 })).toBe('120');
  });

  it('rounds thousands to significant figures with a k', () => {
    expect(formatFigure(16414, { kind: 'thousands', digits: 3 })).toBe('16.4k');
    expect(formatFigure(63653, { kind: 'thousands', digits: 2 })).toBe('64k');
    expect(formatFigure(10110, { kind: 'thousands', digits: 3 })).toBe('10.1k');
    expect(formatFigure(1247240, { kind: 'thousands', digits: 3 })).toBe('1,250k');
  });
});

describe('catalogueSizeFigures', () => {
  const range = [300_000, 1_030_000] as const;

  it('finds in-range figures on a line about the catalogue, in every spelling', () => {
    expect(catalogueSizeFigures('the 390k-star buffer\n~980,000 records\n313_000 stars', range)).toEqual([
      { figure: '390k', line: 1 },
      { figure: '980,000', line: 2 },
      { figure: '313_000', line: 3 },
    ]);
  });

  it('skips marked figures, lines with no catalogue word, out-of-range and embedded figures', () => {
    const text = [
      `${mark('build-catalog/recordCount', '980k', 'k2')} stars`,
      '390k fetches',
      '254,135 stars',
      '1,247,240 records',
    ].join('\n');
    expect(catalogueSizeFigures(text, range)).toEqual([]);
  });
});

describe('markerlessSizeForms', () => {
  it('is the two roundings a marker would render', () => {
    expect(markerlessSizeForms(979659)).toEqual(['980,000', '980k']);
  });
});

describe('parseSizeExemptions', () => {
  it('reads file, figure and reason, skipping comments and blanks', () => {
    expect(parseSizeExemptions('# head\n\ndocs/a.md\t390k\tstale\n')).toEqual([
      { file: 'docs/a.md', figure: '390k', reason: 'stale' },
    ]);
  });

  it('refuses a missing or unknown reason', () => {
    expect(() => parseSizeExemptions('docs/a.md\t390k')).toThrow('size exemption needs');
    expect(() => parseSizeExemptions('docs/a.md\t390k\tlater')).toThrow('size exemption needs');
  });
});

describe('maskCode', () => {
  it('blanks fenced blocks and inline code, keeping length and newlines', () => {
    const text = 'a `x <!-- /count -->` b\n```\n<!-- count:a/b -->\n```\nc';
    const masked = maskCode(text);
    expect(masked).toHaveLength(text.length);
    expect(masked.split('\n')).toHaveLength(text.split('\n').length);
    expect(masked).not.toContain('<!--');
    expect(masked.startsWith('a ')).toBe(true);
    expect(masked.endsWith('\nc')).toBe(true);
  });

  it('finds code a list item or blockquote wraps across lines', () => {
    const text = '- item `a <!-- /count -->\n  b` end\n\n> quote `c\n> d <!-- /count -->` end';
    expect(maskCode(text)).not.toContain('<!--');
  });
});

describe('renderFigures', () => {
  it('reads no marker inside markdown code, but reads it in html', () => {
    const inCode = `\`${mark('nope/x', '1')}\`\n\n    ${mark('nope/y', '2')}\n\n\`\`\`\n<!-- count:<stem>/<path> -->N<!-- /count -->\n\`\`\``;
    expect(renderFigures(inCode, snapshots, 'markdown')).toEqual({ rendered: inCode, problems: [], stale: [] });
    expect(renderFigures(`<p>${mark('nope/x', '1')}</p>`, snapshots, 'html').problems).toEqual([
      'line 1: no snapshot nope-expected.json',
    ]);
  });

  it('rewrites a stale figure and reports it', () => {
    const text = `x ${mark('membership-manifest/rows', '975,000')} y`;
    const report = renderFigures(text, snapshots, 'markdown');
    expect(report.rendered).toBe(`x ${mark('membership-manifest/rows', '975,573')} y`);
    expect(report.stale).toEqual(['line 1: count:membership-manifest/rows quotes 975,000, snapshot gives 975,573']);
    expect(report.problems).toEqual([]);
  });

  it('leaves a current figure and every unmarked number alone', () => {
    const text = `1,977 ${mark('membership-manifest/bindingByClass.none', '1,977')} 975,573`;
    expect(renderFigures(text, snapshots, 'markdown')).toEqual({ rendered: text, problems: [], stale: [] });
  });

  it('leaves an unresolvable marker untouched and reports it', () => {
    const text = mark('membership-manifest/gone', '5');
    const report = renderFigures(text, snapshots, 'markdown');
    expect(report.rendered).toBe(text);
    expect(report.problems).toEqual(['line 1: membership-manifest-expected.json has no gone']);
  });
});
