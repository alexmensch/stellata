import { describe, expect, it } from 'vitest';

import { attachReplay, type ReplayButton, type ReplayableClip } from './replay-control';

class FakeClip extends EventTarget implements ReplayableClip {
  ended = false;
  currentTime = 0;
  plays = 0;
  constructor(private readonly refusedPlays = 0) {
    super();
  }
  play(): Promise<void> {
    this.plays += 1;
    if (this.plays <= this.refusedPlays) return Promise.reject(new Error('NotAllowedError'));
    if (this.ended) this.currentTime = 0;
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

  it('replays an ended clip once through play() alone, with no seek to race it', () => {
    const clip = new FakeClip();
    const button = new FakeButton();
    attachReplay(clip, button);
    clip.currentTime = 4.9;
    clip.finish();
    const before = clip.plays;
    let seekedBeforePlay = false;
    const play = clip.play.bind(clip);
    clip.play = () => {
      seekedBeforePlay = clip.currentTime === 0;
      return play();
    };
    button.press();
    expect(seekedBeforePlay).toBe(false);
    expect(clip.currentTime).toBe(0);
    expect(clip.plays).toBe(before + 1);
    expect(button.hidden).toBe(true);
  });

  it('rewinds a clip paused part-way before playing it', () => {
    const clip = new FakeClip();
    const button = new FakeButton();
    attachReplay(clip, button);
    clip.currentTime = 2.5;
    clip.dispatchEvent(new Event('pause'));
    button.press();
    expect(clip.currentTime).toBe(0);
    expect(button.hidden).toBe(true);
  });

  it('hides on the press itself, before the clip reports playing', () => {
    const clip = new FakeClip();
    const button = new FakeButton();
    attachReplay(clip, button);
    clip.finish();
    clip.play = () => new Promise<void>(() => {});
    button.press();
    expect(button.hidden).toBe(true);
  });

  it('comes back when a press is refused', async () => {
    const clip = new FakeClip(2);
    const button = new FakeButton();
    attachReplay(clip, button);
    await settle();
    button.press();
    expect(button.hidden).toBe(true);
    await settle();
    expect(button.hidden).toBe(false);
  });

  it('appears when the browser refuses to autoplay', async () => {
    const clip = new FakeClip(1);
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
