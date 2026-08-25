// Which fix to name on the gate page. Pure, so the platform table is
// testable without a browser. See README.md § UA picks the wording, never
// the verdict.

/** What the page can read off the browser without asking it to render.
 *  Deliberately a plain record: the caller pulls these off `navigator`,
 *  and every test states them outright. */
export interface UaHints {
  userAgent: string;
  /** `navigator.platform`, or '' where the browser withholds it. */
  platform: string;
  /** `navigator.maxTouchPoints` — the one signal that separates an iPad
   *  on iPadOS 13+ from a desktop Mac, since it claims to be a Mac in
   *  every other field. */
  maxTouchPoints: number;
}

export interface GateAdvice {
  /** Which branch matched — the test's handle, and the page's data attr. */
  platform: 'ios' | 'macos-safari' | 'firefox' | 'android' | 'other';
  /** One sentence naming what to do. */
  action: string;
  /** The version fact behind it, or '' where there is none to give. */
  detail: string;
}

/**
 * The support audit this table encodes is **dated** and the page says so,
 * because a browser the table calls unsupported may have shipped WebGPU
 * since. Nothing here is a guarantee — the verdict came from
 * `detectWebGpuSupport`, and this only picks how to word the fix.
 * README.md § UA picks the wording carries the two subtle branches.
 */
export function adviceFor(hints: UaHints): GateAdvice {
  const ua = hints.userAgent;
  const isIpadOs = /Macintosh/.test(ua) && hints.maxTouchPoints > 1;

  if (/iPhone|iPad|iPod/.test(ua) || isIpadOs) {
    return {
      platform: 'ios',
      action: 'Update to iOS or iPadOS 26, then reload.',
      detail: 'Safari has WebGPU switched on by default from version 26 (September 2025).',
    };
  }

  // Firefox before its own platform's cutoff — checked ahead of macOS so a
  // Mac Firefox gets the Firefox line rather than "use Chrome".
  if (/Firefox\//.test(ua)) {
    return {
      platform: 'firefox',
      action: 'Update Firefox, or open this page in Chrome or Edge.',
      detail: 'Firefox has WebGPU on Windows from 141 and on Apple-silicon macOS from '
        + 'about 145. On Linux it is still behind a flag, and on Android it has not '
        + 'shipped.',
    };
  }

  if (/Android/.test(ua)) {
    return {
      platform: 'android',
      action: 'Update Chrome, and check your Android version.',
      detail: 'Chrome for Android has WebGPU from 121, on Android 12 and later.',
    };
  }

  // Safari on a desktop Mac that has WebGPU nowhere: an Intel Mac, which
  // cannot install macOS Tahoe and so cannot reach Safari 26.
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) {
    const intel = /Intel/.test(hints.platform) || /Intel Mac OS X/.test(ua);
    return {
      platform: 'macos-safari',
      action: intel
        ? 'Open this page in Chrome or Edge.'
        : 'Update Safari to version 26, or open this page in Chrome or Edge.',
      detail: intel
        ? 'Safari gets WebGPU in version 26, which needs macOS Tahoe — and Tahoe does '
          + 'not run on Intel Macs. Chrome and Edge do support WebGPU on this machine.'
        : 'Safari has WebGPU switched on by default from version 26 (September 2025).',
    };
  }

  return {
    platform: 'other',
    action: 'Open this page in Chrome or Edge, version 113 or later.',
    detail: 'Those are the desktop browsers with the widest WebGPU support today.',
  };
}
