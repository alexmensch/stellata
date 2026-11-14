// Which of a promoted companion's absmag and B−V embed the Sol-to-star A_V, so de-extinction subtracts it. See README.md#promotion-lineage.

import type { CompanionAbsmagSource, CompanionCiVia } from './companion-promotion';

/** False for a class→M_V absmag, which is intrinsic already. */
export function companionAbsmagIsObserved(source: CompanionAbsmagSource): boolean {
  return source !== 'spectral';
}

/** Only the row's own B−V is observed; a class colour or the solar fallback is intrinsic. */
export function companionCiIsObservedVia(via: CompanionCiVia): boolean {
  return via === 'own';
}
