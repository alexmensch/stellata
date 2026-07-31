import { describe, expect, it } from 'vitest';

import { constellationRows } from './constellation-row';

describe('constellationRows', () => {
  // No artifact, no row — a card should not carry a field it can't answer.
  it('emits nothing when the lookup has no answer', () => {
    expect(constellationRows(() => null)).toEqual([]);
  });

  // The row is LIVE for every kind because a planet's constellation is an
  // ephemeris statement: scrub the clock and it changes.
  it('re-reads the lookup on every evaluation', () => {
    let name = 'Taurus';
    const [row] = constellationRows(() => name);
    expect(row.label).toBe('Constellation');
    expect((row.value as () => string)()).toBe('Taurus');
    name = 'Gemini';
    expect((row.value as () => string)()).toBe('Gemini');
  });

  // A frame whose position doesn't resolve holds the last known value rather
  // than blanking a row that was there a moment ago.
  it('falls back to the first answer when a later one is missing', () => {
    let name: string | null = 'Orion';
    const [row] = constellationRows(() => name);
    name = null;
    expect((row.value as () => string)()).toBe('Orion');
  });
});
