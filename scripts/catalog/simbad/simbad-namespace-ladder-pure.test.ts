import { describe, it, expect } from 'vitest';
import {
  normaliseGjKey,
  simbadHipKey,
  SIMBAD_NAMESPACE_VALUES,
  emptySimbadNamespaceIndex,
  indexSimbadRow,
  walkSimbadNamespaces,
  type SimbadNamespace,
  type SimbadNamespaceIndex,
  type SimbadRecordKeys,
} from './simbad-namespace-ladder-pure';

describe('simbad-namespace-ladder-pure / normaliseGjKey', () => {
  // The spine spells the catalogue word both ways and SIMBAD stores its own
  // spacing; one folded key is what lets the two meet.
  it('folds both catalogue words and SIMBAD spacing onto one key', () => {
    expect(normaliseGjKey('Gl 165A')).toBe('165A');
    expect(normaliseGjKey('GJ 165A')).toBe('165A');
    expect(normaliseGjKey('165 A')).toBe('165A');
    expect(normaliseGjKey('gj 9728 a')).toBe('9728A');
  });

  it('keeps a bare designation and rejects an empty cell', () => {
    expect(normaliseGjKey('4246')).toBe('4246');
    expect(normaliseGjKey('  ')).toBeNull();
    expect(normaliseGjKey(null)).toBeNull();
    expect(normaliseGjKey('GJ ')).toBeNull();
  });
});

describe('simbad-namespace-ladder-pure / SIMBAD namespace ladder', () => {
  const ALL_KEYS: SimbadRecordKeys = {
    sourceId: '99', hip: 22, tyc: '1-2-1', gl: 'Gl 165A',
  };

  const indexOneRowPerNamespace = (): SimbadNamespaceIndex<string> => {
    const index = emptySimbadNamespaceIndex<string>();
    index.bySourceId.set('99', 'source_id');
    index.byHip.set(22, 'hip');
    index.byGj.set('165A', 'gj');
    index.byTyc.set('1-2-1', 'tyc');
    return index;
  };

  // The array is the only statement of walk order; withdrawing the winning
  // namespace's key one at a time must surface the rest in exactly its order.
  it('walks namespaces in SIMBAD_NAMESPACE_VALUES order', () => {
    const index = indexOneRowPerNamespace();
    const keys: SimbadRecordKeys = { ...ALL_KEYS };
    const withdraw: Record<SimbadNamespace, () => void> = {
      source_id: () => { keys.sourceId = null; },
      hip: () => { keys.hip = null; },
      gj: () => { keys.gl = null; },
      tyc: () => { keys.tyc = null; },
    };
    const seen: SimbadNamespace[] = [];
    for (let i = 0; i < SIMBAD_NAMESPACE_VALUES.length; i++) {
      const hit = walkSimbadNamespaces(index, keys, (row) => row);
      seen.push(hit!.namespace);
      withdraw[hit!.namespace]();
    }
    expect(seen).toEqual([...SIMBAD_NAMESPACE_VALUES]);
    expect(walkSimbadNamespaces(index, keys, (row) => row)).toBeNull();
  });

  // indexSimbadRow and walkSimbadNamespaces derive each key from one binding
  // table, so a row written under a namespace is reachable by it.
  it('reaches an indexed row under every namespace that keyed it', () => {
    const index = emptySimbadNamespaceIndex<string>();
    indexSimbadRow(index, ALL_KEYS, 'row', () => {
      throw new Error('unexpected duplicate');
    });
    for (const namespace of SIMBAD_NAMESPACE_VALUES) {
      const only: SimbadRecordKeys = {
        sourceId: namespace === 'source_id' ? ALL_KEYS.sourceId : null,
        hip: namespace === 'hip' ? ALL_KEYS.hip : null,
        tyc: namespace === 'tyc' ? ALL_KEYS.tyc : null,
        gl: namespace === 'gj' ? ALL_KEYS.gl : null,
      };
      expect(walkSimbadNamespaces(index, only, (row) => row)).toEqual({
        value: 'row', namespace,
      });
    }
  });

  it('hands every colliding namespace to the resolver', () => {
    const index = emptySimbadNamespaceIndex<string>();
    indexSimbadRow(index, ALL_KEYS, 'first', () => {
      throw new Error('unexpected duplicate');
    });
    const collisions: SimbadNamespace[] = [];
    indexSimbadRow(index, ALL_KEYS, 'second', (namespace, _key, incumbent) => {
      collisions.push(namespace);
      return incumbent;
    });
    expect(collisions).toEqual([...SIMBAD_NAMESPACE_VALUES]);
    expect(walkSimbadNamespaces(index, ALL_KEYS, (row) => row)?.value).toBe('first');
  });

  it('indexes the row the resolver picks, under every shared key', () => {
    // A pull that unions namespaces reaches one star under two objects, so
    // the consumer that knows which cell it came for decides.
    const index = emptySimbadNamespaceIndex<string>();
    indexSimbadRow(index, ALL_KEYS, 'first', () => {
      throw new Error('unexpected duplicate');
    });
    indexSimbadRow(index, ALL_KEYS, 'second', (_ns, _key, _incumbent, candidate) => candidate);
    expect(walkSimbadNamespaces(index, ALL_KEYS, (row) => row)?.value).toBe('second');
  });

  it('hands accept the namespace that reached each row it passes over', () => {
    const index = emptySimbadNamespaceIndex<string>();
    indexSimbadRow(index, ALL_KEYS, 'row', () => {
      throw new Error('unexpected duplicate');
    });
    const reached: SimbadNamespace[] = [];
    const hit = walkSimbadNamespaces(index, ALL_KEYS, (row, namespace) => {
      reached.push(namespace);
      return namespace === 'gj' ? row : null;
    });
    expect(reached).toEqual(['source_id', 'hip', 'gj']);
    expect(hit).toEqual({ value: 'row', namespace: 'gj' });
  });

  // A bogus HIP cell must be no key at all rather than a key nothing looks
  // up, which is what would make an indexed row unreachable but present.
  it('takes only a positive integer HIP as a key', () => {
    expect(simbadHipKey(22)).toBe(22);
    expect(simbadHipKey(0)).toBeNull();
    expect(simbadHipKey(-1)).toBeNull();
    expect(simbadHipKey(22.5)).toBeNull();
    expect(simbadHipKey(Number.NaN)).toBeNull();
    expect(simbadHipKey(null)).toBeNull();
  });

  it('indexes nowhere for a row carrying no namespace key', () => {
    const index = emptySimbadNamespaceIndex<string>();
    const none: SimbadRecordKeys = { sourceId: '', hip: 0, tyc: '', gl: '  ' };
    indexSimbadRow(index, none, 'row', () => {
      throw new Error('unexpected duplicate');
    });
    expect(index.bySourceId.size + index.byHip.size + index.byGj.size + index.byTyc.size)
      .toBe(0);
  });
});
