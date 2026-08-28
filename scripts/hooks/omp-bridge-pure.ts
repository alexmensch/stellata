// Pure classification for omp-bridge.ts: which repo paths an omp tool call
// touches, which git commands move history, and how a guard's stdout reads.

/** Internal omp URL schemes and sentinels that never name a repo file. */
const NON_FILE_PREFIXES = [
  'xd://', 'omp://', 'skill://', 'rule://', 'agent://', 'history://',
  'artifact://', 'local://', 'mcp://', 'issue://', 'pr://', 'memory://',
  'conflict://', 'ssh://', 'http://', 'https://',
];

/**
 * Every omp tool this bridge classifies, including the `xd://` write devices
 * that arrive as a `write` rather than a tool call of their own. An id absent
 * from here blocks rather than passing ungated, so a tool omp adds must be
 * triaged into one of the tables below before sessions can call it.
 */
export const KNOWN_TOOLS: Record<string, true> = {
  read: true, grep: true, glob: true, bash: true, edit: true,
  apply_patch: true, write: true, ast_grep: true, ast_edit: true, lsp: true,
  debug: true, eval: true, github: true, ask: true, inspect_image: true,
  browser: true, computer: true, checkpoint: true, rewind: true,
  security_scan: true, task: true, hub: true, todo: true, web_search: true,
  memory_edit: true, retain: true, recall: true, reflect: true, learn: true,
  manage_skill: true, python: true, notebook: true, generate_image: true,
  tts: true, vibe_spawn: true, yield: true, skill: true,
  resolve: true, reject: true, propose: true, report_issue: true, goal: true,
};

/** Effective omp tool name -> the Claude tool name the .sh guards branch on. */
export const CLAUDE_TOOL_NAME: Record<string, string> = {
  read: 'Read',
  grep: 'Grep',
  ast_grep: 'Grep',
  debug: 'Read',
  inspect_image: 'Read',
  notebook: 'NotebookEdit',
  edit: 'Edit',
  apply_patch: 'Edit',
  ast_edit: 'Edit',
  lsp: 'Edit',
  write: 'Write',
  bash: 'Bash',
};

/**
 * omp's own write-approval set for `lsp`. `request` is included because a raw
 * LSP method can come back as a `workspace/applyEdit` the client applies.
 */
const LSP_MUTATING_ACTIONS: Record<string, true> = {
  rename: true, rename_file: true, code_actions: true, request: true,
};

const WILDCARD = /[*?[\]{}]/;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Strip an omp read/write selector: `foo.ts:50-200`, `foo.ts:raw`,
 * `db.sqlite:users:42`, `archive.zip:path/inside`. Gating keys on the
 * container file, so the first unqualified colon ends the path.
 */
export function stripSelector(raw: string): string {
  const schemeEnd = raw.indexOf('://');
  const from = schemeEnd === -1 ? 0 : schemeEnd + 3;
  const colon = raw.indexOf(':', from);
  return colon === -1 ? raw : raw.slice(0, colon);
}

/** `write` accepts a copied `[path#TAG]` header in place of a bare path. */
export function stripHashlineWrapper(raw: string): string {
  const wrapped = /^\[(.+?)(?:#[0-9A-Fa-f]{4})?\]$/.exec(raw.trim());
  return wrapped ? wrapped[1] : raw;
}

/**
 * The deepest directory prefix of a wildcard path that contains no wildcard.
 * A rewrite aimed at `src/client/**\/*.ts` is charged to `src/client`; a
 * pattern whose very first segment is a wildcard names no folder at all.
 */
export function literalPrefixDir(raw: string): string {
  if (!WILDCARD.test(raw)) return raw;
  const kept: string[] = [];
  for (const segment of raw.split('/')) {
    if (WILDCARD.test(segment)) break;
    kept.push(segment);
  }
  return kept.join('/');
}

/**
 * Undo the spellings omp accepts for an ordinary path before anything tries to
 * resolve one. A `~` left unexpanded looks relative, so it resolves against the
 * session cwd and lands in the wrong repository — silently ungating the file it
 * actually names.
 */
export function normalizeToolPath(raw: string, home: string): string {
  let path = raw.trim();
  if (path.startsWith('file://')) path = path.slice('file://'.length);
  if (path.startsWith('@/')) path = path.slice(1);
  if (path === '~') return home;
  if (path.startsWith('~/')) return `${home}/${path.slice(2)}`;
  return path;
}

export function isGateablePath(raw: string): boolean {
  if (raw === '' || raw === '.') return false;
  return !NON_FILE_PREFIXES.some((p) => raw.startsWith(p));
}

/** Section headers in an omp hashline patch: `[path/to/file.ts#1A2B]`. */
export function hashlinePaths(input: string): string[] {
  const found: string[] = [];
  for (const line of input.split('\n')) {
    const header = /^\[(.+?)#[0-9A-Fa-f]{4}\]\s*$/.exec(line);
    if (header) found.push(header[1]);
    const move = /^MV\s+(?:"([^"]+)"|(\S+))\s*$/.exec(line);
    if (move) found.push(move[1] ?? move[2]);
  }
  return found;
}

/**
 * Every document a raw `lsp` `request` payload names. LSP puts the file under
 * a `uri` key at every nesting level it uses — `textDocument.uri`, an
 * `applyEdit`'s `changes` map, `documentChanges[].textDocument.uri` — so the
 * payload is walked for `uri`-shaped keys rather than one fixed shape.
 */
export function requestDocuments(payload: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return [];
  }

  const found: string[] = [];
  const walk = (node: unknown, key: string): void => {
    if (typeof node === 'string') {
      if (/^uri$|Uri$/.test(key) || node.startsWith('file://')) found.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const entry of node) walk(entry, key);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [childKey, value] of Object.entries(node)) {
      // An `applyEdit` keys its `changes` map by document URI.
      if (key === 'changes' && childKey.startsWith('file://')) found.push(childKey);
      walk(value, childKey);
    }
  };
  walk(parsed, '');
  return found;
}

