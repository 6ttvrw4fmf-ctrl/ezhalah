// INCIDENT #45 — a source-published area of ZERO must survive, and silence must never become a number.
//
// THE FINDING THIS PROTECTS. Two searchable abralosol Residential Land rows carry area_m2 = 0:
// ABR6396 (id 10301921) and ABR6243 (id 10301955). That is not a parser artifact. abralosol itself
// publishes «المساحة 0 م» for both — the text is stored on the rows twice over, in
// `source_capture->'index'->>'area_cell'` and in a `source_capture->'detail_blocks'` entry — because
// both ads are multi-plot bundles whose seller left the single area field at 0 and wrote the
// per-plot areas into the description. So the honest value is 0, and the three tempting "repairs"
// are all regressions: nulling it erases something the source did publish, summing the description's
// per-plot figures invents a size out of prose, and deactivating the rows kills a live listing over
// a surprising number.
//
// WHAT ACTUALLY EXECUTES. The barrier is `mon_detect_area_contradicts_capture()`, which runs in
// production twice an hour inside mon_run_all_detectors() and compares the area we SERVE against the
// area the source TEXT carries, for every abralosol row, in both directions (fabricated / erased /
// rewritten). It was mutation-proven against live data at ship time: nulling id 10301921 inside an
// aborting transaction turned it red on the `erased` arm, and setting an area on a row whose capture
// has none turned it red on the `fabricated` arm.
//
// WHAT THIS FILE DOES. `npm test` has no database, so this pins that detector against being deleted,
// narrowed, or quietly turned into an id allowlist — the three ways a committed detector stops
// protecting anything without any test going red. Every predicate below is pure and is executed
// against deliberately broken bodies at the bottom of the file, so the pin itself has been watched
// to fail.
//
//   node --experimental-strip-types scripts/verify-abralosol-area-is-source-verbatim.ts   (in `npm test`)

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const DIR = join(root, 'supabase', 'migrations');

const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
const sqlOf = new Map(files.map((f) => [f, readFileSync(join(DIR, f), 'utf8')]));

