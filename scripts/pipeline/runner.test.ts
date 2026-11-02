import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { fileHashes } from '../util/build-stamp';
import { REPO_ROOT } from '../util/paths';
import { pullQueryHash, requestHash } from './freshness';
import { loadTable, type Loaded } from './load-table';
import { pipelineTree } from './pipeline-tree';
import { runSteps, type Verdict } from './runner';
import type { StepEntry, StepTable } from './step-table-pure';

let root: string;
let logDir: string;
let reads: Map<string, string[]>;
const EMIT_ARTIFACTS = join(REPO_ROOT, 'scripts/util/emit-artifacts');

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'runner-')));
  mkdirSync(join(root, 'steps'));
  logDir = mkdtempSync(join(tmpdir(), 'runner-log-'));
  reads = new Map();
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(logDir, { recursive: true, force: true });
});

const at = (name: string): string => join(root, name);
const write = (name: string, text: string): void => {
  mkdirSync(join(at(name), '..'), { recursive: true });
  writeFileSync(at(name), text);
};
const read = (name: string): string => readFileSync(at(name), 'utf8');
const log = (): string => join(logDir, 'log');
const builds = (): string[] => (existsSync(log()) ? readFileSync(log(), 'utf8').trim().split('\n') : []);

/** A TypeScript step that concatenates its inputs into its one output. */
function tsStep(name: string, out: string, inputs: string[] = [], sleepMs = 0): StepEntry {
  const entry = `steps/${name}.ts`;
  write(entry, `
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
if (existsSync(${JSON.stringify(at(`fail-${name}`))})) process.exit(3);
const body = ${JSON.stringify(inputs.map(at))}.map((p) => readFileSync(p, 'utf8')).join('+');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${sleepMs});
writeFileSync(${JSON.stringify(at(out))}, ${JSON.stringify(name)} + '(' + body + ')' + (process.env.UPDATE_SNAPSHOTS ?? ''));
appendFileSync(${JSON.stringify(log())}, ${JSON.stringify(name)} + '\\n');
`);
  write(`steps/${name}-outputs.ts`, `
import { declareOutputs } from ${JSON.stringify(EMIT_ARTIFACTS)};
export const OUT = declareOutputs({ out: ${JSON.stringify(at(out))} });
`);
  reads.set(at(entry), inputs.map(at));
  return { name, kind: 'build', language: 'ts', entry: at(entry), outputs: { module: at(`steps/${name}-outputs.ts`), name: 'OUT' } };
}

/** A Python pull whose query is the text of query-<name>.txt. */
function pullStep(name: string, out: string, request: string, queryText = 'SELECT *'): StepEntry {
  write(`query-${name}.txt`, queryText);
  write(`steps/${name}.py`, `
import json, sys
from pathlib import Path
if sys.argv[1:] == ["--describe"]:
    print(json.dumps({"query": Path(${JSON.stringify(at(`query-${name}.txt`))}).read_text(), "services": ["esa", "ari"]}))
`);
  write(out, 'pulled');
  writeManualStamp(name, out, request, queryText);
  return { name, kind: 'pull', language: 'python', entry: at(`steps/${name}.py`), outputs: [at(out)], command: `refresh:${name}` };
}

function writeManualStamp(name: string, out: string, request: string, queryText: string): void {
  write(relative(root, pipelineTree(root).manualStamp(name)), JSON.stringify({
    inputs: fileHashes([at(request)], root),
    outputs: fileHashes([at(out)], root),
    query: pullQueryHash({ query: queryText, services: ['esa', 'ari'] }),
  }));
}

/** A Python pull that reads `manifest` only to derive its request: its distinct lines. */
function derivedPullStep(name: string, out: string, manifest: string): StepEntry {
  write(`steps/${name}.py`, `
import json, sys
from pathlib import Path
if sys.argv[1:] == ["--describe"]:
    lines = sorted({l for l in Path(${JSON.stringify(at(manifest))}).read_text().splitlines() if l})
    print(json.dumps({"query": "SELECT *", "services": ["esa"], "request": lines}))
`);
  write(out, 'pulled');
  return { name, kind: 'pull', language: 'python', entry: at(`steps/${name}.py`), outputs: [at(out)], command: `refresh:${name}` };
}

