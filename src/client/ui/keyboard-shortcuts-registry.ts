// Display metadata for keyboard shortcuts — the single source behind the
// `?` help modal. Pure (no DOM), unit-tested.
// See src/client/ui/README.md § Keyboard shortcuts.

export interface ShortcutDescriptor {
  /** Display keys: one chip per entry (`['G']`, `['F', 'F']`, `['+', '−']`). */
  keys: string[];
  /** Help-modal description. */
  label: string;
  /** Hidden everywhere — the undocumented triple-tap-D debug affordance. */
  debug?: boolean;
}

// Order here is the render order for the help modal.
export const SHORTCUTS: readonly ShortcutDescriptor[] = [
  {
    keys: ['G'],
    label: 'Go: focus a star, set a destination, or change observe location',
  },
  {
    keys: ['F'],
    label: 'Find: point the camera at any object without travelling to it (observe mode)',
  },
  { keys: ['O'], label: 'Switch to observe mode when a star is focused' },
  { keys: ['M'], label: 'Toggle star chart mode (in observe mode only)' },
  { keys: ['V'], label: 'Cycle detail level (physical → structure → all)' },
  { keys: ['W'], label: 'Warp to the destination' },
  {
    keys: ['C'],
    label: 'Show a constellation (double-tap to toggle constellation lines)',
  },
  { keys: ['S'], label: 'Toggle the galactic-coordinate sphere' },
  { keys: ['H'], label: 'Toggle the head-up display (HUD)' },
  { keys: ['R'], label: 'Reset camera size, range, FOV & exaggeration' },
  { keys: ['T'], label: 'Open the time scrubber' },
  { keys: ['←', '→'], label: 'Time scrubber (while open): rewind / fast-forward' },
  { keys: ['Space'], label: 'Time scrubber (while open): play / pause' },
  { keys: ['Backspace'], label: 'Time scrubber (while open): reset to live now' },
  { keys: ['F', 'F'], label: 'Double-tap to toggle fullscreen' },
  { keys: ['U'], label: 'Show/hide the controls' },
  { keys: ['+', '−'], label: 'Magnitude limit ± 0.5' },
  { keys: ['='], label: 'Reset magnitude to naked-eye (6.5)' },
  {
    keys: ['Esc'],
    label: 'Step back: exit observe → clear destination → clear focus',
  },
  { keys: ['?'], label: 'Show all keyboard shortcuts' },
  { keys: ['D'], label: 'Debug panel', debug: true },
];

/** Shortcuts shown in the `?` help modal — everything the user can act on,
 *  excluding hidden debug affordances. */
export function helpModalShortcuts(): ShortcutDescriptor[] {
  return SHORTCUTS.filter((s) => !s.debug);
}
