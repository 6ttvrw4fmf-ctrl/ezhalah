// A DETECTOR MUST NOT THROW ON THE ONE PATH THAT HAS SOMETHING TO REPORT.
//
// THE SHAPE. Every mon_detect_* limb records the dedup keys it is standing behind in a `text[]`, so
// that mon_resolve_stale_keys() can close the ones it is no longer standing behind:
//
//   declare live text[] := '{}';
//   ...
//   live := live || 'some_key';          -- 22P02 malformed array literal: "some_key"
//
// That line does NOT append an element. The literal is UNKNOWN-typed, so `||` resolves to
// anyarray || anyarray and Postgres tries to parse 'some_key' AS AN ARRAY. Measured on production
// 2026-09-27, all three forms in one DO block:
//
//   live := live || 'plain_key'          -> THROWS 22P02 malformed array literal: "plain_key"
//   live := live || 'plain_key'::text    -> OK -> {plain_key}
//   live := live || ok                   -> OK -> {plain_key}      (ok text := 'plain_key')
//   live := live || ('pre:' || 'suf')    -> OK -> {pre:suf}
//
// WHY IT IS WORSE THAN AN ORDINARY BUG. That line only runs when the detector HAS A FINDING. So a
// detector written this way returns a healthy 0 every time it has nothing to say, and throws at the
// exact moment it matters. mon_run_all_detectors() catches the throw into its `failed` list and
// moves on, so the sweep survives and the finding is silently never raised — it never becomes the
// alert with its actionable payload. A guard that cannot fire is not a guard, and this one reads as
// a clean bill of health while it is dark (AGENTS.md).
//
// THIS HAS HAPPENED THREE TIMES, TWICE ON ONE EVENING. 20260924020926 shipped
// mon_detect_liveness_checking_shortfall with an uncast fleet arm and was corrected the same night by
// 20260924033542, whose header spells out the lesson: "Executing the thing you actually ship is the
// rule; a tested component inside an untested caller is untested." The predicate had been verified;
// the WRAPPER never was. Three days later the same shape was found in five more detectors (nine
// appends across seven migrations), one of them written by copying
// mon_detect_wasalt_dead_but_active — repaired by 20260927214447. And while THAT repair was in
// review, 20260927210420 shipped a sixth detector with three more, corrected four minutes later by
// 20260927211052.
//
// So the class reproduced itself between the discovery of the five and the merge of their fix, in a
// migration written by a session that had been told about the bug. That is the argument for this
// file: every occurrence was caught by a human executing the detector, and every one of them was
// caught LATE. This check is the first thing in the repo that notices — it found 20260927210420 by
// itself, on its first contact with main after #5000 and #5001 merged.
//
// WHY IT COUNTS INSTEAD OF GREPPING. The obvious check — "does this still contain
// `live := live || '`" — cannot tell the defect from the repair, because the fixed form has the
// identical prefix. That looseness aborted two earlier attempts at the repair migration. The
// predicate here compares CAST appends against ALL literal appends per file, so the two forms are
// distinguishable, and the mutation proofs below execute both directions rather than describing them.
//
// SCOPE. Offline, tracked repo files only, like the other verifiers in `npm test`. It is a FORWARD
// RATCHET: the eight migrations that already carry the shape are grandfathered by exact filename
// (their live function bodies were repaired in place by a later programmatic rewrite), and any NEW
// uncast append fails this check. The grandfather list can only shrink.
//
// Run: node --experimental-strip-types scripts/verify-detector-appends-are-typed.ts
import { readFileSync, readdirSync } from 'node:fs';

const MIGRATIONS_DIR = 'supabase/migrations';

let failed = 0;
const check = (ok: boolean, msg: string, extra = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}${ok || !extra ? '' : ` — ${extra}`}`);
  if (!ok) failed++;
};

// A COMMENT IS NOT A CODE PATH. Both migrations that FIX this class quote the broken line in their
// own header prose to explain it; a reader of un-stripped source would count those as defects and,
// worse, a real defect could hide behind a trailing `--`. Full-line `--` and `/* */` are dropped;
// trailing `--` is deliberately KEPT, exactly as verify-monitoring-sweep-is-guarded.ts does it, so a
// `--` inside a string literal can never cut the statement short. Over-strip fails CLOSED here: the
// text disappears, the count drops, and a missing append reads as clean — which is why the
// grandfathered files double as live proof that the predicate still sees a real one (check 5).
const sqlCode = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--.*$/gm, '');

// `(?:[^']|'')*` walks a SQL literal including doubled-quote escapes, so `'it''s'` is ONE literal
// rather than two — otherwise an apostrophe in a dedup key would split the match and hide the append.
const APPEND_LITERAL = /live\s*:=\s*live\s*\|\|\s*'(?:[^']|'')*'/g;
const APPEND_CAST = /live\s*:=\s*live\s*\|\|\s*'(?:[^']|'')*'\s*::\s*text/g;

