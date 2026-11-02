import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SOL_PLANETS } from '../../src/client/solar-system/planet-system';
import { RING_SPANS } from '../../src/client/util/baker-constants';

// See /data/textures/README.md#ring-strips--true-opacity-and-the-8-bit-floor.

const STRIP_W = 2048;

interface RingRow {
  name: string;
  midRadiusKm: number;
  widthKm: number;
  tau: number;
}

function ringTable(body: string): RingRow[] {
  const src = readFileSync(
    resolve(__dirname, `../../data/textures/src/rings-${body}.tsv`),
    'utf-8',
  );
  return src
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('ring\t'))
    .map((l) => {
      const [name, mid, width, tau] = l.split('\t');
      return {
        name,
        midRadiusKm: Number(mid),
        widthKm: Number(width),
        tau: Number(tau),
      };
    });
}

/** Peak 8-bit alpha the strip build can produce for one ring: true
 *  opacity 1−e^−τ, box-average-diluted when narrower than a texel
 *  (the same equivalent-width-conserving math as build-textures.py). */
function peakAlpha8(ring: RingRow, spanKm: [number, number]): number {
  const texelKm = (spanKm[1] - spanKm[0]) / STRIP_W;
  const opacity = 1 - Math.exp(-ring.tau);
  return Math.round(opacity * Math.min(1, ring.widthKm / texelKm) * 255);
}

describe('ring strips', () => {
  const spans: Record<string, [number, number]> = Object.fromEntries(
    Object.entries(RING_SPANS).map(([body, r]) => [body, [r.innerRadiusKm, r.outerRadiusKm]]),
  );

  it('draws strips for Uranus and Neptune', () => {
    expect(Object.keys(spans).sort()).toEqual(['neptune', 'uranus']);
  });

  it('exactly Saturn, Uranus and Neptune carry rings', () => {
    expect(SOL_PLANETS.filter((p) => p.rings).map((p) => p.name)).toEqual([
      'Saturn',
      'Uranus',
      'Neptune',
    ]);
  });

  it('every TSV ring sits inside its strip span', () => {
    for (const [body, [inner, outer]] of Object.entries(spans)) {
      for (const ring of ringTable(body)) {
        expect(ring.midRadiusKm - ring.widthKm / 2).toBeGreaterThanOrEqual(inner);
        expect(ring.midRadiusKm + ring.widthKm / 2).toBeLessThanOrEqual(outer);
      }
    }
  });

  it('all 10 Uranian narrow rings survive 8-bit true opacity', () => {
    const rows = ringTable('uranus');
    expect(rows.length).toBe(10);
    const visible = rows.filter((r) => peakAlpha8(r, spans.uranus) >= 1);
    expect(visible.length).toBe(10);
  });

  it('Neptune: only Le Verrier and Adams survive; the τ~1e-4 sheets render to 0', () => {
    const rows = ringTable('neptune');
    expect(rows.length).toBe(5);
    const alphaByName = Object.fromEntries(
      rows.map((r) => [r.name, peakAlpha8(r, spans.neptune)]),
    );
    expect(alphaByName.leverrier).toBe(2);
    expect(alphaByName.adams).toBe(4);
    expect(alphaByName.galle).toBe(0);
    expect(alphaByName.lassell).toBe(0);
    expect(alphaByName.arago).toBe(0);
  });
});
