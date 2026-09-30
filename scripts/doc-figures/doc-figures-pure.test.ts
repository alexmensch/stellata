import { describe, expect, it } from 'vitest';
import { formatFigure, parseFormat, parseMarkers, renderFigures, resolveFigure } from './doc-figures-pure';

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
  });
});

describe('renderFigures', () => {
  it('rewrites a stale figure and reports it', () => {
    const text = `x ${mark('membership-manifest/rows', '975,000')} y`;
    const report = renderFigures(text, snapshots);
    expect(report.rendered).toBe(`x ${mark('membership-manifest/rows', '975,573')} y`);
    expect(report.stale).toEqual(['line 1: count:membership-manifest/rows quotes 975,000, snapshot gives 975,573']);
    expect(report.problems).toEqual([]);
  });

  it('leaves a current figure and every unmarked number alone', () => {
    const text = `1,977 ${mark('membership-manifest/bindingByClass.none', '1,977')} 975,573`;
    expect(renderFigures(text, snapshots)).toEqual({ rendered: text, problems: [], stale: [] });
  });

  it('leaves an unresolvable marker untouched and reports it', () => {
    const text = mark('membership-manifest/gone', '5');
    const report = renderFigures(text, snapshots);
    expect(report.rendered).toBe(text);
    expect(report.problems).toEqual(['line 1: membership-manifest-expected.json has no gone']);
  });
});
