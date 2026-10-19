// A CARD MUST CARRY THE IDENTITY OF THE PLATFORM THAT ACTUALLY PUBLISHED IT — checked against the
// string PRODUCTION STORES, not the one this repo invents.
//
// THE DEFECT THIS EXISTS FOR (found live 2026-09-04, on the website, by looking at real cards).
// A search for الهفوف / مزرعة / بيع returned 227 listings of which abralosol owns 210. The top cards
// rendered as «عقار · sa.aqar.fm» — Aqar's name, Aqar's logo, and a click-through to Aqar — on
// listings abralosol published. Three platforms were mis-attributed at once:
//
//     platform     PLATFORMS.name   DB `source`      lower-cased        token tested   matched?
//     abralosol    Abralosol        'Abr Alosol'     'abr alosol'       abralosol      NO
//     therc        THERC            'THE RC'         'the rc'           therc          NO
//     rawasidark   RawasiDark       'Rawasi Dark'    'rawasi dark'      rawasidark     NO
//
// 3,165 live listings, every one of them shown under a competitor's brand and linking to that
// competitor's site. Unfair to the platform, misleading to the user, and a direct breach of the
// neutrality the product is built on.
//
// WHY verify-platform-registration-complete.ts DID NOT CATCH IT. That barrier executes the real
// matchers — correctly — but feeds them `PLATFORMS[i].name`, a string this repo chose
// ('Abralosol', 'THERC', 'RawasiDark'). Those are closed-up, so they match their own branches and
// the barrier goes green. Production never stores them. The gap is not in the matcher logic it
// tests; it is that NOTHING compared the matcher against the values the database really holds.
// A barrier that supplies its own input can only prove the code is self-consistent.
//
// SO THIS ONE READS PRODUCTION. For every platform table it fetches the `source` value actually
// present (anon REST, the same key the client uses — the card reads these very rows) and runs the
// REAL lifted sourceHost over it, asserting:
//   1. sourceHost(live source) === sourceHost(platform slug). The join is the MATCHER, not a name
//      lookup: two inputs for one platform must produce one identity. That is precisely the
//      property that broke, and it needs no slug↔brand table (slug 'souq24' vs brand '24 Souq',
//      'nowaisiry' vs 'Al Nowaisiry' are naming quirks, not identity defects).
//   2. the resolved host is not the Aqar FALLBACK, unless the platform IS aqar/aqarmonthly (Aqar's
//      own monthly vertical, the only legitimate residents of that fallback).
//   3. platforms.ts claims the resolved domain, so a rebrand cannot leave "hosted on" pointing at a
//      domain the platform no longer uses.
//   4. no platform's live source is captured by another platform's token (first match wins, so a
//      loose token silently steals another company's cards).
//
// LIVE CHECK — excluded from `npm test` (scripts/test-exclusions.txt); runs in
// .github/workflows/af-live-truth-check.yml with the other production-truth barriers.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';
import { resolvePublicSupabase } from './lib/public-supabase.ts';
import { platformIdentity, distinctPlatformCount } from '../src/lib/platformDiversity.ts';

const ROOT = join(import.meta.dirname, '..');
const { url: BASE, key: KEY } = resolvePublicSupabase(process.env);
const REST = `${BASE}/rest/v1`;
const H: Record<string, string> = { apikey: KEY, Authorization: `Bearer ${KEY}` };

