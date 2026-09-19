// Write the perf pin from saved run files — no browser, no arm. The runs
// are first-hand data already; pins/README.md § From saved runs.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ArgError, parsePinArgs, pinUsage, type PinArgs } from './args';
import {
  REPO_ROOT, packageVersion, printAgainstPin, readJsonFlag, writePinFile,
} from './checkout';
import {
  acceptedMarks, assertPinFile, citeRunPath, pinFromRuns, pinPathFor, pinWriteRefusal,
  type PinDiff, type RunSource,
} from './pin-pure';
import { assertPerfFile } from './schema';

const EXIT = { ok: 0, refused: 1, usage: 2 } as const;

function readSources(paths: readonly string[]): { sources: RunSource[]; error: string | null } {
  const sources: RunSource[] = [];
  for (const path of paths) {
    const read = readJsonFlag('run', path, assertPerfFile);
    if (read.error !== null) return { sources, error: read.error };
    sources.push({ file: read.value!, sourceRun: citeRunPath(path, REPO_ROOT) });
  }
  return { sources, error: null };
}

/** The pin at the destination, if one is there to judge marks against. An
 *  unreadable one — another schema, a foreign file — is named and passed
 *  over: it can gate nothing, and replacing it is what the writer is for. */
function existingPin(path: string): { pin: ReturnType<typeof assertPinFile> | null; note: string | null } {
  if (!existsSync(path)) return { pin: null, note: null };
  // Named for the destination rather than for `--pin`, which the default
  // path never went through.
  const read = readJsonFlag('the pin at', path, assertPinFile);
  if (read.error !== null) {
    return { pin: null, note: `${read.error}; no marks can be judged against it` };
  }
  return { pin: read.value, note: null };
}

function main(): number {
  let args: PinArgs;
  try {
    args = parsePinArgs(process.argv.slice(2));
  } catch (e) {
    if (!(e instanceof ArgError)) throw e;
    console.error(`perf pin: ${e.message}\n\n${pinUsage()}`);
    return EXIT.usage;
  }
  if (args.help) {
    console.log(pinUsage());
    return EXIT.ok;
  }

  const { sources, error } = readSources(args.runs);
  if (error !== null) {
    console.error(`perf pin: ${error}`);
    return EXIT.usage;
  }

  const summary = pinFromRuns(sources, { version: packageVersion(), accepted: acceptedMarks(args.accept) });
  for (const row of summary.provenance) {
    console.log(`  ${row.key.padEnd(13)} ${row.sourceRun === null ? 'sound in no run' : `← ${row.sourceRun}`}`);
    for (const refused of row.refusedIn) console.log(`      refused in ${refused.sourceRun}: ${refused.reason}`);
  }
  if (summary.pin === null || summary.merged === null) {
    console.error(`perf pin: no pin written —\n  ${summary.refusals.join('\n  ')}`);
    return EXIT.refused;
  }

  const pinPath = resolve(REPO_ROOT, args.pin ?? pinPathFor(summary.pin.adapterSlug));
  const existing = existingPin(pinPath);
  if (existing.note !== null) console.log(`perf pin: ${existing.note}`);
  let against: PinDiff | null = null;
  if (existing.pin !== null) {
    against = printAgainstPin(pinPath, existing.pin, summary.merged);
    if (against.refusedWholeRun !== null) {
      console.error(
        `perf pin: no pin written — the pin at ${pinPath} cannot judge these runs: ` +
        `${against.refusedWholeRun}. Pass --pin for the one they describe.`,
      );
      return EXIT.refused;
    }
  }

  const why = pinWriteRefusal(summary.pin, against);
  if (why !== null) {
    console.error(`perf pin: no pin written — ${why}`);
    return EXIT.refused;
  }
  if (args.dryRun) {
    console.log(`perf pin: dry run — would write ${pinPath} (${summary.pin.rows.length} rows from ${sources.length} run file${sources.length === 1 ? '' : 's'})`);
    return EXIT.ok;
  }
  writePinFile(pinPath, summary.pin);
  return EXIT.ok;
}

process.exitCode = main();
