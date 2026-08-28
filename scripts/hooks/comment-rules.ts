// Typed reader for comment-rules.json, the forbidden-comment pattern set that
// the vitest suite, commit-sweep-guard.sh and the generated TTSR rule share.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CommentRule {
  name: string;
  /** Regex source in the JavaScript / Perl common dialect. */
  pattern: string;
  /** Regex flags; only `i` is used. */
  flags: string;
}

function field(entry: object, key: 'name' | 'pattern' | 'flags'): string {
  if (!(key in entry)) throw new Error(`comment-rules.json: entry lacks "${key}"`);
  const value: unknown = Reflect.get(entry, key);
  if (typeof value !== 'string') {
    throw new Error(`comment-rules.json: "${key}" must be a string`);
  }
  return value;
}

export function loadCommentRules(root: string): CommentRule[] {
  const parsed: unknown = JSON.parse(
    readFileSync(join(root, 'scripts/hooks/comment-rules.json'), 'utf8'),
  );
  if (parsed === null || typeof parsed !== 'object' || !('patterns' in parsed)) {
    throw new Error('comment-rules.json: expected an object with "patterns"');
  }
  const patterns: unknown = parsed.patterns;
  if (!Array.isArray(patterns) || patterns.length === 0) {
    throw new Error('comment-rules.json: "patterns" must be a non-empty array');
  }
  return patterns.map((entry: unknown) => {
    if (entry === null || typeof entry !== 'object') {
      throw new Error('comment-rules.json: every pattern must be an object');
    }
    return {
      name: field(entry, 'name'),
      pattern: field(entry, 'pattern'),
      flags: field(entry, 'flags'),
    };
  });
}
