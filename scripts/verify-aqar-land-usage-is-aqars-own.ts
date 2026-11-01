// SOURCE IS TRUTH — an Aqar plot's type is what the SOURCE states, never a guess (P1 of 2026-10-10).
//
// The bug this pins: scrapers/aqar/enrich_residential.py keyword-scanned the WHOLE page text for
// «صناعي» / «زراعي» / «تجاري». Aqar's nav menu always says «مكتب تجاري» and a city's district list often
// says «حي الصناعية», so on 2026-10-10 every live Aqar plot (26,889) was commercial / industrial /
// agricultural and 0 were residential — while Aqar's own field said سكني on 18,522 of them
// (ad 6772165: page «نوع العقار: سكني», stored «أرض صناعية»). «الأراضي السكنية» showed no Aqar plot.
//
// The rule, in order (owner 2026-10-10):
//   1. Aqar's own «نوع العقار» always wins: سكني → Residential Land; تجاري and سكني/تجاري → Commercial Land.
//   2. Aqar silent → the SELLER'S OWN description (listing.content — never menus / district lists), only
//      the adjacent phrase أرض|ارض|الأرض|الارض + سكني/ة · تجاري/ة · صناعي/ة · زراعي/ة: exactly one usage →
//      that type, stored as the seller's word so the card shows it («أرض صناعي»); «سكني تجاري» → Commercial
//      Land; two different usages → unknown.
//   3. Neither → «أرض» = Other Land (owner: «don't show it in a specific property type»).
//   A page that could not be read, or a closed ad with no spec list, changes nothing.
//
// Inputs are what PRODUCTION sees: scripts/fixtures/aqar-land-<ad>.html.gz are the real server HTML of
// seven plots, fetched 2026-10-10 (PDPL: Arabic text → «x» except the land/usage words, phones →
// [redacted], avatars blanked). Ground truth, opened on sa.aqar.fm: 6772165 «سكني» · 6776403 «تجاري» ·
// 6887394 «سكني/تجاري» · 6910738 «سكني» while its seller writes «أرض تجارية» · 6878439 no «نوع العقار»,
// seller «ارض مسورة» (no usage) · 6634081 no «نوع العقار» (payload `type: 4`, unlabelled by Aqar),
// seller «ارض سكنية بصك» · 6768616 closed, no spec list. scripts/fixtures/aqar-land-descriptions.json
// holds excerpts of nine real recorded descriptions of silent plots (ad 6638771 is the owner's example).
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { pyCall } from './lib/pythonMutant.ts';
import { npmTestRuns } from './lib/testRegistry.ts';
import { normalizeType, CLEAN_TO_TYPE_AR, HIERARCHY } from '../src/data/propertyTypes.ts';

const ROOT = join(import.meta.dirname, '..');
const MOD = 'scrapers.aqar.enrich_residential';
const SRC = join(ROOT, 'scrapers/aqar/enrich_residential.py');
const FIX = join(ROOT, 'scripts/fixtures');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};
const mustCatch = (what: string, caught: boolean) => check(`MUTATION: catches ${what}`, caught);

// The REAL enrich_residential() runs end to end on the fixture page (only the network call is
// replaced), then the row goes through the REAL upsert guard, so «what lands in the column» is tested:
// a value, or KEEP (unknown — the stored value survives). Plus the provenance tag it records.
const HARNESS = `

def get(url, *a, **k):
    import gzip, os, re as _re, types
    ad = _re.search(r"(\\d{6,})$", url).group(1)
    path = os.path.join(${JSON.stringify(FIX)}, "aqar-land-%s.html.gz" % ad)
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
        return ["NO_ROW", None]
    w = {"property_type": row["property_type"]}
    _db._unknown_must_not_overwrite_known(w)
    return [w["property_type"] if "property_type" in w else "KEEP", row["source_capture"].get("land_usage_from")]

def _barrier_desc(text):
    return _usage_from_description(text)

def _barrier_word(word):
    import contextlib, io
    with contextlib.redirect_stdout(io.StringIO()):
        return _land_type({"specs": [{"name": "area", "value": 600}, {"name": "type", "value": word}]}, "0")[0]

def _barrier_types():
    return {"desc": LAND_DESCRIPTION_TYPES, "field": AQAR_LAND_USAGE, "other": LAND_OTHER}
`;
const CASES: [string, boolean, string, string | null, string][] = [
  ['6772165', false, 'Residential Land', 'aqar_field', 'Aqar «سكني» → Residential Land (the ad that surfaced the bug)'],
  ['6776403', false, 'Commercial Land', 'aqar_field', 'Aqar «تجاري» → Commercial Land'],
  ['6887394', false, 'Commercial Land', 'aqar_field', 'Aqar «سكني/تجاري» → Commercial Land (owner mixed-use rule)'],
  ['6910738', false, 'Residential Land', 'aqar_field', 'Aqar «سكني» WINS over the seller\'s «أرض تجارية»'],
  ['6634081', false, 'أرض سكنية', 'description', 'Aqar silent (`type: 4`), seller «ارض سكنية» → the seller\'s word'],
  ['6878439', false, 'أرض', 'none', 'Aqar silent, seller states no usage («ارض مسورة») → «أرض» = Other Land, never commercial'],
  ['6768616', false, 'KEEP', null, 'a closed ad with no spec list → unknown, the stored type survives'],
  ['6772165', true, 'KEEP', null, 'a fetch without aqar\'s payload → unknown, the stored type survives'],
];
type Desc = { ad: string; text: string; want: string | null; why: string };
const DESCS: Desc[] = JSON.parse(readFileSync(join(FIX, 'aqar-land-descriptions.json'), 'utf8'));
// The de-tagged page of 6772165 — the menu («مكتب تجاري») and district list («حي الصناعية») the old guess read.
const PAGE = gunzipSync(readFileSync(join(FIX, 'aqar-land-6772165.html.gz'))).toString('utf8')
  .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const real = readFileSync(SRC, 'utf8');
