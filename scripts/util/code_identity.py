"""A Python source file's identity: the sha1 of its token stream, comments
and docstrings dropped. Paths on stdin, one per line; prints {path: hash}.
See scripts/util/README.md."""

from __future__ import annotations

import hashlib
import io
import json
import sys
import tokenize

_STRUCTURE = frozenset({tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT, tokenize.ENDMARKER})
_TRIVIA = frozenset({tokenize.COMMENT, tokenize.NL, tokenize.ENCODING})


def _is_bare_string(line: list[tokenize.TokenInfo]) -> bool:
    return bool(line) and all(t.type == tokenize.STRING for t in line)


def identity(source: bytes) -> str:
    try:
        return _token_identity(source)
    except (tokenize.TokenError, SyntaxError):
        return "raw:" + hashlib.sha1(source).hexdigest()


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
    return hashlib.sha1(json.dumps(kept).encode()).hexdigest()


if __name__ == "__main__":
    paths = [p for p in sys.stdin.read().split("\n") if p]
    print(json.dumps({p: identity(open(p, "rb").read()) for p in paths}))
