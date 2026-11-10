// THE CARD-PARITY DETECTOR JUDGES THE CURRENT CARD, AND A SELF-HEAL ALERT STANDS ONLY WHILE REPAIRS RECUR.
//
//   node --experimental-strip-types scripts/verify-card-parity-detector-judges-current-state.ts   (npm test)
//
// 🔧 2026-11-09. mon_detect_card_parity() summed 7 nights of ops_card_parity and never re-read what it sampled:
//   · 4 «licence» alerts (aqargate, fursaghyr, october, jurash) re-raised every half hour for a week after the
//     card already carried the page's licence — fixed by 20261109213000 (card_parity_licence_on_card_now()).
//   · 3 «self_healed» P2s (alhoshan/macsaib link, rawaf licence) stood for a week on ONE repair on 11-07 followed by
//     clean nights — fixed by 20261109221500 (stands only on the latest night, or on >= 2 nights).
// The detector is SQL that only production can run, so this reads the LATEST committed definition (the one production
// runs: the newest migration that creates it) and pins both clauses; the dry runs against production are recorded in
// PR #11532. Each pin is mutation-proven against the same text.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'supabase/migrations';
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
let latest = '';
for (const f of files) {
  const sql = readFileSync(join(dir, f), 'utf8');
  const m = /CREATE OR REPLACE FUNCTION public\.mon_detect_card_parity\(\)[\s\S]*?end \$function\$;/i.exec(sql);
  if (m) latest = m[0];
}

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };
const mustCatch = (what: string, caught: boolean) => check(`(mutation) catches ${what}`, caught);

// the whole guard, polarity included: the finding is skipped only when NO sampled card still lacks its licence
const LICENCE_NOW = /and not exists \(select 1 from jsonb_array_elements\(r\.sample\) s\s+where coalesce\(s->>'page', ''\) ~ '\^7\[12\]\[0-9\]\{8\}\$'\s+and public\.card_parity_licence_on_card_now\(s->>'listing', s->>'page'\) is not true\) then/;
const RECUR = /if r\.rep > 0 and \(r\.rep_latest or r\.rep_nights >= 2\) then/;
// the repair predicate too: a clean later night must never inherit an older repair
const REP_LATEST = /bool_or\(coalesce\(\(e\.value->>'repaired'\)::int, 0\) > 0\s+and night = \(select max\(r2\.night\) from recent r2 where r2\.platform = recent\.platform\)\) as rep_latest/;

check('the latest mon_detect_card_parity definition was found', latest.length > 0);
check('a licence finding re-reads every sampled listing (unknown is never healed: «is not true»)', LICENCE_NOW.test(latest));
check('a self-healed finding stands only while the repair recurs (latest night, or >= 2 nights)', RECUR.test(latest));
check('«latest night» is the platform\'s own latest sampled night', REP_LATEST.test(latest));

mustCatch('the licence re-check removed (a week of re-raises on fixed cards)',
  !LICENCE_NOW.test(latest.replace(/\n\s*and public\.card_parity_licence_on_card_now\(s->>'listing', s->>'page'\) is not true\) then/, ') then')));
mustCatch('an unreadable sample counted as healed («= false» instead of «is not true»)',
  !LICENCE_NOW.test(latest.replace("is not true", "= false")));
mustCatch('the licence guard\'s polarity flipped («not exists» → «exists»: skip a card that still lacks its licence)',
  !LICENCE_NOW.test(latest.replace(/and not exists (\(select 1 from jsonb_array_elements\(r\.sample\) s\s+where coalesce\(s->>'page', ''\) ~ '\^7\[12\]\[0-9\]\{8\}\$'\s+and public\.card_parity_licence_on_card_now)/, 'and exists $1')));
mustCatch('the repair predicate dropped from rep_latest (one old repair stands on every later clean night)',
  !REP_LATEST.test(latest.replace("bool_or(coalesce((e.value->>'repaired')::int, 0) > 0\n                     and night", 'bool_or(night')));
mustCatch('self-healed back on «any repair in 7 nights»', !RECUR.test(latest.replace(RECUR, 'if r.rep > 0 then')));

if (failed) { console.error(`\n✗ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the card-parity detector judges the current card; self-heal alerts stand only while repairs recur');
