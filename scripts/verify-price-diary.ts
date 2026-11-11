// EVERY AD'S PRICES AND DATES ARE KEPT FOREVER (owner, 2026-11-11 — docs/ARCHITECTURE.md §20, AGENTS.md).
//
// The price diary (listing_price_history) and the comparables card (listing_comparables) are written by ONE trigger
// function, tg_listing_price_diary(), attached to every listing table. Nothing else records a price change: the scrapers
// overwrite price_total in place, so a diary that stops writing loses that history FOR GOOD — and nothing on screen would
// show it. This pins, on the LATEST committed definitions (code only, mutation-proven):
//   · the trigger logs a 'price' line with the OLD and the NEW price, and 'gone' / 'back' on an active flip;
//   · it logs 'removed' on DELETE, and every event queues the ad for its card (listing_card_queue);
//   · it has NO exception block: a per-row subtransaction overflows Postgres's 64-entry cache on a batch write
//     (CodeRabbit, PR #11776) — the trigger is two plain inserts and nothing else;
//   · the card is rebuilt OUT of the write path by listing_cards_refresh(): first price from the earliest diary line
//     (the OLD price of a first 'price' line), and a removed ad's card from purged_listings_archive with removed_at;
//   · a new listing table is connected at CREATE TABLE by an event trigger, before any write can reach it;
//   · the attach loop covers every _(residential|commercial)_listings$ table, with insert / update / delete triggers and
//     an update WHEN clause on price_total, price_annual AND active;
//   · listing_price_diary_attach() carries its own lock_timeout (it runs from the sweep);
//   · mon_detect_price_diary_health() measures attachment from pg_trigger, runs the card refresh, raises on errors or a
//     queue older than 6 hours, and is spliced into mon_run_all_detectors.
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
const REFRESH = 'listing_cards_refresh';
const BORN = 'listing_price_diary_born_attached';

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
  need("a DELETE does not write a 'removed' line", /else\s+insert into public\.listing_price_history[\s\S]{0,200}?'removed'/, b, tg.file);
  need('a new ad (INSERT) does not write a first line', /TG_OP = 'INSERT'[\s\S]{0,200}?'first'/, b, tg.file);
  const queued = (b.match(/insert into public\.listing_card_queue \(source_table, listing_id\) values \(TG_TABLE_NAME, (new|old)\.id\)/g) ?? []).length;
  if (queued < 3) bad.push(`${tg.file}: only ${queued} of insert / update / delete queue the ad for its card`);
  if (/\bexception\b/i.test(b)) bad.push(`${tg.file}: the trigger has an exception block — one subtransaction per fired row overflows the 64-entry cache on a batch write`);
  if (/listing_comparables/.test(b)) bad.push(`${tg.file}: the trigger writes the card itself — the card belongs out of the write path (listing_cards_refresh)`);

  const rf = bodyOf(files, REFRESH);
  if (!rf.file) bad.push(`no committed migration defines public.${REFRESH}()`);
  else {
    need('the refresh does not drain listing_card_queue', /delete from public\.listing_card_queue/, rf.body, rf.file);
    need("the card's first price is not the OLD price of a first 'price' line",
      /case when h\.event = 'price' then h\.old_price_total else h\.price_total end/, rf.body, rf.file);
    need('a removed ad does not get its card from purged_listings_archive with removed_at',
      /from public\.purged_listings_archive p[\s\S]*?removed_at = excluded\.removed_at/, rf.body, rf.file);
    need('the refresh swallows query_canceled (a timeout must fail the sweep loudly)', /exception when query_canceled then\s*raise;/, rf.body, rf.file);
  }
  const born = bodyOf(files, BORN);
  if (!born.file) bad.push(`no committed migration defines public.${BORN}()`);
  else {
    need('the CREATE TABLE hook does not attach the diary', new RegExp(`perform public\\.${ATTACH}\\(r\\.relname\\)`), born.body, born.file);
    if (/exception\s+when/i.test(born.body)) bad.push(`${born.file}: the CREATE TABLE hook swallows an attach error — a table the diary cannot read would be created and take writes unrecorded`);
    need('the CREATE TABLE hook does not refuse a table without id / price_total / price_annual / active',
      /raise exception 'listing table public\.% cannot be connected to the price diary/, born.body, born.file);
    const evt = /create event trigger listing_price_diary_born_attached on ddl_command_end\s*when tag in \('CREATE TABLE'/;
    if (!Object.values(files).some((v) => evt.test(codeOnly(v)))) bad.push('no committed migration creates the CREATE TABLE event trigger listing_price_diary_born_attached');
  }

  const at = bodyOf(files, ATTACH);
  if (!at.file) bad.push(`no committed migration defines public.${ATTACH}()`);
  else {
    for (const kind of ['insert', 'update', 'delete'])
      need(`the attach function does not create the after ${kind} trigger`,
        new RegExp(`create trigger trg_listing_price_diary_${kind.slice(0, 3)} after ${kind} on public\\.%I`), at.body, at.file);
    need('the update trigger WHEN clause does not watch price_total, price_annual AND active',
      /old\.price_total is distinct from new\.price_total '\s*'or old\.price_annual is distinct from new\.price_annual '\s*'or old\.active is distinct from new\.active\)/, at.body, at.file);
    need('the attach function has no lock_timeout of its own (from the sweep it could queue scraper writes)',
      /set lock_timeout to '\d+s'\s*as \$\$/, at.body + '$$', at.file);
    const loop = latestDefining(Object.fromEntries(Object.entries(files).filter(([, v]) => /loop\s*perform public\.listing_price_diary_attach\(t\)/.test(codeOnly(v)))), ATTACH);
    if (!loop || !/tablename ~ '_\(residential\|commercial\)_listings\$'\s*loop\s*perform public\.listing_price_diary_attach\(t\)/.test(codeOnly(files[loop])))
      bad.push('no committed attach loop covers every _(residential|commercial)_listings$ table');
  }

  const det = bodyOf(files, DETECTOR);
  const miss = bodyOf(files, MISSING);
  if (!det.file) bad.push(`no committed migration defines public.${DETECTOR}()`);
  else {
    need('the detector does not raise on swallowed errors', /from public\.listing_price_diary_errors/, det.body, det.file);
    need('the detector does not run the card refresh', new RegExp(`perform public\\.${REFRESH}\\(\\)`), det.body, det.file);
    need('the detector does not watch the queue age', /min\(at\) into oldest from public\.listing_card_queue/, det.body, det.file);
    const splice = Object.keys(files).sort().find((f) => new RegExp(`mon_run_all_detectors[\\s\\S]*?replace\\(src,[\\s\\S]{0,200}?'${DETECTOR}',`).test(codeOnly(files[f])));
    if (!splice) bad.push(`${DETECTOR} is not spliced into mon_run_all_detectors by any migration`);
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
else ok('price changes, gone/back and removals are written with their dates, the trigger is two plain inserts, cards are rebuilt out of the write path and outlive the ad, new tables connect at birth, and it is watched');

const tgFile = latestDefining(files, TG)!;
const attachFile = latestDefining(files, ATTACH)!;
const detFile = latestDefining(files, DETECTOR)!;
const rfFile = latestDefining(files, REFRESH)!;
const spliceFile = Object.keys(files).sort().find((f) => /replace\(src,[\s\S]{0,200}?'mon_detect_price_diary_health',/.test(files[f]))!;
const loopFile = Object.keys(files).sort().find((f) => /loop\s*perform public\.listing_price_diary_attach\(t\)/.test(files[f]))!;
const mustCatch = (what: string, file: string, mutate: (s: string) => string) => {
  const mutated = mutate(files[file]);
  if (mutated === files[file]) { fail(`MUTATION ${what}: the mutation did not change the file (stale test)`); return; }
  const caught = diaryProblems({ ...files, [file]: mutated }).length > real.length;
  if (caught) ok(`MUTATION ${what} — caught`); else fail(`MUTATION ${what} — NOT caught`);
};
mustCatch('the old price is no longer logged', tgFile, (s) => s.replace(', old.price_total, old.price_annual)', ', null, null)'));
mustCatch('only price_total changes are noticed', tgFile, (s) => s.replace(/if old\.price_total is distinct from new\.price_total or old\.price_annual is distinct from new\.price_annual then/, 'if old.price_total is distinct from new.price_total then'));
mustCatch("'gone'/'back' are no longer logged", tgFile, (s) => s.replace("case when new.active is true then 'back' else 'gone' end", "'price'"));
mustCatch('a delete no longer queues the card', tgFile, (s) => s.replace(/(values \(TG_TABLE_NAME, old\.id, 'removed'[\s\S]*?)insert into public\.listing_card_queue \(source_table, listing_id\) values \(TG_TABLE_NAME, old\.id\);/, '$1'));
mustCatch('a per-row exception block comes back', tgFile, (s) => s.replace("    return old;\n  end if;\nend", "    return old;\n  end if;\nexception when others then return new;\nend"));
mustCatch('the card moves back into the trigger', tgFile, (s) => s.replace("insert into public.listing_card_queue (source_table, listing_id) values (TG_TABLE_NAME, new.id);\n    return new;\n  elsif", "insert into public.listing_comparables (source_table, listing_id) values (TG_TABLE_NAME, new.id);\n    return new;\n  elsif"));
mustCatch("the card's first price becomes the NEW price", rfFile, (s) => s.replace("case when h.event = 'price' then h.old_price_total else h.price_total end", 'h.price_total'));
mustCatch('a removed ad is no longer read from the archive', rfFile, (s) => s.replace('removed_at = excluded.removed_at, updated_at = now()', 'updated_at = now()'));
mustCatch('the refresh swallows a timeout', rfFile, (s) => s.replace('exception when query_canceled then\n      raise;\n    when others then', 'exception when others then'));
mustCatch('the CREATE TABLE hook swallows attach errors again', latestDefining(files, BORN)!, (s) => s.replace('    perform public.listing_price_diary_attach(r.relname);\n  end loop;', '    begin perform public.listing_price_diary_attach(r.relname); exception when others then null; end;\n  end loop;'));
mustCatch('the CREATE TABLE hook stops refusing', latestDefining(files, BORN)!, (s) => s.replace("raise exception 'listing table public.% cannot be connected", "raise notice 'listing table public.% cannot be connected"));
mustCatch('the CREATE TABLE hook is dropped', Object.keys(files).sort().find((f) => /create event trigger listing_price_diary_born_attached/.test(files[f]))!, (s) => s.replace("create event trigger listing_price_diary_born_attached on ddl_command_end", "-- removed"));
mustCatch('the attach loses its lock_timeout', attachFile, (s) => s.replace(/(function public\.listing_price_diary_attach\(p_table text\)[\s\S]*?)set lock_timeout to '5s'\n/, '$1'));
mustCatch('the update WHEN clause stops watching active', attachFile, (s) => s.replace("'or old.active is distinct from new.active) '", "') '"));
mustCatch('the detector stops running the refresh', detFile, (s) => s.replace('perform public.listing_cards_refresh();', 'perform 1;'));
mustCatch('the detector stops watching the queue', detFile, (s) => s.replace('min(at) into oldest from public.listing_card_queue', 'now() into oldest'));
mustCatch('the attach loop narrows to residential tables', loopFile, (s) => s.replace(/tablename ~ '_\(residential\|commercial\)_listings\$'(\s*loop\s*perform public\.listing_price_diary_attach)/, "tablename ~ '_residential_listings$'$1"));
mustCatch('the detector is dropped from the roster splice', spliceFile, (s) => s.replace("    'mon_detect_price_diary_health',$q$);", '$q$);'));
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
