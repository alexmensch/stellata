// Minimal HTML-element DOM fake for the rolodex suite.

export interface FakeEl {
  id: string;
  hidden: boolean;
  className: string;
  textContent: string;
  readonly children: FakeEl[];
  readonly classes: Set<string>;
  classList: {
    add(...n: string[]): void;
    remove(...n: string[]): void;
    toggle(n: string, force?: boolean): void;
    contains(n: string): boolean;
  };
  style: { setProperty(k: string, v: string): void };
  setAttribute(k: string, v: string): void;
  getAttribute(k: string): string | null;
  appendChild(child: FakeEl): FakeEl;
  append(...kids: FakeEl[]): void;
  querySelector(sel: string): FakeEl | null;
  querySelectorAll(sel: string): FakeEl[];
  addEventListener(type: string, cb: (e: unknown) => void): void;
  removeEventListener(type: string, cb: (e: unknown) => void): void;
  /** Fire every listener registered for `type`. */
  emit(type: string, e?: unknown): void;
}

export function makeEl(id = ''): FakeEl {
  const classes = new Set<string>();
  const attrs = new Map<string, string>();
  const children: FakeEl[] = [];
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  let text = '';
  const el: FakeEl = {
    id,
    hidden: false,
    className: '',
    get textContent() { return text; },
    // Assigning '' is how both renderers clear a subtree.
    set textContent(v: string) { text = v; if (v === '') children.length = 0; },
    children,
    classes,
    classList: {
      add: (...n) => n.forEach((c) => classes.add(c)),
      remove: (...n) => n.forEach((c) => classes.delete(c)),
      toggle: (n, force) => {
        const on = force ?? !classes.has(n);
        if (on) classes.add(n); else classes.delete(n);
      },
      contains: (n) => classes.has(n),
    },
    style: { setProperty: () => {} },
    setAttribute: (k, v) => { attrs.set(k, v); },
    getAttribute: (k) => attrs.get(k) ?? null,
    appendChild: (child) => { children.push(child); return child; },
    append: (...kids) => { children.push(...kids); },
    querySelector: (sel) => el.querySelectorAll(sel)[0] ?? null,
    querySelectorAll: (sel) => {
      const want = sel.replace(/^\./, '');
      const hit: FakeEl[] = [];
      const walk = (n: FakeEl) => {
        for (const c of n.children) {
          if (c.className === want || c.id === want) hit.push(c);
          walk(c);
        }
      };
      walk(el);
      return hit;
    },
    addEventListener: (type, cb) => { (listeners.get(type) ?? setList(type)).push(cb); },
    removeEventListener: (type, cb) => {
      const list = listeners.get(type);
      if (list) listeners.set(type, list.filter((f) => f !== cb));
    },
    emit: (type, e) => { for (const cb of listeners.get(type) ?? []) cb(e ?? {}); },
  };
  function setList(type: string) {
    const list: ((e: unknown) => void)[] = [];
    listeners.set(type, list);
    return list;
  }
  return el;
}

/** Every element id the rolodex resolves, pre-minted. */
export const CARD_IDS = [
  'card-stack', 'card-strips', 'front-card', 'front-card-title',
  'front-card-inner', 'front-card-header', 'front-card-close',
  'front-card-toggle',
] as const;

export interface CardDom {
  els: Map<string, FakeEl>;
  /** Install as `document` + `localStorage` globals; returns the teardown. */
  install(): () => void;
  /** The rendered card as flat text — title, then one line per row. */
  dump(): string;
}

export function makeCardDom(): CardDom {
  const els = new Map<string, FakeEl>(CARD_IDS.map((id) => [id, makeEl(id)]));
  const store = new Map<string, string>();
  const doc = {
    getElementById: (id: string) => els.get(id) ?? null,
    createElement: () => makeEl(),
  };
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: () => null,
    get length() { return store.size; },
  } as unknown as Storage;

  const flatten = (el: FakeEl, out: string[]) => {
    if (el.children.length === 0) {
      if (el.textContent !== '') out.push(el.textContent);
      return;
    }
    for (const c of el.children) flatten(c, out);
  };

  return {
    els,
    install() {
      const prevDoc = (globalThis as { document?: unknown }).document;
      const prevStore = (globalThis as { localStorage?: unknown }).localStorage;
      Object.assign(globalThis, { document: doc, localStorage: storage });
      return () => {
        Object.assign(globalThis, { document: prevDoc, localStorage: prevStore });
      };
    },
    dump() {
      const out: string[] = [els.get('front-card-title')!.textContent];
      flatten(els.get('front-card-inner')!, out);
      return out.join('\n');
    },
  };
}
