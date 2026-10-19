// PERMANENT BARRIER — a detector must never mark a real finding "resolved" because it could not see
// it (2026-09-25, routine-2-production).
//
// THE MECHANISM. `mon_resolve_stale_keys(kind, live_keys)` is the repo's "evaluated path" idiom: the
// cohort that raises is the cohort that resolves, so a row that was fixed goes GREEN by itself.
//
//     update public.alert_event set resolved_at = now()
//      where kind = p_kind and resolved_at is null
//        and not (dedup_key = any (coalesce(p_live_keys, '{}'::text[])))
//
// It resolves every open key of the kind that is ABSENT from live_keys. That is correct when
// live_keys is the whole cohort — and silently wrong the moment the scan that built it carried a
// LIMIT, because a row cut off by the LIMIT is absent for a reason that is not "it was fixed". The
// sweep cannot tell those two apart, so it declares the overflow fixed without looking at it.
// Silence would be bad; a false all-clear is worse, and it is indistinguishable afterwards.
//
// HOW IT WAS FOUND, and how close it was. On 2026-09-25 at 00:59 the owner's 2026-09-24 rule ("if a
// website goes down and it's the problem there, we immediately hide their listings") put 151
// intentionally-hidden rows from three dormant platforms into the cohort of
// mon_detect_located_row_unreachable(), which scans `limit 200`. Cohort 154 of 200 — and the ONLY
// genuine finding in it, wasalt_residential_listings 12915861, sorted at row 154 of 154. Forty-six
// more dormant rows and a real unreachable listing would have been RESOLVED rather than reported.
//
// WHY A GREP WOULD HAVE LIED, twice, and why this checks a narrower shape than "has a LIMIT".
// Ten detectors pair mon_resolve_stale_keys() with a literal LIMIT. Eight are NOT vulnerable, and the
// two that read as vulnerable to a crude rule are the instructive ones — both were flagged by the
// first pass of this very check and cleared by READING them:
//
//   mon_detect_agent_health            appends CONSTANT keys (array['agent_failure_rate']); its
//                                      `limit 5` caps a jsonb payload subquery. Key set size 2.
//   mon_detect_adjudicated_reactivation raises ONE key per day ('adjudicated_reactivation:' ||
//                                      current_date); its `limit 200` truncates the row list inside
//                                      the payload. A short payload under-reports; it resolves
//                                      nothing real.
//
// So the dangerous shape is not "a LIMIT" — it is a PER-ROW key set accumulated inside a CAPPED scan.
// The rule below requires all three: a loop whose SELECT carries a cap, a live_keys append that
// references that loop's record variable, and an unguarded sweep. Constant-key and single-key
// detectors are outside it by construction, not by exemption.
//
// The guard a capped detector must carry: count the cohort WITHOUT the window, sweep only when it
// fit, and otherwise RAISE — a checker that cannot see its whole cohort must say so
// (docs/ops/LISTING_LIVENESS.md §9: a checker's silence must be an alarm). Raising the cap instead
// moves the blind spot; it does not remove it.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const MIGRATIONS = join(root, 'supabase', 'migrations');

/** Detectors known to carry the shape and not yet guarded. SHRINK-ONLY: a name may leave, never
 *  join. It is EMPTY, and that is the whole point — both members were fixed the day the class was
 *  found (20260925062556, 20260925063035). A name appearing here again means someone shipped a
 *  capped per-row detector that can resolve a finding it never looked at. */
const KNOWN_UNGUARDED: readonly string[] = [];
const UNGUARDED_CEILING = 0;

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');

/** The LATEST committed definition of every `mon_detect_*` function, by migration version order.
 *  A later migration replacing a function wins, exactly as production resolves it. */
