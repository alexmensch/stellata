// The pass toggles a priceFrame sweep differences: what each row disables
// and how it is put back. See README.md.

import type { Stellata } from '../../../stellata';
import { EMPTY_PASSES_DEFAULT, type PricedPassKey } from './passes-pure';

export interface PassToggle {
  /** Row label in the output table. Adding one means adding it to
   *  `PRICED_PASS_KEYS`, which is what callers validate against. */
  readonly key: PricedPassKey;
  /** False when the pass is not contributing at the current view/state —
   *  the row is skipped with a note rather than measured as a
   *  meaningless zero, and the pass's state is never touched. */
  present(): boolean;
  /** Turn the pass off; returns the restore. Only called when present(). */
  disable(): () => void;
}

export interface PassToggleOptions {
  /** How many empty render passes the `emptyPass` row adds while
   *  "disabled". Its `savedMs` is minus the total for that many boundaries
   *  together, which is what the row bounds — never that over this count,
   *  since consecutive clears with nothing drawn between them are what a
   *  driver would coalesce (README.md § The roster). Raise it wherever one
   *  pass falls under `bracketMs` and the row will not resolve. */
  emptyPasses?: number;
}

/** The passes the 2026-08 audit prices. hdrChain (the chart-mode
 *  park) also stops writing the statistic attachment, flips emitters to
 *  inline tone-mapping and parks the reduction — its row is the whole
 *  target chain against direct-to-canvas, not the resolve draw alone.
 *  The four rows after it decompose that aggregate (README.md
 *  § Decomposing the HDR chain). extinctionPrepass reports the consumer
 *  A/B: disabling ADDS the in-vertex raymarch, so its savedMs is normally
 *  negative (what the cache saves). emptyPass ADDS `emptyPasses` empty
 *  render passes, so its savedMs is minus the floor times that count. */
export function buildPassToggles(
  stellata: Stellata,
  options?: PassToggleOptions,
): PassToggle[] {
  const emptyPasses = Math.max(1, Math.round(options?.emptyPasses ?? EMPTY_PASSES_DEFAULT));
  const flag = (set: (on: boolean) => void): (() => void) => {
    set(false);
    return () => set(true);
  };
  return [
    {
      key: 'localDepth',
      present: () => true,
      disable: () => flag((on) => { stellata.localDepthPass.enabled = on; }),
    },
    {
      key: 'mwBand',
      present: () => stellata.milkyway.isEnabled(),
      disable: () => flag((on) => stellata.milkyway.setEnabled(on)),
    },
    {
      key: 'lgEmission',
      present: () => stellata.kinds.lg.emission?.isEnabled() ?? false,
      disable: () => flag((on) => stellata.kinds.lg.emission?.setEnabled(on)),
    },
    {
      key: 'cloudAbsorption',
      present: () => stellata.kinds.cloud.layer !== null,
      disable: () => flag((on) => stellata.kinds.cloud.layer?.setAbsorptionEnabled(on)),
    },
    {
      key: 'hdrChain',
      present: () => stellata.hdr.statisticTexture() !== null,
      // The park drops the statistic, so `measure()` stops being called at
      // all and the frame loses its only ANGLE submission barrier — the
      // same defect the reduction row was fixed for. Hold the fence across
      // the park so the row prices the chain, not the barrier.
      disable: () => {
        stellata.reduction.fenceWhileParked = true;
        stellata.hdr.setChartMode(true);
        return () => {
          stellata.hdr.setChartMode(false);
          stellata.reduction.fenceWhileParked = false;
        };
      },
    },
    {
      key: 'tonemapOp',
      present: () => stellata.hdr.statisticTexture() !== null,
      disable: () => flag((on) => stellata.hdr.setTonemapEnabled(on)),
    },
    {
      key: 'statisticWrites',
      present: () => stellata.hdr.statisticTexture() !== null,
      disable: () => flag((on) => stellata.hdr.setStatisticWritesEnabled(on)),
    },
    {
      key: 'summation',
      present: () => stellata.hdr.statisticTexture() !== null,
      disable: () => flag((on) => stellata.hdr.setSummationEnabled(on)),
    },
    {
      key: 'summationTaps',
      present: () => stellata.hdr.statisticTexture() !== null,
      disable: () => flag((on) => stellata.hdr.setSummationTapsEnabled(on)),
    },
    {
      key: 'mrtAttachments',
      present: () => stellata.hdr.statisticTexture() !== null,
      // Dropping to a single attachment parks the statistic, so hold the
      // fence for the same reason the hdrChain row does.
      disable: () => {
        stellata.reduction.fenceWhileParked = true;
        stellata.hdr.setExtraAttachmentsEnabled(false);
        return () => {
          stellata.hdr.setExtraAttachmentsEnabled(true);
          stellata.reduction.fenceWhileParked = false;
        };
      },
    },
    {
      key: 'reduction',
      present: () => stellata.hdr.statisticTexture() !== null,
      disable: () => flag((on) => { stellata.reduction.enabled = on; }),
    },
    {
      key: 'coreMask',
      present: () => true,
      disable: () => flag((on) => stellata.setCoreMaskEnabled(on)),
    },
    {
      key: 'extinctionPrepass',
      present: () => stellata.isExtinctionPrepassActive(),
      disable: () => flag((on) => stellata.setExtinctionPrepassEnabled(on)),
    },
    {
      key: 'emptyPass',
      present: () => true,
      disable: () => {
        stellata.localDepthPass.extraEmptyPasses = emptyPasses;
        return () => { stellata.localDepthPass.extraEmptyPasses = 0; };
      },
    },
  ];
}