// The number of literal appends in this SQL that are NOT explicitly ::text. A parenthesised
// expression (`('pre:' || r.col)`) and a declared variable (`k`) are already typed before the append
// and are not literal appends at all, so they are invisible to both patterns and cannot false-red.
const uncastAppends = (sql: string): number => {
  const code = sqlCode(sql);
  return (code.match(APPEND_LITERAL) || []).length - (code.match(APPEND_CAST) || []).length;
};

// Migrations that already write an uncast append. Grandfathered by exact filename — a record of what
// predates the rule, never a template. A NEW entry here is the very thing this guard exists to
// prevent. Twelve appends across eight files, measured 2026-09-27.
const GRANDFATHERED = new Map<string, string>([
  ['20260818012749_detect_district_bridge_leak.sql',
    'district_bridge_leak:guard_missing — the original, superseded by 20260818062557'],
  ['20260818062557_district_bridge_leak_cover_counts_and_templates.sql',
    'district_bridge_leak:guard_missing + :template_unguarded — both P1 limbs'],
  ['20260905052403_routine11_lifecycle_four_missing_detectors_detect_only.sql',
    'inactive_still_searchable:BLIND — the blindness guard itself could not fire'],
  ['20260915081733_mon_detect_dead_qa_oracle_wrapper.sql',
    'dead_qa_oracle_wrapper:__registry_empty__ — "the oracle layer is UNMEASURED, not clean"'],
  ['20260919023049_mon_detect_wasalt_dead_but_active.sql',
    'wasalt_dead_but_active:BLIND — the shape 20260927203335 was copied FROM'],
  ['20260924020926_detect_when_a_website_falls_behind_its_checking_schedule.sql',
    'liveness_checking_shortfall:fleet — caught and corrected the same night by 20260924033542'],
  ['20260927203335_aqarmonthly_card_district_drift_detector.sql',
    'aqarmonthly_card_district_drift:BLIND + the main limb — watchdog for repair 20260927201934'],
  // Found by THIS check, on its first run against main after #5000 and #5001 merged. The class
  // reproduced while the fix for the other five was still in review; corrected four minutes later by
  // 20260927211052, which is the migration that introduced the `declare k text` house pattern.
  ['20260927210420_aqarmonthly_street_as_district_detector.sql',
    'aqarmonthly_street_as_district:BLIND + the main limb + :index — superseded by 20260927211052'],
  // 🆕 New Listings Engineer, 2026-10-03: applied before this check was run locally, caught by it
  // before merge, superseded 1 min 34 s later by 20261003103854 (same body, ::text). The applied
  // file must stay byte-exact for migration content parity, so it is recorded here rather than edited.
  ['20261003103720_dwelleo_amenity_trapped_detector.sql',
    'dwelleo_amenity_trapped:BLIND + :trapped + :false_from_silence — superseded by 20261003103854'],
]);

// Pinned in reviewed source so that adding a name to the list is not a quiet edit to a data
// structure: it fails this check until someone also raises this number in a diff a human read. The
// list may SHRINK (a superseded migration removed from the tree), never grow.
const GRANDFATHERED_CEILING = 9;

const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
check(files.length > 100, `scanned ${files.length} migrations`,
  `only ${files.length} migration files found — the scan is not seeing the directory`);