/** The LAST committed body of a `$fn$ … $fn$` function — last definition wins, as production does. */
export function lastBody(name: string, sources: Iterable<[string, string]>): string {
  const re = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\b[\\s\\S]*?\\$fn\\$([\\s\\S]*?)\\$fn\\$`,
    'gi',
  );
  let body = '';
  for (const [, sql] of sources) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) body = m[1];
    re.lastIndex = 0;
  }
  return body;
}

// ── the pure predicates this barrier is made of ─────────────────────────────────────────────────

/** Both directions, named. `erased` is the arm that fires if anyone "repairs" a published 0 to NULL. */
export const judgesBothDirections = (body: string): boolean =>
  /'fabricated'/.test(body) && /'erased'/.test(body) && /'rewritten'/.test(body)
  && /raw\s+is\s+null\s+and\s+area_m2\s+is\s+not\s+null\s+then\s+'fabricated'/i.test(body)
  && /raw\s+is\s+not\s+null\s+and\s+area_m2\s+is\s+null\s+then\s+'erased'/i.test(body);

/** Judged against the stored SOURCE TEXT, not against a number this repo chose. */
export const judgesAgainstCapture = (body: string): boolean =>
  /source_capture->>'area_raw'/.test(body);

/**
 * No row is exempt. An id allowlist would pin the symptom (these two ids) instead of the rule
 * (served area == published area), protect nothing else, and go stale the moment abralosol edits
 * either ad. Naming the ids in the alert TEXT is documentation and stays allowed; excluding a row
 * from the comparison is not.
 */
export const exemptsNoRow = (body: string): boolean =>
  !/\b(?:id|listing_id)\s*(?:not\s+in|<>|!=)/i.test(body);

/** The alert kind must be clearable, or it goes permanently red and suppresses every recurrence. */
export const canGoGreenAgain = (body: string): boolean =>
  /mon_resolve_stale_keys\(\s*'area_contradicts_capture'/.test(body);

/** A detector outside the roster is decoration — mon_detect_orphaned_detectors() fires on it. */
export const isRostered = (allSql: string): boolean =>
  /'mon_detect_area_contradicts_capture'/.test(allSql);

/** The adjudication itself must be recoverable from the repo, not only from the incident row. */
export const recordsTheEvidence = (allSql: string): boolean =>
  allSql.includes('10301921') && allSql.includes('10301955') && allSql.includes('المساحة 0');

// ── the pin ─────────────────────────────────────────────────────────────────────────────────────

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failed++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

const body = lastBody('mon_detect_area_contradicts_capture', sqlOf);
const allSql = [...sqlOf.values()].join('\n');

console.log('\nIncident #45 — abralosol area is served exactly as the source published it\n');

check('mon_detect_area_contradicts_capture is defined in a committed migration (repo == prod)',
  body.length > 0, 'no $fn$ body found under supabase/migrations');
check('it judges BOTH directions: silence never becomes a number, a published figure is never erased',
  judgesBothDirections(body));
check('it judges against the stored source text (source_capture->>\'area_raw\')',
  judgesAgainstCapture(body));
check('it exempts no row — the invariant is pinned, not the two known ids', exemptsNoRow(body));
check('its alert kind can be resolved, so a fixed state goes green again', canGoGreenAgain(body));
check('it is on the mon_run_all_detectors() roster', isRostered(allSql));
check('the adjudication evidence is committed (both ad ids and the source text «المساحة 0»)',
  recordsTheEvidence(allSql));

// ── mutation proofs: every predicate above, watched to fail on a broken input ────────────────────

let mutFailed = 0;
const mustCatch = (label: string, caught: boolean) => {
  if (caught) { console.log(`PASS  (mutation) catches ${label}`); return; }
  mutFailed++;
  console.error(`FAIL  (mutation) BLIND to ${label}`);
};

console.log('');

// 1. The detector is deleted outright.
mustCatch('the detector being removed from every migration',
  lastBody('mon_detect_area_contradicts_capture', [['x.sql', '-- nothing here']]).length === 0);

// 2. The `erased` arm is dropped — the exact narrowing that would let someone null these two rows
//    back to "unknown" with the suite still green.
const withoutErased = body.replace(/when\s+raw\s+is\s+not\s+null\s+and\s+area_m2\s+is\s+null\s+then\s+'erased'/i, '');
mustCatch('the erased arm being dropped (a published area silently becoming NULL)',
  withoutErased !== body && !judgesBothDirections(withoutErased));

// 3. The `fabricated` arm is dropped — silence becoming a number, the other half of SOURCE IS TRUTH.
const withoutFabricated = body.replace(/when\s+raw\s+is\s+null\s+and\s+area_m2\s+is\s+not\s+null\s+then\s+'fabricated'/i, '');
mustCatch('the fabricated arm being dropped (an invented area)',
  withoutFabricated !== body && !judgesBothDirections(withoutFabricated));

// 4. The comparison stops reading the source and compares against something else.
mustCatch('the comparison being cut loose from the captured source text',
  !judgesAgainstCapture(body.replaceAll("source_capture->>'area_raw'", 'null::text')));

// 5. The two rows are excused instead of the rule being asserted.
mustCatch('an id allowlist being added to excuse the known rows',
  !exemptsNoRow(`${body}\n and id not in (10301921, 10301955)`));

// 6. The kind loses its resolver and can never go green again.
mustCatch('the resolver being removed (a kind stuck red forever)',
  !canGoGreenAgain(body.replace('mon_resolve_stale_keys', 'mon_never_resolve')));

// 7. The detector exists but nothing runs it.
mustCatch('the roster entry being dropped',
  !isRostered(allSql.replaceAll("'mon_detect_area_contradicts_capture'", "'mon_detect_something_else'")));

// 8. The adjudication evidence is scrubbed out of the repo.
mustCatch('the committed evidence being scrubbed',
  !recordsTheEvidence(allSql.replaceAll('10301921', 'REDACTED')));

if (mutFailed > 0) {
  console.error(`\n✗ ${mutFailed} mutation(s) NOT caught — this barrier does not do what it claims`);
  process.exit(1);
}
console.log(failed === 0
  ? '\n✓ a source-published area of 0 is preserved, and an unpublished area still cannot become one'
  : `\n✗ ${failed} check(s) FAILED — incident #45's barrier is being weakened or dropped`);
process.exit(failed === 0 ? 0 : 1);
