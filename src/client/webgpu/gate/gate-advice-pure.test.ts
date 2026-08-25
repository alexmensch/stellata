import { describe, expect, it } from 'vitest';
import { adviceFor, type UaHints } from './gate-advice-pure';

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
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 11; Pixel 4) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const WIN_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36';

describe('the gate names the fix for the browser reading it', () => {
  it('sends iPhone to the OS update', () => {
    const a = adviceFor(hints(IPHONE));
    expect(a.platform).toBe('ios');
    expect(a.action).toContain('26');
  });

  // An iPad on iPadOS 13+ claims to be a Mac in every field but this one,
  // so touch points are the only thing separating it from a desktop Safari
  // that would get the "use Chrome" line instead.
  it('separates iPadOS from a desktop Mac on touch points alone', () => {
    expect(adviceFor(hints(IPAD_OS, { maxTouchPoints: 5 })).platform).toBe('ios');
    expect(adviceFor(hints(IPAD_OS, { maxTouchPoints: 0 })).platform).toBe('macos-safari');
  });

  // An Intel Mac cannot install Tahoe, so it cannot reach Safari 26 — the
  // one branch where updating Safari is NOT the advice.
  it('tells an Intel Mac to switch browser, not to update Safari', () => {
    const a = adviceFor(hints(MAC_SAFARI_INTEL, { platform: 'MacIntel' }));
    expect(a.platform).toBe('macos-safari');
    expect(a.action).toContain('Chrome');
    expect(a.action).not.toContain('Update Safari');
    expect(a.detail).toContain('Tahoe');
  });

  it('tells an Apple-silicon Mac it can update Safari', () => {
    const a = adviceFor(hints(MAC_SAFARI_ARM, { platform: 'MacARM' }));
    expect(a.platform).toBe('macos-safari');
    expect(a.action).toContain('Update Safari');
  });

  // Firefox is matched before the macOS branch, or a Mac Firefox user gets
  // told to update Safari — a browser they are not using.
  it('gives Mac Firefox the Firefox line, not the Safari one', () => {
    const a = adviceFor(hints(MAC_FIREFOX, { platform: 'MacIntel' }));
    expect(a.platform).toBe('firefox');
    expect(a.action).toContain('Firefox');
  });

  it('gives Android Chrome its version and OS floor', () => {
    const a = adviceFor(hints(ANDROID_CHROME));
    expect(a.platform).toBe('android');
    expect(a.detail).toContain('121');
    expect(a.detail).toContain('Android 12');
  });

  it('falls back to Chrome/Edge 113 for anything unrecognised', () => {
    expect(adviceFor(hints(WIN_CHROME)).platform).toBe('other');
    expect(adviceFor(hints('')).action).toContain('113');
  });

  it('always gives both an action and a detail', () => {
    for (const ua of [IPHONE, MAC_SAFARI_INTEL, MAC_FIREFOX, ANDROID_CHROME, WIN_CHROME, '']) {
      const a = adviceFor(hints(ua));
      expect(a.action.length).toBeGreaterThan(0);
      expect(a.detail.length).toBeGreaterThan(0);
    }
  });
});
