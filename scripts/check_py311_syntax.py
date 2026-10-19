"""Fail on syntax Python 3.12 accepts and 3.11 rejects: PEP 701 f-strings and PEP 695 generics.

WHY. The ♻️ Lifecycle Engineer's container runs Python 3.11; CI runs 3.13. On 2026-10-02 a test
file with a backslash inside an f-string replacement field could not even be imported there, so the
engineer never ran it (docs/ops/LIFECYCLE_ENGINEER.md, «Your container runs Python 3.11»).

HOW. On 3.12+ the `tokenize` module emits FSTRING_START / FSTRING_MIDDLE / FSTRING_END, so a
replacement field is a stack of frames: an f-string frame, then an expression frame per `{`. Inside
an expression frame 3.11 forbids a backslash anywhere (even inside a nested string), a comment, the
enclosing quote character (the single quote of `f"…"`; for a triple-quoted f-string only the triple
itself — one `'` inside `f'''…'''` IS legal on 3.11), and a newline when the enclosing f-string
is single-quoted.
PEP 695 (`type X = …`, `def f[T]`, `class C[T]`) is read from the AST.
On 3.11 itself `compile()` is the oracle, so the engineer's own run names the file too.

    python3 scripts/check_py311_syntax.py              # every .py under scrapers/ and scripts/
    python3 scripts/check_py311_syntax.py a.py b.py    # the given files
"""
from __future__ import annotations

import ast
import io
import sys
import tokenize
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCAN_DIRS = ("scrapers", "scripts")
SKIP_DIRS = {"node_modules", "__pycache__"}


def offenders(src: str, name: str = "<src>") -> list[str]:
    """Each entry is 'name:line: reason'. An empty list means the source parses on 3.11."""
    if sys.version_info < (3, 12):
        try:
            compile(src, name, "exec")
        except SyntaxError as e:
            return [f"{name}:{e.lineno}: {e.msg}"]
        return []

    out: list[str] = []
    for node in ast.walk(ast.parse(src, name)):
        if isinstance(node, ast.TypeAlias):
            out.append(f"{name}:{node.lineno}: `type` statement (PEP 695, 3.12+)")
        elif getattr(node, "type_params", None):
            out.append(f"{name}:{node.lineno}: generic [T] syntax (PEP 695, 3.12+)")

    # Frames: ["f", quote, is_triple] for an f-string, ["e", bracket_depth, in_format_spec] for a
    # replacement field. Escaped `{{` never reaches us as an OP token (tokenize folds it).
    stack: list[list] = []
    seen: set[tuple[int, str]] = set()

    def flag(tok: tokenize.TokenInfo, reason: str) -> None:
        if (tok.start[0], reason) not in seen:
            seen.add((tok.start[0], reason))
            out.append(f"{name}:{tok.start[0]}: {reason}")

    for tok in tokenize.generate_tokens(io.StringIO(src).readline):
        # Which frames the token is inside of: the f-strings below the innermost open field are the
        # ones 3.11's tokenizer would have cut short; the fields themselves say whether we are in an
        # expression (restrictions apply) or a format spec (plain text on both versions).
        last_e = max((i for i, fr in enumerate(stack) if fr[0] == "e"), default=-1)
        if last_e >= 0:
            enclosing = [fr for fr in stack[:last_e] if fr[0] == "f"]
            in_expr = any(fr[0] == "e" and not fr[2] for fr in stack[: last_e + 1])
            if in_expr and "\\" in tok.string:
                flag(tok, "backslash inside an f-string replacement field (3.12+)")
            if in_expr and tok.type == tokenize.COMMENT:
                flag(tok, "comment inside an f-string replacement field (3.12+)")
            for _, quote, triple in enclosing:
                if (quote * 3 if triple else quote) in tok.string:
                    flag(tok, f"enclosing quote {quote} reused inside an f-string field (3.12+)")
                if not triple and (tok.type == tokenize.NL or tok.start[0] != tok.end[0]):
                    flag(tok, "newline inside a single-quoted f-string field (3.12+)")

        if tok.type == tokenize.FSTRING_START:
            quote = tok.string[-1]
            stack.append(["f", quote, tok.string.endswith(quote * 3)])
        elif tok.type == tokenize.FSTRING_END:
            stack.pop()
        elif stack and tok.type == tokenize.OP:
            top = stack[-1]
            if top[0] == "f":
                if tok.string == "{":
                    stack.append(["e", 0, False])
            elif top[2]:  # inside a format spec: only a nested field or the closing brace are OPs
                if tok.string == "{":
                    stack.append(["e", 0, False])
                elif tok.string == "}":
                    stack.pop()
            elif tok.string in ("(", "[", "{"):
                top[1] += 1
            elif tok.string in (")", "]"):
                top[1] -= 1
            elif tok.string == "}":
                if top[1] == 0:
                    stack.pop()
                else:
                    top[1] -= 1
            elif tok.string == ":" and top[1] == 0:
                top[2] = True
    return out


def repo_files(root: Path = ROOT) -> list[Path]:
    return sorted(
        p for d in SCAN_DIRS for p in (root / d).rglob("*.py")
        if not (SKIP_DIRS & set(p.relative_to(root).parts)) and not any(
            part.startswith(".") for part in p.relative_to(root).parts)
    )


def scan(paths: list[Path], root: Path = ROOT) -> list[str]:
    out: list[str] = []
    for p in paths:
        rel = str(p.relative_to(root)) if p.is_relative_to(root) else str(p)
        try:
            out += offenders(p.read_text(encoding="utf-8"), rel)
        except SyntaxError as e:  # does not parse even here — CI's own interpreter will say why
            out.append(f"{rel}:{e.lineno}: {e.msg}")
    return out


if __name__ == "__main__":
    files = [Path(a).resolve() for a in sys.argv[1:]] or repo_files()
    bad = scan(files)
    for line in bad:
        print(line)
    print(f"check_py311_syntax: {len(files)} files, {len(bad)} offender(s) (python {sys.version.split()[0]})")
    sys.exit(1 if bad else 0)