export function latestDetectorBodies(files: { file: string; sql: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const { sql } of [...files].sort((a, b) => a.file.localeCompare(b.file))) {
    const re = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?(mon_detect_[a-z0-9_]+)\s*\(/gi;
    for (let m = re.exec(sql); m; m = re.exec(sql)) {
      const tag = /\$([A-Za-z_]*)\$/.exec(sql.slice(m.index));
      if (!tag) continue;
      const open = m.index + tag.index + tag[0].length;
      const close = sql.indexOf(tag[0], open);
      if (close === -1) continue;
      out.set(m[1].toLowerCase(), sql.slice(open, close));
    }
  }
  return out;
}

/** Does this function body accumulate a PER-ROW key set inside a CAPPED scan and then sweep without
 *  an overflow guard? All three conditions, or it is not this defect. */
export function resolvesByTruncation(rawBody: string): boolean {
  const body = stripComments(rawBody);

  if (!/\bmon_resolve_stale_keys\b/i.test(body)) return false;

  // An overflow guard: the cohort is counted outside the window and compared against it before the
  // sweep. Named by the shape both fixes use, so a copy of either passes and a body that merely
  // mentions a limit does not.
  const guarded = /\bcohort_total\b/i.test(body) && /<=\s*window_limit\b/i.test(body);
  if (guarded) return false;

  // Every `for <rec> in <select …> loop … end loop;` span.
  const loopRe = /\bfor\s+([a-z_][a-z0-9_]*)\s+in\b([\s\S]*?)\bloop\b([\s\S]*?)\bend\s+loop\s*;/gi;
  for (let m = loopRe.exec(body); m; m = loopRe.exec(body)) {
    const [, recVar, header, loopBody] = m;

    // Is the scan feeding this loop capped at all? A named cap (`limit window_limit`) counts, so the
    // check cannot be evaded by moving the number into a variable.
    if (!/\blimit\s+(\d+|[a-z_][a-z0-9_]*)/i.test(header)) continue;

    // Does the loop build the key set FROM THE ROW? A constant append (array['agent_latency']) is a
    // fixed-size key set and cannot be truncated.
    const appendRe = /live_keys\s*:=\s*live_keys\s*\|\|([\s\S]*?);/gi;
    for (let a = appendRe.exec(loopBody); a; a = appendRe.exec(loopBody)) {
      if (new RegExp(`\\b${recVar}\\s*\\.`, 'i').test(a[1])) return true;
    }
  }
  return false;
}

let failures = 0;
const fail = (msg: string) => { failures++; console.error(`❌ ${msg}`); };

function mustCatch(what: string, held: () => boolean) {
  if (held()) console.log(`  ✓ ${what}`);
  else fail(`MUTATION SURVIVED — ${what}`);
}

// ── the live repo ────────────────────────────────────────────────────────────────────────────────
const files = readdirSync(MIGRATIONS)
  .filter(f => f.endsWith('.sql'))
  .map(f => ({ file: f, sql: readFileSync(join(MIGRATIONS, f), 'utf8') }));

const bodies = latestDetectorBodies(files);
if (bodies.size === 0) fail('no mon_detect_* definitions found in supabase/migrations — parser broke');

const offenders = [...bodies.entries()]
  .filter(([, body]) => resolvesByTruncation(body))
  .map(([name]) => name)
  .sort();

console.log(`\nscanned ${bodies.size} committed mon_detect_* definitions`);

for (const name of offenders) {
  if (!KNOWN_UNGUARDED.includes(name)) {
    fail(`${name}() accumulates a per-row dedup key inside a CAPPED scan and then calls `
       + `mon_resolve_stale_keys() unconditionally. Every open alert of its kind past the cap will be `
       + `marked resolved without being looked at. Count the cohort without the window, sweep only `
       + `when it fit, and RAISE otherwise — see supabase/migrations/20260925062556_*.sql.`);
  }
}
for (const stale of KNOWN_UNGUARDED.filter(n => !offenders.includes(n))) {
  fail(`${stale} is in KNOWN_UNGUARDED but is now guarded (or gone). Remove it — a ratchet that `
     + `reads worse than reality hides the next real one.`);
}
if (KNOWN_UNGUARDED.length > UNGUARDED_CEILING) {
  fail(`KNOWN_UNGUARDED has ${KNOWN_UNGUARDED.length} entries, ceiling ${UNGUARDED_CEILING}. `
     + `The baseline is shrink-only.`);
}

// ── the rule, mutation-proven against the real shapes it must separate ───────────────────────────
const CAPPED_PER_ROW = `
declare rec record; live_keys text[] := '{}';
begin
  for rec in select s.source_table, s.listing_id from search_listings_ar s
             order by s.source_table limit 200
  loop
    live_keys := live_keys || ('k:' || rec.source_table || ':' || rec.listing_id::text);
  end loop;
  perform public.mon_resolve_stale_keys('k', live_keys);
end`;

mustCatch('the shipped defect shape (per-row keys, capped scan, unguarded sweep) is CAUGHT',
  () => resolvesByTruncation(CAPPED_PER_ROW));

mustCatch('the guarded fix PASSES',
  () => !resolvesByTruncation(`
declare rec record; live_keys text[] := '{}'; window_limit constant int := 200; cohort_total int;
begin
  select count(*) into cohort_total from search_listings_ar;
  for rec in select s.source_table, s.listing_id from search_listings_ar s limit window_limit
  loop live_keys := live_keys || ('k:' || rec.source_table); end loop;
  if cohort_total <= window_limit then
    perform public.mon_resolve_stale_keys('k', live_keys);
  else
    perform public.mon_raise('P1','k_truncated','all','k_truncated:fleet','{}'::jsonb);
  end if;
end`));

mustCatch('naming the cap in a variable does not evade the rule (limit window_limit, NO guard)',
  () => resolvesByTruncation(CAPPED_PER_ROW.replace('limit 200', 'limit window_limit')));

mustCatch('an UNCAPPED per-row loop is not flagged — nothing can be truncated',
  () => !resolvesByTruncation(CAPPED_PER_ROW.replace('limit 200', '')));

mustCatch('mon_detect_agent_health\'s CONSTANT key appends are not flagged (real false positive)',
  () => !resolvesByTruncation(`
declare live_keys text[] := '{}'; rec record;
begin
  for rec in select o outcome from public.agent_health_event group by outcome limit 5
  loop
    live_keys := live_keys || array['agent_failure_rate'];
  end loop;
  perform public.mon_resolve_stale_keys('agent_health', live_keys);
end`));

mustCatch('a SINGLE daily key with a truncated payload is not flagged (adjudicated_reactivation)',
  () => !resolvesByTruncation(`
declare v_key text := 'adjudicated_reactivation:' || current_date; v_count int;
begin
  with shaped as (select tbl, listing_id from sib limit 200)
  select count(*) into v_count from shaped;
  perform public.mon_resolve_stale_keys('adjudicated_reactivation',
    case when v_count > 0 then array[v_key] else '{}'::text[] end);
end`));

mustCatch('a detector that never sweeps is outside this rule',
  () => !resolvesByTruncation(CAPPED_PER_ROW.replace(/perform public\.mon_resolve_stale_keys[^;]*;/, '')));

mustCatch('the parser takes the LATEST definition of a redefined detector',
  () => {
    const got = latestDetectorBodies([
      { file: '20260101000000_a.sql', sql: 'create function public.mon_detect_x() returns int as $$ OLD $$;' },
      { file: '20260202000000_b.sql', sql: 'create or replace function public.mon_detect_x() returns int as $$ NEW $$;' },
    ]);
    return got.get('mon_detect_x')?.trim() === 'NEW';
  });

console.log(failures === 0
  ? '\n✅ no detector can resolve a finding it never looked at.'
  : `\n❌ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
