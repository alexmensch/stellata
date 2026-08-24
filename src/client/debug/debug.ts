import type { Stellata } from '../stellata';
import { type DebugSection, makeCollapsibleSection, makeDebugPanel } from './debug-panel';
import { buildMilkywaySection } from '../milkyway/milkyway-tuning';
import { buildStarSection } from './star-tuning';
import { buildDeepFieldSection } from '../local-group/local-group-tuning';
import { buildPerfSection } from './perf-hud';
import { buildPinSection } from './pin-debug-hud';
import { buildArrowSection } from './arrow-fade-debug-hud';
import { buildEclipseSection } from './eclipse-debug-hud';
import { buildWarpSection } from '../camera/warp/warp-tuning';
import { buildExposureSection } from '../hdr/exposure/exposure-tuning';
import { mountRenderWatch } from './render-watch/render-watch';
import { buildRenderWatchSection } from './render-watch/render-watch-section';
import {
  buildPassToggles,
  runPriceFrame,
  runPriceFrameRepeat,
  type PriceFrameOptions,
  type PriceFrameRow,
} from './frame-cost/frame-cost';
import {
  collectMemoryInventory,
  printMemoryInventory,
  type MemoryInventory,
} from './memory/memory-inventory';
import {
  type DecodedView,
  type IdMaps,
  currentStateOf,
  decodeBlob,
  encodeBlob,
} from '../util/url-state';

// `window.debug.*` dev tooling — panel toggle plus URL-state codec.
// See src/client/debug/README.md § Debug panel for the section catalogue
// and the "how to add a section" recipe.

export interface DebugTools {
  /** Toggle the unified dev panel. */
  panel(): void;
  /** Decode a `?v=` blob (with or without the `v=` prefix) into a DecodedView. */
  decodeView(blob: string): DecodedView;
  /** Encode the current Stellata state into a `?v=` blob string. */
  encodeView(): string;
  /** Price each render pass by gpu.frame differential from the current
   *  viewpoint. Camera stationary, panel CLOSED — its perf timer holds
   *  the context's single query slot. */
  priceFrame(options?: PriceFrameOptions): Promise<PriceFrameRow[]>;
  /** priceFrame N times over; prints per-pass savedMs ranges across
   *  runs (the repeatability check). */
  priceFrameRepeat(runs: number, options?: PriceFrameOptions): Promise<PriceFrameRow[][]>;
  /** Toggle the render watcher: why is this scene rendering, or not.
   *  Deliberately NOT a panel section — the panel holds the gate open, so
   *  no section can observe idling (`render-watch/README.md`). */
  renderWatch(): void;
  /** Print the GPU-residency + JS-heap inventory for the current state,
   *  and return it. Read `memory/README.md` before quoting a number —
   *  what the walk reaches, and what it cannot, both matter. */
  memory(): MemoryInventory;
}

/** Wrap a DebugSection in a collapsible-section and mount it on the panel.
 *  Visibility gate wires both ways: collapse → setVisible(false),
 *  initial-from-storage → setVisible(!collapsed). Returns the module's
 *  disposer for the closePanel cleanup pass. */
function mountSection(
  body: HTMLDivElement,
  title: string,
  storageKey: string,
  module: DebugSection,
): () => void {
  const section = makeCollapsibleSection({
    title,
    storageKey,
    onCollapseChange: (collapsed) => module.setVisible(!collapsed),
  });
  section.body.appendChild(module.element);
  module.setVisible(!section.isCollapsed());
  body.appendChild(section.section);
  return module.dispose;
}

/** The live WebGL2 context, or null on a WebGL1 fallback context or a
 *  WebGPU boot — the Perf section needs it to feature-detect the GPU
 *  timer query. */
function perfGlContext(stellata: Stellata): WebGL2RenderingContext | null {
  const gl = stellata.renderer.getContext();
  return gl instanceof WebGL2RenderingContext ? gl : null;
}

