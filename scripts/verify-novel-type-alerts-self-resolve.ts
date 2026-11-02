// PERMANENT BARRIER — a novel-type alert must close itself when its raw type is gone (2026-11-02, 🔧 repair).
//
// detect_novel_property_types() (pg_cron jobid 33) INSERTS a novel_type_alerts row whenever an active
// listing carries a raw property_type outside known_property_types, or the index shows a type_ar outside
// known_type_ar. Until 20261102 it never set `resolved = true` on a raw-type row, so
// mon_detect_legacy_alert_tables() re-raised `legacy_novel_type` forever for types no active row carried
// any more. Measured 2026-11-02: 8 of the 16 open alerts were for raws with ZERO active rows (wasalt
// «شقة» n=58, «فيلا», «دور», «عمارة», …) — a monitor that cannot clear reads as a standing problem and
// buries the 8 real ones.
//
// ASSERTED, against the NEWEST committed migration that defines the function (the one production runs):
//   1. it resolves non-INVARIANT rows (`update … novel_type_alerts … set resolved = true` + `not like 'INVARIANT:%'`);
//   2. the resolve uses the SAME sets it raises from (_novel_raw and _novel_ar), so raise and resolve
//      cannot drift apart (§25a: resolve on the predicate that raises).
// Mutation-proven below: deleting the resolve, or resolving from a different predicate, is RED.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '..', 'supabase', 'migrations');
const defs = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
  .filter((f) => /create\s+or\s+replace\s+function\s+public\.detect_novel_property_types\s*\(/i
    .test(readFileSync(join(dir, f), 'utf8')));

export function problems(sql: string): string[] {
  const body = sql.replace(/--[^\n]*/g, '');
  const out: string[] = [];
  const m = body.match(/update\s+public\.novel_type_alerts\s+a\s+set\s+resolved\s*=\s*true([\s\S]*?);/i);
  if (!m) return ['no `update public.novel_type_alerts a set resolved = true` — raw-type alerts can never close'];
  const where = m[1];
  if (!/not\s+like\s+'INVARIANT:%'/i.test(where)) out.push("resolve does not exclude INVARIANT:* rows (they have their own resolvers)");
  if (!/from\s+_novel_raw\b/i.test(where)) out.push('resolve does not read _novel_raw — not the predicate that raises');
  if (!/from\s+_novel_ar\b/i.test(where)) out.push('resolve does not read _novel_ar — not the predicate that raises');
  if (!/for\s+rec\s+in\s+select[\s\S]*?from\s+_novel_raw/i.test(body)) out.push('raise no longer reads _novel_raw');
  if (!/for\s+rec\s+in\s+select[\s\S]*?from\s+_novel_ar/i.test(body)) out.push('raise no longer reads _novel_ar');
  return out;
}

let fail = 0;
if (defs.length === 0) { console.error('❌ no committed migration defines detect_novel_property_types()'); process.exit(1); }
const newest = defs[defs.length - 1];
const sql = readFileSync(join(dir, newest), 'utf8');
const p = problems(sql);
if (p.length) { console.error(`❌ ${newest}:\n  - ${p.join('\n  - ')}`); fail++; }

// mutation proofs — the predicate must catch both regressions
const noResolve = sql.replace(/update\s+public\.novel_type_alerts\s+a\s+set\s+resolved\s*=\s*true[\s\S]*?;/i, '');
const otherPredicate = sql.replace(/from\s+_novel_ar\s+y/i, 'from public.search_listings_ar y');
const mustCatch = (what: string, mutant: string) => {
  if (problems(mutant).length === 0) { console.error(`❌ mutation "${what}" was NOT caught`); fail++; }
};
mustCatch('resolve deleted', noResolve);
mustCatch('resolve off another predicate', otherPredicate);
if (fail) process.exit(1);
console.log(`✅ novel-type alerts self-resolve on the raising predicate (${newest}); 2 mutations caught`);
