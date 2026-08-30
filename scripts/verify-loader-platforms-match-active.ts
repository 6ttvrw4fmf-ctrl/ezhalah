// LOADER ROSTER MUST EQUAL PRODUCTION'S ACTIVE-SEARCHABLE PLATFORM SET (owner rule 2026-08-29)
//
// The SearchLoader strip shows one logo per platform Ezhalah currently searches. If a scraper
// went cold with zero reachable rows in `search_listings_ar`, its logo does not belong in the
// strip — that is dishonest to users (they can never reach those results) and unfair to the
// platform (advertised without being able to deliver).
//
// TWO-LAYER GUARANTEE. The client filters PLATFORM_META at RUNTIME via
// `loader_active_platforms_ar()` — so a scraper going cold today stops advertising within one
// page-load. This barrier is the STATIC half: it queries production (anon REST, the same key real
// users hit) and asserts PLATFORM_META, mapped through SOURCE_TOKENS, equals the current active
// set exactly. That way the static list cannot silently drift; a scraper decision has to land in
// the loader in the same PR that removes/adds it.
//
// Because this reads production, it is a live barrier — excluded from the plain `npm test` run
// (which must be self-sufficient) and lives on the same CI schedule as the other
// verify-*-live.ts barriers. The exclusion is declared in scripts/test-exclusions.txt with a
// pointer to the workflow that runs it.

import { readFileSync } from 'node:fs';

// Parse PLATFORM_META names and SOURCE_TOKENS from the source file rather than importing the
// module — `loaderPlatforms.ts` calls `require()` for its bundled logo assets (Metro's require),
// which does not resolve in a plain-Node ESM run. Regex-parsing the two constants is stable
// because their shape is pinned by shape checks further down in this same barrier.
const LOADER_SRC = readFileSync(
  new URL('../src/data/loaderPlatforms.ts', import.meta.url).pathname,
  'utf8',
);

function parsePlatformMetaNames(src: string): string[] {
  const start = src.indexOf('export const PLATFORM_META');
  const openArr = src.indexOf('[', start);
  const closeArr = src.indexOf('];', openArr);
  const body = src.slice(openArr, closeArr);
  const names: string[] = [];
  for (const m of body.matchAll(/\bname:\s*'([^']+)'/g)) names.push(m[1]);
  return names;
}
function parseSourceTokens(src: string): Array<[string, string]> {
  const start = src.indexOf('const SOURCE_TOKENS');
  const openArr = src.indexOf('[', start);
  const closeArr = src.indexOf('];', openArr);
  const body = src.slice(openArr, closeArr);
  const pairs: Array<[string, string]> = [];
  for (const m of body.matchAll(/\['([^']+)',\s*'([^']+)'\]/g)) pairs.push([m[1], m[2]]);
  return pairs;
}
const SOURCE_TOKENS = parseSourceTokens(LOADER_SRC);
function normalizeSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  for (const [tok, name] of SOURCE_TOKENS) if (s.includes(tok)) return name;
  return null;
}
const PLATFORM_META_NAMES = parsePlatformMetaNames(LOADER_SRC);

// The anon key real users' browsers use — pinned here (matches scripts/safe-deploy.sh
// LOCK_ANON_KEY). If it ever rotates, the safe-deploy script is the one truth source and this
// value must move with it.
const SUPABASE_URL = 'https://aannarbkwcymrotzwdbo.supabase.co';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhbm5hcmJrd2N5bXJvdHp3ZGJvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDgxMDAsImV4cCI6MjA5NTk4NDEwMH0.Z-GhSpan6otYWkc8sU43Dw5PT5T_VBUMr0IDZShCQw0';

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
  if (!ok) failed++;
};

console.log('\nLoader roster must equal production active-searchable set (owner 2026-08-29)\n');

