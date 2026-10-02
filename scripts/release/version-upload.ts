/** `deploy.yml`: `version-upload.ts <wrangler output file>` sets the step outputs `version_id` and `preview_url`. */

import { appendFileSync, readFileSync } from 'node:fs';

import { uploadedVersionOf } from './version-upload-pure.ts';

const outputFile = process.argv[2];
if (outputFile === undefined) throw new Error('usage: version-upload.ts <wrangler output file>');
const outputs = process.env.GITHUB_OUTPUT;
if (outputs === undefined) throw new Error('GITHUB_OUTPUT is not set; this runs as a deploy.yml step');

const { versionId, previewUrl } = uploadedVersionOf(readFileSync(outputFile, 'utf8'));
appendFileSync(outputs, `version_id=${versionId}\npreview_url=${previewUrl}\n`);
console.log(`uploaded version ${versionId}, preview at ${previewUrl}`);
