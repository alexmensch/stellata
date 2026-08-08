import { describe, it, expect } from 'vitest';
import { createPlanetLabels } from './planet-labels';
import type { Stellata } from '../../stellata';

describe('createPlanetLabels — sentinel-init', () => {
  it('writes display:none synchronously on init', () => {
    // First-load regression: planet-labels group has no inline `display:
    // none` in index.html, so it starts visible. A boolean visibility
    // sentinel initialised to `false` matches `setGroupVisible(false)` and
    // the first-call write silently no-ops — the empty group then paints
    // at SVG defaults until a non-matching toggle. The dirty-attr `\0`
    // poison sentinel forces the write through. Same shape as the
    // heliopause first-load fix (consistency-at-the-seam §3).
    const group = { style: { display: '' } };
    const prevDoc = (globalThis as { document?: unknown }).document;
    (globalThis as { document?: unknown }).document = {
      getElementById: (id: string) => (id === 'planet-labels' ? group : null),
    };
    try {
      const stellata = {
        on: () => () => {},
        focus: { getFocusedPlanetSystem: () => null },
      } as unknown as Stellata;
      createPlanetLabels(stellata);
      expect(group.style.display).toBe('none');
    } finally {
      (globalThis as { document?: unknown }).document = prevDoc;
    }
  });
});
