// The public site's layout answers to its container and to the reader's own
// font size, never to a viewport measurement, and every value it paints comes
// from a token. Those are properties of the stylesheet, not preferences, so
// they are asserted rather than described.
// `src/site/README.md` § The stylesheet, § Responsiveness has no breakpoints.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(resolve(__dirname, '..', join('src/site/site.css')), 'utf8');

/**
 * The stylesheet with comments removed. Every declaration scan reads this, so
 * prose that happens to contain a property name cannot register as CSS. The
 * layer-order test reads CSS itself, because the section markers are comments.
 */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every `@media (...)` condition in the file, whatever it tests. */
function mediaConditions(): string[] {
  return [...CODE.matchAll(/@media\s*([^{]+)\{/g)].map(([, cond]) => cond.trim());
}

/** The file with its `:root` token block removed — where literals are legal. */
function outsideTokens(): string {
  const root = CODE.match(/:root\s*\{[\s\S]*?\n\}/);
  return root ? CODE.slice(0, root.index) + CODE.slice(root.index! + root[0].length) : CODE;
}

/**
 * A property value with every balanced `var(…)`, `0` and `auto` removed, so
 * what remains is whatever the declaration hardcoded. Balanced rather than
 * regex because a fallback nests: `var(--a, var(--b) var(--c))`.
 */
function stripTokens(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    if (value.startsWith('var(', i)) {
      let depth = 0;
      for (; i < value.length; i += 1) {
        if (value[i] === '(') depth += 1;
        else if (value[i] === ')' && (depth -= 1) === 0) break;
      }
    } else {
      out += value[i];
    }
  }
  return out.replace(/\b(0|auto)\b/g, '').trim();
}

/**
 * The stylesheet with comments removed *except* its `── Section` banners,
 * each kept as a bare marker line. Slicing a layer needs the banners, and
 * scanning declarations needs the prose gone; this is both.
 */
const LAYERED = CSS.replace(/\/\*([\s\S]*?)\*\//g, (whole, body: string) => {
  const banner = body.match(/── [A-Za-z]+/);
  return banner === null ? '' : `\n/*${banner[0]}*/\n`;
});

