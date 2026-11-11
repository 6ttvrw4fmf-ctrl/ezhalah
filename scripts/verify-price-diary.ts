// EVERY AD'S PRICES AND DATES ARE KEPT FOREVER (owner, 2026-11-11 — docs/ARCHITECTURE.md §20, AGENTS.md).
//
// The price diary (listing_price_history) and the comparables card (listing_comparables) are written by ONE trigger
// function, tg_listing_price_diary(), attached to every listing table. Nothing else records a price change: the scrapers
// overwrite price_total in place, so a diary that stops writing loses that history FOR GOOD — and nothing on screen would
// show it. This pins, on the LATEST committed definitions (code only, mutation-proven):
//   · the trigger logs a 'price' line with the OLD and the NEW price, and 'gone' / 'back' on an active flip;
//   · it logs 'removed' on DELETE and finalises the card with removed_at — the card outlives the ad;
//   · an ad with no card yet opens its card from the OLD row (first price = the price before the change);
//   · it NEVER raises (one bad row must not abort a scraper batch or a retention delete) — errors are swallowed into
//     listing_price_diary_errors;
//   · the attach loop covers every _(residential|commercial)_listings$ table, with insert / update / delete triggers and
//     an update WHEN clause on price_total, price_annual AND active;
//   · mon_detect_price_diary_health() measures attachment from pg_trigger, raises on swallowed errors, and is spliced
//     into mon_run_all_detectors in the same migration.
// Production behaviour was proven 2026-11-11 by a rolled-back transaction on a real aqar row:
//   events=price>gone>price>back>removed, card first=220000 last=220000 removed=true, errors=0.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const TG = 'tg_listing_price_diary';
const ATTACH = 'listing_price_diary_attach';
const DETECTOR = 'mon_detect_price_diary_health';
const MISSING = 'mon_price_diary_missing';

const codeOnly = (sql: string) =>
  sql.replace(/^\s*--.*$/gm, '').replace(/\s--.*$/gm, '').replace(/comment on [\s\S]*?;\s*/gi, '');

function latestDefining(files: Record<string, string>, fn: string): string | undefined {
  return Object.keys(files)
    .filter((f) => new RegExp(`function\\s+public\\.${fn}\\s*\\(`).test(files[f]))
    .sort().slice(-1)[0];
}

function bodyOf(files: Record<string, string>, fn: string): { file?: string; body: string; sql: string } {
  const file = latestDefining(files, fn);
  if (!file) return { body: '', sql: '' };
  const sql = codeOnly(files[file]);
  const start = sql.indexOf(`function public.${fn}(`);
  const open = sql.indexOf('$$', start);
  const end = sql.indexOf('$$', open + 2);
  return { file, body: sql.slice(start, end > 0 ? end : undefined), sql };
}

export function diaryProblems(files: Record<string, string>): string[] {
  const bad: string[] = [];
  const tg = bodyOf(files, TG);
  if (!tg.file) return [`no committed migration defines public.${TG}()`];
  const need = (label: string, re: RegExp, text: string, file?: string) => { if (!re.test(text)) bad.push(`${file}: ${label}`); };
  const b = tg.body;
  need("a price change does not write a 'price' line with old AND new prices",
    /values \(TG_TABLE_NAME, new\.id, 'price', new\.price_total, new\.price_annual, old\.price_total, old\.price_annual\)/, b, tg.file);
  need('the price change is not detected on both price_total and price_annual',
    /old\.price_total is distinct from new\.price_total or old\.price_annual is distinct from new\.price_annual/, b, tg.file);
  need("an active flip does not write 'gone' / 'back'",
    /old\.active is distinct from new\.active[\s\S]{0,300}?case when new\.active is true then 'back' else 'gone' end/, b, tg.file);
  need("a DELETE does not write a 'removed' line", /TG_OP = 'DELETE'[\s\S]{0,200}?'removed'/, b, tg.file);
  need('a DELETE does not finalise the card with removed_at (the card would not outlive the ad)',
    /to_jsonb\(old\),\s*coalesce\(old\.deactivated_at, now\(\)\), now\(\), false\)/, b, tg.file);
  need('a new ad (INSERT) does not write a first line', /TG_OP = 'INSERT'[\s\S]{0,200}?'first'/, b, tg.file);
  need('an ad without a card does not open it from the OLD row (its first price would be the price after the change)',
    /if not exists \(select 1 from public\.listing_comparables[\s\S]{0,200}?listing_card_upsert\(TG_TABLE_NAME, to_jsonb\(old\)/, b, tg.file);
  need('errors are not swallowed into listing_price_diary_errors (one bad row would abort a scraper batch)',
    /exception when others then[\s\S]{0,200}?insert into public\.listing_price_diary_errors/, b, tg.file);
  if (/raise\s+exception/i.test(b)) bad.push(`${tg.file}: the trigger raises — one bad row would abort a whole upsert batch or retention delete`);

  const at = bodyOf(files, ATTACH);
  if (!at.file) bad.push(`no committed migration defines public.${ATTACH}()`);
  else {
    for (const kind of ['insert', 'update', 'delete'])
      need(`the attach function does not create the after ${kind} trigger`,
        new RegExp(`create trigger trg_listing_price_diary_${kind.slice(0, 3)} after ${kind} on public\\.%I`), at.body, at.file);
    need('the update trigger WHEN clause does not watch price_total, price_annual AND active',
      /old\.price_total is distinct from new\.price_total '\s*'or old\.price_annual is distinct from new\.price_annual '\s*'or old\.active is distinct from new\.active\)/, at.body, at.file);
    need('the attach loop does not cover every _(residential|commercial)_listings$ table',
      new RegExp(`tablename ~ '_\\(residential\\|commercial\\)_listings\\$'\\s*loop\\s*perform public\\.${ATTACH}\\(t\\)`), at.sql, at.file);
  }

  const det = bodyOf(files, DETECTOR);
  const miss = bodyOf(files, MISSING);
  if (!det.file) bad.push(`no committed migration defines public.${DETECTOR}()`);
  else {
    need('the detector does not raise on swallowed errors', /from public\.listing_price_diary_errors/, det.body, det.file);
    need(`the detector is not spliced into mon_run_all_detectors in the same migration`,
      new RegExp(`mon_run_all_detectors[\\s\\S]*?replace\\(src,[\\s\\S]{0,200}?'${DETECTOR}',`), det.sql, det.file);
  }
  if (!miss.file) bad.push(`no committed migration defines public.${MISSING}()`);
  else need('attachment is not measured from pg_trigger', /from pg_trigger tg/, miss.body, miss.file);
  return bad;
}