const run = (source: string) =>
  pyCall(ROOT, MOD, '_barrier_land', CASES.map(([ad, shell]) => [ad, shell]), source + HARNESS) as [string | null, string | null][];
const descs = (source: string) => pyCall(ROOT, MOD, '_barrier_desc', [...DESCS.map((d) => [d.text]), [PAGE]], source + HARNESS) as (string | null)[];
const word = (source: string, w: string) => pyCall(ROOT, MOD, '_barrier_word', [[w]], source + HARNESS)[0];
const pagesRight = (o: [string | null, string | null][]) => CASES.every(([, , want, from], i) => o[i][0] === want && o[i][1] === from);
const descsRight = (o: (string | null)[]) => DESCS.every((d, i) => o[i] === d.want) && o[DESCS.length] === null;

// ── the real enricher on the real pages ─────────────────────────────────────────────────────────
const o = run(real);
CASES.forEach(([ad, , want, from, label], i) => check(`${ad}: ${label}`, o[i][0] === want && o[i][1] === from,
  `got ${JSON.stringify(o[i])}`));
const d = descs(real);
DESCS.forEach((c, i) => check(`description ${c.ad}: ${c.why}`, d[i] === c.want, `got ${JSON.stringify(d[i])}`));
check('the whole page of 6772165 (menu «مكتب تجاري», district list «حي الصناعية») states no usage',
  d[DESCS.length] === null, `got ${JSON.stringify(d[DESCS.length])}`);
check('…and that page really carries the old guess\'s triggers (else the check above proves nothing)',
  PAGE.includes('تجاري') && PAGE.includes('الصناعية'));
check('an Aqar field word we have never seen («صناعي») → unknown, never commercial', word(real, 'صناعي') === null,
  `got ${JSON.stringify(word(real, 'صناعي'))}`);

// ── the app reads what the scraper writes: same clean type, card word = the source's word ─────────
const T = pyCall(ROOT, MOD, '_barrier_types', [[]], real + HARNESS)[0] as { desc: Record<string, string>; field: Record<string, string>; other: string };
const drift = Object.entries(T.desc).filter(([raw, clean]) => normalizeType(raw, 'res').clean !== clean
  || !(CLEAN_TO_TYPE_AR[clean] ?? []).includes(raw));
check('every seller-word type the scraper stores maps to the SAME clean type in the app and is searched under it',
  drift.length === 0, JSON.stringify(drift));
// A real clean type but NO filter box (owner 2026-10-11: «not searchable by property type, but by other filters») —
// the box half of this is verify-other-land-is-not-a-box.ts.
check('«أرض» (Other Land) is its own clean type, offered in no land box',
  normalizeType(T.other, 'res').clean === 'Other Land' && (CLEAN_TO_TYPE_AR['Other Land'] ?? []).includes(T.other)
  && !HIERARCHY.Commercial.some((g) => g.types.includes('Other Land')));
const usageBoxes = ['Residential Land', 'Commercial Land', 'Industrial Land', 'Agriculture Plot'];
check('…and never under أرض سكنية / تجارية / صناعية / زراعية',
  usageBoxes.every((c) => !(CLEAN_TO_TYPE_AR[c] ?? []).includes(T.other) && !(CLEAN_TO_TYPE_AR[c] ?? []).includes('Land')),
  JSON.stringify(usageBoxes.map((c) => CLEAN_TO_TYPE_AR[c])));

