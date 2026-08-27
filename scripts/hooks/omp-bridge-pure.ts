// Pure path/name extraction for omp-bridge.ts: maps an omp tool call onto the
// Claude-shaped payload the .sh guards read on stdin, and classifies the git
// commands the branch guard inspects.

/** Internal omp URL schemes and sentinels that never name a repo file. */
const NON_FILE_PREFIXES = [
  'xd://', 'omp://', 'skill://', 'rule://', 'agent://', 'history://',
  'artifact://', 'local://', 'mcp://', 'issue://', 'pr://', 'memory://',
  'ssh://', 'http://', 'https://',
];

/** Effective omp tool name -> the Claude tool name the guards branch on. */
export const CLAUDE_TOOL_NAME: Record<string, string> = {
  read: 'Read',
  grep: 'Grep',
  debug: 'Read',
  edit: 'Edit',
  ast_edit: 'Edit',
  lsp: 'Edit',
  write: 'Write',
  bash: 'Bash',
};

const WILDCARD = /[*?[]/;

/**
 * Strip an omp `read` selector: `foo.ts:50-200`, `foo.ts:raw`,
 * `db.sqlite:users:42`, `archive.zip:path/inside`. Gating keys on the
 * container file, so the first unqualified colon ends the path.
 */
export function stripSelector(raw: string): string {
  const schemeEnd = raw.indexOf('://');
  const from = schemeEnd === -1 ? 0 : schemeEnd + 3;
  const colon = raw.indexOf(':', from);
  return colon === -1 ? raw : raw.slice(0, colon);
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
    // `MV DEST` renames into a folder no section header names.
    const move = /^MV\s+(?:"([^"]+)"|(\S+))\s*$/.exec(line);
    if (move) found.push(move[1] ?? move[2]);
  }
  return found;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** An `lsp` call writes only for the actions that apply an edit. */
function lspMutates(input: Record<string, unknown>): boolean {
  const action = str(input.action);
  if (action === 'rename' || action === 'rename_file') {
    return input.apply !== false;
  }
  return action === 'code_actions' && input.apply === true;
}

export interface ToolTarget {
  /** The effective tool: the `xd://` device when the call is a device write. */
  tool: string;
  /** Every repo path the call would read or touch. */
  paths: string[];
  /** Whether the call writes to those paths. */
  mutates: boolean;
}

/**
 * Resolve an omp tool call to the paths a guard must see. A `write` to an
 * `xd://<tool>` device carries that tool's own JSON args, so it recurses and
 * reports the device — not `write` — as the effective tool.
 */
export function toolTargets(
  ompTool: string,
  input: Record<string, unknown>,
): ToolTarget {
  const raw: string[] = [];
  let mutates = false;

  switch (ompTool) {
    case 'read':
    case 'grep':
      // `read` and `grep` take several roots as one semicolon-delimited string.
      for (const root of str(input.path).split(';')) {
        raw.push(root.trim());
      }
      break;

    case 'debug':
      raw.push(str(input.file), str(input.program));
      break;

    case 'write': {
      const path = str(input.path);
      if (path.startsWith('xd://')) {
        const device = path.slice('xd://'.length);
        let args: Record<string, unknown>;
        try {
          args = asRecord(JSON.parse(str(input.content)));
        } catch {
          // A malformed device payload names no path; the tool rejects it.
          return { tool: device, paths: [], mutates: false };
        }
        return toolTargets(device, args);
      }
      raw.push(path);
      mutates = true;
      break;
    }

    case 'edit':
      raw.push(...hashlinePaths(str(input.input)));
      mutates = true;
      break;

    case 'ast_edit':
      if (Array.isArray(input.paths)) {
        for (const entry of input.paths) raw.push(str(entry));
      }
      mutates = true;
      break;

    case 'lsp':
      raw.push(str(input.file));
      mutates = lspMutates(input);
      break;

    default:
      // bash routes through the command, not a path. eval, task, browser,
      // glob, hub, todo and web_search name no gateable file.
      return { tool: ompTool, paths: [], mutates: false };
  }

  const seen = new Set<string>();
  for (const entry of raw) {
    if (entry === '') continue;
    const path = stripSelector(entry);
    if (!isGateablePath(path)) continue;
    // A wildcard read is a listing and gates nothing; a wildcard rewrite
    // still edits files, so it is charged to the folder it descends into.
    if (!WILDCARD.test(path)) {
      seen.add(path);
      continue;
    }
    if (!mutates) continue;
    const prefix = literalPrefixDir(path);
    if (prefix !== '') seen.add(prefix);
  }
  return { tool: ompTool, paths: [...seen], mutates };
}

export interface GuardPayload {
  hook_event_name: string;
  session_id: string;
  cwd: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export function buildPayload(args: {
  tool: string;
  sessionId: string;
  cwd: string;
  filePath?: string;
  command?: string;
}): GuardPayload | undefined {
  const toolName = CLAUDE_TOOL_NAME[args.tool];
  if (toolName === undefined) return undefined;

  const toolInput: Record<string, unknown> = {};
  if (args.filePath !== undefined) toolInput.file_path = args.filePath;
  if (args.command !== undefined) toolInput.command = args.command;

  return {
    hook_event_name: 'PreToolUse',
    session_id: args.sessionId,
    cwd: args.cwd,
    tool_name: toolName,
    tool_input: toolInput,
  };
}

/**
 * The git subcommand a Bash call runs, if it is one that moves history.
 * Matches inside a compound command and through `git -C <path>`, and rejects
 * longer subcommands such as `git commit-tree`.
 */
export function gitHistoryOp(command: string): 'commit' | 'push' | undefined {
  const match = /\bgit(?:\s+-C\s+\S+)*\s+(commit|push)(?:\s|$)/.exec(command);
  if (match === null) return undefined;
  return match[1] as 'commit' | 'push';
}

/** `git commit` is the only Bash shape commit-sweep-guard inspects. */
export function needsCommitSweep(command: string): boolean {
  return gitHistoryOp(command) === 'commit';
}

/** Branches a session must never commit to or push, whatever the remote ref. */
export function isProtectedBranch(branch: string): boolean {
  return branch === 'main' || branch === 'master';
}

/** A guard's deny verdict, or undefined when it stayed silent. */
export function parseVerdict(stdout: string): string | undefined {
  const trimmed = stdout.trim();
  if (trimmed === '') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  const output = asRecord(asRecord(parsed).hookSpecificOutput);
  if (str(output.permissionDecision) !== 'deny') return undefined;
  return str(output.permissionDecisionReason) || 'blocked by guard';
}
