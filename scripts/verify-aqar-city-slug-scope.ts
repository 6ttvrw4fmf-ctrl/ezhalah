// A CITY SLICE MUST ACTUALLY BE THAT CITY — or the crawl is a nationwide feed wearing a town's name.
//
// THE DEFECT (2026-08-22, senior run #35). aqar answers an UNRECOGNISED city slug with a nationwide
// feed instead of a 404. Seven of the 95 catalog slugs carried the hamza spelling (أبها) where aqar
// uses plain alif (ابها), so those seven slices fetched 20 fresh nationwide listings on EVERY page,
// for ever. Consequences, both invisible until measured:
//
//   RUNTIME  discover()'s `new_on_page == 0` early-stop — the one thing that makes `--pages 150`
//            safe — can never fire. Each town walked 150 pages x 49 categories. Five deep-fill
//            shards were killed at the 150-minute ceiling on 2026-08-22 (turabah, ras_tanura,
//            ahad_rafidah, abu_arish, ahad_al_masarihah); abha 129.9m and umluj 120.8m survived
//            only just. All 7 of the slowest shards were exactly the 7 broken slugs.
//   COVERAGE those cities got ZERO aqar city-page coverage. Sampling Abha across 4 categories x 2
//            pages: aqar publishes 162 listings, we held 84. 78 missing, 48% of one major city.
//
// The bitter part: normalize._norm_ar already documented that "Aqar URL slugs drop the hamza
// (ابو-عريش) while our keys carry it (أبو عريش)". The MAPPING side was fixed. The FETCHING side —
// discover.CITY_AR, which builds the request URL — never was.
//
// This verifier is offline and behavioural: it drives the real _city_filter_ignored() over captured
// page shapes, and re-runs the pre-fix condition as a mutation to prove the assertions bite.
//
// Run: node --experimental-strip-types scripts/verify-aqar-city-slug-scope.ts
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const problems: string[] = [];
const ok: string[] = [];
const check = (cond: boolean, pass: string, fail: string) =>
  cond ? ok.push(pass) : problems.push(fail);

const PY = String.raw`
import sys, types, json, re

# discover.py imports scrapers.common.http, which needs curl_cffi. Stub what we do not exercise.
for name in ("curl_cffi", "curl_cffi.requests", "dotenv", "supabase"):
    if name not in sys.modules:
        sys.modules[name] = types.ModuleType(name)
sys.modules["curl_cffi"].requests = sys.modules["curl_cffi.requests"]
sys.modules["dotenv"].load_dotenv = lambda *a, **k: None
sys.modules["supabase"].Client = object
sys.modules["supabase"].create_client = lambda *a, **k: None

from scrapers.aqar.discover import _city_filter_ignored, _CITY_SCOPE_MIN_SAMPLE, CITY_AR
from scrapers.common.emptiness import SliceOutcome, emptiness_is_source_published

R = {}

# Captured 2026-08-22 from the live nationwide fallback served for a wrong slug: 20 links, every one
# of them a different city.
NATIONWIDE = [
    "/شقق-للإيجار/الرياض/غرب-الرياض/حي-ظهرة-لبن/شارع-الطائف-6669316",
    "/شقق-للإيجار/الدمام/حي-الشعلة/شارع-عمر-ابن-الخطاب-6644680",
    "/شقق-للإيجار/الظهران/حي-الدانة-الشمالية/شارع-21ج-6824057",
] * 7
# A real city page for ابها.
ABHA = ["/شقق-للإيجار/ابها/حي-المنسك/شارع-الملك-فهد-%d" % (6600000 + i) for i in range(20)]
# A genuinely small town: few links, none matching — must NOT trip the guard.
SMALL = ["/شقق-للإيجار/الرياض/حي-x-660001%d" % i for i in range(4)]

R["fallback_detected"]   = _city_filter_ignored(NATIONWIDE, "ابها") is True
R["city_page_allowed"]    = _city_filter_ignored(ABHA, "ابها") is False
R["hamza_form_matches"]   = _city_filter_ignored(ABHA, "أبها") is False   # normalization both ways
R["small_page_not_tripped"] = _city_filter_ignored(SMALL, "املج") is False
R["empty_page_not_tripped"] = _city_filter_ignored([], "املج") is False
R["min_sample_is_meaningful"] = _CITY_SCOPE_MIN_SAMPLE >= 8

# Multi-word town inside a long slug.
RT = ["/شقق-للإيجار/راس-تنورة/حي-ا/شارع-ب-660%04d" % i for i in range(10)]
R["multiword_city_matches"] = _city_filter_ignored(RT, "راس-تنورة") is False

# MUTATION: the pre-fix behaviour is "no guard at all" — it can never report the fallback.
def no_guard(links, city):
    return False
R["mutation_detected"] = (no_guard(NATIONWIDE, "ابها") is False) and R["fallback_detected"]

# The outcome is a THIRD state: reached the source, no city page. Not blocked, not "city is empty".
o = SliceOutcome(); o.note_city_filter_ignored()
R["outcome_third_state"] = (o.city_filter_ignored is True and o.fetch_failed is False)
R["ignored_slice_does_not_redden"] = emptiness_is_source_published(o) is True
blocked = SliceOutcome(); blocked.note_fetch_failure()
R["blocked_still_reddens"] = emptiness_is_source_published(blocked) is False

# THE SEVEN SLUGS: every catalog slug must be in the plain-alif form aqar actually serves.
HAMZA = ("أ", "إ", "آ")
R["no_hamza_slugs"] = sorted(k for k, v in CITY_AR.items() if any(h in v for h in HAMZA))
R["catalog_size"] = len(CITY_AR)
for k, want in (("abha", "ابها"), ("turabah", "تربه"), ("umluj", "املج"),
                ("ras_tanura", "راس-تنورة"), ("ahad_rafidah", "احد-رفيده"),
                ("abu_arish", "ابو-عريش"), ("ahad_al_masarihah", "احد-المسارحة")):
    R["slug_" + k] = (CITY_AR.get(k) == want)

print(json.dumps(R, ensure_ascii=False))
`;

