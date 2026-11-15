// Test-only: one MultiplesPair from its system_id and the cells a test names.

import {
  BINARY_ELEMENT_KEYS, type BinaryElements,
} from '../../src/catalog-format/binaries/binaries-format';
import { canonicalCompLetter, wdsRootOf } from './component-tokens-pure';
import type { MultiplesPair } from './pairs-pure';

export const ORBIT = { pDays: 365.25, tJd: 2451545, e: 0.5, aAU: 10, omegaRad: 1, q: 0.5 };

export type PairOver = Partial<Omit<MultiplesPair, 'elements'> & BinaryElements>;

export function pair(systemId = '00000+0000-AB', over: PairOver = {}): MultiplesPair {
  const components = systemId.slice(systemId.lastIndexOf('-') + 1);
  const [primaryComp, secondaryCell] = components.includes(',')
    ? components.split(',')
    : [components[0], components[1] ?? ''];
  const isElement = (k: string): boolean => (BINARY_ELEMENT_KEYS as readonly string[]).includes(k);
  return {
    systemId, wdsId: wdsRootOf(systemId) as string, origin: `multiples:${systemId}/${secondaryCell}`,
    primaryComp, secondaryComp: canonicalCompLetter(primaryComp, secondaryCell),
    primaryGaia: '1', primaryHip: null, secondaryGaia: '2', secondaryHip: null,
    ...Object.fromEntries(Object.entries(over).filter(([k]) => !isElement(k))),
    elements: Object.fromEntries(BINARY_ELEMENT_KEYS.map((k) => [k, over[k] ?? null])) as BinaryElements,
  };
}