function writeDerivedStamp(name: string, out: string, manifest: string, request: string[]): void {
  write(relative(root, pipelineTree(root).manualStamp(name)), JSON.stringify({
    inputs: {},
    outputs: fileHashes([at(out)], root),
    query: pullQueryHash({ query: 'SELECT *', services: ['esa'] }),
    request: requestHash(request),
    requestFrom: [manifest],
  }));
}

function pyStep(name: string, out: string, body: string, extra: Partial<StepEntry> = {}): StepEntry {
  write(`steps/${name}.py`, `
from pathlib import Path
import os
${body}
with open(${JSON.stringify(log())}, "a") as f:
    f.write(${JSON.stringify(name)} + "\\n")
`);
  return { name, kind: 'build', language: 'python', entry: at(`steps/${name}.py`), outputs: [at(out)], after: [], snapshots: [], ...extra } as StepEntry;
}

async function load(steps: StepEntry[], registryFiles: string[] = []): Promise<Loaded> {
  const table: StepTable = { steps, registryFiles };
  return loadTable(table, { root, deriveInputs: async (entry) => reads.get(entry) ?? [] });
}

async function run(steps: StepEntry[], targets: string[], flags: { force?: boolean; updateSnapshots?: boolean } = {}) {
  const loaded = await load(steps);
  if (loaded.kind !== 'loaded') throw new Error(loaded.problems.join('; '));
  const lines: string[] = [];
  const result = await runSteps(loaded, {
    root, targets, force: flags.force ?? false, updateSnapshots: flags.updateSnapshots ?? false, log: (l) => lines.push(l),
  });
  return { ...result, lines, kinds: Object.fromEntries([...result.verdicts].map(([n, v]) => [n, v.kind])) };
}

describe('runSteps — build steps', () => {
  it('builds in derived order, then finds every step fresh', async () => {
    write('a.in', 'x');
    const steps = [tsStep('b', 'b.out', ['a.out']), tsStep('a', 'a.out', ['a.in'])];
    const first = await run(steps, ['b']);
    expect(first.kinds).toEqual({ a: 'built', b: 'built' });
    expect(builds()).toEqual(['a', 'b']);
    expect(read('b.out')).toBe('b(a(x))');
    const second = await run(steps, ['b']);
    expect(second.kinds).toEqual({ a: 'fresh', b: 'fresh' });
    expect(second.status).toBe(0);
  });

  it('rebuilds a step whose input changed, and its reader once the output moved', async () => {
    write('a.in', 'x');
    const steps = [tsStep('a', 'a.out', ['a.in']), tsStep('b', 'b.out', ['a.out'])];
    await run(steps, ['b']);
    write('a.in', 'y');
    expect((await run(steps, ['b'])).kinds).toEqual({ a: 'built', b: 'built' });
    expect(read('b.out')).toBe('b(a(y))');
  });

  it('rebuilds a step whose output was rewritten by something else', async () => {
    write('a.in', 'x');
    const steps = [tsStep('a', 'a.out', ['a.in'])];
    await run(steps, ['a']);
    write('a.out', 'clobbered');
    expect((await run(steps, ['a'])).kinds).toEqual({ a: 'built' });
  });

  it('stamps a stamped family\'s members and leaves an unstamped family\'s out', async () => {
    write('steps/f.ts', `
import { mkdirSync, writeFileSync } from 'node:fs';
for (const d of ['pub', 'base']) mkdirSync(${JSON.stringify(root)} + '/' + d, { recursive: true });
writeFileSync(${JSON.stringify(at('f.out'))}, 'f');
writeFileSync(${JSON.stringify(at('pub/chunk-0'))}, 'c');
writeFileSync(${JSON.stringify(at('base/prev'))}, 'p');
`);
    write('steps/f-outputs.ts', `
import { declareOutputs } from ${JSON.stringify(EMIT_ARTIFACTS)};
export const OUT = declareOutputs({ out: ${JSON.stringify(at('f.out'))} }, [
  { dir: ${JSON.stringify(at('pub'))}, member: /^chunk-\\d+$/, stamped: true },
  { dir: ${JSON.stringify(at('base'))}, member: /^prev$/, stamped: false },
]);
`);
    const steps: StepEntry[] = [{ name: 'f', kind: 'build', language: 'ts', entry: at('steps/f.ts'), outputs: { module: at('steps/f-outputs.ts'), name: 'OUT' } }];
    await run(steps, ['f']);
    rmSync(at('base/prev'));
    expect((await run(steps, ['f'])).kinds).toEqual({ f: 'fresh' });
    rmSync(at('pub/chunk-0'));
    expect((await run(steps, ['f'])).kinds).toEqual({ f: 'built' });
  });

  it('--force reaches every selected build step', async () => {
    write('a.in', 'x');
    const steps = [tsStep('a', 'a.out', ['a.in']), tsStep('b', 'b.out', ['a.out'])];
    await run(steps, ['b']);
    expect((await run(steps, ['b'], { force: true })).kinds).toEqual({ a: 'built', b: 'built' });
    expect(builds()).toEqual(['a', 'b', 'a', 'b']);
  });

  it('--update-snapshots sets UPDATE_SNAPSHOTS for each step it runs', async () => {
    write('a.in', 'x');
    await run([tsStep('a', 'a.out', ['a.in'])], ['a'], { force: true, updateSnapshots: true });
    expect(read('a.out')).toBe('a(x)1');
  });

  it('skips the readers of a failed step and still builds unrelated steps', async () => {
    write('a.in', 'x');
    write('fail-a', '');
    const steps = [tsStep('a', 'a.out', ['a.in']), tsStep('b', 'b.out', ['a.out']), tsStep('c', 'c.out')];
    const result = await run(steps, ['b', 'c']);
    expect(result.kinds).toEqual({ a: 'failed', b: 'skipped', c: 'built' });
    expect(result.verdicts.get('b')).toEqual({ kind: 'skipped', behind: 'a' } satisfies Verdict);
    expect(result.status).toBe(1);
  });

  it('serialises two concurrent runs of one step, and the second finds it fresh', async () => {
    write('a.in', 'x');
    const steps = [tsStep('a', 'a.out', ['a.in'], 800)];
    const [one, two] = await Promise.all([run(steps, ['a']), run(steps, ['a'])]);
    expect([one.kinds.a, two.kinds.a].sort()).toEqual(['built', 'fresh']);
    expect(builds()).toEqual(['a']);
  });
});

