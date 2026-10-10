// SOURCE IS TRUTH — an Aqar plot's type is Aqar's OWN «نوع العقار», never a guess (P1 of 2026-10-10).
//
// The bug this pins: scrapers/aqar/enrich_residential.py keyword-scanned the WHOLE page text for
// «صناعي» / «زراعي» / «تجاري». Aqar's nav menu always says «مكتب تجاري» and a city's district list often
// says «حي الصناعية», so on 2026-10-10 every live Aqar plot (26,889) was commercial / industrial /
// agricultural and 0 were residential — while Aqar's own field said سكني on 18,522 of them
// (ad 6772165: page «نوع العقار: سكني», stored «أرض صناعية»). «الأراضي السكنية» showed no Aqar plot.
//
// Inputs are what PRODUCTION sees: scripts/fixtures/aqar-land-<ad>.html.gz are the real server HTML
// of five plots, fetched 2026-10-10 (PDPL: Arabic text → «x» except the usage words سكني / تجاري /
// صناعي / زراعي / نوع العقار, phones → [redacted], avatars blanked). Ground truth, opened on
// sa.aqar.fm: 6772165 «سكني» · 6776403 «تجاري» · 6887394 «سكني/تجاري» · 6878439 and 6634081 show no
// «نوع العقار» (6634081's payload carries `type: 4`, which Aqar's own dictionary does not label) ·
// 6768616 is a closed ad with no spec list at all.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { pyCall } from './lib/pythonMutant.ts';
import { npmTestRuns } from './lib/testRegistry.ts';

const ROOT = join(import.meta.dirname, '..');
const MOD = 'scrapers.aqar.enrich_residential';
const SRC = join(ROOT, 'scrapers/aqar/enrich_residential.py');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};
const mustCatch = (what: string, caught: boolean) => check(`MUTATION: catches ${what}`, caught);

// The REAL enrich_residential() runs end to end on the fixture page (only the network call is
// replaced), then the row goes through the REAL upsert guard, so «what lands in the column» is tested:
// a value, NULL (Aqar silent), or KEEP (unknown — the stored value survives).
const HARNESS = `

def get(url, *a, **k):
    import gzip, os, re as _re, types
    ad = _re.search(r"(\\d{6,})$", url).group(1)
    path = os.path.join(${JSON.stringify(join(ROOT, 'scripts/fixtures'))}, "aqar-land-%s.html.gz" % ad)
    html = gzip.open(path, "rb").read().decode("utf-8")
    if _BARRIER_SHELL:   # a fetch that came back without aqar's payload (shell / block page)
        html = _re.sub(r"<script>self\\.__next_f\\.push\\(.*?</script>", "", html, flags=_re.S)
    return types.SimpleNamespace(text=html)

_BARRIER_SHELL = False

def _barrier_land(ad, shell):
    global _BARRIER_SHELL
    _BARRIER_SHELL = shell
    import contextlib, io
    from scrapers.common import db as _db
    with contextlib.redirect_stdout(io.StringIO()):
        row = enrich_residential("https://sa.aqar.fm/x/x-%s" % ad, type_slug="land", deal_slug="sale")
    if row is None:
        return "NO_ROW"
    w = {"property_type": row["property_type"]}
    _db._unknown_must_not_overwrite_known(w)
    return w["property_type"] if "property_type" in w else "KEEP"

def _barrier_word(word):
    import contextlib, io
    with contextlib.redirect_stdout(io.StringIO()):
        t = _land_type({"specs": [{"name": "area", "value": 600}, {"name": "type", "value": word}]}, "0")
    return t if t is None or isinstance(t, str) else "SENTINEL"
`;
const CASES: [string, boolean, string | null, string][] = [
  ['6772165', false, 'Residential Land', 'Aqar «سكني» → Residential Land (the ad that surfaced the bug)'],
  ['6776403', false, 'Commercial Land', 'Aqar «تجاري» → Commercial Land'],
  ['6887394', false, 'Commercial Land', 'Aqar «سكني/تجاري» → Commercial Land (owner mixed-use rule)'],
  ['6878439', false, null, 'Aqar lists the specs but no usage → NULL written, never a guessed commercial'],
  ['6634081', false, null, 'payload `type: 4` (unlabelled by Aqar, not shown on its page) → NULL'],
  ['6768616', false, 'KEEP', 'a closed ad with no spec list → unknown, the stored type survives'],
  ['6772165', true, 'KEEP', 'a fetch without aqar\'s payload → unknown, the stored type survives'],
];
const real = readFileSync(SRC, 'utf8');
const run = (source: string) =>
  pyCall(ROOT, MOD, '_barrier_land', CASES.map(([ad, shell]) => [ad, shell]), source + HARNESS) as (string | null)[];
