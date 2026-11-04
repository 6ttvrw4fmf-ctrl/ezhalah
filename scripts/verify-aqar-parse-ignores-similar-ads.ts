// Regression guard — aqar_parse() must never take a price from another ad's «إعلانات مشابهة» card,
// and trg_aqar_parse() must never write a Buy price over the scraper's authoritative «no price».
// ⚡ Scraping Engineer, 2026-11-02 (alert 466, migration 20261102051729).
//
// THE BUG: on a page without the «تفاصيل الإعلان» block (aqar's soft-closed ad: «مغلق», no specs, no
// price), aqar_parse's head = split_part(txt,'تفاصيل الإعلان',1) was the WHOLE page, so its first
// currency-marked number was the first similar-ad card's price. trg_aqar_parse «fully owns Buy total»
// and overwrote the scraper's authoritative NULL with it: 32 served cards carried a neighbour's price
// (ad 6944911 / row 23096982 showed 2,040,000 = the card for «شارع وادي الأعشاب»).
//
// OFFLINE: reads only committed migrations. Every migration that (re)writes the head line or the
// trigger's per_meter guard is replayed in filename order; the LAST writer must carry both fixes.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { replayFunction } from './lib/rpcReplay.ts';

const DIR = 'supabase/migrations';
const OLD_HEAD = "head   := split_part(txt, 'تفاصيل الإعلان', 1);";
const CUT = "'إعلانات مشابهة', 1)";
const GUARD = "authoritative_absent', '') <> 'true'";

type F = { name: string; text: string };

export function problems(files: F[]): string[] {
  const out: string[] = [];
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name));
  // Writers of aqar_parse's head: a full body (contains the head assignment) or a needle replace.
  const headWriters = sorted.filter(f => /head\s+:=\s+split_part\(/.test(f.text) && /aqar_parse/.test(f.text));
  const lastHead = headWriters.at(-1);
  if (!lastHead) out.push('no committed migration writes aqar_parse head');
  else {
    // In a needle-replace file the old line appears as the search string; the result must carry the cut.
    const afterOld = lastHead.text.split(OLD_HEAD).slice(1).join('');
    const carries = lastHead.text.includes(CUT) && (!lastHead.text.includes(OLD_HEAD) || afterOld.includes(CUT));
    if (!carries) out.push(`last aqar_parse head writer ${lastHead.name} does not stop head at «إعلانات مشابهة»`);
  }
  // A WRITER defines the function (create or replace / a needle edit of its live body) — a file that only
  // MENTIONS trg_aqar_parse in a comment (20261104094019 does) writes nothing and must not be judged as one.
  const writesTrg = /create\s+or\s+replace\s+function\s+(public\.)?trg_aqar_parse\s*\(|pg_get_functiondef\(\s*'public\.trg_aqar_parse\(\)'/i;
  const trgWriters = sorted.filter(f => writesTrg.test(f.text) && /per_meter/.test(f.text));
  const lastTrg = trgWriters.at(-1);
  if (!lastTrg || !lastTrg.text.includes(GUARD))
    out.push(`last trg_aqar_parse writer ${lastTrg?.name ?? '(none)'} lets a parsed price overwrite authoritative_absent`);
  return out;
}

const files: F[] = readdirSync(DIR).filter(n => n.endsWith('.sql'))
  .map(name => ({ name, text: readFileSync(join(DIR, name), 'utf8') }));

let fail = 0;
// The body Postgres would hold after replaying every committed migration (full bodies AND needle edits).
const played = replayFunction(DIR, 'aqar_parse');
const code = (played.body ?? '').replace(/--.*$/gm, '');
if (played.unresolved.length || !/head\s*:=\s*split_part\(\s*split_part\(txt,\s*'تفاصيل الإعلان',\s*1\),\s*'إعلانات مشابهة',\s*1\)/.test(code)) {
  console.error(`✗ replayed aqar_parse does not cut head at «إعلانات مشابهة» (unresolved: ${played.unresolved.join(', ') || 'none'})`); fail++;
} else console.log('✓ replayed aqar_parse body cuts head at «إعلانات مشابهة»');
const real = problems(files);
for (const p of real) { console.error(`✗ ${p}`); fail++; }
if (!real.length) console.log('✓ aqar_parse stops at «إعلانات مشابهة» and trg_aqar_parse keeps the authoritative «no price»');

// Mutation proofs: each must be caught.
const mutants: [string, F[]][] = [
  ['a later migration restores the whole-page head', [...files, { name: '29991231000000_x.sql',
    text: `create or replace function public.aqar_parse(txt text) returns jsonb as $f$ begin ${OLD_HEAD} end $f$;` }]],
  ['the fix migration loses its cut', files.map(f => f.name.startsWith('20261102051729')
    ? { ...f, text: f.text.split(CUT).join("'x', 1)") } : f)],
  ['a later trigger rewrite drops the guard', [...files, { name: '29991231000001_y.sql',
    text: `create or replace function public.trg_aqar_parse() returns trigger as $f$ begin if p <> 'per_meter' then null; end if; end $f$;` }]],
];
const mustCatch = (label: string, caught: boolean) => {
  if (!caught) { console.error(`✗ mutation NOT caught: ${label}`); fail++; }
  else console.log(`✓ mutation caught: ${label}`);
};
for (const [label, fs] of mutants) mustCatch(label, problems(fs).length > 0);
// …and the writer predicate is not over-broad: a later file that only MENTIONS the trigger is no writer.
mustCatch('a comment naming trg_aqar_parse and per_meter is not read as a trigger rewrite',
  problems([...files, { name: '29991231000002_z.sql',
    text: `-- trg_aqar_parse respects price_evidence unit per_meter here\nselect 1;` }]).length === 0);
process.exit(fail ? 1 : 0);
