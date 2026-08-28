// Pure classification for omp-bridge.ts: which repo paths an omp tool call
// touches, which git commands move history, and how a guard's stdout reads.

/** Internal omp URL schemes and sentinels that never name a repo file. */
const NON_FILE_PREFIXES = [
  'xd://', 'omp://', 'skill://', 'rule://', 'agent://', 'history://',
  'artifact://', 'local://', 'mcp://', 'issue://', 'pr://', 'memory://',
  'conflict://', 'ssh://', 'http://', 'https://',
];

/**
 * Every omp tool this bridge classifies. An id absent from here blocks rather
 * than passing ungated, so a tool omp adds must be triaged into one of the
 * tables below before sessions can call it.
 */
export const KNOWN_TOOLS: ReadonlySet<string> = new Set([
  'read', 'grep', 'glob', 'bash', 'edit', 'apply_patch', 'write', 'ast_grep',
  'ast_edit', 'lsp', 'debug', 'eval', 'github', 'ask', 'inspect_image',
  'browser', 'computer', 'checkpoint', 'rewind', 'security_scan', 'task',
  'hub', 'todo', 'web_search', 'memory_edit', 'retain', 'recall', 'reflect',
  'learn', 'manage_skill', 'python', 'notebook', 'generate_image', 'tts',
  'vibe_spawn', 'yield', 'resolve', 'skill',
]);

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
const LSP_MUTATING_ACTIONS = new Set([
  'rename', 'rename_file', 'code_actions', 'request',
]);

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
  if (!KNOWN_TOOLS.has(ompTool)) {
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
        let args: Record<string, unknown>;
        try {
          args = asRecord(JSON.parse(str(input.content)));
        } catch {
          // A malformed device payload names no path; the tool rejects it.
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
      const mutates = LSP_MUTATING_ACTIONS.has(action);
      // `rename_file` moves the source to `new_name`, which may land in a
      // folder no other argument names.
      const raw = [str(input.file), mutates ? str(input.new_name) : ''];
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
  /** The `-C` argument or a leading `cd`, whichever names the repo it runs in. */
  dir?: string;
}

const GIT_GLOBAL_FLAG = String.raw`(?:\s+(?:-c\s+\S+|--git-dir=\S+|--work-tree=\S+|-C\s+\S+))*`;

/**
 * The git subcommand a Bash call runs, if it is one that moves history, plus
 * the directory it runs in. Matches inside a compound command and rejects
 * longer subcommands such as `git commit-tree`.
 */
export function gitHistoryOp(command: string): GitHistoryOp | undefined {
  const match = new RegExp(
    String.raw`\bgit${GIT_GLOBAL_FLAG}\s+(commit|push)(?:\s|$)`,
  ).exec(command);
  if (match === null) return undefined;

  const op = match[1] as 'commit' | 'push';
  const dashC = /\bgit(?:\s+(?:-c\s+\S+|--git-dir=\S+|--work-tree=\S+))*\s+-C\s+(\S+)/
    .exec(command);
  if (dashC) return { op, dir: unquote(dashC[1]) };

  const leadingCd = /^\s*cd\s+(?:"([^"]+)"|'([^']+)'|(\S+))\s*&&/.exec(command);
  if (leadingCd) {
    return { op, dir: leadingCd[1] ?? leadingCd[2] ?? leadingCd[3] };
  }
  return { op };
}

function unquote(raw: string): string {
  const quoted = /^(?:"([^"]*)"|'([^']*)')$/.exec(raw);
  return quoted ? (quoted[1] ?? quoted[2]) : raw;
}

/** `git commit` is the only Bash shape commit-sweep-guard inspects. */
export function needsCommitSweep(command: string): boolean {
  return gitHistoryOp(command)?.op === 'commit';
}

/** Branches a session must never commit to or push, whatever the remote ref. */
export function isProtectedBranch(branch: string): boolean {
  return branch === 'main' || branch === 'master';
}

/**
 * Paths a shell command rewrites in place. Narrow by design: every form here
 * writes a file named as a literal argument, so a hit is a real write rather
 * than a guess. Bash can still reach a file this misses — see the README.
 */
export function bashWriteTargets(command: string): string[] {
  const found: string[] = [];

  const inPlace =
    /\b(?:sed|perl)\s+(?:-[A-Za-z]*i[A-Za-z]*(?:\.\S+)?|--in-place\S*)\b([^|;&<>]*)/g;
  for (const match of command.matchAll(inPlace)) {
    found.push(...operands(match[1], true));
  }

  const awkInPlace = /\bawk\s+-i\s+inplace\b([^|;&<>]*)/g;
  for (const match of command.matchAll(awkInPlace)) {
    found.push(...operands(match[1], true));
  }

  const tee = /\btee\s+([^|;&<>]*)/g;
  for (const match of command.matchAll(tee)) {
    found.push(...operands(match[1], false));
  }

  const redirect = /(?:^|[^<>&\d])>{1,2}\s*(?!&)(?:"([^"]+)"|'([^']+)'|([^\s|;&<>]+))/g;
  for (const match of command.matchAll(redirect)) {
    const target = match[1] ?? match[2] ?? match[3];
    if (target !== undefined && target !== '') found.push(target);
  }

  return [...new Set(found.filter((p) => isGateablePath(p)))];
}

/**
 * Literal file operands in a command fragment. `sed`/`perl`/`awk` take their
 * program as the first non-flag token; everything after it is a file.
 */
function operands(fragment: string, skipProgram: boolean): string[] {
  const out: string[] = [];
  let pending = skipProgram;
  for (const token of fragment.trim().split(/\s+/)) {
    if (token === '' || token.startsWith('-')) continue;
    // BSD `sed -i ''` carries its backup suffix as a separate empty argument.
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
