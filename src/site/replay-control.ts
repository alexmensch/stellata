/** Shows a replay button whenever its clip is stopped, and replays the clip once on a press. */

export const REPLAY_GLYPH = '↻';
export const REPLAY_NAME = 'Replay clip';

/** Names each button after its clip, so a list of buttons tells them apart. */
export function replayLabel(clipLabel: string | null): string {
  return clipLabel === null ? REPLAY_NAME : `${REPLAY_NAME}: ${clipLabel}`;
}

export interface ReplayableClip extends EventTarget {
  readonly ended: boolean;
  currentTime: number;
  play(): Promise<void>;
}

export interface ReplayButton extends EventTarget {
  hidden: boolean;
  matches(selectors: string): boolean;
}

export interface Focusable {
  focus(): void;
}

export interface ReplayControl {
  /** Plays the clip from where it stands; a refusal brings the button back. */
  start(): void;
  /** Shows the button over a clip that has not played, for a reader who starts it. */
  offer(): void;
}

/** `refocus` takes the focus a press would otherwise drop, since the pressed button hides. */
export function attachReplay(clip: ReplayableClip, button: ReplayButton, refocus: Focusable): ReplayControl {
  const show = (): void => {
    button.hidden = false;
  };
  const hide = (): void => {
    button.hidden = true;
  };
  // Autoplay refused (a power-saving mode, a site setting) fires no event;
  // the rejected play() is the only report of it.
  const start = (): void => {
    hide();
    clip.play().catch(show);
  };
  hide();
  clip.addEventListener('play', hide);
  clip.addEventListener('pause', show);
  clip.addEventListener('ended', show);
  button.addEventListener('click', () => {
    if (button.matches(':focus')) refocus.focus();
    // play() on an ended clip restarts it from 0 itself. Seeking first races
    // that restart in Safari: play fires before the seek paints, and the clip
    // sits frozen on its last frame until it "ends" again.
    if (!clip.ended) clip.currentTime = 0;
    start();
  });
  return { start, offer: show };
}