export function setupDebug(stellata: Stellata, idMaps: IdMaps): DebugTools {
  let panel: HTMLDivElement | null = null;
  let disposers: Array<() => void> = [];
  let releaseRenderHold: (() => void) | null = null;
  let closeRenderWatch: (() => void) | null = null;

  const closePanel = () => {
    if (!panel) return;
    panel.remove();
    panel = null;
    for (const dispose of disposers) dispose();
    disposers = [];
    releaseRenderHold?.();
    releaseRenderHold = null;
  };

  /** Mount the watcher if it isn't up. Its own [close] link clears the
   *  handle through onClose, so the console toggle stays in step. */
  const openRenderWatch = () => {
    if (closeRenderWatch !== null) return;
    closeRenderWatch = mountRenderWatch(stellata, {
      onClose: () => { closeRenderWatch = null; },
    });
  };

  const togglePanel = () => {
    if (panel) { closePanel(); return; }

    const built = makeDebugPanel({ onClose: closePanel });
    panel = built.element;
    releaseRenderHold = stellata.renderGate.hold();

    const sections: Array<{ title: string; storageKey: string; build: () => DebugSection }> = [
      { title: 'Render watch', storageKey: 'render-watch', build: () => buildRenderWatchSection({
        // Panel first: its hold is exactly what the watcher cannot see past.
        onStart: () => { closePanel(); openRenderWatch(); },
        isRunning: () => closeRenderWatch !== null,
      }) },
      { title: 'Exposure',   storageKey: 'exposure',   build: () => buildExposureSection(stellata) },
      { title: 'Star disc',  storageKey: 'star',       build: () => buildStarSection(stellata) },
      { title: 'Milky Way',  storageKey: 'milkyway',   build: () => buildMilkywaySection(stellata.milkyway) },
      { title: 'Deep field', storageKey: 'deep-field', build: () => buildDeepFieldSection() },
      { title: 'Perf',       storageKey: 'perf',       build: () => buildPerfSection(perfGlContext(stellata)) },
      { title: 'Pin',        storageKey: 'pin',        build: () => buildPinSection(stellata) },
      { title: 'Arrows',     storageKey: 'arrows',     build: () => buildArrowSection(stellata) },
      { title: 'Warp',       storageKey: 'warp',       build: () => buildWarpSection(stellata) },
      { title: 'Eclipse',    storageKey: 'eclipse',    build: () => buildEclipseSection(stellata) },
    ];
    for (const s of sections) {
      disposers.push(mountSection(built.body, s.title, s.storageKey, s.build()));
    }

    document.body.appendChild(panel);
  };

  const tools: DebugTools = {
    panel: togglePanel,
    decodeView: (blob) => {
      // Tolerate full URLs and `v=...` prefixes for paste-in convenience.
      const stripped = blob.includes('v=') ? blob.split('v=').pop()! : blob;
      const { view } = decodeBlob(stripped);
      console.table(view);
      return view;
    },
    encodeView: () => encodeBlob(currentStateOf(stellata, idMaps)),
    priceFrame: (options) =>
      runPriceFrame(stellata, buildPassToggles(stellata), options),
    priceFrameRepeat: (runs, options) =>
      runPriceFrameRepeat(stellata, buildPassToggles(stellata), runs, options),
    memory: () => {
      const inventory = collectMemoryInventory(stellata);
      printMemoryInventory(inventory);
      return inventory;
    },
    renderWatch: () => {
      if (closeRenderWatch !== null) {
        const dispose = closeRenderWatch;
        closeRenderWatch = null;
        dispose();
        return;
      }
      openRenderWatch();
      if (panel !== null) {
        console.warn(
          'render-watch: the debug panel is open and holds the render gate, so '
          + 'every tick renders. Close it (debug.panel()) to observe idling.',
        );
      }
    },
  };

  (window as unknown as { debug: DebugTools }).debug = tools;
  return tools;
}
