import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fileHashes, readStamp, stampIsCurrent } from './build-stamp';
import {
  EmissionRefused, declareOutputs, emitArtifacts, emitEach, type Check,
} from './emit-artifacts';
import { STAGING_SUFFIX } from './staged-write';

describe('emitArtifacts', () => {
  let dir: string;
  let a: string;
  let b: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'emit-artifacts-'));
    a = join(dir, 'a.txt');
    b = join(dir, 'out', 'b.txt');
    writeFileSync(a, 'old a');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  const both = () => declareOutputs({ a, b });
  const files = () => ({ a: 'new a', b: 'new b' });

  it('lands every output and leaves no staged file behind', () => {
    emitArtifacts({ outputs: both(), files: files() });
    expect(readFileSync(a, 'utf8')).toBe('new a');
    expect(readFileSync(b, 'utf8')).toBe('new b');
    expect(readdirSync(dir).filter((n) => n.endsWith(STAGING_SUFFIX))).toEqual([]);
  });

  it('writes nothing when a check fails', () => {
    const fail: Check = { kind: 'fail', message: 'drifted' };
    expect(() => emitArtifacts({ outputs: both(), files: files(), checks: [{ kind: 'pass' }, fail] }))
      .toThrow(EmissionRefused);
    expect(readFileSync(a, 'utf8')).toBe('old a');
    expect(existsSync(b)).toBe(false);
    expect(existsSync(a + STAGING_SUFFIX)).toBe(false);
    expect(console.error).toHaveBeenCalledWith('drifted');
  });

  it('leaves every prior output in place when staging dies part-way', () => {
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, '');
    const c = join(blocker, 'c.txt');
    expect(() => emitArtifacts({
      outputs: declareOutputs({ a, c }),
      files: { a: 'new a', c: 'new c' },
    })).toThrow();
    expect(readFileSync(a, 'utf8')).toBe('old a');
    expect(existsSync(a + STAGING_SUFFIX)).toBe(false);
  });

  it('sweeps a staged file a killed run left behind', () => {
    writeFileSync(a + STAGING_SUFFIX, 'stale');
    emitArtifacts({ outputs: declareOutputs({ a }), files: { a: 'new a' } });
    expect(existsSync(a + STAGING_SUFFIX)).toBe(false);
  });

  it('refuses an undeclared file and a declared one left out, before writing', () => {
    const stray = join(dir, 'stray.txt');
    const chunks = declareOutputs({ a }, [{ dir, member: /^chunk-\d+$/ }]);
    expect(() => emitArtifacts({ outputs: chunks, files: { a: 'x' }, members: new Map([[stray, 'x']]) }))
      .toThrow(/undeclared: .*stray\.txt/);
    // @ts-expect-error the compiler refuses a declared key left out
    expect(() => emitArtifacts({ outputs: both(), files: { a: 'x' } }))
      .toThrow(/declared, not emitted: b/);
    expect(readFileSync(a, 'utf8')).toBe('old a');
    expect(existsSync(stray)).toBe(false);
  });

  it('a narrowed run emits exactly its subset and sweeps leftovers across the whole declaration', () => {
    mkdirSync(join(dir, 'out'));
    writeFileSync(b, 'old b');
    writeFileSync(b + STAGING_SUFFIX, 'stale');
    emitArtifacts({ outputs: both(), only: ['a'], files: { a: 'new a' } });
    expect(readFileSync(a, 'utf8')).toBe('new a');
    expect(readFileSync(b, 'utf8')).toBe('old b');
    expect(existsSync(b + STAGING_SUFFIX)).toBe(false);
    expect(() => emitArtifacts({ outputs: both(), only: ['a'], files: { a: 'x', b: 'y' } as { a: string } }))
      .toThrow(/undeclared: b/);
    // @ts-expect-error a subset must sit inside the declaration
    expect(() => emitArtifacts({ outputs: both(), only: ['z'], files: { z: 'x' } }))
      .toThrow(/undeclared: z/);
  });

  it('replaces a family wholesale: members not emitted go, non-members stay', () => {
    const chunks = join(dir, 'chunks');
    mkdirSync(chunks);
    for (const n of ['chunk-0', 'chunk-1', 'chunk-2', 'README']) writeFileSync(join(chunks, n), 'old');
    emitArtifacts({
      outputs: declareOutputs({}, [{ dir: chunks, member: /^chunk-\d+$/ }]),
      files: {},
      members: new Map([[join(chunks, 'chunk-0'), 'fresh 0'], [join(chunks, 'chunk-1'), 'fresh 1']]),
    });
    expect(readdirSync(chunks).sort()).toEqual(['README', 'chunk-0', 'chunk-1']);
    expect(readFileSync(join(chunks, 'chunk-1'), 'utf8')).toBe('fresh 1');
  });

  it('lands a refreshed baseline with the outputs, and the stamp records only the outputs', () => {
    const snapshot = join(dir, 'expected.json');
    const stampFile = join(dir, 'stamps', 'step.json');
    emitArtifacts({
      outputs: both(),
      files: files(),
      checks: [{ kind: 'refresh', path: snapshot, text: '{"n":2}\n' }],
      stamp: { path: stampFile, inputs: { 'in.txt': 'abc' } },
    });
    expect(readFileSync(snapshot, 'utf8')).toBe('{"n":2}\n');
    const stamp = readStamp(stampFile);
    expect(stamp?.inputs).toEqual({ 'in.txt': 'abc' });
    const recorded = Object.keys(stamp?.outputs ?? {}).sort();
    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toMatch(/a\.txt$/);
    expect(recorded[1]).toMatch(/out\/b\.txt$/);
  });

  it('records a refreshed snapshot the step reads at its new hash, so the stamp stays current', () => {
    const snapshot = join(dir, 'expected.json');
    const stampFile = join(dir, 'stamps', 'step.json');
    writeFileSync(snapshot, '{"n":1}\n');
    emitArtifacts({
      outputs: both(),
      files: files(),
      checks: [{ kind: 'refresh', path: snapshot, text: '{"n":2}\n' }],
      stamp: { path: stampFile, inputs: fileHashes([snapshot]) },
    });
    expect(stampIsCurrent(stampFile, fileHashes([snapshot]))).toBe(true);
  });

  it('emitEach lands every target that verifies and refuses the rest, after trying all', async () => {
    mkdirSync(join(dir, 'out'));
    writeFileSync(b, 'old b');
    const produce = async (key: 'a' | 'b') => (key === 'a'
      ? { contents: 'new a' }
      : { contents: 'new b', checks: [{ kind: 'fail', message: 'b over budget' } as const] });
    await expect(emitEach(both(), ['b', 'a'], produce)).rejects.toThrow(/refused b/);
    expect(readFileSync(a, 'utf8')).toBe('new a');
    expect(readFileSync(b, 'utf8')).toBe('old b');
  });
});
