// Pure path/name extraction for omp-bridge.ts: maps an omp tool call onto the
// Claude-shaped payload the .sh guards read on stdin.

/** Internal omp URL schemes and sentinels that never name a repo file. */
const NON_FILE_PREFIXES = [
  'xd://', 'omp://', 'skill://', 'rule://', 'agent://', 'history://',
  'artifact://', 'local://', 'mcp://', 'issue://', 'pr://', 'memory://',
  'ssh://', 'http://', 'https://',
];

/** omp tool name -> the Claude tool name the guards branch on. */
export const CLAUDE_TOOL_NAME: Record<string, string> = {
  read: 'Read',
  grep: 'Grep',
  edit: 'Edit',
  write: 'Write',
  ast_edit: 'Edit',
  lsp: 'Edit',
  bash: 'Bash',
};

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

export function isGateablePath(raw: string): boolean {
  if (raw === '' || raw === '*') return false;
  if (NON_FILE_PREFIXES.some((p) => raw.startsWith(p))) return false;
  // A bare glob is a path listing, not a content read.
  return !raw.includes('*');
}

/** Section headers in an omp hashline patch: `[path/to/file.ts#1A2B]`. */
export function hashlinePaths(input: string): string[] {
  const found: string[] = [];
  for (const line of input.split('\n')) {
    const match = /^\[(.+?)#[0-9A-Fa-f]{4}\]\s*$/.exec(line);
    if (match) found.push(match[1]);
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

/**
 * Every repo path an omp tool call would touch or read. `write` to an
 * `xd://<tool>` device carries that tool's own JSON args, so it recurses.
 */
export function targetPaths(
  ompTool: string,
  input: Record<string, unknown>,
): string[] {
  const raw: string[] = [];

  switch (ompTool) {
    case 'read':
    case 'grep':
      raw.push(str(input.path));
      break;

    case 'write': {
      const path = str(input.path);
      if (path.startsWith('xd://')) {
        const device = path.slice('xd://'.length);
        let args: Record<string, unknown> = {};
        try {
          args = asRecord(JSON.parse(str(input.content)));
        } catch {
          // A malformed device payload names no path; the tool rejects it.
          return [];
        }
        return targetPaths(device, args);
      }
      raw.push(path);
      break;
    }

    case 'edit':
      raw.push(...hashlinePaths(str(input.input)));
      break;

    case 'ast_edit':
      if (Array.isArray(input.paths)) {
        for (const entry of input.paths) raw.push(str(entry));
      }
      break;

    case 'lsp':
      raw.push(str(input.file));
      break;

    default:
      // bash routes through the command, not a path. eval, task, browser,
      // glob, hub, todo, debug and web_search name no gateable file.
      return [];
  }

  const seen = new Set<string>();
  for (const entry of raw) {
    if (entry === '') continue;
    const path = stripSelector(entry);
    if (isGateablePath(path)) seen.add(path);
  }
  return [...seen];
}

export interface GuardPayload {
  hook_event_name: string;
  session_id: string;
  cwd: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
}

export function buildPayload(args: {
  ompTool: string;
  sessionId: string;
  cwd: string;
  filePath?: string;
  command?: string;
}): GuardPayload | undefined {
  const toolName = CLAUDE_TOOL_NAME[args.ompTool];
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

/** `git commit` is the only Bash shape commit-sweep-guard inspects. */
export function needsCommitSweep(command: string): boolean {
  return /\bgit(\s+-C\s+\S+)?\s+commit(\s|$)/.test(command);
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
