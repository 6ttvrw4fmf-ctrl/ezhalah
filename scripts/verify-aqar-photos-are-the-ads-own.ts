// LISTING FIDELITY — an Aqar listing shows ONLY its own photos (owner rule, P1 of 2026-10-10).
//
// The bug this pins: scrapers/aqar/enrich_residential.py swept EVERY images.aqar.fm URL in the raw
// page. The page also carries the «إعلانات مشابهة» thumbnails of OTHER ads, every CDN size variant of
// each photo, and JSON-escaped junk ending in a backslash. All 160,450 live residential rows were
// polluted: ad 6815040 stored 86 entries for its 21 photos (5 of them another villa); ad 6438846 has
// NO photos on Aqar and stored only other ads' houses. The fix reads aqar's own `listing.imgs`.
//
// Inputs are what PRODUCTION sees, not values this repo chose:
//   • scripts/fixtures/aqar-ad-{6815040,6438846}.html.gz — the real server HTML of both ads,
//     fetched 2026-10-10 (PDPL: Arabic text → «x», phones → [redacted], avatar filenames blanked;
//     image filenames and page structure untouched).
//   • scripts/fixtures/aqar-ad-6815040.stored-photo_urls.json — the row's photo_urls as the DB
//     stored it before the fix (86 entries), for the client-side safety net.
// Ground truth (opened on sa.aqar.fm 2026-10-10): 6815040 shows 21 photos, first
// 003757760_1786380520839.jpg; 6438846 shows none.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
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

// The REAL enrich_residential() runs end to end; only the network call is replaced by the fixture
// page. Appended to BOTH the real source and every mutant, so the one difference is the mutation.
const HARNESS = `

def get(url, *a, **k):
    import gzip, os, re as _re, types
    ad = _re.search(r"(\\d{6,})$", url).group(1)
    path = os.path.join(${JSON.stringify(join(ROOT, 'scripts/fixtures'))}, "aqar-ad-%s.html.gz" % ad)
    html = gzip.open(path, "rb").read().decode("utf-8")
    if _BARRIER_SHELL:   # a fetch that came back without aqar's payload (shell / block page)
        html = _re.sub(r"<script>self\\.__next_f\\.push\\(.*?</script>", "", html, flags=_re.S)
    return types.SimpleNamespace(text=html)

_BARRIER_SHELL = False

def _barrier_photos(ad, type_slug, deal_slug, shell):
    global _BARRIER_SHELL
    _BARRIER_SHELL = shell
    row = enrich_residential("https://sa.aqar.fm/x/x-%s" % ad, type_slug=type_slug, deal_slug=deal_slug)
    return {"row": row is not None, "photo_urls": (row or {}).get("photo_urls")}
`;
const real = readFileSync(SRC, 'utf8');
type Out = { row: boolean; photo_urls: string[] | null };
const CALLS = [['6815040', 'villa', 'sale', false], ['6438846', 'apartment', 'rent', false],
               ['6815040', 'villa', 'sale', true]];
const run = (source: string): Out[] => pyCall(ROOT, MOD, '_barrier_photos', CALLS, source + HARNESS) as Out[];

const OWN_FIRST = 'https://images.aqar.fm/webp/750x0/props/003757760_1786380520839.jpg';
const verdict = (o: Out[]) => {
  const villa = o[0].photo_urls ?? [];
  return {
    villaExact: villa.length === 21 && villa[0] === OWN_FIRST
      && villa.every((u) => /^https:\/\/images\.aqar\.fm\/webp\/750x0\/props\/\d+_\d+\.jpg$/.test(u))
      && new Set(villa).size === 21,
    noPhotoAdEmpty: Array.isArray(o[1].photo_urls) && o[1].photo_urls.length === 0,
    shellUntouched: o[2].photo_urls === null,
  };
};

// ── the real extractor ──────────────────────────────────────────────────────────────────────────
const o = run(real);
const v = verdict(o);
check('both real pages enrich to a row', o[0].row && o[1].row);
check('ad 6815040: exactly its 21 own photos, one 750px URL each, Aqar\'s first photo first', v.villaExact,
  `got ${o[0].photo_urls?.length} — first ${o[0].photo_urls?.[0]}`);
check('ad 6438846: Aqar says imgs:null → photo_urls = [] (no other ad\'s house on its card)', v.noPhotoAdEmpty,
  `got ${JSON.stringify(o[1].photo_urls)?.slice(0, 160)}`);
