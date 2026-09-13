// A DETECTOR THAT ASKS FOR A 404 IS BLIND TO EVERY SOURCE THAT DOES NOT SPEAK 404.
//
// `mon_detect_served_despite_direct_404()` is, in ops_incident #188's words, "the ONLY thing
// watching whether source-confirmed-dead listings are being served to users". Until 2026-09-13 its
// dead test was `http_status in (404, 410)` — in BOTH the `latest_trusted_dead` CTE and the final
// WHERE — and that is a statement about the wire, not about the source's answer.
//
// aqar's dead shape is an HTTP **200** with a «مغلق» badge and no offers node.
// docs/ops/LISTING_LIVENESS.md §0 opens on exactly that shape and records ~14.8% of aqar's active
// population reading healthy forever because of it. Measured on the first run after the ledger
// gained a writer (ops_incident #214): 1,803 rows, **905 kills, zero 404s**. The aqar arms could
// not fire at all — and once the ledger stopped being empty they began READING as covered, which is
// the false-green class AGENTS.md opens on: nine dark detectors reporting a clean bill of health.
//
// THE CONTRACT THIS HOLDS. Each arm declares what CONFIRMED DEAD means in its own ledger's
// vocabulary, and the shared test is `http_status in (404,410) OR ledger_dead`:
//
//     gathern   verdict in ('kill','dead_confirmed')     wasalt    get_verdict = 'dead'
//     aqar      verdict = 'kill'                         dealapp   verdict = 'kill'
//
// Per-arm on purpose: a platform's word for "dead" is a fact about that platform, and a new one
// declares its own rather than inheriting a guess. Additive, and for two platforms a MEASURED
// no-op — gathern's dead verdicts are 404 at 2530/2530 and 3848/3848, wasalt's at 16677/16677, so
// the new limb is a subset of the old one there and cannot change behaviour.
//
// PROVEN IN PRODUCTION, in both directions, 2026-09-13:
//   · the aqar funnel went A 1803 → B 905 ledger-dead (0 under the old test) → C 905 past the
//     trusted-run gate → D 905 latest-probe → **E 0 still active**. Every limb passes traffic; the
//     arm now ends at the ASSERTION rather than at the first line.
//   · alert_event 2428 (gathern, 1,061 rows) stayed OPEN and re-affirmed at 17:19:55 carrying
//     `by_http_status: 1061, by_ledger_verdict: 0` — the no-op, confirmed by the detector itself.
//     Nothing was silenced and no threshold moved (LISTING_LIVENESS.md §7).
//
// WHY THE COMMENT STRIP BELOW IS LOAD-BEARING: the migration's own header quotes the BROKEN
// predicate (`http_status in (404, 410)`) more than once while explaining it. A scan that read
// prose would find the defective text in the explanation and call a correct file wrong — or worse,
// find it in a header and call a reverted file right. Judge the code only.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');
const FN = 'mon_detect_served_despite_direct_404';

/** SQL with `--` comments removed, so prose can never be read as code. */
const codeOnly = (sql: string) => sql.replace(/^\s*--.*$/gm, '').replace(/\s--.*$/gm, '');

function definitions(files: Record<string, string>): string[] {
  return Object.keys(files)
    .filter((f) => new RegExp(`function\\s+public\\.${FN}\\s*\\(`).test(files[f]))
    .sort();
}