export interface ToolTarget {
  /** The effective tool: the `xd://` device when the call is a device write. */
  tool: string;
  /** Every repo path the call would read or touch. */
  paths: string[];
  /** Whether the call writes to those paths. */
  mutates: boolean;
  /** The tool is absent from `KNOWN_TOOLS`, or names no path it must name. */
  unclassified: boolean;
}

function gather(
  raw: string[],
  mutates: boolean,
  tool: string,
  home: string,
): ToolTarget {
  const seen = new Set<string>();
  for (const entry of raw) {
    if (entry === '') continue;
    const path = normalizeToolPath(stripSelector(stripHashlineWrapper(entry)), home);
    if (!isGateablePath(path)) continue;
    if (!WILDCARD.test(path)) {
      seen.add(path);
      continue;
    }
    // A wildcard read is a listing and gates nothing; a wildcard rewrite still
    // edits files, so it is charged to the folder it descends into.
    if (!mutates) continue;
    const prefix = literalPrefixDir(path);
    if (prefix !== '') seen.add(prefix);
  }
  return { tool, paths: [...seen], mutates, unclassified: false };
}

/**
 * Resolve an omp tool call to the paths a guard must see. A `write` to an
 * `xd://<tool>` device carries that tool's own JSON args, so it recurses and
 * reports the device — not `write` — as the effective tool.
 */