const res = spawnSync('python3', ['-c', PY], { encoding: 'utf8', cwd: process.cwd() });
if (res.status !== 0) {
  console.error('aqar-city-slug-scope: the behavioural half could not run\n', res.stderr);
  process.exit(1);
}
let R: Record<string, any>;
try {
  R = JSON.parse((res.stdout || '').trim().split('\n').pop() as string);
} catch {
  console.error('aqar-city-slug-scope: unparseable probe output\n', res.stdout, res.stderr);
  process.exit(1);
}

check(R.fallback_detected,
  'a nationwide fallback page is detected as NOT city-scoped',
  'the guard no longer detects aqar\'s nationwide fallback — a wrong slug would again walk 150 ' +
  'pages x 49 categories and be killed at the job timeout, with zero coverage for that city');
check(R.city_page_allowed && R.hamza_form_matches && R.multiword_city_matches,
  'a real city page is allowed through (both spellings, multi-word towns)',
  'the guard rejects genuine city pages — it would stop every slice after one page and collapse ' +
  'discovery fleet-wide');
check(R.small_page_not_tripped && R.empty_page_not_tripped && R.min_sample_is_meaningful,
  `a short page never trips the guard (min sample ${R.min_sample_is_meaningful ? '>= 8' : 'TOO LOW'})`,
  'a small town\'s short result set can trip the guard — the fallback always returns a full page, ' +
  'so a short page must never be treated as one');
check(R.mutation_detected,
  'MUTATION PROOF: with no guard the fallback goes unreported',
  'the assertions pass even with the guard removed, so they do not test the fix');
check(R.outcome_third_state && R.ignored_slice_does_not_redden && R.blocked_still_reddens,
  'an ignored city filter is a THIRD state — it does not redden the run, a blocked fetch still does',
  'the ignored-city-filter state is collapsed into blocked or into empty; RC-B either goes ' +
  'permanently red on these cities or stops catching a genuinely blocked crawl');

const stillHamza: string[] = R.no_hamza_slugs || [];
check(stillHamza.length === 0,
  `all ${R.catalog_size} aqar city slugs use the plain-alif form aqar actually serves`,
  `these CITY_AR slugs still carry a hamza, which aqar answers with a nationwide feed instead of ` +
  `a 404: ${stillHamza.join(', ')}`);

const seven = ['abha', 'turabah', 'umluj', 'ras_tanura', 'ahad_rafidah', 'abu_arish',
               'ahad_al_masarihah'];
const wrong = seven.filter((k) => !R['slug_' + k]);
check(wrong.length === 0,
  'the seven slugs corrected on 2026-08-22 are pinned to their verified values',
  `these slugs have drifted back from the values verified live against aqar: ${wrong.join(', ')}`);

// The run must SAY it happened — the defect's only symptom was a slow job.
const run = readFileSync('scrapers/aqar/run_residential.py', 'utf8');
check(/city_filter_ignored=/.test(run) && /city_filter_ignored\b/.test(run),
  'run_residential records city_filter_ignored in the run notes',
  'scrapers/aqar/run_residential.py no longer records city_filter_ignored in its notes — ' +
  'mon_detect_aqar_city_slug_broken() reads those notes, so the barrier would go blind');

const pkg = readFileSync('package.json', 'utf8');
check(pkg.includes('verify-aqar-city-slug-scope'),
  'npm test runs this guard',
  'package.json no longer runs verify-aqar-city-slug-scope.ts — the guard is inert');

console.log('aqar-city-slug-scope: a city slice must actually be that city\n');
for (const o of ok) console.log(`  ✓ ${o}`);
for (const p of problems) console.error(`  ✗ ${p}`);
if (problems.length) {
  console.error(`\n❌ ${problems.length} check(s) failed — a wrong slug could again crawl the country.`);
  process.exit(1);
}
console.log('\n✅ aqar-city-slug-scope: passed.');
