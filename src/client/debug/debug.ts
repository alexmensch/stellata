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

/** The live WebGL2 context, or null on a WebGL1 fallback context — the
 *  Perf section needs it to feature-detect the GPU timer query. */
function perfGlContext(stellata: Stellata): WebGL2RenderingContext | null {
  const gl = stellata.renderer.getContext();
  return gl instanceof WebGL2RenderingContext ? gl : null;
}

export function setupDebug(stellata: Stellata, idMaps: IdMaps): DebugTools {
  let panel: HTMLDivElement | null = null;
  let disposers: Array<() => void> = [];

  const closePanel = () => {
    if (!panel) return;
    panel.remove();
    panel = null;
    for (const dispose of disposers) dispose();
    disposers = [];
  };

  const togglePanel = () => {
    if (panel) { closePanel(); return; }

    const built = makeDebugPanel({ onClose: closePanel });
    panel = built.element;

    const sections: Array<{ title: string; storageKey: string; build: () => DebugSection }> = [
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
  };

  (window as unknown as { debug: DebugTools }).debug = tools;
  return tools;
}
