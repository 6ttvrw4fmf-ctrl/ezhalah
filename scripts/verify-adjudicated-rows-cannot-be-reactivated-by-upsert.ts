// AN ADJUDICATED RETRACTION SURVIVES THE CRAWL UPSERT, NOT ONLY THE RECOVERY JOB.
//
// THE DEFECT THIS PINS (2026-11-09, alert_event 13940 adjudicated_reactivation). Four rows in
// ops_adjudicated_listing were ACTIVE again: dealapp_residential_listings 22045812 (retracted 11-04,
// wrong-table sibling — the source still says «استخدامات العقار: تجاري») and three gathern units
// retracted on own-page 404s. auto_recover_false_inactive() was innocent — it has carried the
// ops_adjudicated_listing exemption since 20260830193119. The writer with NO exemption was the
// scraper upsert: every platform's payload writes active=true, so a feed that lists the id (a
// CANDIDATE signal, never a verdict — docs/ops/LISTING_LIVENESS.md) overwrote a recorded decision,
// nightly. verify-adjudication-is-never-undone.ts pins that the recovery job honours the ledger; it
// says nothing about the dozens of other writers. This file pins the guard that sits where ALL of
// them pass: a BEFORE UPDATE trigger on every listing table.
//
// THE RULE, as pinned on the latest committed definition (code only, mutation-proven):
//   · tg_keep_adjudicated_hidden() reads the ONE union view ops_adjudicated_listing — never a single
//     ledger (the same rule verify-adjudication-is-never-undone.ts enforces on the recovery job);
//   · it honours ops_adjudication_superseded (own page read live after the adjudication = the source
//     republished it, so the flip is honest);
//   · it refuses by setting new.active := false and LOGS the refusal (so the detector can tell "the
//     guard held" from "nothing tried"); it never raises, never deactivates an already-active row;
//   · it is attached to every `_(residential|commercial)_listings$` table on the false→true flip only
//     (WHEN clause), so ordinary upserts of active rows pay nothing;
//   · mon_detect_adjudication_guard_missing() re-measures attachment from pg_trigger every sweep and
//     is in the roster in the SAME migration.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const FN = 'tg_keep_adjudicated_hidden';
const TRIGGER = 'trg_keep_adjudicated_hidden';
const DETECTOR = 'mon_detect_adjudication_guard_missing';
const VIEW = 'ops_adjudicated_listing';
const LEDGERS = ['ops_adjudicated_retraction', 'ops_res_com_collision_adjudication'];

const codeOnly = (sql: string) =>
  sql.replace(/^\s*--.*$/gm, '').replace(/\s--.*$/gm, '').replace(/comment on [\s\S]*?;\s*/gi, '');

function latestDefining(files: Record<string, string>, fn: string): string | undefined {
  return Object.keys(files)
    .filter((f) => new RegExp(`function\\s+public\\.${fn}\\s*\\(`).test(files[f]))
    .sort().slice(-1)[0];
}

export function guardProblems(files: Record<string, string>): string[] {
  const bad: string[] = [];
  const file = latestDefining(files, FN);
  if (!file) return [`no committed migration defines public.${FN}()`];
  const sql = codeOnly(files[file]);
  const start = sql.indexOf(`function public.${FN}(`);
  const end = sql.indexOf('$$;', sql.indexOf('$$', start) + 2);
  const body = sql.slice(start, end > 0 ? end : undefined);
  const need = (label: string, re: RegExp, text = body) => { if (!re.test(text)) bad.push(`${file}: ${label}`); };

  need(`the guard does not read ${VIEW} (the one union view every consumer must use)`,
    new RegExp(`from\\s+public\\.${VIEW}\\s+\\w+`));
  for (const ledger of LEDGERS) {
    if (new RegExp(`\\b${ledger}\\b`).test(body)) bad.push(`${file}: the guard reaches past ${VIEW} to ${ledger} — the next ledger would be silently uncovered`);
  }
  need('the guard does not honour ops_adjudication_superseded (a republished listing could never come back)',
    /from\s+public\.ops_adjudication_superseded\s+\w+[\s\S]{0,200}?return new/);
  need('the guard does not refuse the flip by setting new.active := false', /new\.active\s*:=\s*false/);
  need('the refusal is not logged to ops_adjudicated_reactivation_blocked',
    /insert into public\.ops_adjudicated_reactivation_blocked/);
  need('the guard must return new, never raise (a raise would abort the whole crawl batch)', /return new;\s*end/);
  if (/raise\s+exception/i.test(body)) bad.push(`${file}: the guard raises — one adjudicated row would abort a whole upsert batch`);

  // Attachment: every listing table, false→true flip only.
  need('the attach loop does not select every _(residential|commercial)_listings$ table',
    /for t in\s+select tablename from pg_tables\s+where schemaname = 'public' and tablename\s*~\s*'_\(residential\|commercial\)_listings\$'/, sql);
  need(`the trigger is not created as ${TRIGGER} BEFORE UPDATE with the false→true WHEN clause`,
    new RegExp(`create trigger ${TRIGGER} before update on public\\.%I\\s*'\\s*'for each row when \\(old\\.active is not true and new\\.active is true\\)`), sql);

  // Detector + roster in the same migration.
  need(`${DETECTOR} is not defined in the same migration`, new RegExp(`function public\\.${DETECTOR}\\(`), sql);
  need(`${DETECTOR} is not spliced into mon_run_all_detectors in the same migration`,
    new RegExp(`mon_run_all_detectors[\\s\\S]*?replace\\(src,[\\s\\S]{0,200}?'${DETECTOR}',`), sql);
  need('the detector must measure from pg_trigger, not from a list', /from pg_trigger tg/, sql);
  return bad;
}