check('a fetch without aqar\'s payload leaves photos UNKNOWN (None → the upsert keeps the stored ones)',
  v.shellUntouched, `got ${JSON.stringify(o[2].photo_urls)?.slice(0, 160)}`);

// ── mutation proof: each mutant must turn at least one check red ────────────────────────────────
const mutate = (label: string, fn: (s: string) => string) => {
  const m = fn(real);
  if (m === real) { check(`MUTATION ${label}: ANCHOR DRIFTED — mutant never applied`, false); return null; }
  try { return verdict(run(m)); } catch (e) {
    check(`MUTATION ${label}: python threw — ${(e as Error).message.split('\n')[0]}`, false); return null;
  }
};
// (a) THE OLD EXTRACTOR, verbatim — the bug as shipped.
const a = mutate('(a)', (s) => s.replace('    photos = _own_photos(obj)\n',
  `    photos = list(dict.fromkeys(re.findall(r'https://images\\.aqar\\.fm[^"\\'\\s]+', html)))\n`));
mustCatch('the old sweep of every images.aqar.fm URL (similar ads + size variants + junk)',
  a !== null && !(a.villaExact && a.noPhotoAdEmpty));
// (b) aqar's «no photos» (imgs:null) read as unknown — the stale foreign photos would stay forever.
const b = mutate('(b)', (s) => s.replace('    if imgs is None:\n        return []\n', '    if imgs is None:\n        return None\n'));
mustCatch('imgs:null treated as "unknown" (6438846 keeps other ads\' houses)', b !== null && !b.noPhotoAdEmpty);
// (c) an unreadable payload read as "no photos" — one blocked fetch would blank a real gallery.
const c = mutate('(c)', (s) => s.replace('    if not isinstance(obj, dict) or "imgs" not in obj:\n        return None\n',
  '    if not isinstance(obj, dict) or "imgs" not in obj:\n        return []\n'));
mustCatch('a failed/shell fetch blanking the stored photos', c !== null && !c.shellUntouched);

// ── client-side safety net (src/lib/photoUrl.ts), fed the row production stored ────────────────
const STORED: string[] = JSON.parse(readFileSync(join(ROOT, 'scripts/fixtures/aqar-ad-6815040.stored-photo_urls.json'), 'utf8'));
const PHOTO_SRC = readFileSync(join(ROOT, 'src/lib/photoUrl.ts'), 'utf8');
const loadDedupe = async (src: string) => {
  const file = join(mkdtempSync(join(tmpdir(), 'ezhalah-photos-')), 'photoUrl.ts');
  writeFileSync(file, src);
  return (await import(pathToFileURL(file).href)).dedupePhotoUrls as (u: string[]) => string[];
};
const fileOf = (u: string) => u.replace(/^.*\/props\//, '');
const netOk = (out: string[]) => out.length === 26                    // 21 own + 5 foreign files, once each
  && out[0] === OWN_FIRST && !out.some((u) => u.endsWith('\\'))
  && new Set(out.map(fileOf)).size === out.length;
const net = (await loadDedupe(PHOTO_SRC))(STORED);
check('stored 6815040 row (86 entries) → one URL per photo file, no backslash junk, own 750px photo first',
  netOk(net), `got ${net.length}`);
check('the net leaves a non-Aqar gallery untouched',
  (await loadDedupe(PHOTO_SRC))(['https://x.sa/a/300x0/1.jpg', 'https://x.sa/a/750x0/1.jpg']).length === 2);
const noJunk = PHOTO_SRC.replace("    if (u.endsWith('\\\\')) return false;\n", '');
const noCollapse = PHOTO_SRC.replace("u.replace(/^(https:\\/\\/images\\.aqar\\.fm\\/webp\\/)\\d+x\\d+\\//, '$1')", 'u');
check('net mutants applied (anchors intact)', noJunk !== PHOTO_SRC && noCollapse !== PHOTO_SRC);
mustCatch('the net no longer dropping backslash junk', !netOk((await loadDedupe(noJunk))(STORED)));
mustCatch('the net no longer collapsing size variants', !netOk((await loadDedupe(noCollapse))(STORED)));

check('npm test runs this guard', npmTestRuns(ROOT, 'verify-aqar-photos-are-the-ads-own'));

console.log(failed === 0
  ? '\n✅ aqar-photos: a listing carries only its own photos, one per photo; a failed read blanks nothing.\n'
  : `\n❌ aqar-photos: ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
