// Compute a Postgres function's EFFECTIVE body by replaying the repo's migrations in order —
// definitions AND later patcher migrations — instead of trusting "the last CREATE OR REPLACE".
//
// WHY THIS EXISTS (owner, 2026-08-09):
//   "I do not want a future engineer to accidentally remove the RNPL protection because the
//    regression test is looking at an old function body."
//
// A migration may change a function in two ways:
//   (a) DEFINE it        — `CREATE OR REPLACE FUNCTION public.foo(...) ... $function$ ... $function$;`
//   (b) PATCH it         — a DO block that reads pg_get_functiondef() and needle-edits the live body
//                          (used by 20260809131728 to add the RNPL read-guard to three RPCs).
// A checker that only reads (a) silently validates a PRE-PATCH body. That is exactly how a guard can
// disappear while CI stays green.
//
// THE SAFETY PROPERTY THAT MATTERS: this replayer never *guesses*. If a migration touches a tracked
// function in a way it does not understand, it records an `unresolved` entry and the caller MUST
// fail. Refusing to answer is safe; answering from a stale body is not.
//
// Offline + static — reads .sql files only. No DB, no network.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type Replayed = {
  fn: string;
  /** Effective body after replaying every definition and patch, or null if never defined. */
  body: string | null;
  /** Migration files that defined or patched it, oldest → newest. */
  touchedBy: string[];
  /** Migrations that clearly touch this fn but could NOT be interpreted. Non-empty ⇒ FAIL. */
  unresolved: string[];
};

const DEF_RE = (fn: string) =>
  new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`, 'i');

/** Extract the LAST `CREATE OR REPLACE FUNCTION public.<fn>(...)` statement in a migration. */
function extractDefinition(sql: string, fn: string): string | null {
  const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${fn}\\s*\\(`, 'gi');
  let start = -1, m: RegExpExecArray | null;
  while ((m = re.exec(sql))) start = m.index;      // last one wins, same as Postgres
  if (start < 0) return null;
  // Body is dollar-quoted ($function$ … $function$ / $$ … $$). Take through the CLOSING tag.
  const tagM = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(start));
  if (!tagM) return null;
  const tag = tagM[0];
  const openAt = start + tagM.index;
  const closeAt = sql.indexOf(tag, openAt + tag.length);
  if (closeAt < 0) return null;
  return sql.slice(start, closeAt + tag.length);
}

/**
 * Collect every needle→replacement pair a migration performs with `replace(<src>, <needle>, <repl>)`.
 *
 * This repo writes needle-edits two ways and both must be understood:
 *   (a) anchor / replace_with          — `replace(src, anchor, replace_with)`     (20260809131728)
 *   (b) needle_<x> / replacement_<x>   — `replace(v_src, needle_beds, replacement_beds)` (20260803180000)
 * Rather than hard-code either naming, resolve whatever VARIABLES the call actually references back
 * to their declared text literals. New idioms keep working as long as the pair is declared literals.
 *
 * Pairs whose needle is absent from the body are simply skipped — a migration often patches several
 * functions, and each needle only matches its own target. That makes association implicit and exact:
 * a long distinctive needle cannot match the wrong function.
 */
/** Join every quoted segment of a `'a' || 'b' || 'c'` expression, unescaping `''` in each. */
function parseConcatenatedLiteral(expr: string): string {
  const segRe = /'((?:[^']|'')*)'/g;
  let out = '';
  let m: RegExpExecArray | null;
  while ((m = segRe.exec(expr))) out += m[1].replace(/''/g, "'");
  return out;
}

/** Decode the body of a Postgres E'…' literal: `''` and `\'` are a quote, `\n`/`\t`/`\r`/`\\` their characters. */
function decodeEString(body: string): string {
  return body.replace(/''/g, "'").replace(/\\(.)/g, (_m, ch: string) =>
    ch === 'n' ? '\n' : ch === 't' ? '\t' : ch === 'r' ? '\r' : ch);
}

/**
 * Evaluate a declaration expression made of `'plain'`, `E'escaped'` and EARLIER-declared variable
 * segments joined by `||` (20261102212825: `v_new constant text := v_needle || E'\n    -- …';`).
 * Returns undefined when any segment is something else (a function call, an unknown variable) — such
 * a declaration is not a literal and must stay invisible, never guessed.
 */
