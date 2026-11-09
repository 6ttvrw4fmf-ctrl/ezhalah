// mon_detect_field_integrity CAN NEITHER CRASH ON A ZERO AREA NOR SKIP A TABLE IN SILENCE (2026-11-09, #11367).
//
// Two defects CodeRabbit found in the 11-08 «judge what customers are served» change, both now fixed in prod:
//   1. The suspect pre-test divided by x.area_m2 behind «x.area_m2 > 0 and …». PostgreSQL does not promise to
//      evaluate the guard first, so a zero-area row could raise division_by_zero (20261108235000 → nullif).
//   2. Each table's scan sat in «exception when others then continue», so such an error skipped the whole table
//      without a word and its listings read as clean (20261109001500 → a P2 field_integrity_table_skipped alert).
//
// Hermetic: reads committed SQL only.
//   A. some migration installs the nullif-guarded division into mon_detect_field_integrity, and no LATER migration
//      that touches the function carries the bare «::numeric / x.area_m2 >» division (outside a replace() anchor
//      constant) or redefines the function without nullif;
//   B. some migration installs the field_integrity_table_skipped alert, and no LATER migration that touches the
//      function reintroduces a silent «exception when others then continue».
// Mutation-proven at the bottom against synthetic inputs.

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const MIGRATIONS = 'supabase/migrations';
const FN = /mon_detect_field_integrity/;
const REDEFINE = /create\s+or\s+replace\s+function\s+public\.mon_detect_field_integrity\s*\(/i;
const GUARDED = /::numeric\s*\/\s*nullif\(x\.area_m2,\s*0\)\s*>\s*500000/;
// a bare division, ignoring lines that only declare the replace() anchor (`old_div constant text := …`)
const BARE = /::numeric\s*\/\s*x\.area_m2\s*>/;
const SKIP_ALERT = /'field_integrity_table_skipped:'\s*\|\|\s*rec\.tn/;
const SILENT = /exception\s+when\s+others\s+then\s+continue\s*;/i;
// C. both price arms (phone/ID band + extreme magnitude) count a row only while a customer is served that raw figure
const SERVED_RAW = /public\.field_integrity_served_raw\(x\.tableoid,\s*x\.id,\s*coalesce\(x\.price_total,\s*x\.price_annual\)\)/g;
/** How many served-raw calls a migration's executable text carries (replace() anchor constants excluded). */
export const servedRawArms = (sql: string): number => (codeLines(sql).match(SERVED_RAW) || []).length;
// a full definition carries the call twice; a replace() patch carries it once in its constant and ASSERTS it lands twice
// The two price arms, told apart by their own thresholds: the phone/ID band and the extreme price-per-m² test.
const PHONE_ARM = /between\s+500000000\s+and\s+599999999/;
const MAGNITUDE_ARM = /::numeric\s*\/\s*area_m2\s*>\s*2000000\b/;
/** Which price arms of a full function text carry the served-raw call — judged per `count(*) filter (…)` arm,
 *  so two calls in one arm can never stand in for a missing call in the other. */
export function servedRawByArm(sql: string): { phone: boolean; magnitude: boolean } {
  const one = new RegExp(SERVED_RAW.source);
  const arms = codeLines(sql).split(/count\(\*\)\s+filter\s*\(\s*where/i);
  return {
    phone: arms.some((a) => PHONE_ARM.test(a) && one.test(a)),
    magnitude: arms.some((a) => MAGNITUDE_ARM.test(a) && one.test(a)),
  };
}
/** A migration that puts the served-raw check into BOTH price arms (full text judged per arm, or a patch asserting two hits). */
export const installsBothArms = (sql: string): boolean => {
  const by = servedRawByArm(sql);
  return (by.phone && by.magnitude) || ((sql.match(SERVED_RAW) || []).length >= 1 && /\)\s*<>\s*2\s+then/.test(sql));
};

type F = { name: string; sql: string };

/** Every old_X / new_X text constant whose initializer is ONE whole literal ending the statement — a dollar quote
 *  (any tag) or a '…' string with '' escapes. A cast, a concatenation or a function call is NOT parsed, so a
 *  replace() that uses it cannot be judged and fails closed. */
export function parsedConsts(sql: string): Map<string, string> {
  const out = new Map<string, string>();
  const DECL = /\b((?:old|new)_\w+)\s+(?:constant\s+)?text\s*:=\s*(?:\$(\w*)\$([\s\S]*?)\$\2\$|'((?:[^']|'')*)')\s*;/g;
  for (const m of sql.matchAll(DECL)) out.set(m[1], m[3] ?? m[4].replace(/''/g, "'"));
  return out;
}

