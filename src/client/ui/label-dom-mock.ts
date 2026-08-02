// Minimal SVG-label DOM fake for the label-engine and label-family
// suites: named containers plus mint-and-lookup of <text> nodes by id.

export interface FakeLabelNode {
  /** Settable either way — cloud labels assign `.id`, LG labels
   *  `setAttribute('id', …)`; both register the node for lookup. */
  id: string;
  style: { display: string };
  textContent: string;
  setAttribute(name: string, value: string): void;
  getAttribute(name: string): string | null;
  remove(): void;
}

export interface LabelDom {
  /** Stand-in for `document` — hand it to `vi.stubGlobal('document', …)`. */
  document: {
    getElementById(id: string): unknown;
    createElementNS(ns: string, tag: string): FakeLabelNode;
  };
  /** Nodes minted so far, keyed by the id the label family assigned. */
  nodes: Map<string, FakeLabelNode>;
  /** How many minted nodes have been `remove()`d — the teardown check. */
  removed(): number;
}

/** `containerIds` are the `<g>` wrappers a label family appends into
 *  (`lg-labels`, `cloud-labels`); anything else resolves to a minted node
 *  or null, matching how the engine looks its own `<text>` up by id. */
export function makeLabelDom(containerIds: readonly string[]): LabelDom {
  const nodes = new Map<string, FakeLabelNode>();
  const containers = new Map<string, { appendChild(): void }>(
    containerIds.map((id) => [id, { appendChild: () => {} }]),
  );
  let removed = 0;
  const createElementNS = (): FakeLabelNode => {
    const attrs = new Map<string, string>();
    let id = '';
    const node: FakeLabelNode = {
      get id() { return id; },
      set id(value: string) {
        id = value;
        nodes.set(value, node);
      },
      style: { display: '' },
      textContent: '',
      setAttribute(name, value) {
        attrs.set(name, value);
        if (name === 'id') node.id = value;
      },
      getAttribute: (name) => attrs.get(name) ?? null,
      remove: () => { removed++; },
    };
    return node;
  };
  return {
    nodes,
    removed: () => removed,
    document: {
      getElementById: (lookup) => containers.get(lookup) ?? nodes.get(lookup) ?? null,
      createElementNS,
    },
  };
}