describe('runSteps — manual steps', () => {
  it('stops a pull\'s reader when its request changed, names the refresh, and builds an unrelated step', async () => {
    write('req.tsv', 'r1');
    const steps = [pullStep('astro', 'astro.tsv', 'req.tsv'), tsStep('reader', 'reader.out', ['astro.tsv']), tsStep('other', 'other.out')];
    expect((await run(steps, ['reader', 'other'])).kinds).toEqual({ astro: 'fresh', reader: 'built', other: 'built' });
    write('req.tsv', 'r2');
    const result = await run(steps, ['reader', 'other']);
    expect(result.kinds).toEqual({ astro: 'stale', reader: 'skipped', other: 'fresh' });
    expect(result.lines).toContain('✗ astro stale (req.tsv): run pnpm run refresh:astro');
    expect(result.status).toBe(1);
  });

  it('judges a pull against the request this run rebuilt', async () => {
    write('ids.tsv', 'i1');
    write('req.tsv', 'request(i1)');
    const steps = [tsStep('request', 'req.tsv', ['ids.tsv']), pullStep('astro', 'astro.tsv', 'req.tsv'), tsStep('reader', 'reader.out', ['astro.tsv'])];
    await run(steps, ['reader']);
    writeManualStamp('astro', 'astro.tsv', 'req.tsv', 'SELECT *');
    expect((await run(steps, ['reader'])).kinds).toEqual({ request: 'fresh', astro: 'fresh', reader: 'fresh' });
    write('ids.tsv', 'i2');
    expect((await run(steps, ['reader'])).kinds).toEqual({ request: 'built', astro: 'stale', reader: 'skipped' });
  });

  it('stales a pull whose query changed, though no input did', async () => {
    write('req.tsv', 'r1');
    const steps = [pullStep('astro', 'astro.tsv', 'req.tsv')];
    write('query-astro.txt', 'SELECT ra, dec');
    expect((await run(steps, ['astro'])).verdicts.get('astro')).toMatchObject({ kind: 'stale', changed: ['(query)'] });
  });

  it('counts a file read only to derive the request through the request, and orders the pull after its writer', async () => {
    write('ids.in', 'b\na');
    const steps = [
      derivedPullStep('sptype', 'sptype.tsv', 'manifest.txt'),
      tsStep('membership', 'manifest.txt', ['ids.in']),
    ];
    writeDerivedStamp('sptype', 'sptype.tsv', 'manifest.txt', ['a', 'b', 'membership(b']);
    const first = await run(steps, ['sptype']);
    expect([...first.verdicts.keys()]).toEqual(['membership', 'sptype']);
    expect(first.kinds).toEqual({ membership: 'built', sptype: 'stale' });
    writeDerivedStamp('sptype', 'sptype.tsv', 'manifest.txt', ['a)', 'membership(b']);
    expect((await run(steps, ['sptype'])).kinds).toEqual({ membership: 'fresh', sptype: 'fresh' });
    write('ids.in', 'b\na)\na');
    expect((await run(steps, ['sptype'])).kinds).toEqual({ membership: 'built', sptype: 'fresh' });
    write('ids.in', 'b\nc');
    expect((await run(steps, ['sptype'])).verdicts.get('sptype')).toMatchObject({ kind: 'stale', changed: ['(request)'] });
  });

  it('records the answering service without comparing it', async () => {
    write('req.tsv', 'r1');
    const steps = [pullStep('astro', 'astro.tsv', 'req.tsv')];
    const stampFile = pipelineTree(root).manualStamp('astro');
    writeFileSync(stampFile, JSON.stringify({ ...JSON.parse(readFileSync(stampFile, 'utf8')), answeredBy: 'ari', release: 'DR3' }));
    expect((await run(steps, ['astro'])).kinds).toEqual({ astro: 'fresh' });
  });

  it('never runs a manual step under --force', async () => {
    write('req.tsv', 'r1');
    const steps = [pullStep('astro', 'astro.tsv', 'req.tsv')];
    expect((await run(steps, ['astro'], { force: true })).kinds).toEqual({ astro: 'fresh' });
    expect(read('astro.tsv')).toBe('pulled');
  });
});

