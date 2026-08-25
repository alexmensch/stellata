import { describe, expect, it } from 'vitest';
import { adviceFor, type GateVerdict, type UaHints } from './gate-advice-pure';

const hints = (userAgent: string, over: Partial<UaHints> = {}): UaHints => ({
  userAgent, platform: '', maxTouchPoints: 0, ...over,
});

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_OS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const MAC_SAFARI_INTEL = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
  + 'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15';
const MAC_SAFARI_ARM = 'Mozilla/5.0 (Macintosh; ARM Mac OS X 14_5) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.6 Safari/605.1.15';
const MAC_FIREFOX = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:128.0) '
  + 'Gecko/20100101 Firefox/128.0';
const LINUX_FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0';
const ANDROID_FIREFOX = 'Mozilla/5.0 (Android 14; Mobile; rv:139.0) Gecko/139.0 Firefox/139.0';
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 11; Pixel 4) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36';

const EVERY_UA = [IPHONE, IPAD_OS, MAC_SAFARI_INTEL, MAC_SAFARI_ARM, MAC_FIREFOX,
  LINUX_FIREFOX, ANDROID_FIREFOX, ANDROID_CHROME, WIN_CHROME, ''];

describe('no-api — the browser has no WebGPU, so name a newer one', () => {
  it('sends iPhone to the OS update', () => {
    const a = adviceFor(hints(IPHONE), 'no-api');
    expect(a.platform).toBe('ios');
    expect(a.action).toContain('26');
  });

  // An iPad on iPadOS 13+ claims to be a Mac in every field but this one,
  // so touch points are the only thing separating it from a desktop Safari
  // that would get the "use Chrome" line instead.
  it('separates iPadOS from a desktop Mac on touch points alone', () => {
    expect(adviceFor(hints(IPAD_OS, { maxTouchPoints: 5 }), 'no-api').platform).toBe('ios');
    expect(adviceFor(hints(IPAD_OS, { maxTouchPoints: 0 }), 'no-api').platform)
      .toBe('macos-safari');
  });

  // An Intel Mac cannot install Tahoe, so it cannot reach Safari 26 — the
  // one branch where updating Safari is NOT the advice.
  it('tells an Intel Mac to switch browser, not to update Safari', () => {
    const a = adviceFor(hints(MAC_SAFARI_INTEL, { platform: 'MacIntel' }), 'no-api');
    expect(a.platform).toBe('macos-safari');
    expect(a.action).toContain('Chrome');
    expect(a.action).not.toContain('Update Safari');
    expect(a.detail).toContain('Tahoe');
  });

  it('tells an Apple-silicon Mac it can update Safari', () => {
    const a = adviceFor(hints(MAC_SAFARI_ARM, { platform: 'MacARM' }), 'no-api');
    expect(a.platform).toBe('macos-safari');
    expect(a.action).toContain('Update Safari');
  });

  // Firefox is matched before the macOS branch, or a Mac Firefox user gets
  // told to update Safari — a browser they are not using.
  it('gives Mac Firefox the Firefox line, not the Safari one', () => {
    const a = adviceFor(hints(MAC_FIREFOX, { platform: 'MacIntel' }), 'no-api');
    expect(a.platform).toBe('firefox');
    expect(a.action).toContain('Update Firefox');
  });

  // Firefox ships WebGPU per OS, so on the two where it has NOT shipped,
  // "update Firefox" is advice its own detail sentence contradicts.
  it('never tells Android or Linux Firefox to update, since that cannot work', () => {
    const android = adviceFor(hints(ANDROID_FIREFOX), 'no-api');
    expect(android.platform).toBe('firefox');
    expect(android.action).not.toContain('Update Firefox');
    expect(android.action).toContain('Chrome');

    const linux = adviceFor(hints(LINUX_FIREFOX), 'no-api');
    expect(linux.platform).toBe('firefox');
    expect(linux.action).not.toContain('Update Firefox');
    expect(linux.action).toContain('about:config');
  });

  it('gives Android Chrome its version and OS floor', () => {
    const a = adviceFor(hints(ANDROID_CHROME), 'no-api');
    expect(a.platform).toBe('android');
    expect(a.detail).toContain('121');
    expect(a.detail).toContain('Android 12');
  });

  it('falls back to Chrome/Edge 113 for anything unrecognised', () => {
    expect(adviceFor(hints(WIN_CHROME), 'no-api').platform).toBe('other');
    expect(adviceFor(hints(''), 'no-api').action).toContain('113');
  });
});

describe('no-adapter — the browser HAS WebGPU, so never tell it to install one', () => {
  // The whole point of keeping the two verdicts apart. A browser that
  // supports WebGPU and could not start a device is on the newest version
  // there is; "update to 26" reads as nonsense to someone already on 26.
  it('names no browser or OS version to install, on any platform', () => {
    for (const ua of EVERY_UA) {
      const a = adviceFor(hints(ua, { maxTouchPoints: 5 }), 'no-adapter');
      const copy = `${a.action} ${a.detail}`;
      expect(copy).not.toMatch(/Update (Safari|Firefox|Chrome)|Update to iOS|version 26|113/);
    }
  });

  it('points a desktop at hardware acceleration and the driver', () => {
    const a = adviceFor(hints(WIN_CHROME), 'no-adapter');
    expect(a.action).toContain('hardware acceleration');
    expect(a.detail).toContain('driver');
  });

  // No hardware-acceleration switch and no driver to update on a phone.
  it('gives a phone or tablet advice it can actually act on', () => {
    for (const ua of [IPHONE, ANDROID_CHROME]) {
      const a = adviceFor(hints(ua), 'no-adapter');
      expect(a.action).not.toContain('hardware acceleration');
      expect(a.action).toContain('reload');
    }
  });

  it('still reports the platform it detected, for the data attr', () => {
    expect(adviceFor(hints(IPHONE), 'no-adapter').platform).toBe('ios');
    expect(adviceFor(hints(MAC_FIREFOX), 'no-adapter').platform).toBe('firefox');
  });
});

describe('both verdicts', () => {
  it('always give an action and a detail', () => {
    for (const verdict of ['no-api', 'no-adapter'] as GateVerdict[]) {
      for (const ua of EVERY_UA) {
        const a = adviceFor(hints(ua), verdict);
        expect(a.action.length).toBeGreaterThan(0);
        expect(a.detail.length).toBeGreaterThan(0);
      }
    }
  });
});
