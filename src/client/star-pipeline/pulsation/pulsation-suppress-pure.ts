// Pulsation-suppress mask for the star vertex shader's iSuppressPulsation
// attribute. See src/client/binaries/eclipse/README.md § Pulsation gate for
// eclipsing binaries.
import { VAR_TYPE_ECLIPSING } from '../../../../scripts/catalog/catalog-pure';

/** Per-instance pulsation-suppress mask: 1.0 on every eclipsing binary
 *  (varType == ECLIPSING), 0.0 elsewhere. Eclipsers are extrinsically
 *  variable, so the GCVS-amplitude radial pulsation is gated off for
 *  them regardless of whether they carry a renderable orbit. */
export function buildPulsationSuppressMask(varType: Uint8Array): Float32Array {
  const mask = new Float32Array(varType.length);
  for (let i = 0; i < varType.length; i++) {
    if (varType[i] === VAR_TYPE_ECLIPSING) mask[i] = 1;
  }
  return mask;
}
