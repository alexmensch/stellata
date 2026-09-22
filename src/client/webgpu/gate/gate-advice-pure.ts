// Which fix to name on the gate page. Pure, so the platform table is
// testable without a browser. See README.md § UA picks the wording and
// § What a no-adapter reader is told.

import type { WebGpuVerdict } from './webgpu-support';

/** The two verdicts that can reach a page; `supported` never does. */
export type GateVerdict = Exclude<WebGpuVerdict, 'supported'>;

/** Lives here rather than beside the builder because the perf runner reads it
 *  to tell a gated boot from a hung one (`scripts/perf/README.md` § What a run
 *  does), and that is Node code: a value import of the builder would put a
 *  module written against `document` and `navigator` in the runner's import
 *  graph. */
export const GATE_ELEMENT_ID = 'webgpu-gate';

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

/** Chrome on every OS and both verdicts; see README.md § UA picks the
 *  wording. The `no-adapter` copy may name no version at all. */
function firefoxAdvice(ua: string, verdict: GateVerdict): Copy {
  const android = /Android/.test(ua);
  const action = android
    ? 'Open this page in Chrome for Android.'
    : 'Open this page in Chrome or Edge.';

  if (verdict === 'no-adapter') {
    return {
      action,
      detail: 'Firefox here has WebGPU and still started no graphics device. A newer '
        + 'Firefox may fix that, but Chrome is where Stellata has run reliably on every '
        + 'platform tested.',
    };
  }
  if (android) {
    return {
      action,
      detail: 'Firefox for Android has not shipped WebGPU at all. Chrome for Android has '
        + 'it from version 121, on Android 12 and later.',
    };
  }
  if (/Linux|X11/.test(ua)) {
    return {
      action,
      detail: 'Firefox on Linux keeps WebGPU behind dom.webgpu.enabled in about:config, '
        + 'which may work. Chrome needs no flag and is where Stellata has run reliably.',
    };
  }
  // No version numbers: Firefox ships WebGPU per platform on its own
  // schedule, and this page is reached BY a Firefox without it — naming the
  // version a reader is already running tells them their browser is the one
  // that works.
  return {
    action,
    detail: 'Firefox has begun shipping WebGPU on some platforms, but Chrome and '
      + 'Edge are where Stellata has run reliably.',
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
      return firefoxAdvice(hints.userAgent, 'no-api');
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

/** The API is present and no device started, so no line may tell the
 *  reader to update the browser they are running. Firefox still names
 *  another browser (README.md § UA picks the wording). */
function noDeviceAdvice(platform: GateAdvice['platform'], hints: UaHints): Copy {
  if (platform === 'firefox') return firefoxAdvice(hints.userAgent, 'no-adapter');
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
    ...(verdict === 'no-api'
      ? missingApiAdvice(platform, hints)
      : noDeviceAdvice(platform, hints)),
  };
}