function evalDeclExpr(expr: string, decls: Map<string, string>): string | undefined {
  const segRe = /\s*(?:(E)'((?:[^'\\]|''|\\.)*)'|'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_]*))\s*(\|\||$)/gy;
  let out = '';
  let m: RegExpExecArray | null;
  let consumed = 0;
  while (consumed < expr.length && (m = segRe.exec(expr))) {
    if (m[1]) out += decodeEString(m[2]);
    else if (m[3] !== undefined) out += m[3].replace(/''/g, "'");
    else {
      const v = decls.get(m[4]);
      if (v === undefined) return undefined;
      out += v;
    }
    consumed = segRe.lastIndex;
    if (m[5] === '') break;
  }
  return consumed >= expr.trimEnd().length ? out : undefined;
}

function extractPatches(sql: string): { patches: { anchor: string; replacement: string }[]; unreadAssigned: number } {
  // NAME [constant] text := 'literal';   (multi-line, '' = escaped quote)
  //
  // A declaration's literal may also be split across SEVERAL `||`-concatenated segments for
  // readability (20260818221919: `replacement constant text := 'part one ' || 'part two';`).
  // The declaration regex captures the whole `'...' || '...' ...` expression as one group;
  // parseConcatenatedLiteral then pulls out and joins every quoted segment inside it. A plain
  // single-literal declaration is just the zero-`||` case of the same shape, so this is additive.
  const decls = new Map<string, string>();
  const declRe =
    /([A-Za-z_][A-Za-z0-9_]*)\s+(?:constant\s+)?text\s*:=\s*('(?:[^']|'')*'(?:\s*\|\|\s*'(?:[^']|'')*')*)\s*;/g;
  let d: RegExpExecArray | null;
  while ((d = declRe.exec(sql))) decls.set(d[1], parseConcatenatedLiteral(d[2]));

  // (e) E-STRINGS and VARIABLE CONCATENATION (20261102212825) — `v_needle constant text := E'…\n…';`
  // and `v_new constant text := v_needle || E'…';`. Evaluated in declaration order so a later
  // declaration may build on an earlier one; anything that is not literals-and-known-variables is
  // skipped (left to the unresolved path), never guessed.
  // Segments are JOINED by a required `||` — never `(seg (\|\|)?)+`. An optional separator lets one
  // identifier split into exponentially many runs, and a declaration-shaped string with no `;` (e.g.
  // `position('k constant text := ''x''' in src)` in 20261107213742) then backtracks for minutes:
  // CI killed this barrier at its 600 s cap. evalDeclExpr already required `||` between segments.
  const SEG = String.raw`(?:E'(?:[^'\\]|''|\\.)*'|'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_]*)`;
  const exprDeclRe = new RegExp(
    String.raw`([A-Za-z_][A-Za-z0-9_]*)\s+(?:constant\s+)?text\s*:=\s*(${SEG}(?:\s*\|\|\s*${SEG})*)\s*;`, 'g');
  let e: RegExpExecArray | null;
  while ((e = exprDeclRe.exec(sql))) {
    if (decls.has(e[1])) continue;                      // a plain literal already read it
    if (!/E'|\|\|/.test(e[2])) continue;                // only the two new shapes
    const v = evalDeclExpr(e[2].trim(), decls);
    if (v !== undefined) decls.set(e[1], v);
  }

  // (f) DOLLAR-QUOTED DECLARATIONS (20261104032124) — `a1 constant text := $a$needle$a$;` and
  // `b3 constant text := $a$part one$a$ || $a$part two$a$;`. A dollar-quoted literal is raw text (no
  // escapes), so a needle holding `''1 day''` reads exactly as it sits in the function body. Only
  // declarations made ENTIRELY of dollar-quoted segments are read; anything else stays invisible.
  const dollarDeclRe =
    /([A-Za-z_][A-Za-z0-9_]*)\s+(?:constant\s+)?text\s*:=\s*((?:\s*\$[A-Za-z_]*\$[\s\S]*?\$[A-Za-z_]*\$\s*(?:\|\|)?)+)\s*;/g;
  let dd: RegExpExecArray | null;
  while ((dd = dollarDeclRe.exec(sql))) {
    if (decls.has(dd[1])) continue;
    const segRe = /\s*\$([A-Za-z_]*)\$([\s\S]*?)\$\1\$\s*(\|\||$)/y;
    const expr = dd[2].trim();
    let val = '';
    let pos = 0;
    let ok = true;
    while (pos < expr.length) {
      segRe.lastIndex = pos;
      const s = segRe.exec(expr);
      if (!s) { ok = false; break; }
      val += s[2];
      pos = segRe.lastIndex;
      if (s[3] === '') break;
    }
    if (ok && pos >= expr.length) decls.set(dd[1], val);
  }

  // Every arm records WHERE in the SQL its patch sits, and the list is returned in that order: the arms
  // scan separately, and a patch whose anchor an EARLIER patch creates would otherwise be applied first,
  // find nothing, and be skipped silently (CodeRabbit on #11148). Source order is execution order.
  const out: { anchor: string; replacement: string; pos: number; probe?: boolean }[] = [];
  // A `replace(...)` that sits after `--` on its own line is a comment: SQL never runs it…
  // …and neither is one inside a `/* … */` block comment. PostgreSQL NESTS block comments, so this is a
  // depth count over the whole file, not "the last `/*` before it" (which an inner `*/` would fool).
  const inBlock = new Uint8Array(sql.length + 1);
  for (let i = 0, depth = 0; i < sql.length; i++) {
    if (depth === 0 && sql[i] === "'") {             // a '…' / E'…' string: a `/*` inside it opens nothing
      const e = i > 0 && /[eE]/.test(sql[i - 1]);
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (e && sql[j] === '\\') { j += 2; continue; }
        if (sql[j] === "'") break;
        j++;
      }
      i = j;
      continue;
    }
    if (sql.startsWith('/*', i)) { depth++; inBlock[i] = 1; inBlock[i + 1] = 1; i++; continue; }
    if (depth > 0 && sql.startsWith('*/', i)) { inBlock[i] = 1; inBlock[i + 1] = 1; depth--; i++; continue; }
    if (depth > 0) inBlock[i] = 1;
  }
  const commentedOut = (pos: number) =>
    sql.slice(sql.lastIndexOf('\n', pos - 1) + 1, pos).includes('--') || inBlock[pos] === 1;

  // (c) TABLE-DRIVEN — `edits text[][] := array[ ['needle','replacement','count'], ... ]` applied in
  // a loop (20260812122557). A migration that makes a dozen related edits to one RPC is far safer
  // written as one auditable table than as a dozen near-identical variable pairs, and it lets the
  // migration assert an expected occurrence count per edit. The loop variables are not literals, so
  // idioms (a)/(b) above cannot see through them and the whole migration read as "unrecognised
  // change" — which correctly blocked the RNPL/Monthly replay guard until this was taught.
  // Only the first two columns matter here: needle, replacement. Any third column (an expected
  // count) is ignored — it is an assertion, not an edit.
  const arrDeclRe = /\b([A-Za-z_][A-Za-z0-9_]*)\s+text\s*\[\s*\]\s*\[\s*\]\s*:=\s*array\s*\[/g;
  let a: RegExpExecArray | null;
  const tables: string[] = [];
  let unplacedTables = 0;
  while ((a = arrDeclRe.exec(sql))) {
    tables.push(a[1]);
    // Walk from the opening bracket to its match so we only ever read inside THIS declaration.
    let depth = 0;
    let end = -1;
    for (let i = a.index + a[0].length - 1; i < sql.length; i++) {
      const ch = sql[i];
      if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) continue;                       // unterminated — leave it to the unresolved path
    const span = sql.slice(a.index, end + 1);
    const rowRe = /\[\s*'((?:[^']|'')*)'\s*,\s*'((?:[^']|'')*)'/g;
    let r: RegExpExecArray | null;
    while ((r = rowRe.exec(span))) {
      // Positioned at the table's index use INSIDE THE LOOP after its declaration — the loop that applies
      // the rows (directly, `replace(x, name[i][1], …)`, or through variables, `needle := name[i][1]`). A read
      // outside a loop (`n := array_length(name, 1)`, `preview := name[1][1]`) applies nothing and can sit
      // before an inline patch that creates a row's anchor. No such use → the order cannot be known, and the
      // migration is reported as unresolved rather than placed at a guessed position.
      // `a[1]` is an identifier (\w+), so it is safe inside a pattern.
      const idx = new RegExp(String.raw`\b${a[1]}\s*\[`);
      const loopRe = /\bloop\b([\s\S]*?)\bend\s+loop\b/gi;
      loopRe.lastIndex = end + 1;
      // Exactly ONE loop may index the table: with two (one only reading it), which one applies the rows
      // is not something a static reader can know, so the order is reported as unresolved, never guessed.
      const loopsUsing: number[] = [];
      let lp: RegExpExecArray | null;
      while ((lp = loopRe.exec(sql))) {
        if (commentedOut(lp.index)) continue;
        const hit = idx.exec(lp[1]);
        if (hit) loopsUsing.push(lp.index + 'loop'.length + hit.index);
      }
      if (loopsUsing.length !== 1) { unplacedTables++; continue; }
      const u = { index: loopsUsing[0] };
      out.push({ anchor: r[1].replace(/''/g, "'"), replacement: r[2].replace(/''/g, "'"), pos: u.index });
    }
  }

  // (d) INLINE DOLLAR-QUOTED — `replace(d, $x$needle$x$, $x$replacement$x$)` (20261102051729). A needle that
  // itself contains quotes reads far more safely dollar-quoted than ''-escaped inside a declaration.
  const dollarRe =
    /\breplace\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*,\s*\$([A-Za-z_]*)\$([\s\S]*?)\$\1\$\s*,\s*\$([A-Za-z_]*)\$([\s\S]*?)\$\3\$\s*\)/g;
  let q: RegExpExecArray | null;
  while ((q = dollarRe.exec(sql))) if (!commentedOut(q.index)) out.push({ anchor: q[2], replacement: q[4], pos: q.index });

  const callRe = /\breplace\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g;
  let c: RegExpExecArray | null;
  while ((c = callRe.exec(sql))) {
    const anchor = decls.get(c[2]);
    const replacement = decls.get(c[3]);
    if (anchor === undefined || replacement === undefined) continue;  // not a literal pair
    if (commentedOut(c.index)) continue;
    // An ASSIGNED or EXECUTED call runs every time it appears; anything else (`length(replace(…))`) is an
    // occurrence probe, which repeats a pair without applying it.
    const lead = sql.slice(Math.max(0, c.index - 40), c.index);
    out.push({ anchor, replacement, pos: c.index, probe: !/(:=|\bexecute)\s*$/i.test(lead) });
  }

  // (g) INLINE LITERAL ARGUMENTS (20261107213742) — `replace(src, E'needle\n', E'needle\n' || E'added\n')`,
  // the needle and replacement written straight into the call instead of declared first. Each argument
  // must evaluate through evalDeclExpr (literals and known variables joined by `||`); anything else
  // stays invisible and falls to the unresolved path, never guessed. Only an ASSIGNED call (`x := replace(…)`)
  // is a patch: `length(replace(out_def, 'needle', ''))` is an occurrence probe, and reading it as a patch
  // would delete the needle from the replayed body.
  const LIT = String.raw`(?:E'(?:[^'\\]|''|\\.)*'|'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_]*)`;
  const ARG = String.raw`${LIT}(?:\s*\|\|\s*${LIT})*`;
  const inlineRe = new RegExp(String.raw`:=\s*replace\s*\(\s*[A-Za-z_][A-Za-z0-9_]*\s*,\s*(${ARG})\s*,\s*(${ARG})\s*\)`, 'g');
  let il: RegExpExecArray | null;
  while ((il = inlineRe.exec(sql))) {
    if (!/'/.test(il[1]) && !/'/.test(il[2])) continue;               // the variable-only form is (callRe)'s
    const anchor = evalDeclExpr(il[1].trim(), decls);
    const replacement = evalDeclExpr(il[2].trim(), decls);
    if (anchor === undefined || replacement === undefined) continue;
    if (commentedOut(il.index)) continue;
    out.push({ anchor, replacement, pos: il.index });
  }
  // Every executing call is kept, repeats included (X→Y, Y→X, X→Y runs three times). Only a PROBE whose
  // pair already ran is dropped: it repeats a pair without applying it.
  out.sort((x, y) => x.pos - y.pos);
  const ran = new Set<string>();
  const patches = out.filter((p) => {
    const k = `${p.anchor}\u0000${p.replacement}`;
    if (p.probe && ran.has(k)) return false;
    ran.add(k);
    return true;
  }).map(({ anchor, replacement }) => ({ anchor, replacement }));

  // An ASSIGNED replace() this reader could not turn into a patch (a runtime-computed argument) is counted,
  // so a migration mixing readable and unreadable patches is reported instead of half-replayed.
  const assigned = /:=\s*replace\s*\(/g;
  let m: RegExpExecArray | null;
  let unreadAssigned = unplacedTables;
  while ((m = assigned.exec(sql))) {
    if (commentedOut(m.index)) continue;
    const semi = sql.indexOf(';', m.index);
    const end = semi < 0 ? sql.length : semi;        // the whole statement: a table row's use sits in its args
    const stmt = sql.slice(m.index, end);
    const tableRow = tables.some((t) => new RegExp(String.raw`\b${t}\s*\[`).test(stmt));
    if (!tableRow && !out.some((p) => p.pos >= m!.index && p.pos <= end)) unreadAssigned++;
  }
  return { patches, unreadAssigned };
}

/**
 * Does this migration clearly REWRITE the function in a way we could not interpret?
 *
 * Deliberately narrow. Merely MENTIONING a function name is not a change — migrations reference
 * functions in comments, in cron command strings, and from other functions that call them. Flagging
 * those would make the checker cry wolf on every run and get muted, which is worse than no checker.
 * A body rewrite we cannot model has a specific signature: it reads the live definition
 * (pg_get_functiondef) and re-executes it, or it drops/alters the function outright.
 */
export function looksLikeUninterpretedChange(sql: string, fn: string): boolean {
  if (!sql.includes(fn)) return false;

  const dropsOrAlters =
    new RegExp(`drop\\s+function\\s+(if\\s+exists\\s+)?public\\.${fn}\\b`, 'i').test(sql) ||
    new RegExp(`alter\\s+function\\s+public\\.${fn}\\b`, 'i').test(sql);
  if (dropsOrAlters) return true;

  const rewritesViaLiveBody = /pg_get_functiondef/i.test(sql) && /\bexecute\b/i.test(sql);
  if (!rewritesViaLiveBody) return false;

  // A migration that reads pg_get_functiondef is not necessarily rewriting THIS function.
  // Monitors routinely INSPECT an RPC's body — mon_detect_location_predicate_drift reads
  // location_search_candidates_ar to check that a predicate is still indexable, for example. Those
  // migrations define only mon_* functions and change nothing about the RPC, but the old heuristic
  // saw "pg_get_functiondef + execute + the name appears" and reported the tracked function as
  // uninterpretable. Two such migrations landed within minutes of each other on 2026-08-10, and
  // muting each one by hand does not scale — the next monitor repeats it.
  //
  // So: if every function this migration DEFINES is some other function, and none of them is the
  // tracked one, the migration is inspecting, not rewriting. Anything that does define/redefine the
  // tracked function (statically or by building its body dynamically) still reports as unresolved.
  const definedHere = [...sql.matchAll(/create\s+or\s+replace\s+function\s+public\.([a-z0-9_]+)/gi)]
    .map((m) => m[1].toLowerCase());
  // A NEEDLE-EDIT migration names its target in the lookup, not in a literal CREATE OR REPLACE:
  //     select pg_get_functiondef(p.oid) ... where p.proname = 'ops_af_option_truth_sweep'
  // then edits that body and EXECUTEs it. That is the shape AGENTS.md actually prescribes for
  // amending a large live function (the RPC full-body-replace hazard), so it is common and growing.
  // Without this, such a migration has no `definedHere` at all and every tracked RPC it merely
  // MENTIONS — in a comment, or inside a format() string it assembles — is reported uninterpretable.
  // Collect the declared targets so inspect-vs-rewrite can be judged the same way.
  // The alias is optional: `from pg_proc where proname = '...'` (no `p.`) is the same declaration
  // of target (20260905044047 wrote it that way and was wrongly reported uninterpretable for a
  // tracked RPC it only MENTIONED in prose). Widening cannot hide a real rewrite: a bare-proname
  // edit that names a TRACKED function still sets definesTracked and stays flagged.
  for (const m of sql.matchAll(/(?:\w+\.)?proname\s*=\s*'([a-z0-9_]+)'/gi)) definedHere.push(m[1].toLowerCase());
  // 2026-10-18: the other common target declaration is a regprocedure/regproc cast —
  //     src := pg_get_functiondef('public.trg_aqar_parse()'::regprocedure);
  // (20261018234721). Without it that migration declared no target, and every tracked function whose
  // name is a SUBSTRING of the real target (aqar_parse inside trg_aqar_parse) was reported
  // uninterpretable. Only OTHER functions are added: a regprocedure read of the TRACKED function may be
  // an inspection (mon_* detectors do this) or a rewrite, and that call keeps exactly its old outcome —
  // with no literal target it is flagged, as before; with literal targets the dynamic-rebuild check
  // below decides, as before. So this can only clear a migration that rewrites some OTHER function.
  const literalTargets = definedHere.length;
  const regprocTargets = [...sql.matchAll(/pg_get_functiondef\(\s*'(?:public\.)?([a-z0-9_]+)\s*(?:\([^']*\))?'\s*::\s*regproc(?:edure)?\b/gi)]
    .map((m) => m[1].toLowerCase());
  if (literalTargets === 0 && regprocTargets.includes(fn.toLowerCase())) return true;
  for (const t of regprocTargets) if (t !== fn.toLowerCase()) definedHere.push(t);
  const definesTracked = definedHere.includes(fn.toLowerCase());
  if (!definesTracked && definedHere.length > 0) {
    // Guard the loophole: a dynamic rebuild names the target in the EXECUTE string rather than in a
    // literal CREATE OR REPLACE. If the function name appears next to a create-or-replace fragment
    // anywhere (including inside a quoted string being assembled), keep flagging it.
    const dynamicRebuild = new RegExp(
      `create\\s+or\\s+replace\\s+function[^;]{0,120}${fn}|${fn}[^;]{0,120}create\\s+or\\s+replace\\s+function`, 'i',
    ).test(sql);
    return dynamicRebuild;
  }
  return true;
}

export function replayFunction(migrationsDir: string, fn: string): Replayed {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  let body: string | null = null;
  const touchedBy: string[] = [];
  let unresolved: string[] = [];

  for (const f of files) {
    const sql = readFileSync(join(migrationsDir, f), 'utf8');
    if (!sql.includes(fn)) continue;

    if (DEF_RE(fn).test(sql)) {
      const def = extractDefinition(sql, fn);
      if (!def) { unresolved.push(`${f} (definition found but body not parseable)`); continue; }
      body = def;                       // a later CREATE OR REPLACE fully supersedes
      touchedBy.push(f);
      // A full definition WIPES THE SLATE: whatever earlier migrations did to this function — however
      // exotic — is irrelevant, because this statement replaces the body outright. So anything we
      // could not interpret BEFORE this point cannot affect the effective state, and keeping it would
      // be permanent false noise. Only failures to interpret changes made AFTER the last definition
      // can hide a real edit.
      unresolved = [];
      continue;
    }

    const { patches, unreadAssigned } = extractPatches(sql);
    if (patches.length && unreadAssigned && looksLikeUninterpretedChange(sql, fn)) {
      unresolved.push(`${f} (${unreadAssigned} assigned replace() not readable beside readable patches)`);
    }
    if (patches.length) {
      if (body === null) { unresolved.push(`${f} (patches ${fn} before any definition)`); continue; }
      let applied = false;
      for (const patch of patches) {
        if (!body.includes(patch.anchor)) continue;   // needle belongs to another function
        body = body.split(patch.anchor).join(patch.replacement);
        applied = true;
      }
      if (applied) touchedBy.push(f);
      continue;
    }

    if (looksLikeUninterpretedChange(sql, fn)) unresolved.push(`${f} (unrecognised change)`);
  }

  return { fn, body, touchedBy, unresolved };
}

/** Convenience: body with `-- comment` lines stripped, so prose can't satisfy a code assertion. */
export function codeOnly(body: string): string {
  return body.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
}

export const MIGRATIONS_DIR = join(import.meta.dirname, '..', '..', 'supabase', 'migrations');
