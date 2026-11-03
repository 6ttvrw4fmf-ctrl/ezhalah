// Two monitors that raised P1s nobody could clear, because each counted a row that cannot show the
// defect it names. Fixed 2026-11-03 (crawl-health group); this file keeps them fixed.
//
// 1. quarantine_growth (alerts 1729 alobid, 1730 abwbna, open 2026-09-06 → 2026-11-03).
//    The 25% SHARE condition is a LOCATION RESOLVER signal (its own adjudicate text). It counted
//    rows whose source publishes no city/district/region text and no pin — the Aldarim API returns
//    city = null for them — so no resolver can ever place them and the alarm could never clear.
//    Migration 20261103194247: the share counts only unready rows that carry a location signal; the
//    GROWTH condition (> 2x the 7-day median) still counts every unready row, so a scraper that
//    suddenly stops capturing city still fires.
//
// 2. phasea_snapshot_stale (alerts 5791, 6807 aqarcity, open 2026-09-25 → 2026-11-03).
//    It exists to catch a frozen snapshot SERVING a listing in the wrong city. 12 of its 18 rows
//    were inactive (not served; snapshot «جدة» vs source "Jeddah"), the other 6 were «PARENT - PLACE»
//    snapshot values whose part IS the source's city («الدوادمي - الفيضه» vs «الفيضه»). Migration
//    20261103194322: only active rows, and a snapshot naming the source's place agrees; a different
//    city («ابها» vs «جدة», the case the detector was built on) still counts.
//
// Each migration carries a DO block that executes both directions against the real shapes at apply
// time. This file is the hermetic half: it fails the PR if a later migration redefines either
// detector without the distinction, or drops the in-migration proof. Mutations at the bottom.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const MIG = join(ROOT, 'supabase', 'migrations');
const files = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const read = (f: string) => readFileSync(join(MIG, f), 'utf8');

function latest(re: RegExp): { name: string; sql: string } {
  const hits = files.filter((f) => re.test(read(f)));
  const name = hits[hits.length - 1] ?? '';
  return { name, sql: name ? read(name) : '' };
}

// A migration that REDEFINES the detector: a full create-or-replace, or a live-body patch.
const QG_TOUCH = /create\s+or\s+replace\s+function\s+public\.mon_detect_quarantine_growth\s*\(|pg_get_functiondef\('public\.mon_detect_quarantine_growth\(\)'/i;
const PV_TOUCH = /create\s+or\s+replace\s+view\s+public\.mon_phasea_snapshot_stale_vs_source\b/i;

function quarantineProblems(sql: string): string[] {
  const out: string[] = [];
  if (!/as unready_source_silent/.test(sql)) out.push('quarantine_growth counts source-silent unready rows (no text, no pin)');
  if (!/city_ar is null and district_ar is null[\s\S]{0,80}region_ar is null and latitude is null/.test(sql)) {
    out.push('source-silent means no city/district/region text AND no pin (a pin is a location signal)');
  }
  if (!/\(rec\.unready - rec\.unready_source_silent\)::numeric \/ rec\.total > 0\.25/.test(sql)) {
    out.push('the 25% share condition leaves source-silent rows out');
  }
  if (/rec\.unready_source_silent\s*>\s*v_thresh_abs|rec\.unready\s*-\s*rec\.unready_source_silent\s*>\s*v_thresh_abs/.test(sql)) {
    out.push('the GROWTH condition must still count every unready row');
  }
  if (!/array\[false, false, true, false\]/.test(sql)) out.push('the migration executes both directions of the share predicate');
  if (!/refusing to guess/.test(sql)) out.push('the live-body patch fails closed when its anchor is gone');
  return out;
}

function phaseaProblems(sql: string): string[] {
  const out: string[] = [];
  if (!/c\.active is true/.test(sql)) out.push('only ACTIVE rows (the ones search serves) count as stale');
  if (!/not public\.phasea_snapshot_names_place\(p\.city_ar_src, c\.additional_info->>''city_ar''\)/.test(sql)) {
    out.push('a snapshot whose « - » part names the source city agrees');
  }
  if (!/additional_info->>''city_ar''/.test(sql) || !/normalize_ar\(btrim\(p\.city_ar_src\)\) is distinct from/.test(sql)) {
    out.push('the oracle is still the live source payload city_ar, normalisation-aware');
  }
  if (!/array\[true, true, false, false, false, false\]/.test(sql)) {
    out.push('the migration executes both directions (agrees on parent-place, contradicts on another city)');
  }
  if (!/string_to_array\(p_snapshot, ' - '\)/.test(sql)) out.push('phasea_snapshot_names_place splits on « - » parts, never a substring');
  return out;
}

let failures = 0;
const qg = latest(QG_TOUCH);
const pv = latest(PV_TOUCH);
for (const [label, mig, probs] of [
  ['quarantine_growth', qg, quarantineProblems(qg.sql)],
  ['phasea_snapshot_stale', pv, phaseaProblems(pv.sql)],
] as const) {
  if (!mig.name) { failures++; console.error(`✗ ${label}: no migration redefines it`); continue; }
  if (probs.length) { failures += probs.length; for (const p of probs) console.error(`✗ ${label} (${mig.name}): ${p}`); }
  else console.log(`✓ ${label}: ${mig.name} judges only what a user can see`);
}

function mutation(name: string, problems: string[]): void {
  if (problems.length === 0) { failures++; console.error(`✗ mutation NOT caught: ${name}`); }
  else console.log(`✓ mutation caught: ${name}`);
}
mutation('share back on every unready row', quarantineProblems(qg.sql.replace(
  /\(rec\.unready - rec\.unready_source_silent\)::numeric/g, 'rec.unready::numeric')));
mutation('a pinned row read as silent', quarantineProblems(qg.sql.replace(/ and latitude is null/g, '')));
// The patch leaves the growth line untouched; a later edit that narrows it too is the mutant.
mutation('growth judged on the resolvable rows only', quarantineProblems(
  `${qg.sql}\n  v_fired := rec.unready - rec.unready_source_silent > v_thresh_abs`));
mutation('the quarantine check block dropped', quarantineProblems(qg.sql.replace(/array\[false, false, true, false\]/g, 'null')));
mutation('inactive rows counted again', phaseaProblems(pv.sql.replace(/c\.active is true/g, 'true')));
mutation('parent-place read as a contradiction', phaseaProblems(pv.sql.replace(/not public\.phasea_snapshot_names_place\([^)]*\)/g, 'true')));
mutation('the oracle swapped off the source payload', phaseaProblems(pv.sql.replace(/additional_info->>''city_ar''/g, "shadow_city")));
mutation('substring match instead of parts', phaseaProblems(pv.sql.replace(/string_to_array\(p_snapshot, ' - '\)/g, "array[p_snapshot]")));

if (failures) { console.error(`\n✗ ${failures} check(s) failed`); process.exit(1); }
console.log('\n✓ crawl-health detectors judge only rows a user can see, both directions proven at apply time');
