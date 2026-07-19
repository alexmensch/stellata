import { describe, it, expect } from 'vitest';
import { formatMoonsLine } from './moon-list-format';

describe('formatMoonsLine', () => {
  it('returns null for a moonless body', () => {
    expect(formatMoonsLine([])).toBeNull();
  });

  it('lists every name uncapped', () => {
    expect(formatMoonsLine(['Io', 'Europa', 'Ganymede', 'Callisto']))
      .toBe('Moons: Io, Europa, Ganymede, Callisto');
  });

  it('shows all names when the count fits the cap exactly', () => {
    expect(formatMoonsLine(['Io', 'Europa', 'Ganymede', 'Callisto'], 4))
      .toBe('Moons: Io, Europa, Ganymede, Callisto');
  });

  it('truncates past the cap with a "+N more" tail (Saturn: 7 → 3 + 4)', () => {
    expect(formatMoonsLine(
      ['Mimas', 'Enceladus', 'Tethys', 'Dione', 'Rhea', 'Titan', 'Iapetus'], 4,
    )).toBe('Moons: Mimas, Enceladus, Tethys +4 more');
  });

  it('a single moon reads as a plain one-name line', () => {
    expect(formatMoonsLine(['Moon'], 4)).toBe('Moons: Moon');
  });
});
