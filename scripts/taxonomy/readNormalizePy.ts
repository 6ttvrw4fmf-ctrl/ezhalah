// ─────────────────────────────────────────────────────────────────────────────────────────
// HERMETIC reader for the three hardcoded property-type maps in scrapers/common/normalize.py.
//
// Reads the file as TEXT and parses the Python literals in PURE TypeScript. It NEVER executes
// normalize.py and spawns NO external interpreter (no python3, no node:child_process). This is
// what lets the taxonomy gate fail CLOSED with zero runtime coupling: on any parse error / count
// mismatch / value drift the caller fails the build — nothing can be skipped because python3 is
// absent (there is no python3 dependency at all anymore).
//
// Extracts, exactly as normalize.py declares them today:
//   • TYPE_MAP_AR   — module-level dict, Arabic type word -> canonical English type   (expect 27)
//   • SLUG_TO_TYPE  — module-level dict, Aqar URL slug   -> canonical English type    (expect 26)
//   • residential_set + category_default — the set + else-branch inside category_for_type (expect 10)
//
// The parser is deliberately strict: alignment whitespace, trailing commas, `#` comments, single-
// AND double-quoted strings, Python escapes, and Arabic (non-ASCII) content are all handled, but
// any token it does not understand throws — a silent partial parse is impossible.
// ─────────────────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const NORMALIZE_PY_PATH = resolve(HERE, '../../scrapers/common/normalize.py');

export interface NormalizePyMaps {
  TYPE_MAP_AR: Record<string, string>;
  SLUG_TO_TYPE: Record<string, string>;
  residential_set: string[];
  category_default: string;
}

// ── Python string-literal reader ──────────────────────────────────────────────────────────────
// src[i] is a quote char. Handles ''' / """ triple quotes and single/double quotes, decoding the
// common Python escapes. Returns the decoded value and the index one past the closing quote.
function readPyString(src: string, i: number): { value: string; next: number } {
  const q = src[i];
  const triple = src.slice(i, i + 3) === q + q + q;
  const quote = triple ? q + q + q : q;
  let j = i + quote.length;
  let out = '';
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') {
      const e = src[j + 1];
      switch (e) {
        case 'n': out += '\n'; j += 2; break;
        case 't': out += '\t'; j += 2; break;
        case 'r': out += '\r'; j += 2; break;
        case '\\': out += '\\'; j += 2; break;
        case "'": out += "'"; j += 2; break;
        case '"': out += '"'; j += 2; break;
        case '0': out += '\0'; j += 2; break;
        case 'x': out += String.fromCharCode(parseInt(src.slice(j + 2, j + 4), 16)); j += 4; break;
        case 'u': out += String.fromCharCode(parseInt(src.slice(j + 2, j + 6), 16)); j += 6; break;
        case 'U': out += String.fromCodePoint(parseInt(src.slice(j + 2, j + 10), 16)); j += 10; break;
        default: out += '\\' + (e ?? ''); j += 2; break; // unknown escape: keep verbatim
      }
      continue;
    }
    if (src.startsWith(quote, j)) return { value: out, next: j + quote.length };
    out += c;
    j++;
  }
  throw new Error(`normalize.py: unterminated ${triple ? 'triple-' : ''}string literal at index ${i}`);
}

// ── Balanced-brace slicer that honors string + comment state ───────────────────────────────────
// Finds the declaration `declRe`, then returns the text BETWEEN its outermost `{ ... }`. Braces
// inside strings or `#` comments are never miscounted.
function sliceBraceBody(src: string, declRe: RegExp, what: string): string {
  const m = declRe.exec(src);
  if (!m) throw new Error(`normalize.py: could not locate declaration for ${what}`);
  const open = src.indexOf('{', m.index);
  if (open < 0) throw new Error(`normalize.py: no '{' found after ${what}`);
  let depth = 0;
  let i = open;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"') { i = readPyString(src, i).next; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '{') { depth++; i++; continue; }
    if (c === '}') { depth--; i++; if (depth === 0) return src.slice(open + 1, i - 1); continue; }
    i++;
  }
  throw new Error(`normalize.py: unbalanced braces for ${what}`);
}

