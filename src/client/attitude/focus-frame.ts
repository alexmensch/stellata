// The focused object as the frame rules read it, resolved in one place so the
// instrument and the coordinate spheres can only ever ask the same question.

import type { Stellata } from '../stellata';
import type { Target } from '../camera/focus/focus-target';
import type { FocusFrameInputs } from './attitude-pure';

export function focusFrameInputs(
  stellata: Stellata,
  target: Target | null,
): FocusFrameInputs {
  return {
    kind: target?.kind ?? null,
    planetName:
      target?.kind === 'planet'
        ? stellata.kinds.planet?.displayName(target.idx) ?? null
        : null,
    isSol: target?.kind === 'star' && target.idx === stellata.catalog.solIndex,
  };
}
