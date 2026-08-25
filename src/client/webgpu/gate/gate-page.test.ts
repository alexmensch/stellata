import { describe, expect, it } from 'vitest';
import { GATE_ELEMENT_ID, SUPPORT_AUDIT_LABEL, showWebGpuGate } from './gate-page';
import type { UaHints } from './gate-advice-pure';

/** Element-shaped stub — the suite runs in vitest's 'node' environment,
 *  the same reason `typeahead.test.ts` builds its own. */
class ElStub {
  id = '';
  className = '';
  textContent = '';
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly attrs: Record<string, string> = {};
  readonly children: ElStub[] = [];
  constructor(readonly tag: string) {}
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  append(...kids: ElStub[]): void { this.children.push(...kids); }
  /** Depth-first text of the whole subtree, which is what the copy
   *  assertions read. */
  text(): string {
    return [this.textContent, ...this.children.map((c) => c.text())].join(' ');
  }
}

function fakeDoc(selectorHits: ElStub[] = []) {
  const byId = new Map<string, ElStub>();
  const body = new ElStub('body');
  return {
    doc: {
      getElementById: (id: string) => byId.get(id) ?? null,
      createElement: (tag: string) => new ElStub(tag),
      querySelectorAll: () => selectorHits,
      body: {
        append: (el: ElStub) => {
          body.append(el);
          if (el.id !== '') byId.set(el.id, el);
        },
      },
    } as unknown as Document,
    body,
  };
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 '
  + '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const hints: UaHints = { userAgent: IPHONE, platform: '', maxTouchPoints: 5 };

describe('the requires-WebGPU gate page', () => {
  it('mounts under a stable id and tags the branch it took', () => {
    const { doc, body } = fakeDoc();
    const gate = showWebGpuGate('no-api', hints, doc) as unknown as ElStub;
    expect(gate.id).toBe(GATE_ELEMENT_ID);
    expect(gate.dataset.platform).toBe('ios');
    expect(gate.dataset.verdict).toBe('no-api');
    expect(body.children).toHaveLength(1);
  });

  it('names the fix for the browser reading it, and dates the claim', () => {
    const { doc } = fakeDoc();
    const gate = showWebGpuGate('no-api', hints, doc) as unknown as ElStub;
    expect(gate.text()).toContain('iOS or iPadOS 26');
    // A dated audit, never a guarantee: a browser this table calls
    // unsupported may have shipped WebGPU since.
    expect(gate.text()).toContain(SUPPORT_AUDIT_LABEL);
  });

  // Both verdicts land on the same page; only the lead sentence differs,
  // because "supports WebGPU but no device" is a different thing to fix.
  it('separates the two failures in the lead copy', () => {
    const noApi = showWebGpuGate('no-api', hints, fakeDoc().doc) as unknown as ElStub;
    const noAdapter = showWebGpuGate('no-adapter', hints, fakeDoc().doc) as unknown as ElStub;
    expect(noApi.text()).toContain('doesn’t support');
    expect(noAdapter.text()).toContain('couldn’t start a graphics device');
    expect(noAdapter.dataset.verdict).toBe('no-adapter');
  });

  // A caller that races — a boot failure plus an explicit force — must not
  // stack two copies over each other.
  it('is idempotent', () => {
    const { doc, body } = fakeDoc();
    const first = showWebGpuGate('no-api', hints, doc);
    const second = showWebGpuGate('no-adapter', hints, doc);
    expect(second).toBe(first);
    expect(body.children).toHaveLength(1);
  });

  it('hides what is behind it, since the gate is terminal for the page load', () => {
    const canvas = new ElStub('canvas');
    const topbar = new ElStub('div');
    const { doc } = fakeDoc([canvas, topbar]);
    showWebGpuGate('no-api', hints, doc);
    expect(canvas.style.display).toBe('none');
    expect(topbar.style.display).toBe('none');
  });

  it('sets the accessible role and label', () => {
    const { doc } = fakeDoc();
    const gate = showWebGpuGate('no-api', hints, doc) as unknown as ElStub;
    expect(gate.attrs.role).toBe('alertdialog');
    expect(gate.attrs['aria-labelledby']).toBe('webgpu-gate-title');
  });
});
