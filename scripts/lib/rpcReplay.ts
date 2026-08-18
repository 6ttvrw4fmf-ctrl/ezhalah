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

function extractPatches(sql: string): { anchor: string; replacement: string }[] {
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

  const out: { anchor: string; replacement: string }[] = [];

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
  while ((a = arrDeclRe.exec(sql))) {
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
      out.push({ anchor: r[1].replace(/''/g, "'"), replacement: r[2].replace(/''/g, "'") });
    }
  }

  const callRe = /\breplace\s*\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)/g;
  let c: RegExpExecArray | null;
  const seen = new Set<string>();
  while ((c = callRe.exec(sql))) {
    const anchor = decls.get(c[2]);
    const replacement = decls.get(c[3]);
    if (anchor === undefined || replacement === undefined) continue;  // not a literal pair
    const key = `${anchor}\u0000${replacement}`;
    if (seen.has(key)) continue;                                       // occurrence-count probes repeat it
    seen.add(key);
    out.push({ anchor, replacement });
  }
  return out;
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
function looksLikeUninterpretedChange(sql: string, fn: string): boolean {
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

    const patches = extractPatches(sql);
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
