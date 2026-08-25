// TSL uniform-node twins of the band material seam's two uniform blocks
// (../../milkyway/band-materials.ts) — transcribed key-for-key, pinned by
// a key-parity test.

import { Color, Matrix3, Vector3 } from 'three';
import { uniform } from 'three/tsl';
import type { BandComponentSpec } from '../../milkyway/band-materials';

/**
 * The slots both components hold by reference to each other.
 *
 * Built **once per factory**, so the disc and the bulge take the same node
 * objects and one write reaches both draws — the WebGL layout, transcribed.
 * Deliberately NOT taken from the shared uniform-node mirror even where a
 * name collides (`uDustEnabled`, `uExtinctionStrength`,
 * `uDustAvPerDensityPc`, `uWorldOffset`): those mirror the frame-wide map,
 * whose per-frame `sync()` would overwrite a write the band made here.
 */
export function bandSharedUniformNodes() {
  return {
    uDustAvPerDensityPc: uniform(0),
    uDustEnabled: uniform(0),
    uExtinctionStrength: uniform(0),
    uAnalyticalDustScaleLengthPc: uniform(1),
    uAnalyticalDustScaleHeightPc: uniform(1),
    uAnalyticalDustNormPerPc: uniform(0),
    uReddeningRGB: uniform(new Vector3(1, 1, 1)),
    uWorldOffset: uniform(new Vector3()),
    uIcrsToGal: uniform(new Matrix3()),
    uGalCenter: uniform(new Vector3()),
    uR0Pc: uniform(1),
    uGlowMagOffset: uniform(0),
    uChartIsobar: uniform(0),
    uChartInkColor: uniform(new Color(0x000000)),
  };
}

export type BandSharedNodes = ReturnType<typeof bandSharedUniformNodes>;

/** What differs between the two draws. `uIsBulge` is absent: the GLSL
 *  carries it as a uniform and branches, while the builder here takes the
 *  flag and emits one profile or the other. */
export function bandComponentUniformNodes(spec: BandComponentSpec) {
  return {
    uMeshScalePc: uniform(spec.meshScalePc.clone()),
    uDensity0: uniform(spec.density0),
    uColor: uniform(spec.tint.clone()),
    uDiscScaleLengthPc: uniform(spec.discScaleLengthPc),
    uDiscScaleHeightPc: uniform(spec.discScaleHeightPc),
    uDiscThickScaleHeightPc: uniform(spec.discThickScaleHeightPc),
    uDiscThickFraction: uniform(spec.discThickFraction),
    uBulgeScaleRadiusPc: uniform(spec.bulgeScaleRadiusPc),
    uBulgeAxisRatio: uniform(spec.bulgeAxisRatio),
  };
}

export type BandComponentNodes = ReturnType<typeof bandComponentUniformNodes>;