export function toolTargets(
  ompTool: string,
  input: Record<string, unknown>,
  home: string,
): ToolTarget {
  if (KNOWN_TOOLS[ompTool] !== true) {
    return { tool: ompTool, paths: [], mutates: false, unclassified: true };
  }

  switch (ompTool) {
    case 'read':
    case 'inspect_image':
      return gather([str(input.path)], false, ompTool, home);

    case 'grep':
    case 'ast_grep':
      // Only `grep` splits several roots out of one semicolon-delimited string;
      // a `read` path containing a semicolon stays literal.
      return gather(str(input.path).split(';').map((r) => r.trim()), false, ompTool, home);

    case 'debug':
      return gather([str(input.file), str(input.program)], false, ompTool, home);

    case 'notebook':
      return gather([str(input.path), str(input.notebook_path)], true, ompTool, home);

    case 'write': {
      const path = stripHashlineWrapper(str(input.path));
      if (path.startsWith('xd://')) {
        const device = path.slice('xd://'.length);
        // The device is the effective tool, so it faces the same roster gate a
        // top-level call does. Checking it only after a successful JSON parse
        // let an unrecognised device through on any prose body.
        if (KNOWN_TOOLS[device] !== true) {
          return { tool: device, paths: [], mutates: false, unclassified: true };
        }
        let args: Record<string, unknown>;
        try {
          args = asRecord(JSON.parse(str(input.content)));
        } catch {
          // `resolve` / `reject` / `propose` / `report_issue` take prose, and a
          // payload the device cannot parse names no path either way.
          return { tool: device, paths: [], mutates: false, unclassified: false };
        }
        return toolTargets(device, args, home);
      }
      return gather([path], true, ompTool, home);
    }

    case 'edit':
    case 'apply_patch': {
      const hashline = hashlinePaths(str(input.input));
      if (hashline.length > 0) return gather(hashline, true, ompTool, home);
      // `edit.mode` can be `replace`/`patch`, whose payload names its file
      // directly. An edit naming no file at all is unclassified, not harmless.
      const direct = [str(input.path), str(input.file)].filter((p) => p !== '');
      if (direct.length === 0) {
        return { tool: ompTool, paths: [], mutates: true, unclassified: true };
      }
      return gather(direct, true, ompTool, home);
    }

    case 'ast_edit': {
      const paths = Array.isArray(input.paths)
        ? input.paths.map((entry) => str(entry))
        : [];
      if (paths.every((p) => p === '')) {
        return { tool: ompTool, paths: [], mutates: true, unclassified: true };
      }
      return gather(paths, true, ompTool, home);
    }

    case 'lsp': {
      const action = str(input.action);
      const mutates = LSP_MUTATING_ACTIONS[action] === true;
      // `rename_file` moves the source to `new_name`, which may land in a
      // folder no other argument names. A raw `request` names its document in
      // the LSP params instead, where every method that can edit one puts it.
      const raw = [
        str(input.file),
        mutates ? str(input.new_name) : '',
        ...(action === 'request' ? requestDocuments(str(input.payload)) : []),
      ];
      const target = gather(raw, mutates, ompTool, home);
      if (mutates && target.paths.length === 0 && action !== 'reload') {
        return { ...target, unclassified: true };
      }
      return target;
    }

    default:
      // bash routes through the command, not a path. The rest — todo, hub,
      // web_search, memory tools, task, browser, computer — name no repo file.
      return { tool: ompTool, paths: [], mutates: false, unclassified: false };
  }
}

export interface GuardPayload {
  hook_event_name: string;
  session_id: string;
  cwd: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

/**
 * The Claude tool name a guard branches on, or undefined when this omp tool
 * maps onto none of them.
 */
export function claudeToolName(ompTool: string): string | undefined {
  return CLAUDE_TOOL_NAME[ompTool];
}

export function buildPayload(args: {
  toolName: string;
  sessionId: string;
  cwd: string;
  event?: string;
  filePath?: string;
  command?: string;
}): GuardPayload {
  const toolInput: Record<string, unknown> = {};
  if (args.filePath !== undefined) toolInput.file_path = args.filePath;
  if (args.command !== undefined) toolInput.command = args.command;

  return {
    hook_event_name: args.event ?? 'PreToolUse',
    session_id: args.sessionId,
    cwd: args.cwd,
    tool_name: args.toolName,
    tool_input: toolInput,
  };
}

export interface GitHistoryOp {
  op: 'commit' | 'push';
  /** Directory the invocation runs in: `-C`, an enclosing `cd`, or undefined. */
  dir?: string;
  /** Destination side of every refspec a push writes, `refs/heads/` stripped. */
  destinations: string[];
}

/** Shell operators that end a simple command; `(` and `)` also scope `cd`. */
const OPERATORS: Record<string, true> = {
  ';': true, '&&': true, '||': true, '|': true, '&': true,
  '(': true, ')': true, '{': true, '}': true, '\n': true,
};

/**
 * Split a command into shell words and operators, honouring quotes. Quotes are
 * stripped from the word they wrap, so a `cd "/two words"` target survives as
 * one token instead of truncating the scan the way `\S+` did.
 */
export function shellTokens(command: string): string[] {
  const tokens: string[] = [];
  let word = '';
  let quote: '"' | "'" | undefined;
  let started = false;

  const flush = (): void => {
    if (started) tokens.push(word);
    word = '';
    started = false;
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
      else {
        word += ch;
        started = true;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      word += command[i + 1];
      started = true;
      i += 1;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      flush();
      continue;
    }
    const pair = command.slice(i, i + 2);
    if (pair === '&&' || pair === '||') {
      flush();
      tokens.push(pair);
      i += 1;
      continue;
    }
    if (OPERATORS[ch] === true) {
      flush();
      tokens.push(ch);
      continue;
    }
    word += ch;
    started = true;
  }
  flush();
  return tokens;
}

/** Compose a `cd` target onto the directory already in effect. */
function chdir(current: string | undefined, target: string): string {
  if (target.startsWith('/') || target.startsWith('~') || current === undefined) {
    return target;
  }
  return `${current.replace(/\/+$/, '')}/${target}`;
}

/** git's own flags that swallow the token after them. */
const GIT_GLOBAL_VALUE_FLAGS: Record<string, true> = {
  '-c': true, '-C': true, '--namespace': true, '--exec-path': true,
};

/** `git push` flags that swallow the token after them. */
const PUSH_VALUE_FLAGS: Record<string, true> = {
  '-o': true, '--push-option': true, '--repo': true,
  '--receive-pack': true, '--exec': true,
};

/**
 * Every ref a `git push` word list would write. `main`, `HEAD:main`,
 * `+feature:refs/heads/main` and `--delete main` all name `main`; the local
 * branch alone never reveals them, so a refspec push to trunk needs this.
 */
function pushDestinations(words: string[]): string[] {
  const found: string[] = [];
  let sawRemote = false;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word.startsWith('-')) {
      if (PUSH_VALUE_FLAGS[word] === true) i += 1;
      continue;
    }
    if (!sawRemote) {
      sawRemote = true;
      continue;
    }
    const spec = word.replace(/^\+/, '');
    const colon = spec.indexOf(':');
    const dst = colon === -1 ? spec : spec.slice(colon + 1);
    const ref = dst.replace(/^refs\/heads\//, '');
    if (ref !== '') found.push(ref);
  }
  return found;
}

