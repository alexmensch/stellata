// Display metadata for keyboard shortcuts — the single source behind both
// the `?` help modal and the on-screen hint bar. Pure (no DOM), unit-tested.
// See src/client/ui/README.md § Keyboard shortcuts.

/** App state the hint bar filters shortcuts against. */
export interface ShortcutState {
  cameraMode: 'navigate' | 'observe';
  hasFocus: boolean;
  hasDestination: boolean;
  modalOpen: boolean;
}

export interface ShortcutDescriptor {
  /** Display keys: one chip per entry (`['G']`, `['F', 'F']`, `['+', '−']`). */
  keys: string[];
  /** Help-modal description. */
  label: string;
  /** Eligible for the always-on hint bar. When false the shortcut is only
   *  surfaced in the `?` help modal. */
  hint: boolean;
  /** Hidden everywhere — the undocumented triple-tap-D debug affordance. */
  debug?: boolean;
  /** Per-state gate for the hint bar; omitted ⇒ always shown while `hint`.
   *  Consulted only for `hint` entries and only outside modal state. */
  active?: (s: ShortcutState) => boolean;
}

// Order here is the render order for the help modal.
export const SHORTCUTS: readonly ShortcutDescriptor[] = [
  {
    keys: ['G'],
    label: 'Go: focus a star, set a destination, or change observe location',
    hint: true,
    active: (s) => !s.modalOpen,
  },
  {
    keys: ['F'],
    label: 'Find: point the camera at any object without travelling to it',
    hint: true,
    active: (s) => !s.modalOpen,
  },
  {
    keys: ['O'],
    label: 'Switch to observe mode when a star is focused',
    hint: true,
    active: (s) => s.cameraMode === 'navigate' && s.hasFocus,
  },
  {
    keys: ['M'],
    label: 'Toggle star chart mode (in observe mode only)',
    hint: true,
    active: (s) => s.cameraMode === 'observe',
  },
  {
    keys: ['W'],
    label: 'Warp to the destination',
    hint: true,
    active: (s) => s.cameraMode === 'navigate' && s.hasDestination,
  },
  {
    keys: ['C'],
    label: 'Show a constellation (double-tap to toggle constellation lines)',
    hint: false,
  },
  { keys: ['S'], label: 'Toggle the galactic-coordinate sphere', hint: false },
  { keys: ['H'], label: 'Toggle the head-up display (HUD)', hint: false },
  { keys: ['R'], label: 'Reset all camera settings', hint: false },
  {
    keys: ['T'],
    label: 'Open the time scrubber',
    hint: false,
  },
  { keys: ['F', 'F'], label: 'Double-tap to toggle fullscreen', hint: false },
  { keys: ['U'], label: 'Show/hide the controls', hint: false },
  { keys: ['+', '−'], label: 'Magnitude limit ± 0.5', hint: false },
  { keys: ['='], label: 'Reset magnitude to naked-eye (6.5)', hint: false },
  {
    keys: ['Esc'],
    label: 'Step back: exit observe → clear destination → clear focus',
    hint: true,
    active: (s) => s.cameraMode === 'observe' || s.hasDestination || s.hasFocus,
  },
  { keys: ['?'], label: 'Show all keyboard shortcuts', hint: true },
  { keys: ['D'], label: 'Debug panel', hint: false, debug: true },
];

/** Shortcuts shown in the `?` help modal — everything the user can act on,
 *  excluding hidden debug affordances. */
export function helpModalShortcuts(): ShortcutDescriptor[] {
  return SHORTCUTS.filter((s) => !s.debug);
}

/** Shortcuts the on-screen hint bar shows for the given state. In any modal
 *  state only `Esc` is relevant; otherwise every `hint` entry whose `active`
 *  predicate passes (predicate-less entries are always on). */
export function hintBarShortcuts(state: ShortcutState): ShortcutDescriptor[] {
  if (state.modalOpen) {
    return SHORTCUTS.filter((s) => s.keys.length === 1 && s.keys[0] === 'Esc');
  }
  return SHORTCUTS.filter(
    (s) => s.hint && !s.debug && (s.active ? s.active(state) : true),
  );
}
