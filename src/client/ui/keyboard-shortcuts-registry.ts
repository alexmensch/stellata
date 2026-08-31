// Display metadata for keyboard shortcuts — the single source behind the
// `?` help modal. Pure (no DOM), unit-tested.
// See src/client/ui/README.md § Keyboard shortcuts.

export interface ShortcutDescriptor {
  /** Display keys: one chip per entry (`['G']`, `['F', 'F']`, `['+', '−']`). */
  keys: string[];
  /** Keys held together rather than pressed as alternatives — the help modal
   *  joins a chord with `+` and everything else with `/`. A repeated key is a
   *  double-tap and joins with a space, which needs no flag. */
  chord?: boolean;
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
  {
    keys: ['⇧', 'V'],
    chord: true,
    label: 'Invert the view — swing to the far side of the focused object',
  },
  { keys: ['W'], label: 'Warp to the destination' },
  { keys: ['C'], label: 'Show a constellation' },
  {
    keys: ['S'],
    label: 'Cycle the reference frame: the attitude indicator in navigate, '
      + 'the coordinate sphere in observe',
  },
  {
    keys: ['L'],
    label: 'Level the camera — against the attitude indicator in navigate, '
      + 'the coordinate sphere in observe',
  },
  {
    keys: ['⇧', 'L'],
    chord: true,
    label: 'Lock the camera to the orbit — hold this attitude as the object '
      + 'travels (ORB frame only)',
  },
  {
    keys: ['Z'],
    label: 'Aim at the reference frame\'s origin — 0° longitude, 0° latitude '
      + 'on whichever frame is showing',
  },
  {
    keys: ['⇧', 'Z'],
    chord: true,
    label: 'Aim at the opposite point — 180° longitude, 0° latitude',
  },
  { keys: ['H'], label: 'Toggle the head-up display (HUD)' },
  { keys: ['R'], label: 'Reset FOV, exposure & exaggeration' },
  { keys: ['T'], label: 'Open the time scrubber' },
  { keys: ['←', '→'], label: 'Time scrubber (while open): rewind / fast-forward' },
  { keys: ['Space'], label: 'Time scrubber (while open): play / pause' },
  { keys: ['Backspace'], label: 'Time scrubber (while open): reset to live now' },
  { keys: ['F', 'F'], label: 'Double-tap to toggle fullscreen' },
  { keys: ['U'], label: 'Show/hide the controls' },
  { keys: ['K'], label: 'Open the display-calibration screen' },
  { keys: ['+', '−'], label: 'Exposure trim ± 1/3 stop' },
  { keys: ['='], label: 'Reset the exposure trim to 0 EV' },
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
