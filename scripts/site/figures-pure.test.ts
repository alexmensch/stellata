import { describe, expect, it } from 'vitest';

import { FIGURE_NAMES, substituteFigures } from './figures-pure';

const figures = Object.fromEntries(FIGURE_NAMES.map((name) => [name, `value of ${name}`]));

describe('substituteFigures', () => {
  it.each(FIGURE_NAMES)('fills %s in', (name) => {
    expect(substituteFigures(`<p>%${name}%</p>`, figures, 'page.html')).toBe(`<p>value of ${name}</p>`);
  });

  it('refuses a token naming no published figure, even one the environment holds', () => {
    expect(() => substituteFigures('%VITE_STAR_CUONT%', { ...figures, VITE_STAR_CUONT: '1' }, 'page.html')).toThrow(
      /page\.html: %VITE_STAR_CUONT% is not a published figure/,
    );
  });

  it('reads a digit in a name as part of it', () => {
    expect(() => substituteFigures('%VITE_STAR_COUNT2%', figures, 'page.html')).toThrow(/not a published figure/);
  });

  it.each([
    ['absent', {}],
    ['empty', { VITE_STAR_COUNT: '' }],
  ])('refuses a figure whose value is %s', (_, env) => {
    expect(() => substituteFigures('%VITE_STAR_COUNT%', env, 'page.html')).toThrow(/has no value/);
  });

  it('leaves text with no token as it is', () => {
    expect(substituteFigures('100% of 5%', figures, 'page.html')).toBe('100% of 5%');
  });
});
