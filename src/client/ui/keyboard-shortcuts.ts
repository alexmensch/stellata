import type { Stellata } from '../stellata';
import { isHardTarget } from '../camera/focus/focus-target';
import { DEFAULT_FOV } from '../filters/filter-state';
import { nextCoordSphereFrame } from '../galactic/coord-spheres/coord-sphere-frames';
import { DETAIL_LEVELS } from '../scene/scene-elements';
import type { TimeScrubberWidget } from '../solar-system/time/time-scrubber-widget';
import { bindHelpModal } from '../modals/help-modal';
import { bindCalibrationOverlay } from '../calibration/calibration-overlay';
import {
  pushTapAndCheckTriple,
  makeDoubleTapGate,
} from './keyboard-shortcuts-pure';
import { steppedEv } from '../hdr/exposure/exposure-epoch';
import { toggleFullscreen } from './fullscreen';
import { toggleControlsHidden } from './controls-hidden';

// Keys that drive the time scrubber while it's open → the widget method
// each fires. Handled ahead of the main switch since they share one
// open-gate (and Space defers to an active warp).
type TransportMethod = 'stepForward' | 'stepBack' | 'togglePlay' | 'reset';
const TRANSPORT_KEY_ACTIONS: Record<string, TransportMethod> = {
  ArrowRight: 'stepForward',
  ArrowLeft: 'stepBack',
  ' ': 'togglePlay',
  Backspace: 'reset',
};

export interface KeyboardShortcutsDeps {
  /** Reveal/dismiss the unified debug panel. Bound to the hidden
   *  triple-tap-D affordance. */
  toggleDebugPanel: () => void;
  /** The first-class time scrubber. `T` toggles it; while it's open,
   *  `←`/`→` step rewind/fast-forward, Space toggles play/pause, and
   *  Backspace resets to live-now. */
  timeScrubber: TimeScrubberWidget;
  /** Zero the camera's roll against the attitude indicator's active
   *  reference frame — the same action as clicking its ball. */
  levelAttitude: () => void;
  /** Step the attitude indicator's reference frame on — what `S` moves in
   *  navigate, where the ball rather than a grid carries the frame. */
  cycleReferenceFrame: () => void;
  /** Capture the focused object's own orbital plane and level on it — the
   *  same action as double-clicking the ball. */
  levelAttitudeOnOrbit: () => void;
}