// ── mutation proof: each mutant must turn at least one check red ────────────────────────────────
const mutate = (label: string, fn: (s: string) => string) => {
  const m = fn(real);
  if (m === real) { check(`MUTATION ${label}: ANCHOR DRIFTED — mutant never applied`, false); return null; }
  return m;
};
// (a) THE OLD PAGE-TEXT GUESS, verbatim — the bug as shipped.
const a = mutate('(a)', (s) => s.replace('        property_type, land_usage_from = _land_type(obj, ad_number)\n',
  `        if re.search(r"صناعي", text):
            property_type = "Industrial Land"
        elif re.search(r"زراعي|مزرع", text):
            property_type = "Agriculture Plot"
        elif re.search(r"تجاري", text):
            property_type = "Commercial Land"
`));
mustCatch('the page-text guess coming back (a residential plot typed from the nav menu)', !!a && run(a)[0][0] !== 'Residential Land');
// (b) unknown defaulting to commercial — Aqar silent and the seller silent, we say «تجاري».
const b = mutate('(b)', (s) => s.replace('    return (stated, "description") if stated else (LAND_OTHER, "none")\n',
  '    return (stated, "description") if stated else ("Commercial Land", "none")\n'));
mustCatch('a plot nobody typed defaulting to Commercial Land', !!b && !pagesRight(run(b)));
const b2 = mutate('(b2)', (s) => s.replace('            return None, None\n        return AQAR_LAND_USAGE[word], "aqar_field"\n',
  '            return "Commercial Land", "aqar_field"\n        return AQAR_LAND_USAGE[word], "aqar_field"\n'));
mustCatch('an unmapped Aqar usage word defaulting to Commercial Land', !!b2 && word(b2, 'صناعي') !== null);
// (c) a residential page stored as commercial.
const c = mutate('(c)', (s) => s.replace('"سكني": "Residential Land"', '"سكني": "Commercial Land"'));
mustCatch('Aqar «سكني» stored as Commercial Land', !!c && run(c)[0][0] !== 'Residential Land');
// (d) the owner's mixed-use rule broken (field and description).
const dm = mutate('(d)', (s) => s.replace('"سكني/تجاري": "Commercial Land"', '"سكني/تجاري": "Residential Land"'));
mustCatch('Aqar «سكني/تجاري» filed as residential (owner rule: Commercial Land)', !!dm && run(dm)[2][0] !== 'Commercial Land');
const dm2 = mutate('(d2)', (s) => s.replace('LAND_DESCRIPTION_TYPES[LAND_MIXED] = "Commercial Land"', 'LAND_DESCRIPTION_TYPES[LAND_MIXED] = "Residential Land"'));
mustCatch('the seller\'s «سكني تجاري» filed as residential', !!dm2
  && (pyCall(ROOT, MOD, '_barrier_types', [[]], dm2 + HARNESS)[0] as typeof T).desc['أرض سكني تجاري'] !== T.desc['أرض سكني تجاري']);
// (e) a failed / closed read erasing the stored type.
const e = mutate('(e)', (s) => s.replace('    if not isinstance(specs, list) or not specs:\n        return None, None\n',
  '    if not isinstance(specs, list) or not specs:\n        return LAND_OTHER, "none"\n'));
mustCatch('a failed or closed read overwriting the stored type', !!e && !pagesRight(run(e)));
// (f) MENU TEXT MATCHED — the «أرض» adjacency dropped: a usage word anywhere counts (the old guess's shape).
const f = mutate('(f)', (s) => s.replace('[وبف]?(?:ال)?[أا]رض\\s+({_USAGE_WORD})', '({_USAGE_WORD})'));
mustCatch('menu / district-list text matched as the plot\'s usage (adjacency to «أرض» dropped)', !!f && !descsRight(descs(f)));
// (g) NEAR-INDUSTRIAL MATCHED — «أرض … المنطقة الصناعية» read as a usage (words allowed in between).
const g = mutate('(g)', (s) => s.replace('[وبف]?(?:ال)?[أا]رض\\s+({_USAGE_WORD})', '[وبف]?(?:ال)?[أا]رض.{0,80}?\\s(?:ال)?({_USAGE_WORD})'));
mustCatch('«الأرض … يخدم المنطقة الصناعية» typed industrial', !!g && !descsRight(descs(g)));
// (h) CONFLICTING PHRASES RESOLVED TO ONE — the first usage wins instead of «unknown».
const h = mutate('(h)', (s) => s.replace('    return next(iter(kinds.values())) if len(kinds) == 1 else None\n',
  '    return next(iter(kinds.values())) if kinds else None\n'));
mustCatch('two different stated usages resolved to the first one', !!h && !descsRight(descs(h)));
// (i) the seller's words winning over Aqar's own field.
const i = mutate('(i)', (s) => s.replace('    if word:\n        if word not in AQAR_LAND_USAGE:',
  '    if _usage_from_description(obj.get("content")):\n        return _usage_from_description(obj.get("content")), "description"\n    if word:\n        if word not in AQAR_LAND_USAGE:'));
mustCatch('the seller\'s «أرض تجارية» overriding Aqar\'s own «سكني» (6910738)', !!i && run(i)[3][0] !== 'Residential Land');

check('npm test runs this guard', npmTestRuns(ROOT, 'verify-aqar-land-usage-is-aqars-own'));

console.log(failed === 0
  ? '\n✅ aqar-land-usage: Aqar\'s «نوع العقار» first, then the seller\'s own adjacent words, else «أرض»; a failed read changes nothing.\n'
  : `\n❌ aqar-land-usage: ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
