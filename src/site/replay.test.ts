// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';

import { replayLabel } from './replay-control';

const PAGE = `
  <section class="hero"><video id="hero" autoplay muted></video></section>
  <a class="sight-media" id="media" href="/app/v/AQAA/">
    <video id="clip" data-replay preload="none" aria-label="Orion deforming"></video>
  </a>
  <a id="plain" href="/app"><video id="still"></video></a>
`;

class FakeObserver {
  static last: FakeObserver | null = null;
  readonly observed = new Set<Element>();
  constructor(private readonly callback: IntersectionObserverCallback) {
    FakeObserver.last = this;
  }
  observe(target: Element): void {
    this.observed.add(target);
  }
  unobserve(target: Element): void {
    this.observed.delete(target);
  }
  disconnect(): void {
    this.observed.clear();
  }
  reveal(target: Element): void {
    const entry = { target, isIntersecting: true } as IntersectionObserverEntry;
    this.callback([entry], this as unknown as IntersectionObserver);
  }
}

async function runScript(reducedMotion: boolean): Promise<void> {
  document.body.innerHTML = PAGE;
  vi.stubGlobal('IntersectionObserver', FakeObserver);
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: reducedMotion && query.includes('reduce') }));
  vi.resetModules();
  await import('./replay');
}

const byId = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

describe('replay.ts on the page', () => {
  let play: MockInstance<HTMLMediaElement['play']>;
  let load: MockInstance<HTMLMediaElement['load']>;

  beforeEach(() => {
    play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    FakeObserver.last = null;
  });

  it('puts the button beside the media anchor, never inside it', async () => {
    await runScript(false);
    const media = byId('media');
    const button = media.nextElementSibling as HTMLButtonElement;
    expect(button.tagName).toBe('BUTTON');
    expect(button.closest('a')).toBeNull();
    expect(button.type).toBe('button');
    expect(button.getAttribute('aria-label')).toBe(replayLabel('Orion deforming'));
    expect(media.parentElement?.className).toBe('replay-frame');
  });

  it('gives a clip without data-replay no button', async () => {
    await runScript(false);
    expect(byId('plain').parentElement).toBe(document.body);
    expect(document.querySelectorAll('button')).toHaveLength(1);
  });

  it('starts a sight clip only when it is first seen', async () => {
    await runScript(false);
    const clip = byId('clip');
    expect(play).not.toHaveBeenCalled();
    expect(FakeObserver.last?.observed.has(clip)).toBe(true);
    FakeObserver.last?.reveal(clip);
    expect(play).toHaveBeenCalledTimes(1);
    expect(FakeObserver.last?.observed.has(clip)).toBe(false);
  });

  it('under reduced motion plays nothing and offers the button', async () => {
    await runScript(true);
    const hero = byId<HTMLVideoElement>('hero');
    expect(hero.hasAttribute('autoplay')).toBe(false);
    expect(load).toHaveBeenCalledTimes(1);
    expect(FakeObserver.last?.observed.size).toBe(0);
    expect((byId('media').nextElementSibling as HTMLButtonElement).hidden).toBe(false);
    expect(play).not.toHaveBeenCalled();
  });
});