export function bindKeyboardShortcuts(
  stellata: Stellata,
  deps: KeyboardShortcutsDeps,
) {
  const help = bindHelpModal();
  const calibration = bindCalibrationOverlay();

  // The "go" picker reuses the topbar's existing `#topbar-search` widget —
  // whatever inputs `bindSearch` puts there (Focus / To / Location) are
  // what the modal exposes. Selecting by id (not `.search-wrap`) matters:
  // the hidden Find widget also carries `.search-wrap`, so a class query
  // would grab it instead. The "constellation" picker does the same with
  // `#con-typeahead`. We move the live element into the modal card on open,
  // restore it on close — so all wiring (Fuse search, OBSERVE mode
  // handling, blur-pick race) keeps working unchanged.
  const goModal = bindRelocateModal({
    source: () => document.getElementById('topbar-search'),
    focusTarget: () => {
      const toRow = document.getElementById('search-to-row');
      const toInput = document.getElementById('search-to') as HTMLInputElement | null;
      if (toRow && !toRow.hidden && toInput) return toInput;
      return document.getElementById('search-focus') as HTMLInputElement | null;
    },
  });
  const conModal = bindRelocateModal({
    // Move the wrapper rather than just `#con-typeahead` so the panel's
    // existing "reset" link comes along — gives the modal a built-in
    // clear path without re-implementing it.
    source: () => document.getElementById('con-picker'),
    focusTarget: () => document.getElementById('con-input') as HTMLInputElement | null,
  });
  const findModal = bindRelocateModal({
    source: () => document.getElementById('find-wrap'),
    focusTarget: () => document.getElementById('find-input') as HTMLInputElement | null,
  });

  // F: single tap opens Find (observe-only — in navigate, aiming just parks
  // the target behind the focused star); double tap F-F toggles fullscreen
  // in every mode.
  const findGate = makeDoubleTapGate(
    () => { if (stellata.focus.getCameraMode() === 'observe') findModal.open(); },
    toggleFullscreen,
  );

  // Rolling window of recent D-key tap timestamps. Three taps inside
  // D_TRIPLE_TAP_MS open the debug panel — hidden affordance, intentionally
  // undocumented.
  const dTapTimes: number[] = [];

  // Capture phase so we observe foreground-modal state BEFORE bubble-phase
  // handlers (brand-modal / info-modal / help-modal) flip `hidden=true` on
  // ESC. Without capture, our cascade would fire after a modal closed itself
  // because the visibility check would already see no modal open.
  window.addEventListener('keydown', (e) => {
    // Don't claim shortcuts when a system modifier is held — Cmd+R /
    // Ctrl+R is browser reload, Cmd+= is zoom-in, etc. Shift is fine
    // (it's how `+` and `?` are typed on US layouts).
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === 'Escape') {
      // Highest priority: an open kb-modal (Go / Constellation) closes
      // even if its input has focus. The Typeahead class bails its own
      // ESC when the dropdown has no results (empty input), so we own
      // ESC for the kb-modal regardless.
      const kbModal = document.getElementById('kb-modal');
      if (kbModal && !kbModal.hidden) {
        goModal.close();
        conModal.close();
        findModal.close();
        e.preventDefault();
        return;
      }
      // Any other foreground modal (info / about / credits / help) owns
      // its own ESC via its own document listener — stay out of the way
      // so the cascade doesn't run AFTER the modal closes itself.
      if (anyVisibleSelector('.modal')) return;
      // Warp owns ESC via warp-button.ts.
      if (stellata.warp.isActive()) return;
      // Search/typeahead inputs handle ESC themselves (clear dropdown +
      // blur). Skip our cascade in that case.
      if (targetIsEditable(e.target)) return;
      escCascade(stellata);
      return;
    }

    // Non-ESC shortcuts — skip when typing or when any modal is open.
    if (targetIsEditable(e.target)) return;

    // Hidden triple-tap-D affordance for the debug panel. Checked BEFORE
    // the modal gate (the user might want it from inside an info/help
    // modal). Bail on shift so Shift+D doesn't trigger it.
    if (e.code === 'KeyD' && !e.shiftKey && !e.repeat) {
      if (pushTapAndCheckTriple(dTapTimes, performance.now())) {
        deps.toggleDebugPanel();
      }
      return;
    }

    if (anyVisibleSelector('.modal') || anyVisibleSelector('.kb-modal')) return;

    // Time-scrubber transport keys, live only while the scrubber is open;
    // otherwise they fall through untouched, keeping their default
    // behaviour. Space is special: during a warp it belongs to
    // warp-button.ts (skip-warp), so we bow out and let that bubble-phase
    // handler take it — the scrubber only claims Space when no warp is
    // running. The jump field is covered by the targetIsEditable guard above,
    // so its text takes the arrows and Space while it has focus.
    if (e.key === ' ' && stellata.warp.isActive()) return;
    const transport = TRANSPORT_KEY_ACTIONS[e.key];
    if (transport) {
      if (deps.timeScrubber.isOpen()) {
        deps.timeScrubber[transport]();
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case 'r': case 'R':
        resetCameraSection(stellata);
        e.preventDefault();
        break;
      case 'g': case 'G':
        goModal.open();
        e.preventDefault();
        break;
      case 'c': case 'C':
        if (e.repeat) break;
        e.preventDefault();
        conModal.open();
        break;
      case 'h': case 'H':
        stellata.filters.setFilter({ showHud: !stellata.filters.getFilter().showHud });
        e.preventDefault();
        break;
      case 's': case 'S':
        // One key, one idea — step the coordinate frame on — landing on
        // whichever instrument the mode has on screen.
        if (stellata.focus.getCameraMode() === 'observe') cycleCoordSphere(stellata);
        else deps.cycleReferenceFrame();
        e.preventDefault();
        break;
      case 'l': case 'L':
        if (e.shiftKey) deps.levelAttitudeOnOrbit(); else deps.levelAttitude();
        e.preventDefault();
        break;
      case 'f': case 'F':
        if (e.repeat) break;
        e.preventDefault();
        findGate();
        break;
      case 'u': case 'U':
        toggleControlsHidden();
        e.preventDefault();
        break;
      case 'k': case 'K':
        calibration.open();
        e.preventDefault();
        break;
      case 't': case 'T':
        deps.timeScrubber.toggle();
        e.preventDefault();
        break;
      case 'o': case 'O':
        // Mirror the panel's observe-button enable rule: any hard-kind
        // focus (star / planet) is a valid anchor. setCameraMode no-ops
        // without one anyway, but bailing here keeps the key from
        // feeling unresponsive.
        if (isHardTarget(stellata.focus.getFocusedTarget())) {
          stellata.observe.setMode('observe');
          e.preventDefault();
        }
        break;
      case 'm': case 'M':
        // Chart mode toggle. Observe-only — chart needs a focal star and
        // a stable camera (orbit camera doesn't make sense for reading
        // labels). No-op outside observe rather than auto-mode-switching:
        // the user should know they're entering observe before chart
        // engages on top.
        if (stellata.focus.getCameraMode() === 'observe') {
          stellata.filters.setFilter({ chart: !stellata.filters.getFilter().chart });
          e.preventDefault();
        }
        break;
      case 'v': case 'V':
        // Declutter cycle: physical → representational → all → physical,
        // within the current render style. Not mode-gated (unlike M).
        cycleDetailLevel(stellata);
        e.preventDefault();
        break;
      case '?':
        help.open();
        e.preventDefault();
        break;
      case '+':
        stellata.exposure.setEv(steppedEv(stellata.exposure.getEv(), +1));
        e.preventDefault();
        break;
      case '-':
        stellata.exposure.setEv(steppedEv(stellata.exposure.getEv(), -1));
        e.preventDefault();
        break;
      case '=':
        stellata.exposure.setEv(0);
        e.preventDefault();
        break;
    }
  }, { capture: true });
}

