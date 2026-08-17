// Synthetic star field + dust volume for the WebGPU spike — exercises
// every attribute path of the real pipeline without the catalog loaders.

import * as THREE from 'three/webgpu';
import type { SyntheticStars } from './star-common';

export const FIELD_COUNT = 50_000;

/** Deterministic LCG so both implementations and every reload see the
 *  identical field (comparison across browsers stays apples-to-apples). */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export const AU_PC = 4.84814e-6;

/** Scripted stars at fixed indices; the HUD keys reference these. */
export const ALPHA_IDX = 0; // Sol twin, camera parked ~0.5 AU away
export const BETA_IDX = 1; // K dwarf 5 AU behind Alpha — reversed-z ordering probe
export const SUPERGIANT_IDX = 2;
export const MIRA_IDX = 3;

export function makeSyntheticStars(): SyntheticStars {
  const rng = makeRng(0x5717a7a);
  const count = FIELD_COUNT;
  const posDist = new Float32Array(count * 4);
  const phot = new Float32Array(count * 4);
  const varParams = new Float32Array(count * 4);
  const misc = new Float32Array(count * 4);

  const set = (
    i: number,
    p: [number, number, number],
    absmag: number, ci: number, teff: number, logR: number,
    period: number, amp: number, rho: number, swing: number,
    spect: number, lum: number, suppress = 0,
  ) => {
    const d = Math.hypot(p[0], p[1], p[2]);
    posDist.set([p[0], p[1], p[2], d], i * 4);
    phot.set([absmag, ci, teff, logR], i * 4);
    varParams.set([period, amp, rho, swing], i * 4);
    misc.set([spect, lum, suppress, 0], i * 4);
  };

  set(ALPHA_IDX, [0, 0, 0.5 * AU_PC], 4.83, 0.65, 5772, 0, 0, 0, 1, 0, 4, 2);
  set(BETA_IDX, [0, 0.3 * AU_PC, 5.5 * AU_PC], 7.2, 1.15, 4200, -0.14, 0, 0, 1, 0, 5, 2);
  set(SUPERGIANT_IDX, [30, 5, 0], -5.6, 1.85, 3600, 2.95, 400, 1.0, 1.2, 0.3, 6, 8);
  set(MIRA_IDX, [20, -4, 2], 0.5, 1.6, 3200, 2.4, 330, 6.0, 1.1, 1.0, 6, 4);

  for (let i = 4; i < count; i++) {
    const r = 2 + 148 * Math.cbrt(rng());
    const th = Math.acos(2 * rng() - 1);
    const ph = 2 * Math.PI * rng();
    const p: [number, number, number] = [
      r * Math.sin(th) * Math.cos(ph),
      r * Math.sin(th) * Math.sin(ph),
      r * Math.cos(th),
    ];
    const absmag = Math.min(16, Math.max(-7, 6 + 3 * (rng() + rng() + rng() - 1.5)));
    const ci = -0.3 + 2.2 * rng();
    const teff = rng() < 0.3 ? 3000 + 27_000 * rng() * rng() : 0;
    const giant = rng() < 0.02;
    const logR = giant ? 1 + 2 * rng() : 0.6 * (rng() - 0.5);
    const isVar = rng() < 0.03;
    set(
      i, p, absmag, ci, teff, logR,
      isVar ? 0.5 + 400 * rng() * rng() : 0,
      isVar ? 0.3 + 5 * rng() * rng() : 0,
      1.05 + 0.35 * rng(),
      0.3 * rng(),
      Math.floor(rng() * 10),
      giant ? 4 + Math.floor(rng() * 5) : 2,
    );
  }
  return { count, posDist, phot, varParams, misc };
}

export const DUST_SIZE = 32;

/** Gaussian blob centred at (60, 0, 0), σ = 25 pc, encoded with the
 *  Edenhofer texture's pure-log scheme so the shader decode matches:
 *  density = densityMin · exp(encoded · logRatio). */
export function makeSyntheticDust(boundsPc: number, densityMin: number, logRatio: number): THREE.Data3DTexture {
  const n = DUST_SIZE;
  const data = new Uint8Array(n * n * n);
  const densityMax = densityMin * Math.exp(logRatio);
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const px = ((x + 0.5) / n - 0.5) * 2 * boundsPc;
        const py = ((y + 0.5) / n - 0.5) * 2 * boundsPc;
        const pz = ((z + 0.5) / n - 0.5) * 2 * boundsPc;
        const d2 = (px - 60) ** 2 + py ** 2 + pz ** 2;
        const density = densityMax * Math.exp(-d2 / (2 * 25 * 25));
        const encoded = density <= densityMin
          ? 0
          : Math.min(1, Math.log(density / densityMin) / logRatio);
        data[x + n * (y + n * z)] = Math.round(encoded * 255);
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, n, n, n);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}
