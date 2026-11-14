// The WDS components the pull asks SIMBAD about, and the ident each is stored under. See README.md#the-request.

import { compareCodeUnits } from '../../util/order-pure';
import { splitComponents, type WdsPair } from '../../wds/wds-pure';

export interface WdsComponent {
  readonly wdsId: string;
  readonly component: string;
}

/** A component's map key and its name in a message: `06451-1643 B`. */
export const componentId = (c: WdsComponent): string => `${c.wdsId} ${c.component}`;

/** The suffix SIMBAD stores the component under in its `WDS` namespace. */
export const identSuffix = (c: WdsComponent): string => `${c.wdsId}${c.component}`;

/** Both sides of every pair row whose components field splits, each once, by WDS id then component: the rows Stage 2 decomposes. */
export function wdsComponents(pairs: readonly WdsPair[]): WdsComponent[] {
  const seen = new Map<string, WdsComponent>();
  for (const pair of pairs) {
    const split = splitComponents(pair.components);
    if (split === null) continue;
    for (const component of split) {
      const c = { wdsId: pair.wdsId, component };
      seen.set(componentId(c), c);
    }
  }
  return [...seen.values()].sort((a, b) => compareCodeUnits(a.wdsId, b.wdsId) || compareCodeUnits(a.component, b.component));
}