function cycleCoordSphere(stellata: Stellata) {
  stellata.filters.setFilter({
    coordSphere: nextCoordSphereFrame(
      stellata.filters.getFilter().coordSphere,
      (frame) => stellata.coordSphereAvailable(frame),
    ),
  });
}

function cycleDetailLevel(stellata: Stellata) {
  const cur = stellata.filters.getDetailLevel();
  const next = DETAIL_LEVELS[(DETAIL_LEVELS.indexOf(cur) + 1) % DETAIL_LEVELS.length];
  stellata.filters.applyDetailPreset(next);
}

// R: reset only the sliders living under the panel's "Camera" section —
// FOV, EV trim, exaggeration. Mirrors the per-row "reset" buttons wired
// in controls.ts.
function resetCameraSection(stellata: Stellata) {
  stellata.setCameraFov(DEFAULT_FOV);
  stellata.exposure.setEv(0);
  stellata.filters.setStarKMultiplier(stellata.filters.getStarKMultiplierDefault());
}

// ESC progression: observe→navigate (keep focus, animated exit), then
// in navigate clear destination if any, else clear focus — uniform
// across every focusable kind. A no-op if neither is set. Exported for
// its unit test.
export function escCascade(stellata: Stellata) {
  if (stellata.focus.getCameraMode() === 'observe') {
    stellata.observe.setMode('navigate');
    return;
  }
  if (stellata.focus.getVectorTarget() !== null) {
    stellata.focus.setVector(null);
    return;
  }
  if (stellata.focus.getFocusedTarget() !== null) {
    stellata.focus.unfocus();
  }
}

