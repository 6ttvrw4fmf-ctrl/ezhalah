/**
 * A platform whose readable catalogue changed shape ON PURPOSE is rebased PER PLATFORM, with evidence, and a
 * collapse after the rebase still alarms (owner decision 4, 2026-11-03: superoffice respects robots.txt).
 *
 * superoffice.sa was rebuilt (2026-10-28): each branch page server-renders 8 offices and the rest sit behind
 * /api/office-listing, which robots.txt disallows. The owner chose to respect robots.txt, so 24 offices a run is
 * the whole catalogue — yet rows_collapse (12219) and silent_partial_success (12556) kept comparing it with the old
 * site's 184. The repair is ops_platform_catalogue_rebase: one row per platform (rebase moment, expected run size,
 * reason, a link to the rule), read by both detectors. It must never become a way to quiet a real collapse:
 *
 *   1. the table demands a reason and an https pointer to the source rule (no silent waivers);
 *   2. silent_partial_success drops ONLY a rebased platform's pre-rebase runs, and holds it to its declared size
 *      from its first run (mode 'declared_catalogue'), so a collapse after the rebase raises before a median exists;
 *   3. the fleet thresholds are untouched (0.50 × median / p25 in silent_partial_success);
 *   4. the migration's own check block proves both directions by EXECUTION on synthetic runs — the rebased shape
 *      stays quiet, the same shape WITHOUT a rebase row fires, a post-rebase drop fires, a new rebase under its
 *      declared size fires — and the apply fails unless it does;
 *   5. rows_collapse's baseline also starts at the rebase (its 300-row fleet floor is not lowered).
 *
 * Hermetic: reads committed migrations only. The mutations at the bottom prove every check fails on the shape it
 * guards.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATIONS = join(new URL('..', import.meta.url).pathname, 'supabase/migrations');
const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const read = (f: string) => readFileSync(join(MIGRATIONS, f), 'utf8');
const latest = (needle: string) => {
  const hits = files.filter((f) => read(f).includes(needle));
  return hits.length ? read(hits[hits.length - 1]) : '';
};
const allWith = (...needles: string[]) => files.filter((f) => needles.every((n) => read(f).includes(n))).map(read).join('\n');

function problems(table: string, cand: string, collapse: string): string[] {
  const out: string[] = [];
  if (!/create table if not exists public\.ops_platform_catalogue_rebase/.test(table)) out.push('a committed migration creates ops_platform_catalogue_rebase');
  if (!/reason\s+text\s+not null check \(length\(reason\) >= 40\)/.test(table)) out.push('a rebase row must carry a real reason');
  if (!/source_rule_url\s+text\s+not null check \(source_rule_url ~ '\^https:\/\/'\)/.test(table)) out.push('a rebase row must point at the source rule (https)');
  if (!/'superoffice',\s*'2026-10-29[^']*',\s*24,/.test(table) || !/'https:\/\/superoffice\.sa\/robots\.txt'/.test(table)) {
    out.push('superoffice is rebased to 24 a run with robots.txt as its rule');
  }
  if (!/left join public\.ops_platform_catalogue_rebase cr on cr\.platform = r\.platform/.test(cand)
    || !/\(cr\.rebased_at is null or r\.started_at >= cr\.rebased_at\)/.test(cand)) {
    out.push('silent_partial_success drops only a rebased platform\'s pre-rebase runs');
  }
  if (!/c\.rows_seen < 0\.50 \* cr\.expected_rows_per_run/.test(cand) || !/'declared_catalogue'/.test(cand)
    || !/union all\s+select \* from declared/.test(cand)) {
    out.push('a rebased platform is held to its declared size from its first run');
  }
  if (!/d\.total < 0\.50 \* b\.p25_total/.test(cand) || !/c\.rows_seen < 0\.50 \* br\.median_rows/.test(cand)) {
    out.push('the fleet thresholds (0.50 × p25 / median) are unchanged');
  }
  if (!/hits is distinct from array\['__chk_rb_drop', '__chk_rb_new', '__chk_rb_none'\]/.test(cand)
    || !/'__chk_rb_ok'/.test(cand) || !/'__chk_rb_new_ok'/.test(cand)) {
    out.push('the latest candidates definition carries the both-directions rebase check block');
  }
  if (!/not exists \(select 1 from public\.ops_platform_catalogue_rebase cr\s+where cr\.platform = scrape_runs\.platform and scrape_runs\.started_at < cr\.rebased_at\)/.test(collapse)) {
    out.push('rows_collapse\'s baseline starts at the rebase');
  }
  if (/min_baseline\s+constant numeric := (?!300\b)\d+/.test(collapse) || /collapse_ratio constant numeric := (?!0\.20\b)[\d.]+/.test(collapse)) {
    out.push('rows_collapse\'s fleet floor and ratio are unchanged');
  }
  return out;
}

const table = latest('create table if not exists public.ops_platform_catalogue_rebase');
const cand = latest('function public.mon_silent_partial_success_candidates(');
const collapse = allWith('mon_detect_rows_collapse', 'ops_platform_catalogue_rebase');

let failures = 0;
const real = problems(table, cand, collapse);
for (const p of real) { failures++; console.error(`  ✗ ${p}`); }
if (!real.length) console.log('  ✓ the catalogue rebase is per platform, evidenced, and a post-rebase collapse still alarms');

function mutation(name: string, t: string, c: string, rc: string): void {
  if (problems(t, c, rc).length) { console.log(`  ✓ (mutation) catches ${name}`); return; }
  failures++;
  console.error(`  ✗ (mutation) NOT caught: ${name}`);
}
mutation('a rebase row without a reason', table.replace(/check \(length\(reason\) >= 40\)/, ''), cand, collapse);
mutation('a rebase row without its rule link', table.replace(/check \(source_rule_url ~ '\^https:\/\/'\)/, ''), cand, collapse);
mutation('the rebase dropping EVERY platform\'s history', table, cand.replace(/\(cr\.rebased_at is null or r\.started_at >= cr\.rebased_at\)/, '(r.started_at >= now() - interval \'3 days\')'), collapse);
mutation('the declared floor removed', table, cand.replace(/union all\s+select \* from declared/, ''), collapse);
mutation('the fleet threshold lowered', table, cand.replace(/c\.rows_seen < 0\.50 \* br\.median_rows/, 'c.rows_seen < 0.10 * br.median_rows'), collapse);
mutation('the rebase check block assertion dropped', table, cand.replace(/hits is distinct from array\['__chk_rb_drop', '__chk_rb_new', '__chk_rb_none'\]/, 'hits is null'), collapse);
mutation('rows_collapse not reading the rebase', table, cand, collapse.replace(/scrape_runs\.started_at < cr\.rebased_at/g, 'false'));
mutation('rows_collapse\'s fleet floor lowered', table, cand, collapse + '\n  min_baseline   constant numeric := 50;');

if (failures) { console.error(`\n✗ ${failures} check(s) failed`); process.exit(1); }
console.log('\nPASS — a catalogue rebase is scoped to one platform with evidence, and a collapse after it still alarms.');
