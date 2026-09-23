import { describe, expect, it } from 'vitest';

import { attachReplay, type ReplayButton, type ReplayableClip } from './replay-control';

class FakeClip extends EventTarget implements ReplayableClip {
  ended = false;
  currentTime = 0;
  plays = 0;
  constructor(private readonly autoplayAllowed = true) {
    super();
  }
  play(): Promise<void> {
    this.plays += 1;
    if (!this.autoplayAllowed && this.plays === 1) return Promise.reject(new Error('NotAllowedError'));
    this.ended = false;
    this.dispatchEvent(new Event('play'));
    return Promise.resolve();
  }
  finish(): void {
    this.ended = true;
    this.dispatchEvent(new Event('pause'));
    this.dispatchEvent(new Event('ended'));
  }
}

class FakeButton extends EventTarget implements ReplayButton {
  hidden = false;
  press(): void {
    this.dispatchEvent(new Event('click'));
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('attachReplay', () => {
  it('stays hidden while the clip plays and appears when it ends', () => {
    const clip = new FakeClip();
    const button = new FakeButton();
    attachReplay(clip, button);
    expect(button.hidden).toBe(true);
    clip.finish();
    expect(button.hidden).toBe(false);
  });

  it('replays from the start, once, and hides again', () => {
    const clip = new FakeClip();
    const button = new FakeButton();
    attachReplay(clip, button);
    clip.finish();
    clip.currentTime = 4.9;
    const before = clip.plays;
    button.press();
    expect(clip.currentTime).toBe(0);
    expect(clip.plays).toBe(before + 1);
    expect(button.hidden).toBe(true);
  });

  it('appears when the browser refuses to autoplay', async () => {
    const clip = new FakeClip(false);
    const button = new FakeButton();
    attachReplay(clip, button);
    await settle();
    expect(button.hidden).toBe(false);
  });

  it('appears at once for a clip that ended before the script ran, without replaying it', () => {
    const clip = new FakeClip();
    clip.ended = true;
    const button = new FakeButton();
    attachReplay(clip, button);
    expect(button.hidden).toBe(false);
    expect(clip.plays).toBe(0);
  });
});
