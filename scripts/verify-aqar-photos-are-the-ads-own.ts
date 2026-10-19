// LISTING FIDELITY — an Aqar listing shows ONLY its own photos (owner rule, P1 of 2026-10-10).
//
// The bug this pins: scrapers/aqar/enrich_residential.py swept EVERY images.aqar.fm URL in the raw
// page. The page also carries the «إعلانات مشابهة» thumbnails of OTHER ads, every CDN size variant of
// each photo, and JSON-escaped junk ending in a backslash. All 160,450 live residential rows were
// polluted: ad 6815040 stored 86 entries for its 21 photos (5 of them another villa); ad 6438846 has
// NO photos on Aqar and stored only other ads' houses. The fix reads aqar's own `listing.imgs`.
// The same fetch now also carries aqar's own pin (`listing.location`) — Aqar was 0% coordinates —
// which must never be dropped, swapped, (0,0) or outside Saudi Arabia.
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
import { gunzipSync } from 'node:zlib';
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
    return {"row": row is not None, "photo_urls": (row or {}).get("photo_urls"),
            "coords": (row or {}).get("additional_info")}
`;
const real = readFileSync(SRC, 'utf8');
type Coords = { latitude: number; longitude: number } | null;
type Out = { row: boolean; photo_urls: string[] | null; coords: Coords };
const CALLS = [['6815040', 'villa', 'sale', false], ['6438846', 'apartment', 'rent', false],
               ['6815040', 'villa', 'sale', true], ['6772165', 'land', 'sale', false],
               ['6753755', 'apartment', 'rent', false]];
const run = (source: string): Out[] => pyCall(ROOT, MOD, '_barrier_photos', CALLS, source + HARNESS) as Out[];

// The pin each page itself publishes in its ld+json `geo` — read here independently of the extractor
// (which reads `listing.location`), so the two sources on the real page must agree.
const geoOf = (ad: string) => {
  const html = gunzipSync(readFileSync(join(ROOT, `scripts/fixtures/aqar-ad-${ad}.html.gz`))).toString('utf8');
  const m = html.match(/"geo":\{[^}]*"latitude":(-?[0-9.]+),"longitude":(-?[0-9.]+)/);
  return m ? { latitude: Number(m[1]), longitude: Number(m[2]) } : null;
};
const GEO = [geoOf('6815040'), geoOf('6438846'), geoOf('6772165'), geoOf('6753755')];
const BRACE_FIRST = 'https://images.aqar.fm/webp/750x0/props/002560473_1782818506095.jpg';
const LAND_FIRST = 'https://images.aqar.fm/webp/750x0/props/003239080_1783961654587.jpg';
const samePin = (c: Coords, g: Coords) => !!c && !!g && c.latitude === g.latitude && c.longitude === g.longitude;
const OWN_FIRST = 'https://images.aqar.fm/webp/750x0/props/003757760_1786380520839.jpg';
const verdict = (o: Out[]) => {
  const villa = o[0].photo_urls ?? [];
  return {
    villaExact: villa.length === 21 && villa[0] === OWN_FIRST
      && villa.every((u) => /^https:\/\/images\.aqar\.fm\/webp\/750x0\/props\/\d+_\d+\.jpg$/.test(u))
      && new Set(villa).size === 21,
    noPhotoAdEmpty: Array.isArray(o[1].photo_urls) && o[1].photo_urls.length === 0,
    shellUntouched: o[2].photo_urls === null,
    pins: samePin(o[0].coords, GEO[0]) && samePin(o[1].coords, GEO[1]),
    shellPinUntouched: o[2].coords === null,
    // A LAND page (ad 6772165, «أرض للبيع», 9 photos on aqar) — the shape the 2026-10-10 repair skipped.
    land: (o[3]?.photo_urls ?? []).length === 9 && o[3].photo_urls![0] === LAND_FIRST
      && samePin(o[3].coords, GEO[2]),
    // An ad whose OWN TEXT holds «{»/«}» (6753755, 4 photos on aqar): the old brace counter closed
    // the payload mid-string and read the whole listing as None — 43 rows kept other ads' photos.
    braces: (o[4]?.photo_urls ?? []).length === 4 && o[4].photo_urls![0] === BRACE_FIRST
      && samePin(o[4].coords, GEO[3]),
  };
};

// ── the real extractor ──────────────────────────────────────────────────────────────────────────
const o = run(real);
const v = verdict(o);
check('both real pages enrich to a row', o[0].row && o[1].row);
check('an ad whose own text holds { } (6753755) still yields its 4 photos and its pin', v.braces,
  `got ${o[4]?.photo_urls?.length} photos, pin ${JSON.stringify(o[4]?.coords)}`);
check('a real LAND page (6772165) yields its own 9 photos and its own pin', v.land,
  `got ${o[3]?.photo_urls?.length} photos, pin ${JSON.stringify(o[3]?.coords)}`);
check('ad 6815040: exactly its 21 own photos, one 750px URL each, Aqar\'s first photo first', v.villaExact,
  `got ${o[0].photo_urls?.length} — first ${o[0].photo_urls?.[0]}`);
check('ad 6438846: Aqar says imgs:null → photo_urls = [] (no other ad\'s house on its card)', v.noPhotoAdEmpty,
  `got ${JSON.stringify(o[1].photo_urls)?.slice(0, 160)}`);
check('a fetch without aqar\'s payload leaves photos UNKNOWN (None → the upsert keeps the stored ones)',
  v.shellUntouched, `got ${JSON.stringify(o[2].photo_urls)?.slice(0, 160)}`);

check('the page\'s ld+json geo is readable (else the pin checks prove nothing)',
  GEO[0]?.latitude === 24.920876 && GEO[0]?.longitude === 46.780616 && GEO[1] !== null);
check('both ads carry aqar\'s own pin, equal to the page\'s ld+json geo (not dropped, not swapped)', v.pins,
  `got ${JSON.stringify([o[0].coords, o[1].coords])}`);
check('a fetch without aqar\'s payload writes no pin (None → the stored one survives)', v.shellPinUntouched);
const box = pyCall(ROOT, MOD, '_own_coordinates', [
  [{ location: { lat: 0, lng: 0 } }], [{ location: { lat: 46.78, lng: 24.92 } }],
  [{ location: { lat: '24.9', lng: '46.7' } }], [{ location: null }], [{}], [null],
  [{ location: { lat: 24.920876, lng: 46.780616 } }],
]);
check('(0,0), a swapped pair, strings, null and a missing pin are all rejected — never written',
  box.slice(0, 6).every((x) => x === null), JSON.stringify(box));
check('…while a real Saudi pin passes through unchanged',
  samePin(box[6] as Coords, { latitude: 24.920876, longitude: 46.780616 }));

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

// (d) the row stops carrying the pin — photos still arrive, the coordinates are silently dropped.
const d = mutate('(d)', (s) => s.replace('        "additional_info":         _own_coordinates(obj),\n', ''));
mustCatch('the extractor returning photos but dropping the coordinates', d !== null && d.villaExact && !d.pins);
// (e) lat/lng swapped on the way out.
const e = mutate('(e)', (s) => s.replace('return {"latitude": float(lat), "longitude": float(lng)}',
  'return {"latitude": float(lng), "longitude": float(lat)}'));
mustCatch('lat/lng swapped', e !== null && !e.pins);
// (f) the Saudi box removed — (0,0) would be written as a pin in the Gulf of Guinea.
const fSrc = real.replace('    if not (16 <= lat <= 33 and 34 <= lng <= 56):\n        return None\n', '');
check('MUTATION (f): anchor intact', fSrc !== real);
const fOut = fSrc === real ? [] : pyCall(ROOT, MOD, '_own_coordinates', [[{ location: { lat: 0, lng: 0 } }]], fSrc);
mustCatch('the Saudi box removed, letting (0,0) through', fOut[0] !== null);

// (h) the brace counter the payload reader used until 2026-10-10, verbatim.
const BRACE_COUNTER = `    for m in _LISTING_OBJ_RE.finditer(blob):
        start = blob.index("{", m.start() + len('"listing"'))
        depth = 0
        for i in range(start, min(len(blob), start + 200_000)):
            ch = blob[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = _json.loads(blob[start:i + 1])
                    except Exception:  # noqa: BLE001
                        break
                    if isinstance(obj, dict) and obj.get("id") is not None:
                        return obj
                    break
    return None`;
const h = mutate('(h)', (s) => s.replace(/    dec = _json\.JSONDecoder\(\)\n[\s\S]*?\n    return None/, BRACE_COUNTER));
mustCatch('a payload reader that counts braces inside the ad\'s own text', h !== null && h.villaExact && !h.braces);

// ── the repair must REACH every row: each stored property_type resolves to an aqar slug ─────────
// 2026-10-10: the recovery mapped type→slug by inverting SLUG_TO_TYPE, so the zoning types the
// enricher derives for land («تجاري»/«صناعي»/«زراعي» → Commercial Land / Industrial Land /
// Agriculture Plot) had no slug, and 21,613 live land rows were skipped as "unfetchable" without one
// fetch. (a) the class: every type the enricher can WRITE — SLUG_TO_TYPE's values plus every
// `property_type = "…"` it assigns, discovered from its source by shape — must resolve. (b) the
// path: recover() over the real land page, with the row as production stores it, must fetch it.
const REC = 'scrapers.aqar.recover_stubs';
const REC_SRC = readFileSync(join(ROOT, 'scrapers/aqar/recover_stubs.py'), 'utf8');
const REC_HARNESS = `

def _barrier_recovery(ad, stored_type):
    import gzip, os, re as _re, types
    import scrapers.aqar.enrich_residential as _E
    from scrapers.common import normalize as _N
    def _get(url, *a, **k):
        n = _re.search(r"(\\d{6,})$", url).group(1)
        p = os.path.join(${JSON.stringify(join(ROOT, 'scripts/fixtures'))}, "aqar-ad-%s.html.gz" % n)
        return types.SimpleNamespace(text=gzip.open(p, "rb").read().decode("utf-8"))
    _E.get = _get
    writable = (set(_N.SLUG_TO_TYPE.values()) | set(_E.AQAR_LAND_USAGE.values())
                | set(_re.findall(r'property_type = "([A-Za-z ]+)"', open(_E.__file__, encoding="utf-8").read())))
    row = {"id": 1, "ad_number": ad, "listing_url": "https://sa.aqar.fm/x/x-%s" % ad,
           "property_type": stored_type, "transaction_type": "Buy"}
    import contextlib, io
    with contextlib.redirect_stdout(io.StringIO()):
        c = recover([row], True, 1)
    return {"unresolved": sorted(t for t in writable if t not in TYPE_TO_SLUG),
            "derived": sorted(writable - set(_N.SLUG_TO_TYPE.values())),
            "fetched": c["fetched"], "skipped": c.get("no_slug", 0) + c["unfetchable"]}
`;
type Rec = { unresolved: string[]; derived: string[]; fetched: number; skipped: number };
const recRun = (src: string) => pyCall(ROOT, REC, '_barrier_recovery', [['6772165', 'Commercial Land']], src + REC_HARNESS)[0] as Rec;
const rec = recRun(REC_SRC);
// Since 2026-10-10 a plot's type is Aqar's own «نوع العقار» (AQAR_LAND_USAGE); Industrial Land /
// Agriculture Plot are only legacy stored values now, still mapped in TYPE_TO_SLUG for those rows.
check('the class barrier can see the enricher\'s derived land types (else it proves nothing)',
  rec.derived.includes('Commercial Land'),
  JSON.stringify(rec.derived));
check('every property_type the enricher can write resolves to an aqar slug', rec.unresolved.length === 0,
  `unresolved: ${rec.unresolved.join(', ')}`);
check('recover() FETCHES a land row stored as «Commercial Land» (never skipped unfetched)',
  rec.fetched === 1 && rec.skipped === 0, JSON.stringify(rec));
const noLand = REC_SRC.replace(/\nTYPE_TO_SLUG\.update\(\{t: "land"[^\n]*\n/, '\n');
check('MUTATION (g): anchor intact', noLand !== REC_SRC);
if (noLand !== REC_SRC) {
  const g = recRun(noLand);
  mustCatch('the recovery losing the land slug (21,613 rows skipped unfetched)', g.unresolved.length > 0 && g.fetched === 0);
}

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