/** Keywords and wrappers that sit in front of the real command word. */
const SEGMENT_PREFIXES: Record<string, true> = {
  do: true, then: true, else: true, elif: true, '!': true,
  time: true, exec: true, sudo: true, nohup: true, command: true, eval: true,
};

/**
 * Every git invocation in a Bash command that moves history, with the
 * directory it runs in. Walks shell segments rather than matching one regex:
 * a `cd` anywhere in the chain decides the repository, `(` scopes it, and a
 * `git push` ending a segment is still a push.
 */
export function gitHistoryOps(command: string): GitHistoryOp[] {
  const ops: GitHistoryOp[] = [];
  const scopes: (string | undefined)[] = [];
  let dir: string | undefined;
  let words: string[] = [];

  const endSegment = (): void => {
    if (words.length === 0) return;
    let start = 0;
    // Skip `FOO=bar` environment prefixes and the keywords a compound
    // statement puts in front of the command word — `do git push` in a loop
    // body is still a push.
    while (
      start < words.length &&
      (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[start]) ||
        SEGMENT_PREFIXES[words[start]] === true)
    ) {
      start += 1;
    }
    const argv = words.slice(start);
    words = [];
    if (argv.length === 0) return;

    if (argv[0] === 'cd') {
      const target = argv.find((word, index) => index > 0 && !word.startsWith('-'));
      if (target !== undefined) dir = chdir(dir, target);
      return;
    }
    if (argv[0] !== 'git') return;

    let here = dir;
    let i = 1;
    for (; i < argv.length; i += 1) {
      const word = argv[i];
      if (!word.startsWith('-')) break;
      if (GIT_GLOBAL_VALUE_FLAGS[word] === true) {
        if (word === '-C') here = chdir(here, argv[i + 1] ?? '');
        i += 1;
      }
    }
    const sub = argv[i];
    if (sub !== 'commit' && sub !== 'push') return;
    ops.push({
      op: sub,
      ...(here === undefined ? {} : { dir: here }),
      destinations: sub === 'push' ? pushDestinations(argv.slice(i + 1)) : [],
    });
  };

  for (const token of shellTokens(command)) {
    if (OPERATORS[token] !== true) {
      words.push(token);
      continue;
    }
    endSegment();
    if (token === '(') scopes.push(dir);
    else if (token === ')') dir = scopes.length > 0 ? scopes.pop() : dir;
  }
  endSegment();
  return ops;
}

function unquote(raw: string): string {
  const quoted = /^(?:"([^"]*)"|'([^']*)')$/.exec(raw);
  return quoted ? (quoted[1] ?? quoted[2]) : raw;
}

/** `git commit` is the only Bash shape commit-sweep-guard inspects. */
export function needsCommitSweep(command: string): boolean {
  return gitHistoryOps(command).some((entry) => entry.op === 'commit');
}

/** Branches a session must never commit to or push, whatever the remote ref. */
export function isProtectedBranch(branch: string): boolean {
  return branch === 'main' || branch === 'master';
}

/** `sed` / `perl` flags that consume the next token as their value. */
const SCRIPT_VALUE_FLAGS: Record<string, true> = {
  '-e': true, '-f': true, '--expression': true, '--file': true,
};

/** An in-place flag on `sed` / `perl`, wherever it sits in the flag cluster. */
const IN_PLACE_FLAG = /^(?:--in-place(?:=\S*)?|-[A-Za-z]*i(?:\.\S+)?)$/;

