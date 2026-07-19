import { describe, it, expect } from 'vitest';
import { moonRosterText } from './moon-list-format';

describe('moonRosterText', () => {
  it('returns null for a moonless body', () => {
    expect(moonRosterText([])).toBeNull();
  });

  it('lists every name uncapped', () => {
    expect(moonRosterText(['Io', 'Europa', 'Ganymede', 'Callisto']))
      .toBe('Io, Europa, Ganymede, Callisto');
  });

  it('shows all names when the count fits the cap exactly', () => {
    expect(moonRosterText(['Io', 'Europa', 'Ganymede', 'Callisto'], 4))
      .toBe('Io, Europa, Ganymede, Callisto');
  });

  it('truncates past the cap with a "+N more" tail (Saturn: 7 -> 3 + 4)', () => {
    expect(moonRosterText(
      ['Mimas', 'Enceladus', 'Tethys', 'Dione', 'Rhea', 'Titan', 'Iapetus'], 4,
    )).toBe('Mimas, Enceladus, Tethys +4 more');
  });

  it('a single moon reads as a plain one-name roster', () => {
    expect(moonRosterText(['Moon'], 4)).toBe('Moon');
  });
});