interface RelocateModalOptions {
  source: () => HTMLElement | null;
  focusTarget: () => HTMLInputElement | null;
}

// Shared "move existing widget into a centred card" modal. One DOM
// container (#kb-modal) is reused across the two pickers — only one
// can be open at a time anyway. Close triggers: backdrop click, input
// blur (covers ESC-inside-input, click-outside, and pick-then-blur via
// Typeahead's pick()).
function bindRelocateModal(
  opts: RelocateModalOptions,
): { open: () => void; close: () => void } {
  const modal = document.getElementById('kb-modal')!;
  const card = document.getElementById('kb-modal-card')!;
  const backdrop = modal.querySelector<HTMLElement>('.kb-modal-backdrop')!;

  let originalParent: HTMLElement | null = null;
  let originalNextSibling: Node | null = null;
  let openWidget: HTMLElement | null = null;
  let openInput: HTMLInputElement | null = null;
  let pendingClose: number | null = null;

  const onInputBlur = () => {
    // Defer slightly so a result mousedown inside Typeahead's pick() —
    // which calls input.blur() right after firing onSelect — finishes
    // its state changes before we tear down the modal. Typeahead itself
    // uses a 140ms deferral; we sit just after it.
    if (pendingClose !== null) clearTimeout(pendingClose);
    pendingClose = window.setTimeout(() => {
      pendingClose = null;
      close();
    }, 180);
  };
  const onInputFocus = () => {
    // The typeahead's X-clear refocuses the input synchronously after
    // blurring — cancel the pending close so the modal doesn't disappear
    // mid-edit.
    if (pendingClose !== null) {
      clearTimeout(pendingClose);
      pendingClose = null;
    }
  };

  const close = () => {
    if (!openWidget) return;
    if (pendingClose !== null) {
      clearTimeout(pendingClose);
      pendingClose = null;
    }
    if (openInput) {
      // Detach the modal-specific blur handler before we explicitly blur
      // the input below, so the synthetic blur doesn't re-enter close()
      // through `onInputBlur`'s deferred timer.
      openInput.removeEventListener('blur', onInputBlur);
      openInput.removeEventListener('focus', onInputFocus);
      openInput.removeEventListener('typeahead-pick', close);
      // Synchronously blur the input so the Typeahead's restore-on-blur
      // listener fires. Without this, the DOM move below can drop focus
      // silently and the input keeps any half-typed value the user just
      // abandoned with ESC.
      openInput.blur();
      openInput = null;
    }
    backdrop.removeEventListener('click', close);
    if (originalParent) {
      originalParent.insertBefore(openWidget, originalNextSibling);
    }
    openWidget = null;
    originalParent = null;
    originalNextSibling = null;
    modal.hidden = true;
  };

  const open = () => {
    if (openWidget) return;
    const widget = opts.source();
    const input = opts.focusTarget();
    if (!widget || !input || !widget.parentElement) return;

    originalParent = widget.parentElement;
    originalNextSibling = widget.nextSibling;
    card.appendChild(widget);
    openWidget = widget;
    openInput = input;
    modal.hidden = false;

    backdrop.addEventListener('click', close);
    input.addEventListener('blur', onInputBlur);
    input.addEventListener('focus', onInputFocus);
    // Typeahead dispatches 'typeahead-pick' on its input right before
    // onSelect runs — close synchronously so the focus glide / aim slerp
    // the selection triggers plays against the live scene, not behind
    // the modal backdrop. The blur-deferred close below stays as the
    // fallback for non-pick teardowns.
    input.addEventListener('typeahead-pick', close);

    // Focus on the next frame so the modal show + DOM move settle first.
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  };

  return { open, close };
}

function targetIsEditable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) return true;
  return t.isContentEditable;
}

function anyVisibleSelector(selector: string): boolean {
  const nodes = document.querySelectorAll<HTMLElement>(selector);
  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i].hidden) return true;
  }
  return false;
}
