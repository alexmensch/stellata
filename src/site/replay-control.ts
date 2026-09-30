/** Shows a replay button whenever its clip is stopped, and replays the clip once on a press. */

export const REPLAY_GLYPH = '↻';

export interface ReplayableClip extends EventTarget {
  readonly ended: boolean;
  currentTime: number;
  play(): Promise<void>;
}

export interface ReplayButton extends EventTarget {
  hidden: boolean;
}

export function attachReplay(clip: ReplayableClip, button: ReplayButton): void {
  const show = (): void => {
    button.hidden = false;
  };
  const hide = (): void => {
    button.hidden = true;
  };
  hide();
  clip.addEventListener('play', hide);
  clip.addEventListener('pause', show);
  clip.addEventListener('ended', show);
  button.addEventListener('click', () => {
    hide();
    // play() on an ended clip restarts it from 0 itself. Seeking first races
    // that restart in Safari: play fires before the seek paints, and the clip
    // sits frozen on its last frame until it "ends" again.
    if (!clip.ended) clip.currentTime = 0;
    clip.play().catch(show);
  });

  // Autoplay refused (a power-saving mode, a site setting) fires no event;
  // the rejected play() is the only report of it.
  if (clip.ended) show();
  else clip.play().catch(show);
}