/** One problem per broken guarantee, judged on the LAST committed definition. */
export function ledgerAwareProblems(files: Record<string, string>): string[] {
  const defs = definitions(files);
  // Fails CLOSED — "the detector is not in the repo" must never read as "the detector is fine".
  if (defs.length === 0) return [`no committed migration defines public.${FN}()`];

  const latest = defs[defs.length - 1];
  const sql = codeOnly(files[latest]);
  const bad: string[] = [];
  const need = (label: string, re: RegExp) => { if (!re.test(sql)) bad.push(`${latest}: ${label}`); };

  // ── Every arm declares its own confirmed-dead vocabulary ──────────────────────────────────────
  need('the gathern arm declares no ledger verdict', /d\.verdict\s+in\s*\(\s*'kill'\s*,\s*'dead_confirmed'\s*\)/);
  need('the wasalt arms declare no ledger verdict', /d\.get_verdict\s*=\s*'dead'/);
  need("the aqar/dealapp arms declare no ledger verdict — and aqar's death is a 200, so without it "
     + 'those arms cannot fire at all', /d\.verdict\s*=\s*'kill'/);

  // ── ledger_dead survives the pipeline: named in probes, carried through latest_probe ──────────
  need('the probes CTE does not carry ledger_dead, so no arm can report one',
    /probes\s*\([^)]*\bledger_dead\b[^)]*\)/);
  need('latest_probe drops ledger_dead, so the final test can never see it',
    /distinct on \(src, listing_id\)[\s\S]{0,200}?\bledger_dead\b[\s\S]{0,120}?from probes/);

  // ── BOTH dead tests consult the ledger, not only the wire ─────────────────────────────────────
  const deadTest = /\(\s*\w+\.http_status in \(404, ?410\)\s+or\s+\w+\.ledger_dead\s*\)/g;
  const found = sql.match(deadTest)?.length ?? 0;
  if (found < 2) {
    bad.push(`${latest}: only ${found} of the 2 dead tests consult the ledger — `
      + 'latest_trusted_dead and the final WHERE must BOTH accept a ledger verdict, or a '
      + 'non-404 platform is filtered out at whichever one was missed');
  }
  // A bare status-only test anywhere is the pre-fix predicate coming back.
  if (/where\s+\w+\.http_status in \(404, ?410\)\s*$/m.test(sql)
      || /and\s+\w+\.http_status in \(404, ?410\)\s*\n\s*and\s+\w+\.active/.test(sql)) {
    bad.push(`${latest}: a status-only dead test survives — that is the blind predicate`);
  }

  // ── The operator can tell the two signals apart ───────────────────────────────────────────────
  need('the payload does not report which signal matched (by_http_status / by_ledger_verdict), so a '
     + 'full-grace kill and an ungraced 404 read identically',
    /'by_http_status',\s*r\.by_http_status[\s\S]{0,120}?'by_ledger_verdict',\s*r\.by_ledger_verdict/);

  return bad;
}

function load(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of readdirSync(MIGRATIONS)) {
    if (!f.endsWith('.sql')) continue;
    const body = readFileSync(join(MIGRATIONS, f), 'utf8');
    if (body.includes(FN)) out[f] = body;
  }
  return out;
}

const files = load();
const real = ledgerAwareProblems(files);

let failures = 0;
const fail = (m: string) => { failures++; console.log(`  ❌ ${m}`); };

console.log(`verify-served-despite-404-reads-the-ledger: ${Object.keys(files).length} migration(s) mention ${FN}`);
if (real.length) for (const p of real) fail(p);
else console.log('  ✓ every arm declares its own confirmed-dead vocabulary and both dead tests read it');

const latest = definitions(files).slice(-1)[0];
const mustCatch = (what: string, mutate: (s: string) => string) => {
  const mutated = mutate(files[latest]);
  if (mutated === files[latest]) { fail(`MUTATION NOT APPLIED (${what})`); return; }
  const caught = ledgerAwareProblems({ ...files, [latest]: mutated }).length > real.length;
  if (caught) console.log(`  ✓ mutation caught: ${what}`);
  else fail(`MUTATION SURVIVED: ${what}`);
};

// The pre-fix predicate, exactly: both dead tests keyed on the wire alone.
mustCatch('BOTH dead tests reverted to status-only (the blind pre-fix detector)',
  (s) => s.replace(/\((\w+)\.http_status in \(404, 410\) or \1\.ledger_dead\)/g, '$1.http_status in (404, 410)'));
mustCatch('only the final WHERE reverted to status-only',
  (s) => s.replace(/where \(lp\.http_status in \(404, 410\) or lp\.ledger_dead\)/,
                   'where lp.http_status in (404, 410)'));