const word = (source: string, w: string) => pyCall(ROOT, MOD, '_barrier_word', [[w]], source + HARNESS)[0];
const allRight = (o: (string | null)[]) => CASES.every(([, , want], i) => o[i] === want);

// ── the real enricher on the real pages ─────────────────────────────────────────────────────────
const o = run(real);
CASES.forEach(([ad, , want, label], i) => check(`${ad}: ${label}`, o[i] === want, `got ${JSON.stringify(o[i])}`));
check('a usage word Aqar has never shown («صناعي») → unknown, never commercial', word(real, 'صناعي') === null,
  `got ${JSON.stringify(word(real, 'صناعي'))}`);
// 6772165's own usage is سكني, so a «تجاري» anywhere on it is the nav menu the old guess fell for.
check('the residential fixture still carries the old guess\'s trigger («تجاري» off-listing), else mutant (a) proves nothing',
  gunzipSync(readFileSync(join(ROOT, 'scripts/fixtures/aqar-land-6772165.html.gz'))).toString('utf8').includes('تجاري'));

// ── mutation proof: each mutant must turn at least one check red ────────────────────────────────
const mutate = (label: string, fn: (s: string) => string) => {
  const m = fn(real);
  if (m === real) { check(`MUTATION ${label}: ANCHOR DRIFTED — mutant never applied`, false); return null; }
  return m;
};
// (a) THE OLD PAGE-TEXT GUESS, verbatim — the bug as shipped.
const a = mutate('(a)', (s) => s.replace('        property_type = _land_type(obj, ad_number)\n',
  `        if re.search(r"صناعي", text):
            property_type = "Industrial Land"
        elif re.search(r"زراعي|مزرع", text):
            property_type = "Agriculture Plot"
        elif re.search(r"تجاري", text):
            property_type = "Commercial Land"
`));
const ao = a ? run(a) : null;
mustCatch('the page-text guess coming back (a residential plot typed from the nav menu)',
  !!ao && ao[0] !== 'Residential Land');
// (b) unknown defaulting to commercial — Aqar silent, we say «تجاري».
const b = mutate('(b)', (s) => s.replace('    if not word:\n        return LAND_USAGE_SILENT\n',
  '    if not word:\n        return "Commercial Land"\n'));
mustCatch('a silent plot defaulting to Commercial Land', !!b && !allRight(run(b)));
const b2 = mutate('(b2)', (s) => s.replace('    return AQAR_LAND_USAGE.get(word)\n',
  '    return AQAR_LAND_USAGE.get(word, "Commercial Land")\n'));
mustCatch('an unmapped usage word defaulting to Commercial Land', !!b2 && word(b2, 'صناعي') !== null);
// (c) a residential page stored as commercial.
const c = mutate('(c)', (s) => s.replace('"سكني": "Residential Land"', '"سكني": "Commercial Land"'));
mustCatch('Aqar «سكني» stored as Commercial Land', !!c && run(c)[0] !== 'Residential Land');
// (d) the owner's mixed-use rule broken.
const d = mutate('(d)', (s) => s.replace('"سكني/تجاري": "Commercial Land"', '"سكني/تجاري": "Residential Land"'));
mustCatch('«سكني/تجاري» filed as residential (owner rule: Commercial Land)', !!d && run(d)[2] !== 'Commercial Land');
// (e) a failed / closed read erasing the stored type.
const e = mutate('(e)', (s) => s.replace('    if not isinstance(specs, list) or not specs:\n        return None\n',
  '    if not isinstance(specs, list) or not specs:\n        return LAND_USAGE_SILENT\n'));
mustCatch('a failed or closed read writing NULL over the stored type', !!e && !allRight(run(e)));

check('npm test runs this guard', npmTestRuns(ROOT, 'verify-aqar-land-usage-is-aqars-own'));

console.log(failed === 0
  ? '\n✅ aqar-land-usage: a plot takes Aqar\'s own «نوع العقار»; silent → NULL; a failed read changes nothing.\n'
  : `\n❌ aqar-land-usage: ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
