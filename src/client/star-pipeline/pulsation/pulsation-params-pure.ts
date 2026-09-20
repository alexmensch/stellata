// Per-type variable-star pulsation params (radius-swing ρ, colour-swing
// ΔB−V) for the star shader's iPuls attribute. See
// docs/science-stellar-modelling.md § Variable-star pulsation.
import {
  VAR_TYPE_MIRA,
  VAR_TYPE_SEMIREGULAR,
  VAR_TYPE_CEPHEID,
  VAR_TYPE_RR_LYRAE,
  VAR_TYPE_DSCT,
} from '../../../../scripts/catalog/record/catalog-pure';

/** Per-type pulsation parameters:
 *  - `rho` is the peak-to-peak physical-radius ratio (interferometric
 *    disc swing), so the shader's `radiusFactor = ρ^(−0.5·cos 2πφ)`
 *    spans [ρ^−0.5, ρ^+0.5] over a cycle with minimum radius at maximum
 *    light (φ = 0).
 *  - `colorSwing` is the peak-to-peak B−V swing; the shader shifts the
 *    LUT-input B−V by `−(ΔB−V / 2)·cos 2πφ` so the disc reddens toward
 *    minimum light. */
export interface PulsationParams {
  rho: number;
  colorSwing: number;
}

// {ρ, ΔB−V} per variability code. Miras split almost all of their large
// V-band amplitude into a temperature swing (TiO opacity + Planck-peak
// shift out of V), so their physical disc barely breathes (ρ ≈ 1.4)
// while the colour reddens strongly. Cepheids / RR Lyrae swing radius
// more (10–20%) with a moderate colour shift; DSCT-class low-amplitude
// pulsators barely move. Values documented + cited in
// docs/science-stellar-modelling.md § Variable-star pulsation.
export const PULSATION_PARAMS_BY_TYPE: Record<number, PulsationParams> = {
  [VAR_TYPE_MIRA]: { rho: 1.4, colorSwing: 0.35 },
  [VAR_TYPE_SEMIREGULAR]: { rho: 1.2, colorSwing: 0.2 },
  [VAR_TYPE_CEPHEID]: { rho: 1.15, colorSwing: 0.3 },
  [VAR_TYPE_RR_LYRAE]: { rho: 1.1, colorSwing: 0.25 },
  [VAR_TYPE_DSCT]: { rho: 1.02, colorSwing: 0.05 },
};

// Fallback for a pulsator with no dedicated bucket (generic
// VAR_TYPE_PULSATING, VAR_TYPE_OTHER-with-period) — a modest swing that
// reads as variable without overstating any one family.
export const PULSATION_PARAMS_DEFAULT: PulsationParams = { rho: 1.1, colorSwing: 0.1 };

export function pulsationParamsForType(varType: number): PulsationParams {
  return PULSATION_PARAMS_BY_TYPE[varType] ?? PULSATION_PARAMS_DEFAULT;
}

/** Non-pulsators take the default row; the values are inert on
 *  non-variables because the shader / renderedSizePx gate radius modulation
 *  on period > 0 && amplitude > 0 && !suppressed. */
export function buildPulsationParams(varType: Uint8Array): {
  rho: Float32Array;
  colorSwing: Float32Array;
} {
  const rho = new Float32Array(varType.length);
  const colorSwing = new Float32Array(varType.length);
  writePulsationParams(varType, rho, colorSwing, 0, varType.length);
  return { rho, colorSwing };
}

/** `buildPulsationParams` over one record window, into arrays the caller
 *  owns. The progressive load fills each landing chunk's window without
 *  replacing arrays a GPU attribute is already bound over. */
export function writePulsationParams(
  varType: Uint8Array,
  rho: Float32Array,
  colorSwing: Float32Array,
  first: number,
  end: number,
): void {
  for (let i = first; i < end; i++) {
    const p = pulsationParamsForType(varType[i]);
    rho[i] = p.rho;
    colorSwing[i] = p.colorSwing;
  }
}

/** {ρ, ΔB−V} interleaved as the iPuls vec2 attribute's backing array —
 *  one attribute rather than two to stay within the WebGL2 16-attribute
 *  budget. Shared by the WebGL2 geometry and the WebGPU port's. */
export function interleavePulsParams(
  rho: Float32Array,
  colorSwing: Float32Array,
): Float32Array {
  const out = new Float32Array(rho.length * 2);
  writeInterleavedPulsParams(rho, colorSwing, out, 0, rho.length);
  return out;
}

/** `interleavePulsParams` over one record window. The attribute's backing
 *  array is a COPY of the two source columns, so a progressive load that
 *  only refills `catalog.pulsRho` never reaches the shader — the window has
 *  to be re-interleaved and the attribute's range flagged. */
export function writeInterleavedPulsParams(
  rho: Float32Array,
  colorSwing: Float32Array,
  out: Float32Array,
  first: number,
  end: number,
): void {
  for (let i = first; i < end; i++) {
    out[i * 2] = rho[i];
    out[i * 2 + 1] = colorSwing[i];
  }
}