/** The `old_X` / `new_X` constant pairs of a `replace(v, old_X, new_X)` patch migration, matched by suffix.
 *  Reads any dollar quote (`$a$`, `$o$`, `$$` …) and plain '…' strings with '' escapes. */
export function patchPairs(sql: string): Array<{ old: string; neu: string }> {
  const consts = new Map<string, { old?: string; neu?: string }>();
  for (const [name, val] of parsedConsts(sql)) {
    const [, kind, sfx] = name.match(/^(old|new)_(\w+)$/)!;
    const e = consts.get(sfx) ?? {};
    if (kind === 'old') e.old = val; else e.neu = val;
    consts.set(sfx, e);
  }
  return [...consts.values()].filter((e) => e.old !== undefined && e.neu !== undefined).map((e) => ({ old: e.old!, neu: e.neu! }));
}

/** A migration that rewrites mon_detect_field_integrity from its live text (pg_get_functiondef + replace) —
 *  if patchPairs cannot read its pairs, the barrier cannot judge it and must fail closed. */
export function isFunctionPatch(sql: string): boolean {
  return FN.test(sql) && /pg_get_functiondef\s*\(\s*'public\.mon_detect_field_integrity/.test(sql) && /\breplace\s*\(/.test(sql);
}

/** Every replace(...) call in a function patch, and whether each one is a form this barrier can judge:
 *  replace(<var>, old_X, new_X) or replace(<var>, old_X, '') with old_X/new_X declared constants. Anything else —
 *  an inline literal, a concatenation, a second unrelated rewrite — is unreadable, so the patch must fail closed. */
export function unreadableReplaces(sql: string): string[] {
  const code = sql.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
  const declared = new Set(parsedConsts(code).keys()); // parsed values only — a declared-but-unparsed name is unreadable
  const callStarts = [...code.matchAll(/\breplace\s*\(/gi)].map((m) => m.index!);
  const judged = new Set<number>();
  let readable = 0;
  const bad: string[] = [];
  for (const m of code.matchAll(/\breplace\s*\(\s*(\w+)\s*,\s*([^,()]+?)\s*,\s*([^,()]+?)\s*\)/gi)) {
    const [, , from, to] = m;
    const sfx = from.replace(/^old_/, '');
    const isOld = /^old_\w+$/.test(from) && declared.has(from);
    // replace(v, old_X, '') only COUNTS matches when it sits inside length(…); anywhere else it deletes text from
    // the function body, which must be declared as new_X := '' so patchRemoves() can judge it like any other edit.
    const counting = to === "''" && /\blength\s*\(\s*$/i.test(code.slice(0, m.index));
    const ok = isOld && (counting || (to === `new_${sfx}` && declared.has(to)));
    judged.add(m.index!);
    if (ok) readable++;
    else bad.push(to === "''" ? `${m[0]} deletes body text outside a length() count — declare new_${sfx} := '' instead` : m[0]);
  }
  // a call the shape regex could not split (nested parens, a function call in an argument …) is named, never counted away
  for (const i of callStarts) if (!judged.has(i)) bad.push(`unparseable ${code.slice(i, i + 140).replace(/\s+/g, ' ')}…`);
  return bad;
}

// ── D. replay: the safeguard text, word for word as production runs it (whitespace-normalised) ──────────────────
// Measured 2026-11-09 against pg_get_functiondef(mon_detect_field_integrity) on aannarbkwcymrotzwdbo: GUARD_CLAUSE ×2
// (one per price arm), SKIP_RAISE ×1, SKIP_RESOLVE ×1. Every later replace() patch is REPLAYED over this reference;
// a patch that alters any snippet — even partially («then true or public.field_integrity_served_raw…») — fails.
// A patch that is meant to change a safeguard must update this reference in the same PR: a reviewed decision.
const norm = (t: string): string => t.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
export const SAFEGUARDS: Array<{ name: string; text: string; count: number }> = [
  { name: 'skipped-table alert', count: 1, text: norm(`n := n + public.mon_raise('P2','field_integrity', rec.platform,
      'field_integrity_table_skipped:'||rec.tn,`) },
  { name: 'skipped-table alert resolve', count: 1, text: norm(`update public.alert_event set resolved_at = now()
      where kind='field_integrity' and resolved_at is null
      and dedup_key = 'field_integrity_table_skipped:'||rec.tn;`) },
];
// ── E. the two price arms IN FULL, from «count(*) filter (where … phone/ID band» through «from public.%I x», exactly as
// production runs them. Measured 2026-11-09: comment-stripped + whitespace-normalised, this text is byte-identical to
// pg_get_functiondef(mon_detect_field_integrity) on aannarbkwcymrotzwdbo (md5 below). Patches are replayed over the
// WHOLE arms, so an edit that crosses a safeguard's edge («else false end),» → «else false end or true),») is seen,
// and the result is judged STRUCTURALLY: each arm's filter must stay a pure top-level AND chain carrying the guard.
const ARMS_REFERENCE = `count(*) filter (where active and (price_total  between 100000000 and 101000000
                                          or price_total  between 500000000 and 599999999
                                          or price_annual between 100000000 and 101000000
                                          or price_annual between 500000000 and 599999999)
                            and not (coalesce(source_capture->'price_evidence'->>'origin', '') = 'api'
                                     and coalesce(source_capture->'price_evidence'->>'field', '') ~ 'landTotalPrice$'
                                     and coalesce(source_capture->'price_evidence'->>'stored', '') ~ '^[0-9]+$'
                                     and (source_capture->'price_evidence'->>'stored')::numeric
                                         = coalesce(price_total, price_annual))
                            and not exists (select 1 from public.ops_price_source_verified v
                                             where v.source_table = %L and v.listing_id = id)
                            and case when greatest(coalesce(x.price_total, 0), coalesce(x.price_annual, 0)) >= 100000000
                                      or (x.area_m2 > 0 and greatest(coalesce(x.price_total, 0), coalesce(x.price_annual, 0))::numeric / nullif(x.area_m2, 0) > 500000)
                                      or x.area_m2::numeric > 1000000
                                 then public.field_integrity_served_raw(x.tableoid, x.id, coalesce(x.price_total, x.price_annual))
                                 else false end),
          count(*) filter (where active and (
                             (area_m2 is not null and area_m2 > 0
                               and ((price_total  is not null and price_total::numeric/area_m2  > 2000000)
                                 or (price_annual is not null and price_annual::numeric/area_m2 > 500000)))
                             or (area_m2::numeric > 1000000 and coalesce(property_type,'') !~ '^أرض'
                                 and coalesce(property_type,'') <> all(%L::text[])))
                            and not exists (select 1 from public.ops_price_source_verified v
                                             where v.source_table = %L and v.listing_id = id)
                            and case when greatest(coalesce(x.price_total, 0), coalesce(x.price_annual, 0)) >= 100000000
                                      or (x.area_m2 > 0 and greatest(coalesce(x.price_total, 0), coalesce(x.price_annual, 0))::numeric / nullif(x.area_m2, 0) > 500000)
                                      or x.area_m2::numeric > 1000000
                                 then public.field_integrity_served_raw(x.tableoid, x.id, coalesce(x.price_total, x.price_annual))
                                 else false end
                            and not exists (select 1 from public.search_listings_ar s
                                             where s.source_table = %L and s.listing_id = x.id
                                               and s.price_total is distinct from x.price_total
                                               and s.area_m2 > 0
                                               and coalesce(s.price_total, 0)::numeric / s.area_m2 <= 2000000
                                               and coalesce(s.price_annual, 0)::numeric / s.area_m2 <= 500000))
        from public.%I x`;
export const ARMS_REFERENCE_MD5 = '1e636809971c914b72d0f5f925694cf3';
const GUARD = norm(`and case when greatest(coalesce(x.price_total, 0), coalesce(x.price_annual, 0)) >= 100000000
      or (x.area_m2 > 0 and greatest(coalesce(x.price_total, 0), coalesce(x.price_annual, 0))::numeric / nullif(x.area_m2, 0) > 500000)
      or x.area_m2::numeric > 1000000
      then public.field_integrity_served_raw(x.tableoid, x.id, coalesce(x.price_total, x.price_annual))
      else false end`);

/** The predicate inside each «count(*) filter (where …)», cut at its matching parenthesis (quotes respected). */
export function filterPredicates(text: string): string[] {
  const out: string[] = [];
  const open = /count\(\*\) filter \(where /g;
  for (const m of text.matchAll(open)) {
    let depth = 0, q = false, i = m.index! + m[0].length;
    const from = i;
    for (; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === "'") { if (text[i + 1] === "'") i++; else q = false; } continue; }
      if (c === "'") q = true; else if (c === '(') depth++;
      else if (c === ')') { if (depth === 0) break; depth--; }
    }
    out.push(i < text.length ? text.slice(from, i) : '');           // '' = unterminated → judged broken
  }
  return out;
}

/** True when a predicate carries an OR at its own top level — outside every parenthesis, string and CASE … END
 *  (the guard's own «case when … or … then» is nesting, not a disjunction of the filter). */
export function hasTopLevelOr(pred: string): boolean {
  let depth = 0, caseDepth = 0, q = false;
  for (let i = 0; i < pred.length; i++) {
    const c = pred[i];
    if (q) { if (c === "'") { if (pred[i + 1] === "'") i++; else q = false; } continue; }
    if (c === "'") { q = true; continue; }
    if (c === '(') { depth++; continue; }
    if (c === ')') { depth--; continue; }
    if (depth !== 0 || (i > 0 && /\w/.test(pred[i - 1]))) continue;      // only whole words at paren depth 0
    const word = /^[a-z_]+/i.exec(pred.slice(i))?.[0]?.toLowerCase();
    if (word === 'case') caseDepth++;
    else if (word === 'end' && caseDepth > 0) caseDepth--;
    else if (word === 'or' && caseDepth === 0) return true;
    if (word) i += word.length - 1;
  }
  return false;
}

/** Judges replayed arm text: both price arms present once, each a pure top-level AND chain that carries the guard. */
export function armDamage(text: string): string[] {
  const preds = filterPredicates(text);
  const phone = preds.filter((p) => /between 500000000 and 599999999/.test(p));
  const mag = preds.filter((p) => /::numeric\/area_m2 > 2000000/.test(p));
  const out: string[] = [];
  for (const [label, arm] of [['phone/ID', phone], ['extreme-magnitude', mag]] as const) {
    if (arm.length !== 1) { out.push(`${label} arm no longer found intact`); continue; }
    if (!arm[0].includes(GUARD)) out.push(`${label} arm lost the served-raw guard clause`);
    if (hasTopLevelOr(arm[0])) out.push(`${label} arm gained a top-level OR, so it can count prices customers are not served`);
  }
  if (preds.length !== 2 || (phone.length === 1 && mag.length === 1 && phone[0] === mag[0])) out.push(`the two price arms are no longer two separate filters (found ${preds.length})`);
  if (!/ from public\.%I x$/.test(text)) out.push('the arms no longer end at «from public.%I x»');
  return out;
}

/** Replays a patch over the full production arms and judges the result structurally. */
export function replayArms(sql: string): string[] {
  let body = norm(ARMS_REFERENCE);
  for (const { old, neu } of patchPairs(sql)) { const o = norm(old); if (o) body = body.split(o).join(norm(neu)); }
  return armDamage(body);
}

const occurrences = (hay: string, needle: string): number => (needle ? hay.split(needle).length - 1 : 0);
/** Replays a patch's old_X → new_X edits over the production safeguard reference; names every snippet it alters. */
export function replayDamage(sql: string): string[] {
  let body = SAFEGUARDS.flatMap((g) => Array(g.count).fill(g.text)).join(' … ');
  for (const { old, neu } of patchPairs(sql)) { const o = norm(old); if (o) body = body.split(o).join(norm(neu)); }
  return SAFEGUARDS.filter((g) => occurrences(body, g.text) < g.count).map((g) => g.name);
}

/** True when a replace() patch swaps text carrying `marker` for text that no longer carries it. */
export function patchRemoves(sql: string, marker: RegExp): boolean {
  const m = new RegExp(marker.source, marker.flags.replace('g', ''));
  return patchPairs(sql).some((p) => m.test(p.old) && !m.test(p.neu));
}

function codeLines(sql: string): string {
  return sql.split('\n').filter((l) => !/^\s*old_\w+\s+constant\s+text\s*:=/.test(l) && !/^\s*--/.test(l)).join('\n');
}

/** Every way the committed migrations leave mon_detect_field_integrity crashable, silent, or judging unserved prices. */
export function problems(files: F[]): string[] {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  const out: string[] = [];
  const guardIdx = sorted.findIndex((f) => FN.test(f.sql) && GUARDED.test(f.sql));
  if (guardIdx < 0) out.push('no migration installs the nullif-guarded area division into mon_detect_field_integrity');
  else for (const f of sorted.slice(guardIdx + 1)) {
    if (!FN.test(f.sql)) continue;
    if (BARE.test(codeLines(f.sql))) out.push(`${f.name} brings back the unguarded «/ x.area_m2» division`);
    if (REDEFINE.test(f.sql) && !GUARDED.test(f.sql)) out.push(`${f.name} redefines mon_detect_field_integrity without nullif(x.area_m2, 0)`);
    if (patchRemoves(f.sql, GUARDED)) out.push(`${f.name} removes the nullif-guarded division through a replace() patch`);
  }
  const skipIdx = sorted.findIndex((f) => FN.test(f.sql) && SKIP_ALERT.test(f.sql));
  if (skipIdx < 0) out.push('no migration makes a skipped field_integrity table raise an alert');
  else for (const f of sorted.slice(skipIdx + 1)) {
    if (!FN.test(f.sql)) continue;
    if (SILENT.test(codeLines(f.sql))) out.push(`${f.name} reintroduces a silent «exception when others then continue»`);
    if (REDEFINE.test(f.sql) && !SKIP_ALERT.test(f.sql)) out.push(`${f.name} redefines mon_detect_field_integrity without the skipped-table alert`);
    if (patchRemoves(f.sql, SKIP_ALERT)) out.push(`${f.name} removes the skipped-table alert through a replace() patch`);
  }
  const servedIdx = sorted.findIndex((f) => FN.test(f.sql) && installsBothArms(f.sql));
  if (servedIdx < 0) out.push('no migration installs the served-raw check into both price arms of mon_detect_field_integrity');
  else for (const f of sorted.slice(servedIdx + 1)) {
    if (REDEFINE.test(f.sql)) {
      const by = servedRawByArm(f.sql);
      if (!by.phone) out.push(`${f.name} redefines mon_detect_field_integrity without the served-raw check in the phone/ID price arm`);
      if (!by.magnitude) out.push(`${f.name} redefines mon_detect_field_integrity without the served-raw check in the extreme-magnitude arm`);
    }
    if (patchRemoves(f.sql, SERVED_RAW)) out.push(`${f.name} removes the served-raw check from a price arm through a replace() patch`);
    if (isFunctionPatch(f.sql)) {
      const damaged = [...replayDamage(f.sql), ...replayArms(f.sql)];
      if (damaged.length) out.push(`${f.name} alters production safeguard text when replayed: ${damaged.join(', ')} — if intended, update SAFEGUARDS in this barrier in the same PR`);
      const bad = unreadableReplaces(f.sql);
      if (patchPairs(f.sql).length === 0 || bad.length) out.push(`${f.name} patches mon_detect_field_integrity in a shape this barrier cannot read — every rewrite must be replace(v, old_X, new_X) with declared constants: ${bad.join('; ') || 'no readable pairs'}`);
    }
  }
  return out;
}

// ── mutation proofs ──────────────────────────────────────────────────────────────────────────────────────────
const ARM = 'then public.field_integrity_served_raw(x.tableoid, x.id, coalesce(x.price_total, x.price_annual))';
const PHONE = 'count(*) filter (where price_total between 500000000 and 599999999';
const MAG = 'count(*) filter (where price_total::numeric/area_m2 > 2000000';
const served: F = { name: '20261108221500_s.sql', sql: `-- mon_detect_field_integrity\n${PHONE} ${ARM}),\n${MAG} ${ARM})` };
const guard: F = { name: '20261108235000_a.sql', sql: "old_div constant text := $a$coalesce(x.price_annual, 0))::numeric / x.area_m2 > 500000)$a$;\nnew_div constant text := $a$coalesce(x.price_annual, 0))::numeric / nullif(x.area_m2, 0) > 500000)$a$;\n-- mon_detect_field_integrity" };
const skip: F = { name: '20261109001500_b.sql', sql: "old_exc constant text := $a$    exception when others then continue;  -- x\n$a$;\n-- mon_detect_field_integrity\n'field_integrity_table_skipped:'||rec.tn" };
const cases: Array<[string, F[], boolean]> = [
  ['the real set passes', [served, guard, skip], true],
  ['no guard install fails', [served, skip], false],
  ['no skip-alert install fails', [served, guard], false],
  ['no served-raw install fails', [guard, skip], false],
  ['a later patch with a bare division fails', [served, guard, skip, { name: '20261110000000_c.sql', sql: 'mon_detect_field_integrity … greatest(0,1)::numeric / x.area_m2 > 500000' }], false],
  ['a later redefine without nullif fails', [served, guard, skip, { name: '20261110000000_c.sql', sql: "create or replace function public.mon_detect_field_integrity() 'field_integrity_table_skipped:'||rec.tn" }], false],
  ['a later silent handler fails', [served, guard, skip, { name: '20261110000000_c.sql', sql: 'mon_detect_field_integrity\n    exception when others then continue;\n' }], false],
  ['an unrelated later migration passes', [served, guard, skip, { name: '20261110000000_c.sql', sql: 'select 1 / x.area_m2 > 2; exception when others then continue;' }], true],
];
let bad = 0;
const mustCatch = (label: string, caught: boolean) => { if (!caught) { console.error(`✗ mutation proof «${label}» not caught`); bad++; } };
const mustPass = (label: string, ok: boolean) => { if (!ok) { console.error(`✗ «${label}» should pass`); bad++; } };
for (const [label, files, expectOk] of cases) {
  const ok = problems(files).length === 0;
  if (expectOk) mustPass(label, ok); else mustCatch(label, !ok);
}
mustCatch('a later patch reintroducing the bare division', problems([served, guard, skip, { name: '20261110000000_d.sql', sql: 'mon_detect_field_integrity … greatest(0,1)::numeric / x.area_m2 > 500000' }]).length > 0);
mustCatch('a later patch reintroducing the silent skip', problems([served, guard, skip, { name: '20261110000000_e.sql', sql: 'mon_detect_field_integrity\n    exception when others then continue;\n' }]).length > 0);
const redefineWith = (phoneCalls: number, magCalls: number): F => ({ name: '20261110000000_f.sql', sql: `create or replace function public.mon_detect_field_integrity() x::numeric / nullif(x.area_m2, 0) > 500000 'field_integrity_table_skipped:'||rec.tn\n${PHONE} ${Array(phoneCalls).fill(ARM).join(' ')}),\n${MAG} ${Array(magCalls).fill(ARM).join(' ')})` });
const errs = (f: F) => problems([served, guard, skip, f]);
mustCatch('a redefine that drops the served-raw check from the phone/ID arm only', errs(redefineWith(0, 1)).some((e) => /phone\/ID/.test(e)) && !errs(redefineWith(0, 1)).some((e) => /extreme-magnitude/.test(e)));
mustCatch('a redefine that drops the served-raw check from the extreme-magnitude arm only', errs(redefineWith(1, 0)).some((e) => /extreme-magnitude/.test(e)) && !errs(redefineWith(1, 0)).some((e) => /phone\/ID/.test(e)));
mustCatch('a redefine with TWO calls in the phone arm and none in the magnitude arm', errs(redefineWith(2, 0)).some((e) => /extreme-magnitude/.test(e)));
mustCatch('a redefine with TWO calls in the magnitude arm and none in the phone arm', errs(redefineWith(0, 2)).some((e) => /phone\/ID/.test(e)));
mustCatch('a redefine that drops it from both arms', errs(redefineWith(0, 0)).length >= 2);
mustPass('a redefine that keeps both arms', errs(redefineWith(1, 1)).length === 0);
mustCatch('an install with the check in only one arm', problems([{ ...served, sql: `-- mon_detect_field_integrity\n${ARM}` }, guard, skip]).length > 0);
const patch = (oldText: string, newText: string): F => ({ name: '20261110000000_p.sql', sql: `-- mon_detect_field_integrity\ndo $m$ declare v text;\n  old_x constant text := $a$${oldText}$a$;\n  new_x constant text := $a$${newText}$a$;\nbegin v := pg_get_functiondef('public.mon_detect_field_integrity()'::regprocedure);\n  execute replace(v, old_x, new_x); end $m$;` });
mustCatch('a replace() patch that swaps the served-raw call for «true»', problems([served, guard, skip, patch(ARM, 'then true')]).length > 0);
mustCatch('a replace() patch that swaps the nullif division back to a bare one', problems([served, guard, skip, patch('::numeric / nullif(x.area_m2, 0) > 500000', '::numeric / x.area_m2 > 500000')]).length > 0);
mustCatch("a replace() patch that drops the skipped-table alert", problems([served, guard, skip, patch("'field_integrity_table_skipped:'||rec.tn", "'x'")]).length > 0);
mustPass('a replace() patch that keeps the served-raw call while changing its guard', problems([served, guard, skip, patch(`and ${ARM}`, `and case when y ${ARM} else false end`)]).length === 0);
const patchQ = (decl: string, body: string): F => ({ name: '20261110000000_q.sql', sql: `-- mon_detect_field_integrity\ndo $m$ declare v text; n int;\n${decl}\nbegin v := pg_get_functiondef('public.mon_detect_field_integrity()'::regprocedure);\n${body}\nend $m$;` });
const diag = (f: F) => problems([served, guard, skip, f]).join('\n');
const REMOVES = /removes the served-raw check/;
const UNREADABLE = /cannot read/;
const KEEP_PAIR = `  old_x constant text := 'and ${ARM}';\n  new_x constant text := 'and case when y = ''z'' ${ARM} else false end';`;
const OK_PAIR = `  old_ok constant text := 'unrelated';\n  new_ok constant text := 'unrelated';`;
const RUN_X = `  execute replace(v, old_x, new_x);`;
mustCatch('a $o$/$n$-quoted pair that drops the served-raw call (judged, not merely unreadable)', REMOVES.test(diag(patchQ(`  old_x constant text := $o$${ARM}$o$;\n  new_x constant text := $n$then true$n$;`, RUN_X))));
mustCatch("a '…'-quoted pair that drops the served-raw call (judged)", REMOVES.test(diag(patchQ(`  old_x constant text := '${ARM}';\n  new_x constant text := 'then true';`, RUN_X))));
mustCatch("a declared empty replacement new_drop := '' that drops the call (judged)", REMOVES.test(diag(patchQ(`  old_drop constant text := 'and case when y ${ARM} else false end';\n  new_drop constant text := '';`, `  execute replace(v, old_drop, new_drop);`))));
mustCatch('an unrelated readable pair, then an inline-literal replace that removes the call', /cannot read[\s\S]*field_integrity_served_raw/.test(diag(patchQ(OK_PAIR, `  v := replace(v, old_ok, new_ok);\n  v := replace(v, 'public.field_integrity_served_raw(x.tableoid, x.id, coalesce(x.price_total, x.price_annual))', 'true');\n  execute v;`))));
mustCatch("an unrelated readable pair, then a bare deletion replace(v, old_drop, '')", /deletes body text outside a length\(\) count/.test(diag(patchQ(`${OK_PAIR}\n  old_drop constant text := 'and case when y ${ARM} else false end';`, `  v := replace(v, old_ok, new_ok);\n  v := replace(v, old_drop, '');\n  execute v;`))));
mustCatch("an unrelated readable pair, then new_drop declared with an initializer the reader cannot parse ('true'::text)", /cannot read[\s\S]*new_drop/.test(diag(patchQ(`${OK_PAIR}\n  old_drop constant text := $a$${ARM}$a$;\n  new_drop constant text := ('true'::text);`, `  v := replace(v, old_ok, new_ok);\n  v := replace(v, old_drop, new_drop);\n  execute v;`))));
mustCatch('a constant whose initializer is a concatenation (not one whole literal)', /cannot read[\s\S]*new_x/.test(diag(patchQ(`  old_x constant text := 'and ${ARM}';\n  new_x constant text := 'and ' || 'true';`, RUN_X))));
mustCatch('a replace whose replacement argument is a concatenation', UNREADABLE.test(diag(patchQ(KEEP_PAIR, `  execute replace(v, old_x, new_x || 'c');`))));
mustCatch('a replace nested inside another expression the reader cannot split', UNREADABLE.test(diag(patchQ(KEEP_PAIR, `  execute replace(upper(v), old_x, new_x);`))));
mustPass("a '…'-quoted pair that keeps the call (with a '' escape)", diag(patchQ(KEEP_PAIR, RUN_X)) === '');
mustPass("the match-count idiom length(replace(v, old_x, '')) beside a pair that keeps the call", diag(patchQ(KEEP_PAIR, `  n := (length(v) - length(replace(v, old_x, ''))) / length(old_x);\n${RUN_X}`)) === '');
const ALTERS = /alters production safeguard text/;
mustCatch("a PARTIAL replacement «then true or public.field_integrity_served_raw» that keeps the call text but disables it", ALTERS.test(diag(patchQ(`  old_part constant text := 'then public.field_integrity_served_raw';\n  new_part constant text := 'then true or public.field_integrity_served_raw';`, `  execute replace(v, old_part, new_part);`))));
mustCatch("a partial replacement that flips the clause's «and case» to «or case»", ALTERS.test(diag(patchQ(`  old_p constant text := 'and case when greatest';\n  new_p constant text := 'or case when greatest';`, `  execute replace(v, old_p, new_p);`))));
mustCatch('a partial replacement that turns «else false end» into «else true end»', ALTERS.test(diag(patchQ(`  old_p constant text := 'else false end';\n  new_p constant text := 'else true end';`, `  execute replace(v, old_p, new_p);`))));
mustCatch('a partial replacement inside the skipped-table resolve', ALTERS.test(diag(patchQ(`  old_p constant text := 'and resolved_at is null';\n  new_p constant text := 'and false';`, `  execute replace(v, old_p, new_p);`))));
mustPass('a patch whose old text is not in any safeguard (an unrelated arm) passes replay', !ALTERS.test(diag(patchQ(`  old_p constant text := 'bedrooms > 1000';\n  new_p constant text := 'bedrooms > 2000';`, `  execute replace(v, old_p, new_p);`))));
// the reference is pinned to what production was measured to run — editing it is a deliberate, visible act
mustPass('ARMS_REFERENCE is the production-measured text (md5 pin)', createHash('md5').update(norm(ARMS_REFERENCE)).digest('hex') === ARMS_REFERENCE_MD5);
mustPass('the unpatched production arms judge clean', armDamage(norm(ARMS_REFERENCE)).length === 0);
const CROSS = (o: string, n: string) => diag(patchQ(`  old_p constant text := '${o}';\n  new_p constant text := '${n}';`, `  execute replace(v, old_p, new_p);`));
mustCatch("CodeRabbit's boundary-crossing edit «else false end),» → «else false end or true),» (phone arm)", /phone\/ID arm gained a top-level OR/.test(CROSS('else false end),', 'else false end or true),')));
mustCatch('a boundary-crossing «or true» appended to the magnitude arm before its final «))»', /extreme-magnitude arm gained a top-level OR/.test(CROSS('<= 500000))', '<= 500000) or true)')));
mustCatch('an «or true» inserted ahead of the guard clause', /gained a top-level OR/.test(CROSS('and case when greatest', 'or true and case when greatest')));
mustCatch('an edit that splices the two arms together', /no longer two separate filters/.test(CROSS('else false end), count(*) filter (where active and (', 'else false end and (')));
mustPass('a nested «or» inside the arm (a new band in the phone list) is not a top-level OR', !/gained a top-level OR/.test(CROSS('or price_annual between 500000000 and 599999999)', 'or price_annual between 500000000 and 599999999 or price_annual between 900000000 and 900000001)')));
if (bad) process.exit(1);

const files = readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), 'utf8') }));
const p = problems(files);
if (p.length) { for (const x of p) console.error('✗ ' + x); process.exit(1); }
console.log(`✓ field_integrity scan: zero-area safe and never silent (${cases.length} mutation proofs)`);