// ── 1. NO NEW MIGRATION MAY CARRY AN UNCAST APPEND ───────────────────────────────────────────
const offenders = files
  .filter((f) => !GRANDFATHERED.has(f))
  .map((f) => [f, uncastAppends(readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8'))] as const)
  .filter(([, n]) => n > 0);
check(offenders.length === 0,
  'every mon_detect_* append outside the grandfather list is explicitly ::text',
  `these migrations append an UNTYPED literal to a text[], which throws 22P02 on the only path that ` +
  `has a finding — the detector returns a healthy 0 until it matters, then lands in ` +
  `mon_run_all_detectors()'s \`failed\` list instead of raising its alert. Write ` +
  `\`declare k text := '<kind>';\` and append \`k\` / \`(k || ':suffix')\`, or add \`::text\` to the ` +
  `literal, and pass the same value to mon_raise and mon_resolve_stale_keys: ` +
  offenders.map(([f, n]) => `${f} (${n})`).join(', '));

// ── 2. THE GRANDFATHER LIST IS A RECORD, NOT A LOOPHOLE ──────────────────────────────────────
const stale = [...GRANDFATHERED.keys()].filter((f) => !files.includes(f));
check(stale.length === 0,
  `grandfather list matches the tree (${GRANDFATHERED.size} historical migrations)`,
  `grandfathered files no longer exist — the list has drifted from the tree: ${stale.join(', ')}`);

check(GRANDFATHERED.size === GRANDFATHERED_CEILING,
  `the grandfather list is at its pinned size (${GRANDFATHERED_CEILING})`,
  `the list holds ${GRANDFATHERED.size} names against a pinned ceiling of ${GRANDFATHERED_CEILING}. ` +
  `It may only shrink. If it grew, a detector that cannot raise was just waved through`);

// ── 3. EVERY GRANDFATHERED NAME MUST STILL EARN ITS PLACE ────────────────────────────────────
// This is also the load-bearing proof that the predicate still sees a REAL uncast append in real
// tracked SQL. If a future change to sqlCode() over-stripped, check 1 would go quietly green on a
// genuine defect; this check goes red instead, because the twelve historical appends would vanish too.
const unearned = [...GRANDFATHERED.keys()]
  .filter((f) => files.includes(f))
  .filter((f) => uncastAppends(readFileSync(`${MIGRATIONS_DIR}/${f}`, 'utf8')) === 0);
check(unearned.length === 0,
  'every grandfathered migration still contains the append it is listed for, so the predicate is ' +
  'demonstrably seeing real SQL and not an over-stripped blank',
  `these files no longer carry an uncast append, so either they were edited (migrations are ` +
  `immutable history) or the predicate has gone blind and check 1 is now green for the wrong ` +
  `reason: ${unearned.join(', ')}`);

// ── MUTATION PROOF ───────────────────────────────────────────────────────────────────────────
const mustCatch = (what: string, caught: boolean) =>
  check(caught, `(mutation) catches ${what}`,
    'MUTANT SURVIVED — the assertion above is blind to the defect it exists to catch');

// Verbatim from 20260927203335, the newest migration to ship the defect.
const BARE = `    live := live || 'aqarmonthly_card_district_drift:BLIND';`;
// The same line as 20260927214447's rewrite left it in the live function body.
const FIXED = `    live := live || 'aqarmonthly_card_district_drift:BLIND'::text;`;
// The two forms that were already safe and must never be reported.
const PAREN = `    live := live || ('district_bridge_leak:probe:' || r.district_ar);`;
const VAR = `    k text := 'street_as_district';\n    live := live || k;\n    live := live || (k || ':index');`;

mustCatch('the 22P02 shape: an untyped literal appended to a text[]',
  uncastAppends(BARE) === 1);
mustCatch('a doubled-quote literal, so an apostrophe in a dedup key cannot split the match and hide it',
  uncastAppends(`live := live || 'it''s_broken';`) === 1);

// The other direction. A barrier that only ever fires is as useless as one that never does, and the
// cheap wrong "fix" for a false red here is to weaken the predicate until it stops complaining.
mustCatch('the REPAIRED form is not reported (a false red would be cleared by weakening this check)',
  uncastAppends(FIXED) === 0);
mustCatch('a parenthesised expression is not reported — it is typed before the append',
  uncastAppends(PAREN) === 0);
mustCatch('a declared text variable is not reported — the house fix pattern must stay green',
  uncastAppends(VAR) === 0);
mustCatch('a defect quoted in a comment is not reported — a comment is not a code path',
  uncastAppends(`-- live := live || 'some_key';  the bug, explained\n`) === 0);

// THE TRAP THIS BARRIER EXISTS TO AVOID, executed rather than described. The intuitive check cannot
// tell the defect from the repair: the prefix is identical, so it matches BOTH. A barrier built on it
// is green on the bug (if it asserts presence) or red on the fix (if it asserts absence) — and the
// second is what aborted two earlier attempts at the repair migration.
const NAIVE = /live := live \|\| '/;
mustCatch('the naive prefix check failing to discriminate, which is why this file counts casts',
  NAIVE.test(BARE) && NAIVE.test(FIXED) && uncastAppends(BARE) !== uncastAppends(FIXED));

console.log(failed === 0
  ? `\n✅ verify-detector-appends-are-typed: every mon_detect_* append outside ${GRANDFATHERED.size} grandfathered migrations is explicitly typed.`
  : `\n❌ verify-detector-appends-are-typed: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
