import { afterEach, describe, expect, it } from 'vitest';
import { readPageMargins } from './page-margins';

function stubRoot(vars: Record<string, string>) {
  (globalThis as { document?: unknown }).document = { documentElement: {} };
  (globalThis as { getComputedStyle?: unknown }).getComputedStyle = () => ({
    getPropertyValue: (name: string) => vars[name] ?? '',
  });
}

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { getComputedStyle?: unknown }).getComputedStyle;
});

describe('readPageMargins', () => {
  it('parses the px values off :root', () => {
    stubRoot({
      '--page-margin-x': '14px',
      '--page-margin-top': '10px',
      '--page-margin-bottom': '16px',
    });
    expect(readPageMargins()).toEqual({ x: 14, top: 10, bottom: 16 });
  });

  it('reads 0 for a missing or unparseable property', () => {
    // Without the guard these land as NaN and every consumer's clamp
    // arithmetic silently produces "NaNpx".
    stubRoot({ '--page-margin-x': 'auto' });
    expect(readPageMargins()).toEqual({ x: 0, top: 0, bottom: 0 });
  });
});
