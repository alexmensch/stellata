# Regex pieces for recognising a command inside a Bash tool call, sourced by
# the hooks that gate on one. Newlines must already be flattened to ';'.

CMD_START='(^|[;&|(][[:space:]]*)'
ENV_PREFIX='(env[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*'
