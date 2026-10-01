/** The homepage's one script: each `video[data-replay]` starts when first seen and gets a replay button,
    as the hero does under reduced motion. /src/site/README.md#one-script. */

import { REPLAY_GLYPH, attachReplay, replayLabel, type ReplayControl } from './replay-control';

const SEEN_FRACTION = 0.5;

const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A replay button on `video`: beside the link around it, else inside its (positioned) parent. */
function mountReplay(video: HTMLVideoElement): ReplayControl | null {
  const link = video.closest('a');
  const host = link ?? video.parentElement;
  if (host === null) return null;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'replay';
  button.textContent = REPLAY_GLYPH;
  button.setAttribute('aria-label', replayLabel(video.getAttribute('aria-label')));

  if (link === null) {
    host.tabIndex = -1;
    host.append(button);
  } else {
    const frame = document.createElement('div');
    frame.className = 'replay-frame';
    link.replaceWith(frame);
    frame.append(link, button);
  }
  return attachReplay(video, button, host);
}

if (calm) {
  for (const video of document.querySelectorAll<HTMLVideoElement>('video[autoplay]')) {
    video.removeAttribute('autoplay');
    video.load();
    mountReplay(video)?.offer();
  }
}

const controls = new Map<Element, ReplayControl>();
const seen = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      seen.unobserve(entry.target);
      controls.get(entry.target)?.start();
    }
  },
  { threshold: SEEN_FRACTION },
);

for (const video of document.querySelectorAll<HTMLVideoElement>('video[data-replay]')) {
  const control = mountReplay(video);
  if (control === null) continue;
  if (calm) {
    control.offer();
  } else {
    controls.set(video, control);
    seen.observe(video);
  }
}
