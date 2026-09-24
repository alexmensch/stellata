// Pulsation-suppress mask for the star vertex shader's iSuppressPulsation
// attribute. See /src/client/binaries/eclipse/README.md#pulsation-gate-for-eclipsing-binaries.
import { VAR_TYPE_ECLIPSING } from '../../../../scripts/catalog/record/catalog-pure';

/** Per-instance pulsation-suppress mask: 1.0 on every eclipsing binary
 *  (varType == ECLIPSING), 0.0 elsewhere. Eclipsers are extrinsically
 *  variable, so the GCVS-amplitude radial pulsation is gated off for
 *  them regardless of whether they carry a renderable orbit. */
export function buildPulsationSuppressMask(varType: Uint8Array): Float32Array {
  const mask = new Float32Array(varType.length);
  writePulsationSuppressMask(varType, mask, 0, varType.length);
  return mask;
}

/** `buildPulsationSuppressMask` over one record window, into a mask the
 *  caller owns. Zero reads as "not suppressed", so an undecoded eclipsing
 *  binary would pulsate cosmetically until its window lands. */
export function writePulsationSuppressMask(
  varType: Uint8Array,
  mask: Float32Array,
  first: number,
  end: number,
): void {
  for (let i = first; i < end; i++) {
    if (varType[i] === VAR_TYPE_ECLIPSING) mask[i] = 1;
  }
}
