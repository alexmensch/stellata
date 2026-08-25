// Which fix to name on the gate page. Pure, so the platform table is
// testable without a browser. See README.md § UA picks the wording and
// § What a no-adapter reader is told.

import type { WebGpuVerdict } from './webgpu-support';

/** The two verdicts that can reach a page; `supported` never does. */
export type GateVerdict = Exclude<WebGpuVerdict, 'supported'>;

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

type Copy = Pick<GateAdvice, 'action' | 'detail'>;

function platformFor(hints: UaHints): GateAdvice['platform'] {
  const ua = hints.userAgent;
  const isIpadOs = /Macintosh/.test(ua) && hints.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || isIpadOs) return 'ios';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Android/.test(ua)) return 'android';
  if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return 'macos-safari';
  return 'other';
}

/** Firefox ships WebGPU per operating system, so "update Firefox" is only
 *  the fix on the two where shipping it is what happened. */
function firefoxAdvice(ua: string): Copy {
  if (/Android/.test(ua)) {
    return {
      action: 'Open this page in Chrome for Android.',
      detail: 'Firefox for Android has not shipped WebGPU, so updating it will not help. '
        + 'Chrome for Android has it from version 121, on Android 12 and later.',
    };
  }
  if (/Linux|X11/.test(ua)) {
    return {
      action: 'Open this page in Chrome, or switch on dom.webgpu.enabled in about:config.',
      detail: 'Firefox on Linux still keeps WebGPU behind that flag, so updating alone '
        + 'will not switch it on.',
    };
  }
  return {
    action: 'Update Firefox, or open this page in Chrome or Edge.',
    detail: 'Firefox has WebGPU on Windows from 141 and on Apple-silicon macOS from '
      + 'about 145.',
  };
}

/** No `navigator.gpu` at all, so naming a newer browser or OS is the fix. */
function missingApiAdvice(platform: GateAdvice['platform'], hints: UaHints): Copy {
  switch (platform) {
    case 'ios':
      return {
        action: 'Update to iOS or iPadOS 26, then reload.',
        detail: 'Safari has WebGPU switched on by default from version 26 (September 2025).',
      };
    case 'firefox':
      return firefoxAdvice(hints.userAgent);
    case 'android':
      return {
        action: 'Update Chrome, and check your Android version.',
        detail: 'Chrome for Android has WebGPU from 121, on Android 12 and later.',
      };
    case 'macos-safari': {
      // An Intel Mac cannot install macOS Tahoe, so it cannot reach
      // Safari 26 — the one branch where updating Safari is not the fix.
      const intel = /Intel/.test(hints.platform) || /Intel Mac OS X/.test(hints.userAgent);
      return intel
        ? {
          action: 'Open this page in Chrome or Edge.',
          detail: 'Safari gets WebGPU in version 26, which needs macOS Tahoe — and Tahoe '
            + 'does not run on Intel Macs. Chrome and Edge do support WebGPU on this '
            + 'machine.',
        }
        : {
          action: 'Update Safari to version 26, or open this page in Chrome or Edge.',
          detail: 'Safari has WebGPU switched on by default from version 26 '
            + '(September 2025).',
        };
    }
    case 'other':
      return {
        action: 'Open this page in Chrome or Edge, version 113 or later.',
        detail: 'Those are the desktop browsers with the widest WebGPU support today.',
      };
  }
}

/** The API is present and no device started, so every "install this
 *  browser" line is wrong by construction — this browser already has it. */
function noDeviceAdvice(platform: GateAdvice['platform']): Copy {
  if (platform === 'ios' || platform === 'android') {
    return {
      action: 'Close your other apps and reload. If it keeps failing, restart the device.',
      detail: 'This browser has WebGPU, but no graphics device would start — on a phone '
        + 'or tablet that usually clears on its own.',
    };
  }
  return {
    action: 'Switch hardware acceleration on in your browser settings, then reload.',
    detail: 'This browser has WebGPU, but no graphics device would start — usually '
      + 'hardware acceleration turned off, a graphics driver the browser blocks, or a '
      + 'remote or virtual session with no GPU to hand out.',
  };
}

/**
 * The support audit behind the `no-api` table is dated and the page says
 * so. Nothing here is a guarantee: `detectWebGpuSupport` produced the
 * verdict, and this only picks how to word the fix.
 */
export function adviceFor(hints: UaHints, verdict: GateVerdict): GateAdvice {
  const platform = platformFor(hints);
  return {
    platform,
    ...(verdict === 'no-api' ? missingApiAdvice(platform, hints) : noDeviceAdvice(platform)),
  };
}