function load(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(MIGRATIONS)) if (f.endsWith('.sql')) out[f] = readFileSync(join(MIGRATIONS, f), 'utf8');
  return out;
}

const files = load();
const real = diaryProblems(files);
let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ❌ ${m}`); };
const ok = (m: string) => console.log(`  ✓ ${m}`);
console.log('verify-price-diary');
if (real.length) for (const p of real) fail(p);
else ok('price changes, gone/back and removals are written with their dates, cards outlive the ad, the trigger never raises, and it is watched');

const tgFile = latestDefining(files, TG)!;
const attachFile = latestDefining(files, ATTACH)!;
const detFile = latestDefining(files, DETECTOR)!;
const mustCatch = (what: string, file: string, mutate: (s: string) => string) => {
  const mutated = mutate(files[file]);
  if (mutated === files[file]) { fail(`MUTATION ${what}: the mutation did not change the file (stale test)`); return; }
  const caught = diaryProblems({ ...files, [file]: mutated }).length > real.length;
  if (caught) ok(`MUTATION ${what} — caught`); else fail(`MUTATION ${what} — NOT caught`);
};
mustCatch('the old price is no longer logged', tgFile, (s) => s.replace(', old.price_total, old.price_annual)', ', null, null)'));
mustCatch('only price_total changes are noticed', tgFile, (s) => s.replace(/if old\.price_total is distinct from new\.price_total or old\.price_annual is distinct from new\.price_annual then/, 'if old.price_total is distinct from new.price_total then'));
mustCatch("'gone'/'back' are no longer logged", tgFile, (s) => s.replace("case when new.active is true then 'back' else 'gone' end", "'price'"));
mustCatch('a delete no longer finalises the card', tgFile, (s) => s.replace('coalesce(old.deactivated_at, now()), now(), false)', 'coalesce(old.deactivated_at, now()), null, false)'));
mustCatch('the card opens from the NEW row', tgFile, (s) => s.replace(/(if not exists \(select 1 from public\.listing_comparables[\s\S]{0,200}?listing_card_upsert\(TG_TABLE_NAME, )to_jsonb\(old\)/, '$1to_jsonb(new)'));
mustCatch('errors are re-raised instead of swallowed', tgFile, (s) => s.replace("exception when others then\n    -- The diary must never break a scraper write or a retention delete.", "exception when others then\n    raise exception 'diary';"));
mustCatch('the delete trigger is no longer created', attachFile, (s) => s.replace("create trigger trg_listing_price_diary_del after delete on public.%I", "create trigger trg_listing_price_diary_del after truncate on public.%I"));
mustCatch('the WHEN clause stops watching active', attachFile, (s) => s.replace("'or old.active is distinct from new.active) '", "') '"));
mustCatch('the attach loop narrows to residential tables', attachFile, (s) => s.replace(/tablename ~ '_\(residential\|commercial\)_listings\$'(\s*loop\s*perform public\.listing_price_diary_attach)/, "tablename ~ '_residential_listings$'$1"));
mustCatch('the detector is dropped from the roster splice', detFile, (s) => s.replace(`    '${DETECTOR}',$q$);`, `$q$);`));
{
  const later = '29991231000000_a_later_migration_blinds_the_diary.sql';
  const blind = `create or replace function public.${TG}() returns trigger language plpgsql as $$ begin return new; end $$;`;
  if (diaryProblems({ ...files, [later]: blind }).length > real.length) ok('MUTATION a later migration redefines the trigger as a no-op — caught');
  else fail('MUTATION a later migration redefines the trigger as a no-op — NOT caught');
}
if (diaryProblems({}).length > 0) ok('no committed definition at all fails CLOSED'); else fail('no committed definition read as fine');

if (failures) {
  console.log(`\n❌ verify-price-diary: ${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\n✓ verify-price-diary: every price change and date is kept, and outlives the ad.');