describe('runSteps — Python build steps', () => {
  const rename = (out: string): string => `
tmp = Path(${JSON.stringify(at(`${out}.tmp`))})
tmp.write_text(Path(${JSON.stringify(at('p.in'))}).read_text() + "!")
os.replace(tmp, ${JSON.stringify(at(out))})
`;

  it('stamps what the run read and finds it fresh until an input moves', async () => {
    write('p.in', 'x');
    const steps = [pyStep('p', 'p.out', rename('p.out'))];
    expect((await run(steps, ['p'])).kinds).toEqual({ p: 'built' });
    expect(read('p.out')).toBe('x!');
    expect((await run(steps, ['p'])).kinds).toEqual({ p: 'fresh' });
    write('p.in', 'y');
    expect((await run(steps, ['p'])).kinds).toEqual({ p: 'built' });
  });

  it('stales a step when a folder it listed gains a file', async () => {
    write('folder/one', '');
    const listing = `${rename('p.out')}\nos.listdir(${JSON.stringify(at('folder'))})`;
    write('p.in', 'x');
    const steps = [pyStep('p', 'p.out', listing)];
    await run(steps, ['p']);
    expect((await run(steps, ['p'])).kinds).toEqual({ p: 'fresh' });
    write('folder/two', '');
    expect((await run(steps, ['p'])).kinds).toEqual({ p: 'built' });
  });

  it('stales a step when a path it probed appears', async () => {
    write('p.in', 'x');
    const body = `${rename('p.out')}\nfrom scripts.util.build_stamp import probe\nprobe(Path(${JSON.stringify(at('maybe.txt'))}))`;
    const steps = [pyStep('p', 'p.out', body)];
    await run(steps, ['p']);
    expect((await run(steps, ['p'])).kinds).toEqual({ p: 'fresh' });
    write('maybe.txt', '');
    expect((await run(steps, ['p'])).verdicts.get('p')).toEqual({ kind: 'built' });
  });

  it('fails a run that writes its own stamp, which only the runner writes', async () => {
    write('p.in', 'x');
    const stamp = pipelineTree(root).buildStamp('p');
    const body = `${rename('p.out')}\nPath(${JSON.stringify(stamp)}).parent.mkdir(parents=True, exist_ok=True)\nPath(${JSON.stringify(stamp)}).write_text("{}")`;
    const result = await run([pyStep('p', 'p.out', body)], ['p']);
    expect(result.verdicts.get('p')).toEqual({ kind: 'failed', reason: `p wrote ${stamp}, which it does not declare` });
  });

  it('fails a run that writes a file it does not declare', async () => {
    write('p.in', 'x');
    const body = `${rename('p.out')}\nPath(${JSON.stringify(at('stray.txt'))}).write_text("s")`;
    const result = await run([pyStep('p', 'p.out', body)], ['p']);
    expect(result.verdicts.get('p')).toEqual({ kind: 'failed', reason: `p wrote ${at('stray.txt')}, which it does not declare` });
  });

  it('fails a run that reads another step\'s output without running after it', async () => {
    write('a.in', 'x');
    write('a.out', 'stale copy');
    const body = `Path(${JSON.stringify(at('a.out'))}).read_text()\nPath(${JSON.stringify(at('p.out'))}).write_text("p")`;
    const result = await run([tsStep('a', 'a.out', ['a.in']), pyStep('p', 'p.out', body)], ['p', 'a']);
    expect(result.verdicts.get('p')).toMatchObject({ kind: 'failed' });
    const covered = await run([tsStep('a', 'a.out', ['a.in']), pyStep('p', 'p.out', body, { after: ['a'] } as Partial<StepEntry>)], ['p']);
    expect(covered.kinds).toEqual({ a: 'fresh', p: 'built' });
  });

  it.each([
    ['lists', `os.listdir(${JSON.stringify('OUTDIR')})`],
    ['probes', `from scripts.util.build_stamp import probe\nprobe(Path(${JSON.stringify('OUTFILE')}))`],
  ])('fails a run that %s another step\'s output without running after it', async (how, probeLine) => {
    write('a.in', 'x');
    write('made/a.out', 'stale copy');
    const line = probeLine.replace('"OUTDIR"', JSON.stringify(at('made'))).replace('"OUTFILE"', JSON.stringify(at('made/a.out')));
    const body = `${line}\nPath(${JSON.stringify(at('p.out'))}).write_text("p")`;
    const result = await run([tsStep('a', 'made/a.out', ['a.in']), pyStep('p', 'p.out', body)], ['p', 'a']);
    expect(result.verdicts.get('p')).toEqual({
      kind: 'failed',
      reason: `p read ${at(how === 'lists' ? 'made' : 'made/a.out')}, an output of a, without running after it`,
    });
  });
});

