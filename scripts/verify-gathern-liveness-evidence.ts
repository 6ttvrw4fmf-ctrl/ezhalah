// A LEDGER NOTHING WRITES IS DECORATION — AND FOR AN INACTIVATION LEDGER THAT IS A SAFETY GAP.
//
// THE FAILURE CLASS (found 2026-08-22, Data Integrity run #37). Migration 20260812113726 created
// `gathern_liveness_detail` as the per-row source-evidence ledger for gathern inactivations. Its
// own comment states the contract: "written by scrapers/gathern/liveness.py on EVERY run including
// dry-runs". The writer was never implemented. Ten days later the table held ZERO rows — while the
// sweep had gone on deactivating listings (68 on 08-21, 98 on 08-22, ~1.1k historically).
//
// This is not a bookkeeping nit. DATA_INTEGRITY_ENGINEER.md §4 is explicit: "Do not trust our own
// inactive, stale, missing_count, or deletion flags as proof — those are Ezhalah state, not source
// evidence." The sweep DOES re-fetch the source and DOES derive its verdict from the raw HTTP
// status (404/410 → strike/kill, 200 → alive, anything else → transient/untouched) — so the
// evidence exists at decision time and was simply thrown away. Only the aggregate line survived in
// scrape_runs.notes ("scanned=1500 dead=1131 …"), which cannot say WHICH row returned WHICH status
// on WHICH day. That is the exact pre-fix state wasalt was rescued from by
// wasalt_liveness_pilot_detail, and it is why three separate audits had to re-derive gathern
// liveness state by hand.
//
// WHAT THIS GUARD PINS, and why each half matters:
//   1. liveness.py writes gathern_liveness_detail at all            — the defect itself
//   2. the raw probe() status is captured, not discarded inline     — the evidence's whole content
//   3. the write is best-effort (try/except)                        — audit logging must never
//                                                                     break or roll back a sweep
//   4. it is NOT gated behind `if args.apply`                       — a dry-run's evidence is the
//                                                                     entire point of a dry-run
//   5. a kill's `applied` is resolved AFTER the anomaly cap gate    — a quarantined batch records
//                                                                     real evidence with applied=false
//
// Deliberately OFFLINE (tracked repo files only), like the other verifiers in `npm test`. The LIVE
// half is mon_detect_liveness_evidence_gap(), which asks whether a gathern sweep that inactivated
// rows actually left per-row evidence behind.
//
// Run: node --experimental-strip-types scripts/verify-gathern-liveness-evidence.ts
import { readFileSync } from 'node:fs';

const SRC = 'scrapers/gathern/liveness.py';
const src = readFileSync(SRC, 'utf8');

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

const TABLE = 'gathern_liveness_detail';

// ── 1. The ledger is written at all ──────────────────────────────────────────────────────────────
const insertsLedger = new RegExp(
  `table\\(\\s*["']${TABLE}["']\\s*\\)\\s*\\.insert\\(`,
).test(src);
check(
  insertsLedger,
  `writes ${TABLE} via .insert()`,
  `${SRC} never inserts into ${TABLE}. Migration 20260812113726 created that table as the per-row ` +
    `evidence ledger and states it is "written by scrapers/gathern/liveness.py on EVERY run ` +
    `including dry-runs". Without it, an inactivation cannot be re-checked from our own data.`,
);

