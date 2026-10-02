/** `deploy.yml`'s last gate: the live site answers as this checkout says it should. README.md#the-post-deploy-check. */

import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { catalogChunkFilename } from '../catalog/record/catalog-pure.ts';
import { appVersion } from '../site/site-metrics.ts';
import { APP_PATH } from '../../src/client/util/url-state/share-path-pure.ts';
import { ROUTING_CASES, documentIdentifiers } from '../../src/routing-cases-fixture.ts';
import { SITE_ORIGIN } from '../../src/routing-pure.ts';
import {
  entryScriptOf,
  failureReport,
  judgeCase,
  judgeCatalogue,
  judgeEntryScript,
  judgeFooterVersion,
  untilPassing,
  type Judged,
  type Verdict,
} from './post-deploy-pure.ts';
import { rawGet, type RawAnswer } from './raw-get.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const origin = process.argv[2] ?? SITE_ORIGIN;
const version = appVersion(ROOT);
const identifies = documentIdentifiers(ROOT);
const at = (path: string) => new URL(path, origin);

async function judged(path: string, judge: (answer: RawAnswer) => Verdict, headers?: Record<string, string>): Promise<Judged> {
  const answer = await rawGet(at(path), headers);
  return { verdict: judge(answer), answer };
}

const text = (answer: RawAnswer) => answer.body.toString('utf8');

async function check(): Promise<Judged[]> {
  const results = await Promise.all(
    ROUTING_CASES.map((routingCase) =>
      judged(routingCase.pathname + routingCase.search, (answer) => judgeCase(routingCase, answer, identifies)),
    ),
  );

  const app = await rawGet(at(APP_PATH));
  const entry = entryScriptOf(text(app));
  results.push(
    entry === null
      ? { verdict: `${APP_PATH}: no module entry script`, answer: app }
      : await judged(entry, judgeEntryScript, {}),
  );

  results.push(await judged(`/${catalogChunkFilename(0)}`, judgeCatalogue, {}));
  results.push(await judged('/', (answer) => judgeFooterVersion(text(answer), version)));
  return results;
}

const failures = await untilPassing(async () => {
  try {
    return await check();
  } catch (err) {
    return [{ verdict: `request failed: ${(err as Error).message}`, answer: null }];
  }
}, { attempts: 12, waitMs: 5_000, sleep });

if (failures.length > 0) {
  for (const line of failureReport(failures)) console.error(`::error::post-deploy: ${line}`);
  process.exit(1);
}
console.log(`post-deploy: ${origin} answers as v${version} should`);
