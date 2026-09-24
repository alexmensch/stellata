// The public stylesheet's house rules, asserted rather than described.
// `src/site/styles/README.md` § House style, § Responsiveness has no breakpoints.

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(resolve(__dirname, '..', join('src/site/styles/site.css')), 'utf8');

/** Comments removed, so prose naming a property cannot register as CSS. */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '');

/** Comments removed except the `── Section` banners, kept as marker lines. */
const LAYERED = CSS.replace(/\/\*([\s\S]*?)\*\//g, (_, body: string) => {
  const banner = body.match(/── [A-Za-z]+/);
  return banner === null ? '' : `\n/*${banner[0]}*/\n`;
});

function sliceAt(text: string, marker: string): { before: string; after: string } {
  const at = text.indexOf(marker);
  if (at < 0) throw new Error(`site.css has no ${marker} section`);
  return { before: text.slice(0, at), after: text.slice(at) };
}

const ROOT_BLOCK = /:root\s*\{[\s\S]*?\n\}/.exec(CODE);
if (ROOT_BLOCK === null) throw new Error('site.css has no :root token block');
const TOKENS_CSS = ROOT_BLOCK[0];
const RULES_CSS = CODE.slice(0, ROOT_BLOCK.index) + CODE.slice(ROOT_BLOCK.index + TOKENS_CSS.length);

interface Declaration {
  prop: string;
  value: string;
}

/** Every declaration, a rule's last one included whether or not it ends in `;`. */
function declarations(css: string): Declaration[] {
  return [...css.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)[;}]/g)].map(([, prop, value]) => ({
    prop,
    value: value.replace('!important', '').trim(),
  }));
}

const RULES = declarations(RULES_CSS).filter(({ prop }) => !prop.startsWith('--'));
const TOKENS = new Map(
  [...TOKENS_CSS.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]),
);

/** A value with every balanced `var(…)` removed; balanced because a fallback nests. */
function stripVars(value: string): string {
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
  return out;
}

const shown = (found: Declaration[]): string => found.map((d) => `${d.prop}: ${d.value}`).join(' · ');