let failures = 0;
const check = (name: string, cond: boolean, detail = '') => {
  console.log(`  ${cond ? '✓' : '❌'} ${name}${!cond && detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
};

// ── the REAL matchers, lifted (never re-implemented — a copy would drift from the shipped one) ────
const rc = await liftSymbols(join(ROOT, 'src/components/ResultCard.tsx'),
  [{ header: 'function sourceHost' }], ['sourceHost'], '');
const sourceHost = rc.sourceHost as (s: string) => string;

// ── the platform registry: name → domain ─────────────────────────────────────────────────────────
const platformsSrc = readFileSync(join(ROOT, 'src/data/platforms.ts'), 'utf8');
const REGISTRY = [...platformsSrc.matchAll(/\{\s*name:\s*'([^']+)',\s*domain:\s*'([^']+)'/g)]
  .map((m) => ({ name: m[1], domain: m[2] }));
check('the platform registry parsed', REGISTRY.length > 20, `${REGISTRY.length} platforms`);

// Aqar and its own monthly vertical are the only legitimate residents of the Aqar fallback.
const AQAR_FALLBACK = 'sa.aqar.fm';
const FALLBACK_OK = new Set(['aqar', 'aqarmonthly']);

// ── every platform table live in production, and the source strings it really holds ──────────────
const rpc = await fetch(`${REST}/rpc/loader_active_platforms_ar`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: '{}',
});
if (!rpc.ok) {
  check('loader_active_platforms_ar() is reachable via the anon key real clients use', false,
    `HTTP ${rpc.status} — ${(await rpc.text()).slice(0, 160)}`);
  console.log('\n✗ verify-platform-identity-matches-live-source: could not reach the truth source.\n');
  process.exit(1);
}
const livePlatforms = (await rpc.json()) as string[];
check('production reported a plausible fleet', livePlatforms.length > 20, `${livePlatforms.length}`);

const seenSources: { platform: string; source: string; host: string }[] = [];
for (const p of livePlatforms) {
  for (const kind of ['residential', 'commercial']) {
    // One row is enough per table: `source` is a per-platform constant written by that platform's
    // own upsert helper. A second DISTINCT value would be its own defect and shows up as a
    // mismatched host here anyway.
    const r = await fetch(`${REST}/${p}_${kind}_listings?select=source&active=is.true&limit=1`, { headers: H });
    if (!r.ok) continue;                       // table may not exist for this platform (monthly-only sources)
    const rows = (await r.json()) as { source: string }[];
    if (!rows.length || !rows[0]?.source) continue;
    seenSources.push({ platform: p, source: rows[0].source, host: sourceHost(rows[0].source) });
  }
}
check('live source strings were read for the fleet', seenSources.length >= livePlatforms.length,
  `${seenSources.length} table(s) sampled across ${livePlatforms.length} platform(s)`);

for (const { platform, source, host } of seenSources) {
  // THE JOIN IS THE MATCHER ITSELF, not a name lookup. Feed it two inputs for the same platform —
  // the string production stores, and the platform's own slug — and require the SAME identity out.
  // Joining slug→platforms.ts by name instead would need slug 'souq24' to equal brand '24 Souq',
  // 'nowaisiry' to equal 'Al Nowaisiry', 'october' to equal '1 October'; that is a naming quirk,
  // not an identity defect, and reporting it would be this barrier crying wolf about itself.
  const bySlug = sourceHost(platform);
  check(`${platform}: live source "${source}" resolves the same as its own slug`,
    host === bySlug,
    `sourceHost("${source}") = ${host} but sourceHost("${platform}") = ${bySlug}`
    + (host === AQAR_FALLBACK ? " — the live string hits the AQAR FALLBACK: the card shows Aqar's brand and links to Aqar" : ''));
  if (!FALLBACK_OK.has(platform)) {
    check(`${platform}: does not land on the Aqar fallback`, host !== AQAR_FALLBACK,
      `every ${platform} card would render as Aqar`);
  }
  // The registry must still agree with whatever that identity is, so a rebrand cannot leave the
  // "hosted on" label pointing at a domain the platform no longer uses.
  const reg = REGISTRY.find((x) => x.domain === host);
  check(`${platform}: ${host} is a domain platforms.ts knows`, Boolean(reg),
    `sourceHost resolved ${host}, which no platforms.ts entry claims`);
}

// ── token shadowing, measured on the LIVE strings rather than on invented names ───────────────────
for (const a of seenSources) {
  const stolen = seenSources.find((b) => b.platform !== a.platform && b.host === a.host && a.host !== AQAR_FALLBACK);
  if (stolen) {
    check(`${a.platform}: is not shadowed by ${stolen.platform}'s token`, false,
      `both "${a.source}" and "${stolen.source}" resolve to ${a.host}`);
    break;                                      // one report is enough; the fix is the same edit
  }
}

// ── IDENTITY HEALTH, ON THE LIVE STRINGS — the half that let the 2026-09-26 P0 through ──────────
// The checks above ask "does this card carry its OWN publisher's brand". They all passed on
// 2026-09-26 while a second, quieter failure was live: platformDiversity's platformToken() was
// `[^a-z0-9]`, a LATIN-ONLY filter, so a platform whose stored `source` is Arabic tokenised to the
// EMPTY STRING. distinctPlatformCount() skips empty identities by design (a blank source must not
// invent a slot), so those platforms were NOT COUNTED, initialReveal() sized the first screen from
// that count, and they got no first-screen card at all — measured on الرياض/تجاري/بيع: 21 matching
// platforms, 11 of them Arabic-named, 10 cards shown. Nothing rendered under the wrong brand, so
// nothing above fired.
//
// These run HERE, in the live barrier, rather than only in the hermetic ones, because a hermetic
// test can only assert about the names the repo already knows. The roster is heading for ~136 sites
// and new entries are increasingly Arabic-named; this is the only check that sees a platform added
// TOMORROW, with a name shape nobody anticipated, in whatever encoding its scraper stores.
{
  const blank = seenSources.filter((s) => platformIdentity(s.source) === '');
  check('every LIVE source string produces a non-empty platform identity',
    blank.length === 0,
    blank.map((b) => `${b.platform} stores "${b.source}" → ''`).join(' | ')
    + (blank.length ? ' — these platforms are invisible to the first-screen count' : ''));

  // A live source colliding with a DIFFERENT website's identity costs the second one its slot in
  // exactly the same way. Same-domain folds (Aqar / Aqar Monthly) are correct and excluded.
  const byIdentity = new Map<string, Set<string>>();
  for (const s of seenSources) {
    const id = platformIdentity(s.source);
    if (!id) continue;
    if (!byIdentity.has(id)) byIdentity.set(id, new Set());
    byIdentity.get(id)!.add(s.host);
  }
  const collided = [...byIdentity].filter(([, hosts]) => hosts.size > 1);
  check('no two LIVE source strings from different websites share one identity',
    collided.length === 0,
    collided.slice(0, 3).map(([id, h]) => `${id} ← ${[...h].join(' + ')}`).join(' | '));

  // The end-to-end property the owner's rule actually depends on: the number the first screen is
  // sized from must equal the number of distinct websites live in the fleet. Counted through the
  // REAL distinctPlatformCount(), on the REAL strings, with legitimate same-domain folds allowed.
  const distinctHosts = new Set(seenSources.map((s) => s.host)).size;
  const counted = distinctPlatformCount(seenSources.map((s) => ({ source: s.source })));
  check('the first-screen platform count sees EVERY live website (no platform is erased)',
    counted >= distinctHosts,
    `distinctPlatformCount saw ${counted} of ${distinctHosts} live websites`
    + (counted < distinctHosts ? ` — ${distinctHosts - counted} would get no first-screen card` : ''));
}

console.log(failures === 0
  ? `\n✅ verify-platform-identity-matches-live-source: ${seenSources.length} live source strings, every card carries its own publisher.\n`
  : `\n✗ verify-platform-identity-matches-live-source: ${failures} check(s) failed — listings are rendering under the wrong brand.\n`);
process.exit(failures === 0 ? 0 : 1);