describe('loadTable', () => {
  it('rejects an outputs module that imports beyond emit-artifacts, paths and pure modules, before importing it', async () => {
    const step = tsStep('a', 'a.out');
    write('steps/a-outputs.ts', `
import { declareOutputs } from ${JSON.stringify(EMIT_ARTIFACTS)};
import { STAMP_DIR } from ${JSON.stringify(join(REPO_ROOT, 'scripts/util/build-stamp'))};
writeSideEffect();
export const OUT = declareOutputs({ out: STAMP_DIR });
`);
    const loaded = await load([step]);
    expect(loaded).toEqual({
      kind: 'rejected',
      problems: [`outputs module ${relative(REPO_ROOT, at('steps/a-outputs.ts'))} reaches scripts/util/build-stamp.ts, beyond util/emit-artifacts, util/paths and *-pure modules`],
    });
  });

  it('rejects an outputs module that reaches an impure module through a pure one', async () => {
    const step = tsStep('a', 'a.out');
    write('steps/paths-pure.ts', `export { STAMP_DIR } from ${JSON.stringify(join(REPO_ROOT, 'scripts/util/build-stamp'))};\n`);
    write('steps/a-outputs.ts', `
import { declareOutputs } from ${JSON.stringify(EMIT_ARTIFACTS)};
import { STAMP_DIR } from './paths-pure';
export const OUT = declareOutputs({ out: STAMP_DIR });
`);
    expect(await load([step])).toEqual({
      kind: 'rejected',
      problems: [`outputs module ${relative(REPO_ROOT, at('steps/a-outputs.ts'))} reaches scripts/util/build-stamp.ts, beyond util/emit-artifacts, util/paths and *-pure modules`],
    });
  });

  it('rejects a build step whose declared output lies through a symlink', async () => {
    mkdirSync(at('elsewhere'));
    symlinkSync(at('elsewhere'), at('public'));
    const loaded = await load([tsStep('a', 'public/a.out')]);
    expect(loaded).toEqual({ kind: 'rejected', problems: [`a declares an output through a symlink: ${at('public')}`] });
  });

  it('rejects a table whose build steps form a cycle', async () => {
    const loaded = await load([tsStep('a', 'a.out', ['b.out']), tsStep('b', 'b.out', ['a.out'])]);
    expect(loaded).toMatchObject({ kind: 'rejected', problems: ['the build steps form a cycle: a → b → a'] });
  });
});
