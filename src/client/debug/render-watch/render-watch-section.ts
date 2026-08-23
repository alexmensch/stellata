// Debug-panel section that hands off to the render watcher. See README.md
// § Starting it from the panel.

import type { DebugSection } from '../debug-panel';

export interface RenderWatchSectionOpts {
  /** Close the panel, then mount the watcher — in that order, because the
   *  panel's gate hold is what the watcher cannot see past. */
  onStart: () => void;
  isRunning: () => boolean;
}

export function buildRenderWatchSection(opts: RenderWatchSectionOpts): DebugSection {
  const body = document.createElement('div');

  const note = document.createElement('div');
  note.style.cssText = 'margin-bottom:6px;line-height:1.4';
  note.textContent = 'Why is this scene rendering? Starting the watcher CLOSES '
    + 'this panel — the panel holds the render gate open, so nothing in here can '
    + 'see the app idle.';

  const button = document.createElement('button');
  button.style.cssText = 'cursor:pointer;padding:3px 8px;user-select:none';
  const sync = () => {
    button.textContent = opts.isRunning()
      ? 'render watch is running' : 'start render watch (closes panel)';
    button.disabled = opts.isRunning();
  };
  button.addEventListener('click', () => {
    if (opts.isRunning()) return;
    opts.onStart();
  });
  sync();

  body.append(note, button);
  return {
    element: body,
    // Re-sync on expand: the watcher can be started or closed from its own
    // [close] link or the console while this section sits collapsed.
    setVisible: (v) => { if (v) sync(); },
    dispose: () => {},
  };
}
