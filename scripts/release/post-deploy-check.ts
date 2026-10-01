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
  judgeCase,
  judgeCatalogue,
  judgeEntryScript,
  judgeFooterVersion,
  untilPassing,
  type Verdict,
} from './post-deploy-pure.ts';
import { rawGet } from './raw-get.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const origin = process.argv[2] ?? SITE_ORIGIN;
const version = appVersion(ROOT);
const identifies = documentIdentifiers(ROOT);
const at = (path: string) => new URL(path, origin);

async function check(): Promise<Verdict[]> {
  const verdicts = await Promise.all(
    ROUTING_CASES.map(async (routingCase) =>
      judgeCase(routingCase, await rawGet(at(routingCase.pathname + routingCase.search)), identifies),
    ),
  );

  const app = (await rawGet(at(APP_PATH))).body.toString('utf8');
  const entry = entryScriptOf(app);
  verdicts.push(entry === null ? `${APP_PATH}: no module entry script` : judgeEntryScript(await rawGet(at(entry), {})));

  verdicts.push(judgeCatalogue(await rawGet(at(`/${catalogChunkFilename(0)}`), {})));
  verdicts.push(judgeFooterVersion((await rawGet(at('/'))).body.toString('utf8'), version));
  return verdicts;
}

const failures = await untilPassing(async () => {
  try {
    return await check();
  } catch (err) {
    return [`request failed: ${(err as Error).message}`];
  }
}, { attempts: 12, waitMs: 5_000, sleep });

if (failures.length > 0) {
  for (const failure of failures) console.error(`::error::post-deploy: ${failure}`);
  process.exit(1);
}
console.log(`post-deploy: ${origin} answers as v${version} should`);
