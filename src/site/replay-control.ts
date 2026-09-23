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
  button.hidden = true;
  clip.addEventListener('play', () => {
    button.hidden = true;
  });
  clip.addEventListener('pause', show);
  clip.addEventListener('ended', show);
  button.addEventListener('click', () => {
    clip.currentTime = 0;
    void clip.play();
  });

  // Autoplay refused (a power-saving mode, a site setting) fires no event;
  // the rejected play() is the only report of it.
  if (clip.ended) show();
  else clip.play().catch(show);
}
