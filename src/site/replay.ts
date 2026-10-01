/** The homepage's one script: each `video[data-replay]` starts when first seen and gets a replay button.
    /src/site/README.md#one-script. */

import { REPLAY_GLYPH, attachReplay, replayLabel, type ReplayControl } from './replay-control';

const SEEN_FRACTION = 0.5;

const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

if (calm) {
  for (const video of document.querySelectorAll<HTMLVideoElement>('video[autoplay]')) {
    video.removeAttribute('autoplay');
    video.load();
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
  const media = video.parentElement;
  if (media === null) continue;

  const frame = document.createElement('div');
  frame.className = 'replay-frame';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'replay';
  button.textContent = REPLAY_GLYPH;
  button.setAttribute('aria-label', replayLabel(video.getAttribute('aria-label')));

  media.replaceWith(frame);
  frame.append(media, button);
  const control = attachReplay(video, button, media);
  if (calm) {
    control.offer();
  } else {
    controls.set(video, control);
    seen.observe(video);
  }
}
