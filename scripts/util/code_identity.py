"""A Python source file's identity: the sha1 of its token stream, comments
and docstrings dropped. Paths on stdin, one per line; prints {path: hash}.
See scripts/util/README.md."""

from __future__ import annotations

import io
import json
import sys
import tokenize
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from scripts.util.stamp_hash import hash_bytes  # noqa: E402

_STRUCTURE = frozenset({tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT, tokenize.ENDMARKER})
_TRIVIA = frozenset({tokenize.COMMENT, tokenize.NL, tokenize.ENCODING})


def _is_bare_string(line: list[tokenize.TokenInfo]) -> bool:
    return bool(line) and all(t.type == tokenize.STRING for t in line)


def identity(source: bytes) -> str:
    try:
        return _token_identity(source)
    except (tokenize.TokenError, SyntaxError):
        return "raw:" + hash_bytes(source)


def _token_identity(source: bytes) -> str:
    kept: list[str] = []
    line: list[tokenize.TokenInfo] = []
    for tok in tokenize.tokenize(io.BytesIO(source).readline):
        if tok.type in _TRIVIA:
            continue
        if tok.type not in _STRUCTURE:
            line.append(tok)
            continue
        if tok.type == tokenize.NEWLINE and _is_bare_string(line):
            line = []
            continue
        kept.extend(t.string for t in line)
        kept.append(tokenize.tok_name[tok.type])
        line = []
    return hash_bytes(json.dumps(kept).encode())


def _pinned_version() -> tuple[int, ...]:
    pin = Path(__file__).resolve().parents[2] / ".python-version"
    return tuple(int(n) for n in pin.read_text().strip().split(".")[:2])


if __name__ == "__main__":
    if sys.version_info[:2] != _pinned_version():
        sys.exit(
            f"code_identity.py: python3 is {sys.version_info[0]}.{sys.version_info[1]}, "
            f".python-version pins {'.'.join(map(str, _pinned_version()))}; "
            "tokenize differs across versions, so identities would not match CI's"
        )
    paths = [p for p in sys.stdin.read().split("\n") if p]
    print(json.dumps({p: identity(open(p, "rb").read()) for p in paths}))
