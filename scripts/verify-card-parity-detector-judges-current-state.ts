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

// 🔧 2026-11-11 (20261111220000): a non-licence card_missing stands down when the platform's LATEST reading decided the
// field with zero misses — a card fix (indexBathrooms.ts) no longer re-raises for a week. Only the raise is skipped.
const TODAY_CLEAN = /v_cm_today_clean := r\.field <> 'licence' and r\.mm = 0\s+and coalesce\(r\.latest_decided, 0\) > 0 and coalesce\(r\.latest_cm, 0\) = 0;/;
const RAISE_GATED = /if v_wrong >= 2 and 2 \* v_wrong >= v_decided and not v_cm_today_clean then/;
const LATEST_CM = /sum\(coalesce\(\(e\.value->>'card_missing'\)::int, 0\)\)\s+filter \(where night = \(select max\(r2\.night\) from recent r2 where r2\.platform = recent\.platform\)\) as latest_cm/;
check('a card_missing whose latest reading is clean stands down (never a licence, never over a source mismatch)', TODAY_CLEAN.test(latest));
check('only the raise is gated by today\'s clean reading', RAISE_GATED.test(latest));
check('«latest» card_missing is counted on the platform\'s own latest night', LATEST_CM.test(latest));
mustCatch('the clean-today gate also covering a source mismatch (r.mm = 0 dropped)',
  !TODAY_CLEAN.test(latest.replace("r.field <> 'licence' and r.mm = 0", "r.field <> 'licence'")));
mustCatch('a reading that decided nothing counted as clean (latest_decided > 0 dropped)',
  !TODAY_CLEAN.test(latest.replace('and coalesce(r.latest_decided, 0) > 0 ', '')));
mustCatch('the gate removed from the raise (a week of re-raises on fixed cards)',
  !RAISE_GATED.test(latest.replace(' and not v_cm_today_clean then', ' then')));
mustCatch('latest_cm summed over the whole window', !LATEST_CM.test(latest.replace(/(as latest_decided,\s+sum\(coalesce\(\(e\.value->>'card_missing'\)::int, 0\)\))\s+filter \([^\n]+\)\) as latest_cm/, '$1 as latest_cm')));

if (failed) { console.error(`\n✗ ${failed} check(s) failed`); process.exit(1); }
console.log('\n✓ the card-parity detector judges the current card; self-heal alerts stand only while repairs recur');
