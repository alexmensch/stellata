/** The homepage's one script: a replay button on every `video[data-replay]`. src/site/README.md § One script. */

import { REPLAY_GLYPH, attachReplay } from './replay-control';

for (const video of document.querySelectorAll<HTMLVideoElement>('video[data-replay]')) {
  const media = video.parentElement;
  if (media === null) continue;

  const frame = document.createElement('div');
  frame.className = 'replay-frame';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'replay';
  button.textContent = REPLAY_GLYPH;
  button.setAttribute('aria-label', 'Replay clip');

  media.replaceWith(frame);
  frame.append(media, button);
  attachReplay(video, button);
}