mustCatch('only latest_trusted_dead reverted to status-only, silently dropping non-404 platforms there',
  (s) => s.replace(/where \(p\.http_status in \(404, 410\) or p\.ledger_dead\)/,
                   'where p.http_status in (404, 410)'));
mustCatch('the aqar/dealapp vocabulary removed, returning those arms to dark',
  (s) => s.replace(/\(d\.verdict = 'kill'\)/g, '(false)'));
mustCatch("the aqar arms given the WRONG vocabulary (wasalt's word, which aqar never writes)",
  (s) => s.replace(/\(d\.verdict = 'kill'\)/g, "(d.verdict = 'dead')"));
mustCatch('the gathern vocabulary removed', (s) => s.replace(/d\.verdict in \('kill','dead_confirmed'\)/, 'false'));
mustCatch('the wasalt vocabulary removed', (s) => s.replace(/d\.get_verdict = 'dead'/g, 'false'));
mustCatch('ledger_dead dropped from the probes column list',
  (s) => s.replace(/probes\(src, tok, listing_id, http_status, ledger_dead, run_at, last_seen_at, active\)/,
                   'probes(src, tok, listing_id, http_status, run_at, last_seen_at, active)'));
mustCatch('ledger_dead dropped on the way through latest_probe',
  (s) => s.replace(/src, tok, listing_id, http_status, ledger_dead, run_at, last_seen_at, active\n        from probes/,
                   'src, tok, listing_id, http_status, run_at, last_seen_at, active\n        from probes'));
mustCatch('the signal split removed from the payload',
  (s) => s.replace(/'by_http_status', r\.by_http_status,\n\s*'by_ledger_verdict', r\.by_ledger_verdict,\n/, ''));

// The bypass: a LATER migration redefining the detector back to the wire-only test.
{
  const later = '29991231000000_a_later_migration_redefines_the_detector.sql';
  const blind = `create or replace function public.${FN}() returns integer language plpgsql as`
    + ` $function$ begin return 0; end; $function$;`;
  const caught = ledgerAwareProblems({ ...files, [later]: blind }).length > real.length;
  if (caught) console.log('  ✓ mutation caught: a later create-or-replace going back to the wire-only test');
  else fail('MUTATION SURVIVED: a later create-or-replace going back to the wire-only test');
}
{
  const caught = ledgerAwareProblems({}).length > 0;
  if (caught) console.log('  ✓ mutation caught: an empty corpus fails closed');
  else fail('MUTATION SURVIVED: an empty corpus read as clean');
}

// NEGATIVE CONTROLS. The first is the one that matters here: the header QUOTES the broken
// predicate while explaining it, so a prose-reading scan would invert on a correct file.
{
  const still = ledgerAwareProblems({ ...files, [latest]: files[latest].replace(/^-- /gm, '--   ') }).length;
  if (still === real.length) console.log('  ✓ negative control: a comment-only edit stays green');
  else fail(`NEGATIVE CONTROL FAILED: reformatting comments changed the verdict (${real.length} → ${still})`);
}
{
  // Adding a NEW platform arm with its own vocabulary must not trip anything.
  const extra = files[latest].replace(/\), dc as \(/,
    "), xx as (\n      select 'x_residential_listings'::text, 'x'::text, d.listing_id, d.http_status,"
    + " (d.verdict = 'gone'), d.run_at, r0.last_seen_at, r0.active from public.x_liveness_detail d"
    + ' join public.x_residential_listings r0 on r0.id = d.listing_id\n    ), dc as (');
  const still = ledgerAwareProblems({ ...files, [latest]: extra }).length;
  if (still === real.length) console.log('  ✓ negative control: a new arm with its own vocabulary stays green');
  else fail(`NEGATIVE CONTROL FAILED: adding a platform arm changed the verdict (${real.length} → ${still})`);
}

if (failures) {
  console.log(`\n❌ verify-served-despite-404-reads-the-ledger: ${failures} failure(s).`);
  process.exit(1);
}
console.log('\n✅ verify-served-despite-404-reads-the-ledger: all checks passed.');
