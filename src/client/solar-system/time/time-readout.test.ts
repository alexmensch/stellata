import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createTimeReadout,
  formatDeltaT,
  formatFullTimeReadout,
  formatJdReadout,
  formatTimeReadout,
} from './time-readout';
import { jdTdbToT } from './time';
import type { Stellata } from '../../stellata';

describe('formatTimeReadout', () => {
  it('formats a known Unix-seconds value as plain-English UT', () => {
    // 2026-05-07T18:23:45Z = Unix-seconds 1778264625.
    const t = Date.UTC(2026, 4, 7, 18, 23, 45) / 1000;
    expect(formatTimeReadout(t)).toBe('7 May 2026, 18:23:45 UT');
  });

  it('zero-pads single-digit hours / minutes / seconds', () => {
    const t = Date.UTC(2026, 0, 1, 3, 4, 5) / 1000;
    expect(formatTimeReadout(t)).toBe('1 Jan 2026, 03:04:05 UT');
  });

  it('does NOT zero-pad the day-of-month (matches the chosen plain-English style)', () => {
    const t = Date.UTC(2026, 0, 9, 12, 0, 0) / 1000;
    expect(formatTimeReadout(t)).toBe('9 Jan 2026, 12:00:00 UT');
  });

  it('handles year boundaries in UTC (no off-by-one from local timezone)', () => {
    const t = Date.UTC(2025, 11, 31, 23, 59, 59) / 1000;
    expect(formatTimeReadout(t)).toBe('31 Dec 2025, 23:59:59 UT');
  });

  it('renders all 12 month abbreviations correctly', () => {
    const expected = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    for (let m = 0; m < 12; m++) {
      const t = Date.UTC(2026, m, 15, 0, 0, 0) / 1000;
      expect(formatTimeReadout(t)).toBe(`15 ${expected[m]} 2026, 00:00:00 UT`);
    }
  });

  it('handles fractional Unix-seconds (truncates to integer second)', () => {
    const t = Date.UTC(2026, 4, 7, 18, 23, 45) / 1000 + 0.7;
    expect(formatTimeReadout(t)).toBe('7 May 2026, 18:23:45 UT');
  });

  it('locale-independent — same output regardless of the browser timezone', () => {
    // J2000 epoch: 2000-01-01T12:00:00 UTC. Has been a common gotcha
    // for naive local-timezone formatters in the past.
    const j2000Unix = 946728000;
    expect(formatTimeReadout(j2000Unix)).toBe('1 Jan 2000, 12:00:00 UT');
  });

  it('keeps the proleptic Gregorian calendar in the deep past, astronomical year numbering', () => {
    // The canon labels this instant "-1999 Jun 12" (Julian calendar, TT).
    // The readout deliberately stays Gregorian in every era — the label
    // that tracks the seasons — and reads the UT day, ΔT earlier.
    const d = new Date(0);
    d.setUTCFullYear(-1999, 4, 25);
    d.setUTCHours(14, 20, 26, 0);
    expect(formatTimeReadout(d.getTime() / 1000)).toBe('25 May -1999, 14:20:26 UT');
  });

  it('labels the calendar only when asked — the collapsed readout, not the scrubber', () => {
    expect(formatTimeReadout(946728000, true)).toBe('1 Jan 2000, 12:00:00 UT (Gregorian)');
  });
});

describe('formatDeltaT', () => {
  it('formats hour-scale offsets as h/m', () => {
    expect(formatDeltaT(46438)).toBe('+12h 54m');
    expect(formatDeltaT(74254)).toBe('+20h 38m');
  });

  it('formats minute-scale offsets as m/s', () => {
    expect(formatDeltaT(63.8338127)).toBe('+1m 4s');
    expect(formatDeltaT(75.4)).toBe('+1m 15s');
  });

  it('formats sub-minute offsets as bare seconds, signed', () => {
    expect(formatDeltaT(42.3)).toBe('+42s');
    // ΔT really was negative 1871–1902 (Earth span fast); the sign must show.
    expect(formatDeltaT(-2.7)).toBe('-3s');
  });

  it('rolls a rounded value across the unit boundary instead of printing 60', () => {
    expect(formatDeltaT(59.5)).toBe('+1m 0s');
    expect(formatDeltaT(3599.6)).toBe('+1h 0m');
  });
});

describe('formatJdReadout', () => {
  it('labels the JD with its TT scale and carries ΔT, at J2000', () => {
    // JD(TT) = JD(UT) + ΔT/86400; ΔT at J2000 is 63.834 s = 0.000739 d.
    expect(formatJdReadout(946728000)).toBe('JD 2451545.000739 TT · ΔT +1m 4s');
  });

  it('round-trips a canon-published JD(TT): entering it reads the same JD back', () => {
    // NASA Five Millennium Canon, -1999 Jun 12 (its first total solar
    // eclipse): greatest eclipse JD 991085.63500 TT. The whole point of
    // the line is that this catalogue number is directly matchable.
    const t = jdTdbToT(991085.63500);
    expect(formatJdReadout(t)).toBe('JD 991085.635000 TT · ΔT +12h 54m');
    expect(formatTimeReadout(t)).toBe('25 May -1999, 14:20:26 UT');
  });
});

describe('formatFullTimeReadout', () => {
  it('joins the two lines with a newline for white-space: pre-line', () => {
    expect(formatFullTimeReadout(946728000)).toBe(
      '1 Jan 2000, 12:00:00 UT\nJD 2451545.000739 TT · ΔT +1m 4s',
    );
    expect(formatFullTimeReadout(946728000, true)).toBe(
      '1 Jan 2000, 12:00:00 UT (Gregorian)\nJD 2451545.000739 TT · ΔT +1m 4s',
    );
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
    expect(el.textContent).toBe(formatFullTimeReadout(946728000, true));
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
