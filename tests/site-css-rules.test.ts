// The public site's layout answers to its container and to the reader's own
// font size, never to a viewport measurement. That is a property of the
// stylesheet, not a preference, so it is asserted rather than described.
// `src/site/README.md` § Responsiveness has no breakpoints.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(resolve(__dirname, '..', join('src/site/site.css')), 'utf8');

/** Every `@media (...)` condition in the file, whatever it tests. */
function mediaConditions(): string[] {
  return [...CSS.matchAll(/@media\s*([^{]+)\{/g)].map(([, cond]) => cond.trim());
}

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
    const pxType = [...CSS.matchAll(/(font-size|line-height)\s*:\s*[^;]*\d(px|pt)/g)].map(
      ([m]) => m,
    );
    expect(pxType, `pixel type: ${pxType.join(' · ')}`).toEqual([]);
  });

  // Sizes and spaces come from the two Utopia scales so that a heading and
  // the gap above it move together. A bespoke clamp() breaks exactly that.
  it('declares every type size as a scale step', () => {
    const offenders = [...CSS.matchAll(/font-size\s*:\s*([^;]+);/g)]
      .map(([, value]) => value.trim())
      .filter((v) => !/^var\(--step-|^inherit$|^0\.95em$/.test(v));
    expect(offenders, `off-scale font sizes: ${offenders.join(' · ')}`).toEqual([]);
  });
});
