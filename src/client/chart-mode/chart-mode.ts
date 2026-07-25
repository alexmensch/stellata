import type { Stellata } from '../stellata';
import type { BayerInfo } from '../typeahead/search';
import { applyTheme } from '../ui/theme-toggle';

// Star chart mode orchestrator.
//
// Activation predicate:  cameraMode === 'observe'  &&  filter.chart
//
// Chart mode is gated on observe so the camera is anchored at a focal star
// — the chart's "you are here" — and the user has a stable, FPS-style
// look-around to read labels by. Toggling out of observe (ESC, mode
// button) clears `filter.chart` so the next observe session starts in
// navigate rendering unless the user re-enables chart.
//
// Side-effects when chart engages:
//   - body.chart class on document.body (selectors in styles.css can
//     branch on this independently of the existing body.monochrome).
//   - Paper-aesthetic palette via the existing setMonochrome plumbing
//     (stars, clouds, hud, galactic disc/grid, blend modes, clear color).
//   - Cloud isobar pass (driven by uMaxAppMag); the milky-way band↔isobar
//     swap rides applyDetailPreset via the milkyWayIsobar detail bind.
//   - Constellation figure switches to all-88 mode — the WebGL
//     constellation-figure/ layer, rebuilt by the shell on the same
//     chart-and-observe predicate.
//   - Label engine spins up; which label tiers render is gated by the
//     detail cycle (chart-labels.ts reads detailPermits per tier).

export interface ChartModeContext {
  bayerMap: Map<number, BayerInfo>;
  starLabels: Map<number, string>;
}

export function bindChartMode(stellata: Stellata, ctx: ChartModeContext): void {
  // Track the active state separately from filter.chart so we can run
  // teardown only on real transitions (avoid flapping if filter changes
  // arrive in quick succession). The active state is derived from the
  // gate predicate; filter.chart is the user's intent.
  let active = false;

  const sync = () => {
    const f = stellata.getFilter();
    const observed = stellata.getCameraMode() === 'observe';
    const next = f.chart && observed;
    if (next === active) return;
    active = next;
    // The render style flipped, so re-derive the detail-permitted set from
    // the new style's floors: this drives the milky-way band↔isobar swap
    // (via the milkyWayIsobar bind), hides the realistic-only structure
    // layers, and gates the chart-labels tiers below. `false` preserves the
    // user's per-element toggles across the style flip — only a detail-level
    // change (V / the control) clears them.
    if (active) {
      document.body.classList.add('chart');
      applyTheme('mono');
      stellata.applyDetailPreset(stellata.getDetailLevel(), false);
      stellata.chartLabels.start(ctx);
    } else {
      document.body.classList.remove('chart');
      applyTheme('dark');
      stellata.applyDetailPreset(stellata.getDetailLevel(), false);
      stellata.chartLabels.stop();
    }
  };

  stellata.on('cameraMode', () => {
    // Leaving observe always deactivates chart — the camera state required
    // to interpret the chart goes away. Clear the user's `chart` flag so
    // the next observe session starts clean unless they re-enable it.
    if (stellata.getCameraMode() !== 'observe' && stellata.getFilter().chart) {
      stellata.setFilter({ chart: false });
      return; // setFilter triggers sync via the 'filter' event
    }
    sync();
  });
  stellata.on('filter', sync);

  // Initial reconciliation in case URL state restored chart=on before the
  // orchestrator was bound.
  sync();
}
