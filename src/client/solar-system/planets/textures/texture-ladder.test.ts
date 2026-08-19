import { describe, expect, it } from 'vitest';

import { TEXTURE_LADDER } from './texture-ladder-generated';
import {
  meanLuminanceOf,
  requiredMapWidth,
  rungsOf,
  selectRung,
  TEXTURE_TIER_DROP,
  TEXTURE_TIER_LEAD,
} from './texture-ladder';

// The build writes texture-ladder-generated.ts; these pin the selection rules
// over it, and the shape of the generated table itself. Rationale for each
// rule: README.md § Texture tier selection.

describe('the generated ladder', () => {
  it('lists ascending rungs for every body, with no duplicates', () => {
    for (const [body, row] of Object.entries(TEXTURE_LADDER)) {
      expect(row.rungs.length, body).toBeGreaterThan(0);
      for (let i = 1; i < row.rungs.length; i++) {
        expect(row.rungs[i], `${body} rung ${i}`).toBeGreaterThan(row.rungs[i - 1]);
      }
    }
  });

  it('never exceeds the 8192 top of the ladder', () => {
    for (const [body, row] of Object.entries(TEXTURE_LADDER)) {
      expect(row.rungs[row.rungs.length - 1], body).toBeLessThanOrEqual(8192);
    }
  });

  it('caps the cloud and haze bodies at their own master widths', () => {
    // Not an oversight: a fluid atmosphere has no high-frequency detail to
    // photograph, so no sharper map was ever built. Pinned so a future
    // session reads a missing rung as a source limit rather than a bug.
    expect(rungsOf('venus')).toEqual([1024, 1800]);
    expect(rungsOf('neptune')).toEqual([1024, 1800]);
    expect(rungsOf('saturn')).toEqual([1024, 2048, 2880]);
    expect(rungsOf('jupiter')).toEqual([1024, 2048, 3601]);
    expect(rungsOf('titan')).toEqual([1024, 2048, 4040]);
  });

  it('carries the re-pulled bodies all the way to 8192', () => {
    for (const body of ['moon', 'earth', 'io', 'europa', 'ganymede', 'callisto']) {
      expect(rungsOf(body), body).toEqual([1024, 2048, 4096, 8192]);
    }
  });

  it('has no row for a body that ships no map', () => {
    // Uranus is texture-less by design; selection must return null rather
    // than request a rung that would 404 every frame.
    expect(rungsOf('uranus')).toBeNull();
    expect(selectRung('uranus', 4000, null)).toBeNull();
    expect(meanLuminanceOf('uranus')).toBeNull();
  });

  it('gives every body a positive mean luminance', () => {
    for (const [body, row] of Object.entries(TEXTURE_LADDER)) {
      expect(row.meanLuminance, body).toBeGreaterThan(0);
      expect(row.meanLuminance, body).toBeLessThan(1);
    }
  });
});

describe('requiredMapWidth', () => {
  it('spends two texels of map width per device pixel of disc', () => {
    // An equirect map spans 360 deg across its width; the visible hemisphere
    // is 180 deg, so the disc diameter is covered by W/2 texels.
    expect(requiredMapWidth(1000, 1)).toBe(2000);
    expect(requiredMapWidth(1000, 2)).toBe(4000);
  });

  it('reproduces the display cases the ladder was sized from', () => {
    // 1080p dpr 1: a body at the camera floor spans 972 css px.
    expect(requiredMapWidth(972, 1)).toBe(1944);
    // 5K, 1440 css px at dpr 2 — the case that needs the top rung.
    expect(requiredMapWidth(2592, 2)).toBe(10368);
  });
});

describe('selectRung', () => {
  it('rounds up, never to the nearest', () => {
    // 1025 px of demand on a 1024 rung is under-resolved; the guarantee is
    // that the image is always at least as sharp as the display conveys.
    expect(selectRung('moon', 1025, null)).toBe(2048);
    expect(selectRung('moon', 1024, null)).toBe(1024);
  });

  it('clamps to the top rung rather than asking for one that does not exist', () => {
    expect(selectRung('moon', 99999, null)).toBe(8192);
    // Venus tops out at its master width, so a 5K approach still gets 1800.
    expect(selectRung('venus', 10368, null)).toBe(1800);
  });

  it('leads the swap before the resident rung is actually outgrown', () => {
    // Resident 2048, demand 1600: rule 1 alone would keep 2048, and the
    // swap would then start only once the map was already soft.
    expect(1600).toBeGreaterThanOrEqual(TEXTURE_TIER_LEAD * 2048);
    expect(selectRung('moon', 1600, 2048)).toBe(4096);
    // Comfortably inside the resident rung: no load.
    expect(selectRung('moon', 1400, 2048)).toBe(2048);
  });

  it('does not lead past the top rung', () => {
    expect(selectRung('moon', 7000, 8192)).toBe(8192);
    expect(selectRung('venus', 1700, 1800)).toBe(1800);
  });

  it('holds across the band rather than swapping on every wobble', () => {
    // Between DROP and LEAD of the resident width nothing moves. Most camera
    // motion lives here and costs nothing.
    expect(selectRung('moon', 0.5 * 8192, 8192)).toBe(8192);
    expect(selectRung('moon', TEXTURE_TIER_DROP * 8192 + 1, 8192)).toBe(8192);
    expect(selectRung('moon', TEXTURE_TIER_LEAD * 8192 - 1, 8192)).toBe(8192);
  });

  it('drops once the body has shrunk well past what it holds', () => {
    // The case the eviction budget cannot reach on its own: a body still
    // drawn every frame is stamped used every frame, so an 8192 it no longer
    // needs would be pinned forever. Dropping is also the CHEAP direction —
    // 2.8 MB uploaded to free 176 MB.
    expect(selectRung('moon', 20, 8192)).toBeLessThan(8192);
    expect(selectRung('moon', 1, 8192)).toBe(1024);
  });

  it('lands where neither rule fires again — a true fixed point', () => {
    // The whole safety argument for allowing downgrades. Feed the selector
    // its own answer at a fixed demand and it must settle, not oscillate.
    for (const demand of [1, 7, 40, 200, 900, 1500, 3000, 5000, 9000, 20000]) {
      let rung = selectRung('moon', demand, null)!;
      const seen = new Set<number>();
      for (let i = 0; i < 20; i++) {
        const next = selectRung('moon', demand, rung)!;
        if (next === rung) break;
        // Revisiting a width means a cycle, which is exactly the thrash the
        // dead band exists to make impossible.
        expect(seen.has(next), `demand ${demand} cycled at ${next}`).toBe(false);
        seen.add(next);
        rung = next;
      }
      expect(selectRung('moon', demand, rung), `demand ${demand}`).toBe(rung);
    }
  });

  it('keeps the dead band wide enough to be a band at all', () => {
    // If DROP ever reached LEAD the two rules would meet and every body near
    // a boundary would swap every frame.
    expect(TEXTURE_TIER_DROP).toBeLessThan(TEXTURE_TIER_LEAD);
    // Dropping targets demand/LEAD, so the landing rung sits at least this
    // far under its own upgrade threshold.
    expect(TEXTURE_TIER_DROP).toBeLessThan(TEXTURE_TIER_LEAD * TEXTURE_TIER_LEAD);
  });

  it('holds a small map on a distant body whatever the display', () => {
    // Strictly better than one tier per device: most of the time a body is
    // nowhere near the camera floor.
    expect(selectRung('mars', requiredMapWidth(4, 2), null)).toBe(1024);
  });
});