function load(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(MIGRATIONS)) if (f.endsWith('.sql')) out[f] = readFileSync(join(MIGRATIONS, f), 'utf8');
  return out;
}

const files = load();
const real = guardProblems(files);
let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ❌ ${m}`); };
const ok = (m: string) => console.log(`  ✓ ${m}`);
console.log('verify-adjudicated-rows-cannot-be-reactivated-by-upsert');
if (real.length) for (const p of real) fail(p); else ok('the guard reads the view, honours supersession, refuses by flipping back, logs, is attached everywhere, and is watched');

const file = latestDefining(files, FN)!;
const mustCatch = (what: string, mutate: (s: string) => string) => {
  const mutated = mutate(files[file]);
  if (mutated === files[file]) { fail(`MUTATION ${what}: the mutation did not change the file (stale test)`); return; }
  const caught = guardProblems({ ...files, [file]: mutated }).length > real.length;
  if (caught) ok(`MUTATION ${what} — caught`); else fail(`MUTATION ${what} — NOT caught`);
};
mustCatch('the guard reads one ledger instead of the view', (s) => s.replace(`from public.${VIEW} j`, 'from public.ops_adjudicated_retraction j'));
mustCatch('the superseded check is removed', (s) => s.replace(/\s*if exists \(select 1 from public\.ops_adjudication_superseded s[\s\S]*?end if;\n/, '\n'));
mustCatch('the guard forgets to flip active back', (s) => s.replace('new.active := false;', 'perform 1;'));
mustCatch('the refusal is no longer logged', (s) => s.replace(/\s*insert into public\.ops_adjudicated_reactivation_blocked[\s\S]*?;\n/, '\n'));
mustCatch('the guard raises instead of returning', (s) => s.replace('new.active := false;', "raise exception 'adjudicated';"));
mustCatch('the WHEN clause is widened to every update', (s) => s.replace('for each row when (old.active is not true and new.active is true) ', 'for each row '));
mustCatch('the attach loop narrows to residential tables only', (s) => s.replace("tablename ~ '_(residential|commercial)_listings$'", "tablename ~ '_residential_listings$'"));
mustCatch('the detector is dropped from the roster splice', (s) => s.replace(`'mon_detect_run_duration_explosion',\n    '${DETECTOR}',`, "'mon_detect_run_duration_explosion',"));
{
  const later = '29991231000000_a_later_migration_redefines_the_guard.sql';
  const blind = `create or replace function public.${FN}() returns trigger language plpgsql as $$ begin return new; end $$;`;
  const caught = guardProblems({ ...files, [later]: blind }).length > real.length;
  if (caught) ok('MUTATION a later migration redefines the guard as a no-op — caught');
  else fail('MUTATION a later migration redefines the guard as a no-op — NOT caught');
}
{
  const caught = guardProblems({}).length > 0;
  if (caught) ok('no committed definition at all fails CLOSED'); else fail('no committed definition read as fine');
}

if (failures) {
  console.log(`\n❌ verify-adjudicated-rows-cannot-be-reactivated-by-upsert: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ verify-adjudicated-rows-cannot-be-reactivated-by-upsert: a recorded decision outlives the feed.');