/**
 * Paths a shell command rewrites in place. Narrow by design: every form here
 * writes a file named as a literal argument, so a hit is a real write rather
 * than a guess. Bash can still reach a file this misses — see the README.
 */
export function bashWriteTargets(command: string): string[] {
  const found: string[] = [];

  const stream = /\b(?:sed|perl)\b([^|;&<>]*)/g;
  for (const match of command.matchAll(stream)) {
    found.push(...scriptOperands(match[1]));
  }

  const awkInPlace = /\bawk\s+-i\s+inplace\b([^|;&<>]*)/g;
  for (const match of command.matchAll(awkInPlace)) {
    found.push(...operands(match[1], true));
  }

  const tee = /\btee\s+([^|;&<>]*)/g;
  for (const match of command.matchAll(tee)) {
    found.push(...operands(match[1], false));
  }

  // A digit before `>` is a file descriptor, not part of the target, and `2>
  // log` is still a write; only `>&` names a descriptor rather than a file.
  const redirect = /(?:^|[^<>&])>{1,2}\s*(?!&)(?:"([^"]+)"|'([^']+)'|([^\s|;&<>]+))/g;
  for (const match of command.matchAll(redirect)) {
    const target = match[1] ?? match[2] ?? match[3];
    if (target !== undefined && target !== '') found.push(target);
  }

  return [...new Set(found.filter((p) => isGateablePath(p)))];
}

/**
 * File operands of a `sed` / `perl` invocation, empty unless it rewrites in
 * place. The in-place flag can sit anywhere in the cluster — `sed -e … -i f`
 * edits `f` exactly as `sed -i … f` does — so the whole cluster is scanned.
 */
function scriptOperands(fragment: string): string[] {
  const tokens = fragment.trim().split(/\s+/).filter((token) => token !== '');
  if (!tokens.some((token) => IN_PLACE_FLAG.test(token))) return [];

  const out: string[] = [];
  let program = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token.startsWith('-')) {
      // `-e <script>` supplies the program, so the next bare word is a file.
      if (SCRIPT_VALUE_FLAGS[token] === true) {
        program = true;
        i += 1;
      }
      continue;
    }
    const value = unquote(token);
    // BSD `sed -i ''` carries its backup suffix as a separate empty argument.
    if (value === '') continue;
    if (!program) {
      program = true;
      continue;
    }
    out.push(value);
  }
  return out;
}

/**
 * Literal file operands in a command fragment. `awk` takes its program as the
 * first non-flag token; everything after it is a file.
 */
function operands(fragment: string, skipProgram: boolean): string[] {
  const out: string[] = [];
  let pending = skipProgram;
  for (const token of fragment.trim().split(/\s+/)) {
    if (token === '' || token.startsWith('-')) continue;
    const value = unquote(token);
    if (value === '') continue;
    if (pending) {
      pending = false;
      continue;
    }
    out.push(value);
  }
  return out;
}

/**
 * Local branch names a `github` call would push. `pr_push` writes the remote
 * ref recorded in branch config, so the caller resolves that too; this returns
 * what the arguments alone name.
 */
export function githubPushBranches(
  input: Record<string, unknown>,
): string[] | undefined {
  if (str(input.op) !== 'pr_push') return undefined;
  const branch = str(input.branch);
  return branch === '' ? [] : [branch];
}

export interface GuardRun {
  stdout: string;
  status: number | null;
}

/**
 * A guard's deny verdict, or undefined when it stayed silent. Anything that is
 * not a clean allow — non-zero exit, unparseable output — blocks: a guard that
 * died partway has not approved the call.
 */
export function parseVerdict(run: GuardRun): string | undefined {
  const trimmed = run.stdout.trim();
  if (run.status !== 0) {
    return `Guard exited ${run.status ?? 'on a signal'} without a verdict; blocking. Output: ${
      trimmed === '' ? '(none)' : trimmed.slice(0, 400)
    }`;
  }
  if (trimmed === '') return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return `Guard emitted unparseable output; blocking. Output: ${trimmed.slice(0, 400)}`;
  }
  const output = asRecord(asRecord(parsed).hookSpecificOutput);
  const decision = str(output.permissionDecision);
  if (decision === '') {
    return `Guard emitted no permissionDecision; blocking. Output: ${trimmed.slice(0, 400)}`;
  }
  if (decision !== 'deny') return undefined;
  return str(output.permissionDecisionReason) || 'blocked by guard';
}