describe('the public stylesheet carries no breakpoints', () => {
  // A width breakpoint asserts that one pixel either side of it is a
  // different design, which is never true of a model looked at on every
  // shape of screen. The switcher's flex-basis calc replaces them.
  it('never asks how wide the viewport is', () => {
    const sized = mediaConditions().filter((c) => /(min|max)-(width|height)/.test(c));
    expect(sized, `viewport-sized media queries: ${sized.join(' · ')}`).toEqual([]);
  });

  // A px font size overrides the reader's own browser setting, which more
  // people change than use some whole browsers.
  it('sizes no type in pixels', () => {
    const pxType = [...CODE.matchAll(/(font-size|line-height)\s*:\s*[^;]*\d(px|pt)/g)].map(
      ([m]) => m,
    );
    expect(pxType, `pixel type: ${pxType.join(' · ')}`).toEqual([]);
  });

  // Sizes and spaces come from the two Utopia scales so that a heading and
  // the gap above it move together. A bespoke clamp() breaks exactly that.
  it('declares every type size as a scale step', () => {
    const offenders = [...CODE.matchAll(/font-size\s*:\s*([^;]+);/g)]
      .map(([, value]) => value.trim())
      .filter((v) => !/^var\(--step-|^var\(--code-size\)$|^inherit$/.test(v));
    expect(offenders, `off-scale font sizes: ${offenders.join(' · ')}`).toEqual([]);
  });

  // A rem grid minimum grows with the reader's font size while the viewport
  // does not, so a bare minmax() fits a 320px screen at a 16px root and
  // overflows it at the 32px root that WCAG 1.4.4's 200% resize implies.
  // min(x, 100%) collapses the track instead, and costs nothing.
  it('guards every grid minimum with min()', () => {
    const unguarded = [...CODE.matchAll(/minmax\(\s*(?!min\()([^,]+),/g)].map(([m]) => m);
    expect(unguarded, `minmax() without min(): ${unguarded.join(' · ')}`).toEqual([]);
  });
});

describe('the public stylesheet hardcodes no values', () => {
  // src/design-tokens.css is the only place a colour of both surfaces is
  // written; a site-only colour is defined in this file's :root. Either way a
  // rule paints from a token, so alpha variants are color-mix()es of one.
  it('paints no colour outside the token block', () => {
    const literals = [...outsideTokens().matchAll(/[^-\w](#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/g)]
      .map(([m]) => m.trim());
    expect(literals, `colour literals outside :root: ${literals.join(' · ')}`).toEqual([]);
  });

  // Leading, tracking, weight and radius are named sets like the sizes are,
  // so the visual language changes in one place. A keyword is not a value the
  // system has to hold.
  it('takes every typographic value from a token', () => {
    const typographic =
      /(?:^|\n)\s*(line-height|letter-spacing|font-weight|border-radius|opacity)\s*:\s*([^;]+);/g;
    const offenders = [...CODE.matchAll(typographic)]
      .map(([, prop, value]) => ({ prop, value: value.trim() }))
      .filter(({ value }) => !/^var\(--[\w-]+\)$/.test(value) && !/^[a-z]+$/.test(value))
      .map(({ prop, value }) => `${prop}: ${value}`);
    expect(offenders, `untokenised typography: ${offenders.join(' · ')}`).toEqual([]);
  });

  // Every gap, margin and padding is a scale step, so the page's rhythm moves
  // as one. `0` and `auto` are structural, not sizes.
  it('spaces everything from the scale', () => {
    const spacing = /(?:^|\n)\s*((?:gap|margin|padding)(?:-[a-z-]+)?)\s*:\s*([^;]+);/g;
    const offenders = [...CODE.matchAll(spacing)]
      .map(([, prop, value]) => ({ prop, value: value.replace('!important', '').trim() }))
      .filter(({ value }) => stripTokens(value) !== '')
      .map(({ prop, value }) => `${prop}: ${value}`);
    expect(offenders, `off-scale spacing: ${offenders.join(' · ')}`).toEqual([]);
  });
});

describe('the public stylesheet keeps the CUBE cascade order', () => {
  // tokens → global → compositions → blocks → utilities. Utilities are final
  // adjustments and carry !important, so anything a block must be able to
  // override belongs in the block layer instead.
  it('emits utilities after every block', () => {
    const utilities = CSS.indexOf('── Utilities');
    const lastBlock = CSS.lastIndexOf('── Block:');
    const composition = CSS.indexOf('── Composition');
    expect(composition, 'no Composition section').toBeGreaterThan(-1);
    expect(utilities, 'no Utilities section').toBeGreaterThan(-1);
    expect(lastBlock, 'no Block sections').toBeGreaterThan(-1);
    expect(composition).toBeLessThan(lastBlock);
    expect(lastBlock).toBeLessThan(utilities);
  });

  // The defect this catches, twice over: `.spec-list { margin: 0 }` and
  // `.plate { margin: 0 }` restated the global reset in the block layer,
  // which cascades AFTER compositions — so each cancelled the gap `.flow`
  // had given it and the element sat flush against the one above. A block
  // needing a reset means adding the element to the global reset, and a
  // block needing a different gap sets `--flow-space`.
  it('declares no vertical margin after the composition layer', () => {
    const blocks = LAYERED.slice(LAYERED.indexOf('── Block'));
    expect(blocks, 'no Block section').not.toBe('');
    const offenders = [
      ...blocks.matchAll(/\n\s+(margin(?:-block(?:-start|-end)?|-top|-bottom)?\s*:[^;]+);/g),
    ].map(([, decl]) => decl.trim());
    expect(
      offenders,
      `vertical margins outside .flow: ${offenders.join(' · ')}`,
    ).toEqual([]);
  });

  it('marks every utility declaration !important', () => {
    const layer = CODE.slice(CODE.indexOf('.wrapper'));
    const plain = [...layer.matchAll(/\n\s{2}([a-z-]+\s*:[^;]+);/g)]
      .map(([, decl]) => decl.trim())
      .filter((decl) => !decl.includes('!important'));
    expect(plain, `utilities without !important: ${plain.join(' · ')}`).toEqual([]);
  });
});

describe('the public stylesheet uses logical properties', () => {
  // The physical property is wrong the moment the writing mode or direction
  // changes, and there is a logical equivalent for every one of these.
  it('declares no physical box property', () => {
    const physical =
      /(?:^|[;{\s])(width|height|min-width|max-width|min-height|max-height|top|right|bottom|left|margin-(?:top|right|bottom|left)|padding-(?:top|right|bottom|left)|border-(?:top|right|bottom|left))\s*:/g;
    const found = [...CODE.matchAll(physical)].map(([, prop]) => prop);
    expect(found, `physical properties: ${found.join(' · ')}`).toEqual([]);
  });

  it('aligns text to start and end, not left and right', () => {
    const found = [...CODE.matchAll(/text-align\s*:\s*(left|right)/g)].map(([m]) => m);
    expect(found, `physical text-align: ${found.join(' · ')}`).toEqual([]);
  });
});
