import { describe, expect, it } from 'vitest';

import { siblingSlug } from './sibling-artifacts-pure';

describe('siblingSlug', () => {
  it('keeps a clean lower-case key and kebab-cases the rest', () => {
    expect(siblingSlug('lmc', 'object')).toBe('lmc');
    expect(siblingSlug('Bootes II', 'object')).toBe('bootes-ii');
    expect(siblingSlug('Mon OB1 / NGC 2264', 'cloud')).toBe('mon-ob1-ngc-2264');
  });

  it('drops a letter outside ASCII', () => {
    expect(siblingSlug('Orion λ', 'cloud')).toBe('orion');
  });

  it('falls back when nothing survives', () => {
    expect(siblingSlug('…', 'object')).toBe('object');
    expect(siblingSlug('λ', 'cloud')).toBe('cloud');
  });
});
