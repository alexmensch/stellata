import { describe, it, expect, vi, afterEach } from 'vitest';
import { createTimeReadout, formatTimeReadout } from './time-readout';
import type { Stellata } from '../stellata';

describe('formatTimeReadout', () => {
  it('formats a known Unix-seconds value as plain-English UTC', () => {
    // 2026-05-07T18:23:45Z = Unix-seconds 1778264625.
    const t = Date.UTC(2026, 4, 7, 18, 23, 45) / 1000;
    expect(formatTimeReadout(t)).toBe('7 May 2026, 18:23:45 UTC');
  });

  it('zero-pads single-digit hours / minutes / seconds', () => {
    const t = Date.UTC(2026, 0, 1, 3, 4, 5) / 1000;
    expect(formatTimeReadout(t)).toBe('1 Jan 2026, 03:04:05 UTC');
  });

  it('does NOT zero-pad the day-of-month (matches the chosen plain-English style)', () => {
    const t = Date.UTC(2026, 0, 9, 12, 0, 0) / 1000;
    expect(formatTimeReadout(t)).toBe('9 Jan 2026, 12:00:00 UTC');
  });

  it('handles year boundaries in UTC (no off-by-one from local timezone)', () => {
    const t = Date.UTC(2025, 11, 31, 23, 59, 59) / 1000;
    expect(formatTimeReadout(t)).toBe('31 Dec 2025, 23:59:59 UTC');
  });

  it('renders all 12 month abbreviations correctly', () => {
    const expected = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    for (let m = 0; m < 12; m++) {
      const t = Date.UTC(2026, m, 15, 0, 0, 0) / 1000;
      expect(formatTimeReadout(t)).toBe(`15 ${expected[m]} 2026, 00:00:00 UTC`);
    }
  });

  it('handles fractional Unix-seconds (truncates to integer second)', () => {
    const t = Date.UTC(2026, 4, 7, 18, 23, 45) / 1000 + 0.7;
    expect(formatTimeReadout(t)).toBe('7 May 2026, 18:23:45 UTC');
  });

  it('locale-independent — same output regardless of the browser timezone', () => {
    // J2000 epoch: 2000-01-01T12:00:00 UTC. Has been a common gotcha
    // for naive local-timezone formatters in the past.
    const j2000Unix = 946728000;
    expect(formatTimeReadout(j2000Unix)).toBe('1 Jan 2000, 12:00:00 UTC');
  });
});

describe('createTimeReadout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeMockStellata(t = 946728000) {
    return {
      getT: () => t,
    } as unknown as Stellata;
  }

  it('always-on: mounts visible regardless of focus / warp / chart state', () => {
    const el = { textContent: '', hidden: true } as unknown as HTMLElement;
    const stellata = makeMockStellata();
    const teardown = createTimeReadout({ el, stellata });
    expect(el.hidden).toBe(false);
    expect(el.textContent).toBe('1 Jan 2000, 12:00:00 UTC');
    teardown();
  });

  it('teardown clears the per-second tick timer', () => {
    vi.useFakeTimers();
    const el = { textContent: '', hidden: true } as unknown as HTMLElement;
    let t = 1_000_000_000;
    const stellata = { getT: () => t } as unknown as Stellata;
    const teardown = createTimeReadout({ el, stellata });
    const initial = el.textContent;
    t += 60; // 60 s elapsed
    vi.advanceTimersByTime(1000);
    expect(el.textContent).not.toBe(initial);
    teardown();
    const afterTeardown = el.textContent;
    t += 60;
    vi.advanceTimersByTime(5000);
    expect(el.textContent).toBe(afterTeardown);
  });
});