// ── Tokenizer over a literal body (strings + structural punctuation; whitespace/comments dropped) ─
type Tok = { t: 'str'; v: string } | { t: 'punct'; v: string } | { t: 'name'; v: string };
function tokenize(body: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue; }
    if (c === '#') { while (i < body.length && body[i] !== '\n') i++; continue; }
    if (c === "'" || c === '"') { const r = readPyString(body, i); toks.push({ t: 'str', v: r.value }); i = r.next; continue; }
    if (':,{}()[]'.includes(c)) { toks.push({ t: 'punct', v: c }); i++; continue; }
    let j = i;
    while (j < body.length && /[A-Za-z0-9_.]/.test(body[j])) j++;
    if (j > i) { toks.push({ t: 'name', v: body.slice(i, j) }); i = j; continue; }
    throw new Error(`normalize.py: unexpected character «${c}» while tokenizing`);
  }
  return toks;
}

// dict body -> Record<string,string>. Every key AND value must be a string literal; anything else
// (including a duplicate key or a missing separator) throws.
function parseDictBody(body: string, what: string): Record<string, string> {
  const toks = tokenize(body);
  const out: Record<string, string> = {};
  let i = 0;
  while (i < toks.length) {
    const k = toks[i];
    if (k.t !== 'str') throw new Error(`normalize.py ${what}: expected string key, got ${k.t} «${k.v}»`);
    const colon = toks[i + 1];
    if (!colon || colon.t !== 'punct' || colon.v !== ':') throw new Error(`normalize.py ${what}: expected ':' after key «${k.v}»`);
    const val = toks[i + 2];
    if (!val || val.t !== 'str') throw new Error(`normalize.py ${what}: expected string value for key «${k.v}»`);
    if (Object.prototype.hasOwnProperty.call(out, k.v)) throw new Error(`normalize.py ${what}: duplicate key «${k.v}»`);
    out[k.v] = val.v;
    i += 3;
    if (i < toks.length) {
      const sep = toks[i];
      if (sep.t === 'punct' && sep.v === ',') i++;
      else throw new Error(`normalize.py ${what}: expected ',' between entries near «${k.v}»`);
    }
  }
  return out;
}

// set body -> string[] (declaration order). Every element must be a string literal.
function parseSetBody(body: string, what: string): string[] {
  const toks = tokenize(body);
  const out: string[] = [];
  let i = 0;
  while (i < toks.length) {
    const el = toks[i];
    if (el.t !== 'str') throw new Error(`normalize.py ${what}: expected string element, got ${el.t} «${el.v}»`);
    out.push(el.v);
    i++;
    if (i < toks.length) {
      const sep = toks[i];
      if (sep.t === 'punct' && sep.v === ',') i++;
      else throw new Error(`normalize.py ${what}: expected ',' between elements near «${el.v}»`);
    }
  }
  return out;
}

/**
 * Statically parse the three property-type maps out of scrapers/common/normalize.py.
 * Throws on any structural problem (locate failure, unterminated string, unexpected token) so the
 * caller fails CLOSED. Does NOT execute the file and uses no external interpreter.
 */
export function readNormalizePyMaps(): NormalizePyMaps {
  const src = readFileSync(NORMALIZE_PY_PATH, 'utf8');

  // Module-level dicts (anchored at column 0 so an indented reference like `if raw in TYPE_MAP_AR:`
  // is never mistaken for the assignment).
  const TYPE_MAP_AR = parseDictBody(sliceBraceBody(src, /^TYPE_MAP_AR\s*=\s*\{/m, 'TYPE_MAP_AR'), 'TYPE_MAP_AR');
  const SLUG_TO_TYPE = parseDictBody(sliceBraceBody(src, /^SLUG_TO_TYPE\s*=\s*\{/m, 'SLUG_TO_TYPE'), 'SLUG_TO_TYPE');

  // residential_set + category_default live INSIDE category_for_type — slice that function first so
  // we read the intended `residential = { … }` and the intended else-branch, nothing else.
  const fnStart = src.indexOf('def category_for_type');
  if (fnStart < 0) throw new Error('normalize.py: could not find def category_for_type');
  const nextDef = src.indexOf('\ndef ', fnStart + 1);
  const fnSrc = src.slice(fnStart, nextDef < 0 ? src.length : nextDef);

  const residential_set = parseSetBody(sliceBraceBody(fnSrc, /residential\s*=\s*\{/, 'category_for_type residential set'), 'residential_set');

  // return "Residential" if t in residential else "Commercial"  →  default is the else string.
  const defM = /return\s+(['"])(?:\\.|(?!\1).)*\1\s+if\s+t\s+in\s+residential\s+else\s+(['"])((?:\\.|(?!\2).)*)\2/.exec(fnSrc);
  if (!defM) throw new Error('normalize.py: could not parse category_for_type default (else) branch');
  const category_default = defM[3];

  return { TYPE_MAP_AR, SLUG_TO_TYPE, residential_set, category_default };
}