// ── 2. The raw status is captured, not consumed inline by classify() ─────────────────────────────
// The old code read `classify(probe(s, url), ...)` — the status reached the verdict and then
// vanished. The evidence row is worth little without the number the source actually returned.
const inlineProbe = /classify\(\s*probe\(/.test(src);
check(
  !inlineProbe,
  'probe() status is bound to a variable before classify(), so it can be recorded',
  `${SRC} still calls classify(probe(...)) inline, which discards the raw HTTP status. Bind it ` +
    `(e.g. \`status = probe(s, url)\`) so the evidence row can carry http_status.`,
);
check(
  /["']http_status["']\s*:/.test(src),
  'evidence row carries http_status',
  `${SRC} does not record an http_status field — the verdict alone is Ezhalah state, not source ` +
    `evidence (§4).`,
);
for (const field of ['listing_id', 'verdict', 'missing_count_before', 'missing_count_after', 'applied']) {
  check(
    new RegExp(`["']${field}["']\\s*:`).test(src),
    `evidence row carries ${field}`,
    `${SRC} evidence row is missing the ${field} column defined by migration 20260812113726.`,
  );
}

// ── 3. Best-effort: an audit-log write must never break the sweep ────────────────────────────────
// Isolate the flush helper and require a try/except around the insert.
const flushStart = src.indexOf('def _flush_detail');
check(
  flushStart !== -1,
  '_flush_detail() helper exists',
  `${SRC} has no _flush_detail() helper; the evidence write should be one guarded place, as in ` +
    `scrapers/wasalt/liveness.py.`,
);
if (flushStart !== -1) {
  // The helper body ends at the next top-level-in-function `def ` at the same indentation.
  const after = src.slice(flushStart);
  const nextDef = after.slice(1).search(/\n {4}def /);
  const body = nextDef === -1 ? after : after.slice(0, nextDef + 1);
  check(
    /try:/.test(body) && /except\s+Exception/.test(body),
    'evidence insert is wrapped in try/except (best-effort)',
    `${SRC} _flush_detail() does not guard its insert with try/except Exception. A failed audit ` +
      `write must never fail or roll back a liveness sweep.`,
  );
  check(
    !/\braise\b/.test(body),
    '_flush_detail() never re-raises',
    `${SRC} _flush_detail() re-raises, which would let an audit-log failure abort the sweep.`,
  );
}

// ── 4. Evidence is recorded on dry-runs too ──────────────────────────────────────────────────────
// A dry run writes no listing rows; its evidence is the entire point of running it. So the insert
// must not sit behind an `if args.apply` gate. We check the flush call sites rather than the
// helper: `applied` may legitimately reference args.apply as a VALUE.
const flushCalls = [...src.matchAll(/^([ \t]*)(?:if[^\n]*\n[ \t]*)?_flush_detail\(/gm)];
check(
  flushCalls.length > 0,
  '_flush_detail() is actually called',
  `${SRC} defines _flush_detail() but never calls it — a helper nothing calls is the same defect ` +
    `in a new place.`,
);
const gatedOnApply = /if\s+args\.apply[^\n]*:\s*\n\s*_flush_detail\(/.test(src);
check(
  !gatedOnApply,
  'evidence flush is not gated behind `if args.apply` (dry-runs record too)',
  `${SRC} only flushes evidence when --apply is set. Migration 20260812113726: "Written on every ` +
    `run INCLUDING dry-runs ... with applied=false when nothing was flipped."`,
);

// ── 5. A kill's `applied` is resolved after the anomaly cap gate ─────────────────────────────────
// A quarantined batch produces REAL evidence with applied=false. If kill evidence were flushed in
// the loop, `applied` would be a guess made before the cap was known.
const anomalyIdx = src.indexOf('anomaly = args.apply and is_anomaly(');
check(
  anomalyIdx !== -1,
  'anomaly cap gate still present',
  `${SRC} no longer contains the anomaly cap gate — this guard's assumptions need revisiting.`,
);
if (anomalyIdx !== -1) {
  const afterGate = src.slice(anomalyIdx);
  // Deliberately specific. A loose `/applied/ && /not anomaly/` passes on the PRE-FIX file, whose
  // `applied_kills` and `if not anomaly` both sit after the gate for unrelated reasons — a check
  // that green-lights the bug it exists to catch is worse than no check (run #34d).
  check(
    /\[\s*["']applied["']\s*\]\s*=\s*[^\n]*\bnot\s+anomaly\b/.test(afterGate),
    "kill evidence resolves `applied` from the cap gate's outcome",
    `${SRC} does not set the kill batch's \`applied\` from the anomaly outcome after the gate. A ` +
      `quarantined batch must record applied=false, not applied=true.`,
  );
  // The kill buffer must be flushed after the gate, not inside the probe loop.
  const killFlushAfter = /_flush_detail\(\s*kill_detail\s*\)/.test(afterGate);
  check(
    killFlushAfter,
    'kill evidence is flushed after the cap gate',
    `${SRC} does not flush the deferred kill evidence after the anomaly cap gate, so quarantined ` +
      `kills would leave no evidence at all.`,
  );
}

// ── 6. The resurrection pass is structurally non-destructive ─────────────────────────────────────
// --recheck-dead re-probes rows the kill pass already killed. It exists because the sweep's own
// rule ("HTTP 200 → alive → rescue") was only ever applied to rows that were still ACTIVE, so one
// source fact produced a rescue for one row and permanent removal for another (measured 2026-08-22:
// 3 of 60 sampled killed rows served a full 200 page, replicated, against a 10/10 live control).
// A pass that can restore MUST NOT also be able to inactivate: that is what makes it safe to run
// unattended without a kill cap, and what stops a bad source day from deepening the damage.
const rIdx = src.indexOf('def _recheck_dead');
check(
  rIdx !== -1,
  '_recheck_dead() resurrection pass exists',
  `${SRC} has no _recheck_dead() pass, so a killed-but-source-live row is never re-probed and is ` +
    `lost permanently unless it re-enters gathern's enumeration feed.`,
);
if (rIdx !== -1) {
  const body = src.slice(rIdx, src.indexOf('\ndef main()', rIdx));
  check(
    /"active"\s*:\s*True/.test(body),
    'recheck restores with active=True',
    `${SRC} _recheck_dead() never sets active=True — it cannot restore anything.`,
  );
  check(
    !/"active"\s*:\s*False/.test(body),
    'recheck can never set active=False (non-destructive by construction)',
    `${SRC} _recheck_dead() writes active=False. The resurrection pass must only ever restore; if ` +
      `it can also inactivate it needs the kill cap and every guard the kill pass has.`,
  );
  check(
    /status\s*==\s*200/.test(body),
    'recheck restores only on a literal HTTP 200',
    `${SRC} _recheck_dead() does not gate the restore on status == 200. A restore driven by ` +
      `anything softer than a live page is fabrication.`,
  );
  check(
    /table\(\s*["']gathern_liveness_detail["']\s*\)\s*\.insert\(/.test(body),
    'recheck records its own evidence',
    `${SRC} _recheck_dead() writes no evidence, reintroducing the very gap this file was fixed for.`,
  );
  check(
    !/kill_cap/.test(body),
    'recheck does not consult the kill cap (nothing for it to guard)',
    `${SRC} _recheck_dead() references kill_cap; a pass that cannot inactivate has no kill batch, ` +
      `and borrowing that gate would only obscure which pass a cap decision belonged to.`,
  );
}

// ── Report ───────────────────────────────────────────────────────────────────────────────────────
for (const o of ok) console.log(`  ✓ ${o}`);
if (problems.length) {
  console.error(`\n✗ verify-gathern-liveness-evidence: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error(`  ✗ ${p}\n`);
  process.exit(1);
}
console.log(`\n✓ verify-gathern-liveness-evidence: ${ok.length} checks passed`);