// ── 1. Fetch the current production active set via the same public RPC the client calls ─────────
const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/loader_active_platforms_ar`, {
  method: 'POST',
  headers: {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    'Content-Type': 'application/json',
  },
  body: '{}',
});
check(`RPC loader_active_platforms_ar() reachable via anon (HTTP 200)`, rpcRes.status === 200,
  rpcRes.status !== 200 ? `got HTTP ${rpcRes.status}` : '');
if (rpcRes.status !== 200) {
  console.log(`\n✗ ${failed} check(s) FAILED — cannot reach the truth source`);
  process.exit(1);
}
const raws = (await rpcRes.json()) as unknown;
check('RPC returns an array', Array.isArray(raws), `got ${typeof raws}`);
if (!Array.isArray(raws)) process.exit(1);

// ── 2. Map raw DB names → canonical loader names via SOURCE_TOKENS (the SAME normalizer the
//       client uses) so the comparison is apples-to-apples.
const liveCanon = new Set<string>();
const unmapped: string[] = [];
for (const raw of raws as string[]) {
  const n = normalizeSource(raw);
  if (n) liveCanon.add(n);
  else unmapped.push(raw);
}
check(`every live raw platform maps to a canonical name (via SOURCE_TOKENS)`, unmapped.length === 0,
  unmapped.length ? `unmapped: ${unmapped.join(', ')}` : '');

// ── 3. PLATFORM_META names (the static catalog the loader ships with, parsed from source).
const catalog = new Set(PLATFORM_META_NAMES);

// ── 4. The two sets must be equal — every advertised logo has a live platform, every live
//       platform is advertised.
const advertisedButDead = [...catalog].filter((n) => !liveCanon.has(n)).sort();
const liveButHidden = [...liveCanon].filter((n) => !catalog.has(n)).sort();

check(
  `PLATFORM_META advertises no dead platforms (rows=0 in search_listings_ar)`,
  advertisedButDead.length === 0,
  advertisedButDead.length ? `dead in catalog: ${advertisedButDead.join(', ')}` : '',
);
check(
  `PLATFORM_META hides no live platforms (rows>0 with no logo entry)`,
  liveButHidden.length === 0,
  liveButHidden.length ? `live but hidden: ${liveButHidden.join(', ')}` : '',
);
check(
  `PLATFORM_META set equals the production active set (size ${catalog.size} vs ${liveCanon.size})`,
  advertisedButDead.length === 0 && liveButHidden.length === 0,
);

// ── 5. Defensive shape checks on the parsed source — no duplicates, non-empty.
const seenNames = new Set<string>();
for (const n of PLATFORM_META_NAMES) {
  check(`PLATFORM_META entry "${n}" is unique`, !seenNames.has(n));
  seenNames.add(n);
}
check(`PLATFORM_META parses non-empty (parser sanity)`, PLATFORM_META_NAMES.length > 0);
check(`SOURCE_TOKENS parses non-empty (parser sanity)`, SOURCE_TOKENS.length > 0);

// ── 6. The mandatory rule text lives in loaderPlatforms.ts's header comment. Pin it so a future
//       edit that removes the honest-claim rule turns this barrier red on that half too.
check(
  'loaderPlatforms.ts carries the owner-2026-08-29 honest-claim rule in its header',
  /PRODUCT RULE \(owner 2026-08-29/.test(LOADER_SRC) && /HONEST CLAIM/.test(LOADER_SRC),
);
check(
  'pickLoaderPlatforms accepts an activeNames filter (safe-degradation fallback path exists)',
  /pickLoaderPlatforms\([^)]*activeNames\?:/.test(LOADER_SRC) && /activeNames\.size/.test(LOADER_SRC),
);
const runtimeSrc = readFileSync(
  new URL('../src/data/loaderActivePlatforms.ts', import.meta.url).pathname,
  'utf8',
);
check(
  'loaderActivePlatforms.ts exports fetchActivePlatformNames (runtime filter is wired)',
  /export async function fetchActivePlatformNames\(/.test(runtimeSrc) &&
    /supabase\.rpc\(\s*['"]loader_active_platforms_ar['"]/.test(runtimeSrc),
);

console.log(
  failed
    ? `\n✗ ${failed} check(s) FAILED — loader roster does not match production; the search-loading strip is dishonest`
    : `\n✓ Loader roster equals production active-searchable set (${liveCanon.size} platforms) — no dead logos, no hidden live platforms`,
);
process.exit(failed ? 1 : 0);