describe('the public stylesheet carries no breakpoints', () => {
  it('never asks how big the viewport is', () => {
    const conditions = [...CODE.matchAll(/@media\s*([^{]+)\{/g)].map(([, cond]) => cond.trim());
    const sized = conditions.filter((c) => /\b(width|height|inline-size|block-size|aspect-ratio)\b/.test(c));
    expect(sized, `viewport-sized media queries: ${sized.join(' · ')}`).toEqual([]);
  });

  it('sizes no type in pixels, directly or through a token', () => {
    const typeProps = new Set(['font', 'font-size', 'line-height']);
    const pxType = RULES.filter(({ prop, value }) => {
      if (!typeProps.has(prop)) return false;
      const referenced = [...value.matchAll(/var\((--[\w-]+)/g)].map(([, name]) => TOKENS.get(name) ?? '');
      return [value, ...referenced].some((v) => /\d(px|pt)\b/.test(v));
    });
    expect(pxType, `pixel type: ${shown(pxType)}`).toEqual([]);
  });

  it('declares every type size as a scale step', () => {
    const offenders = RULES.filter(
      ({ prop, value }) =>
        prop === 'font-size' && !/^var\(--step-|^var\(--code-size\)$|^inherit$/.test(value),
    );
    expect(offenders, `off-scale font sizes: ${shown(offenders)}`).toEqual([]);
  });

  it('guards every grid minimum with min()', () => {
    const unguarded = [...CODE.matchAll(/minmax\(\s*(?!min\()([^,]+),/g)].map(([m]) => m);
    expect(unguarded, `minmax() without min(): ${unguarded.join(' · ')}`).toEqual([]);
  });
});

describe('the public stylesheet hardcodes no values', () => {
  const NAMED_COLOUR =
    /\b(white|black|red|green|blue|gray|grey|silver|yellow|orange|purple|pink|navy|teal|cyan|magenta)\b/;
  const COLOUR_FUNCTION = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/;

  it('paints no colour outside the token block', () => {
    const literals = RULES.filter(
      ({ value }) => /#[0-9a-fA-F]{3,8}\b/.test(value) || COLOUR_FUNCTION.test(value) || NAMED_COLOUR.test(value),
    );
    expect(literals, `colour literals outside :root: ${shown(literals)}`).toEqual([]);
  });

  it('mixes every alpha variant in the token block rather than restating one', () => {
    const restated = [...TOKENS].filter(([, value]) => COLOUR_FUNCTION.test(value));
    expect(restated.map(([name, value]) => `${name}: ${value}`)).toEqual([]);
  });

  // Placement integers and the visually-hidden clip are structure, not sizes.
  const STRUCTURAL = new Set(['grid-area', 'grid-row', 'grid-column', 'clip-path']);

  it('carries no bare value in any rule', () => {
    const offenders = RULES.filter(
      ({ prop, value }) =>
        !STRUCTURAL.has(prop) &&
        /\d/.test(stripVars(value).replace(/\b(0|1|100%|1fr|1px)(?![\w.%])/g, '')),
    );
    expect(offenders, `bare values: ${shown(offenders)}`).toEqual([]);
  });

  it('takes every typographic value from a token or a keyword', () => {
    const typographic = new Set(['line-height', 'letter-spacing', 'font-weight', 'border-radius', 'opacity']);
    const offenders = RULES.filter(
      ({ prop, value }) =>
        typographic.has(prop) && !/^var\(--[\w-]+\)$/.test(value) && !/^[a-z]+$/.test(value),
    );
    expect(offenders, `untokenised typography: ${shown(offenders)}`).toEqual([]);
  });

  it('spaces everything from the scale', () => {
    const offenders = RULES.filter(
      ({ prop, value }) =>
        /^(gap|margin|padding)(-[a-z-]+)?$/.test(prop) &&
        stripVars(value).replace(/\b(0|auto)\b/g, '').trim() !== '',
    );
    expect(offenders, `off-scale spacing: ${shown(offenders)}`).toEqual([]);
  });
});

describe('the public stylesheet keeps the CUBE cascade order', () => {
  it('emits utilities after every block', () => {
    const composition = CSS.indexOf('── Composition');
    const lastBlock = CSS.lastIndexOf('── Block:');
    const utilities = CSS.indexOf('── Utilities');
    expect(composition, 'no Composition section').toBeGreaterThan(-1);
    expect(lastBlock, 'no Block sections').toBeGreaterThan(-1);
    expect(utilities, 'no Utilities section').toBeGreaterThan(-1);
    expect(composition).toBeLessThan(lastBlock);
    expect(lastBlock).toBeLessThan(utilities);
  });

  // A block restating the global margin reset cascades after .flow and
  // cancels its gap silently.
  it('declares no vertical margin after the composition layer', () => {
    const offenders = declarations(sliceAt(LAYERED, '── Block').after).filter(({ prop }) =>
      /^margin(-block(-start|-end)?|-top|-bottom)?$/.test(prop),
    );
    expect(offenders, `vertical margins outside .flow: ${shown(offenders)}`).toEqual([]);
  });

  it('marks every utility declaration !important, and nothing else', () => {
    const { before, after } = sliceAt(LAYERED, '── Utilities');
    const plain = [...after.matchAll(/([a-z-]+\s*:[^;{}]+)[;}]/g)]
      .map(([, decl]) => decl.trim())
      .filter((decl) => !decl.includes('!important'));
    expect(after).toMatch(/!important/);
    expect(plain, `utilities without !important: ${plain.join(' · ')}`).toEqual([]);
    expect(before).not.toMatch(/!important/);
  });

  it('keeps --flow-space from inheriting into a nested .flow', () => {
    expect(CODE).toMatch(/@property --flow-space\s*\{[^}]*inherits:\s*false/);
  });
});

// `styles/README.md` § House style — both pills share one hover.
describe('the filled call to action inverts the outlined one', () => {
  const ruleFor = (selector: string): { at: number; body: string } => {
    const at = CODE.indexOf(`${selector} {`);
    expect(at, `no ${selector} rule`).toBeGreaterThan(-1);
    return { at, body: CODE.slice(at, CODE.indexOf('}', at)) };
  };

  it('fills with the accent and drops its text to the page ground', () => {
    const { body } = ruleFor('.pill[data-primary]');
    expect(body).toMatch(/background:\s*var\(--accent\)/);
    expect(body).toMatch(/color:\s*var\(--bg\)/);
  });

  it('empties on hover into the outlined pill’s one hover treatment', () => {
    const primary = ruleFor('.pill[data-primary]');
    const hover = ruleFor('.pill:hover');
    expect(hover.at).toBeGreaterThan(primary.at);
    expect(hover.body).toMatch(/background:\s*var\(--pill-bg\)/);
    expect(hover.body).toMatch(/color:\s*var\(--accent\)/);
    expect(CODE).not.toContain('.pill[data-primary]:hover');
  });
});

describe('the public stylesheet uses logical properties', () => {
  // overflow-x: the one exception, `styles/README.md` § House style.
  const PHYSICAL =
    /^(width|height|(min|max)-(width|height)|top|right|bottom|left|inset|float|clear|overflow-y|(margin|padding|border)-(top|right|bottom|left)(-[a-z]+)?)$/;

  it('declares no physical box property', () => {
    const found = RULES.filter(({ prop }) => PHYSICAL.test(prop));
    expect(found, `physical properties: ${shown(found)}`).toEqual([]);
  });

  it('scrolls horizontally in one place only', () => {
    expect(RULES.filter(({ prop }) => prop === 'overflow-x')).toHaveLength(1);
  });

  it('aligns text to start and end, not left and right', () => {
    const found = RULES.filter(({ prop, value }) => prop === 'text-align' && /^(left|right)$/.test(value));
    expect(found, `physical text-align: ${shown(found)}`).toEqual([]);
  });

  it('aligns the sources table on its cells, where a th would otherwise centre', () => {
    expect(CODE).not.toMatch(/\.sources\s*\{[^}]*text-align/);
    expect(CODE).toMatch(/\.sources :is\(th, td\)\s*\{[^}]*text-align:\s*start/);
    expect(CODE).toMatch(/\.sources :is\(th, td\):nth-child\(2\)\s*\{[^}]*text-align:\s*end/);
  });
});
