// PERMANENT BARRIER — a platform is registered EVERYWHERE or it is not shipped (2026-09-02).
//
// THE BUG CLASS THIS EXISTS FOR. SourceBadge / sourceHost / sourceName all end in an unconditional
// `return <Aqar>` fallback. So a platform whose `source` string matches NO branch does not render
// as "unknown" — it renders as AQAR: Aqar's logo, the name "AQAR", and "hosted on sa.aqar.fm".
// That is silent MIS-ATTRIBUTION: one company's listing shown under a different company's brand,
// with the click-through pointing at the wrong website. It is invisible in code review because
// nothing throws and nothing is empty — the card just looks like a normal Aqar card.
//
// IT HAS ALREADY HAPPENED TWICE, both from the same trap: the DB `source` value carries a SPACE
// ('Al Khaas', 'Al Nokhba') while the branch tested the closed-up slug ('alkhaas', 'alnokhba'),
// which is not a substring of it. 'Al Khaas' was found and fixed by hand (209 active rows). This
// barrier was written while adding 5 new platforms and immediately caught 'Al Nokhba' still
// unfixed — the identical trap, surviving because that platform is retired (0 active rows today),
// i.e. latent rather than absent.
//
// WHAT IS ASSERTED, by EXECUTING the real matcher order (never by grepping for a slug):
//   1. Every PLATFORMS entry resolves to an EXPLICIT branch in all three functions — never the
//      trailing Aqar fallback (Aqar itself, and Aqar Monthly which IS Aqar's own vertical, are the
//      only legitimate residents of that fallback).
//   2. sourceHost(name) === that platform's own `domain` — the "hosted on" label and the platform
//      registry cannot disagree (this is what caught the stale aqaratikom.com after the nawait.sa
//      rebrand: the scraper reads nawait.sa, so platforms.ts was the wrong one).
//   3. No platform is shadowed by an EARLIER platform's token (first match wins, so a badly-chosen
//      token silently steals another platform's cards).
//   4. Search-layer registration is complete and symmetric: every platform has both its
//      _residential_listings and _commercial_listings table in remote.ts's RES_TABLES/COM_TABLES
//      and in the by-id lookup list, plus its two db.py upsert helpers — a platform half-wired
//      here is searchable but unrenderable, or renderable but unsearchable.
//
// MUTATION-PROVEN (each of these makes this barrier fail, verified by hand):
//   M1 delete any new platform's SourceBadge branch      -> falls to Aqar, check 1 fails
//   M2 change a sourceHost domain to a different site    -> check 2 fails
//   M3 revert Al Nokhba's branch to 'alnokhba' only      -> falls to Aqar, check 1 fails
//   M4 drop one table from RES_TABLES/COM_TABLES         -> check 4 fails
//
//   node --experimental-strip-types scripts/verify-platform-registration-complete.ts   (in `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { liftSymbols } from './lib/liftSymbols.ts';

const ROOT = join(import.meta.dirname, '..');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? ` — ${detail}` : ''}`);
};

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ── The platform registry (name / domain / brand), parsed from the shipped source ───────────────
const platformsSrc = read('src/data/platforms.ts');
const PLATFORMS = [...platformsSrc.matchAll(
  /\{ name: '([^']+)', domain: '([^']+)', brand: '([^']+)'/g,
)].map((m) => ({ name: m[1], domain: m[2], brand: m[3] }));

check('platform registry parsed', PLATFORMS.length >= 30, `got ${PLATFORMS.length}`);

// ── Extract each matcher's ORDERED branches, then execute that order ────────────────────────────
// A branch may test several tokens ("al khaas" || "alkhaas"), which is exactly the shape that fixes
// the space trap — so tokens are collected per LINE, not per includes() call.
type Branch = { tokens: string[]; value: string };
function branchesOf(src: string, fnHeader: string): { branches: Branch[]; fallback: string } {
  const i = src.indexOf(fnHeader);
  if (i < 0) throw new Error(`matcher not found: ${fnHeader}`);
  const body = src.slice(i, src.indexOf('\n}\n', i));
  const branches: Branch[] = [];
  for (const line of body.split('\n')) {
    if (!line.includes('includes(')) continue;
    const tokens = [...line.matchAll(/includes\('([^']+)'\)/g)].map((m) => m[1]);
    const str = line.match(/return\s+'([^']*)'/);
    const img = line.match(/return\s+<Image source=\{([A-Z0-9_]+)\}/);
    const badge = line.match(/card\.([A-Za-z0-9]+Badge)\]/);
    const value = str?.[1] ?? img?.[1] ?? badge?.[1];
    if (tokens.length && value !== undefined) branches.push({ tokens, value });
  }
  const tail = [...body.matchAll(/\n\s*return\s+(?:'([^']*)'|<Image source=\{([A-Z0-9_]+)\})/g)].pop();
  return { branches, fallback: (tail?.[1] ?? tail?.[2] ?? 'NO_FALLBACK') };
}
// First match wins — mirrors the real if-chain exactly.
const resolve = (b: Branch[], fb: string, name: string) => {
  const n = name.toLowerCase();
  for (const br of b) if (br.tokens.some((t) => n.includes(t))) return br.value;
  return fb;
};
const indexOfMatch = (b: Branch[], name: string) => {
  const n = name.toLowerCase();
  return b.findIndex((br) => br.tokens.some((t) => n.includes(t)));
};

const cardSrc = read('src/components/ResultCard.tsx');
const dispSrc = read('src/lib/listingDisplay.ts');
const badge = branchesOf(cardSrc, 'function SourceBadge');
const host = branchesOf(cardSrc, 'function sourceHost');
const nameFn = branchesOf(dispSrc, 'export function sourceName');

check('all three matchers parsed with real branches',
  badge.branches.length > 20 && host.branches.length > 20 && nameFn.branches.length > 20,
  `badge=${badge.branches.length} host=${host.branches.length} name=${nameFn.branches.length}`);

// Aqar owns the fallback legitimately; Aqar Monthly is Aqar's OWN monthly vertical on the same site
// (sa.aqar.fm), so resolving to Aqar's badge/host is correct for it too. Nothing else may land there.
const FALLBACK_OK = new Set(['Aqar', 'Aqar Monthly']);

// ── 1. NOTHING falls through to the Aqar default ────────────────────────────────────────────────
for (const p of PLATFORMS) {
  if (FALLBACK_OK.has(p.name)) continue;
  const b = resolve(badge.branches, badge.fallback, p.name);
  const h = resolve(host.branches, host.fallback, p.name);
  const n = resolve(nameFn.branches, nameFn.fallback, p.name);
  check(`${p.name}: has an explicit badge (not the Aqar fallback)`, b !== badge.fallback,
    `renders as ${badge.fallback}`);
  check(`${p.name}: has an explicit host (not sa.aqar.fm fallback)`, h !== host.fallback,
    `links to ${host.fallback}`);
  check(`${p.name}: has an explicit display name (not "${nameFn.fallback}")`, n !== nameFn.fallback);
}

// ── 2. The "hosted on" label MUST equal the platform's own registered domain ────────────────────
for (const p of PLATFORMS) {
  const h = resolve(host.branches, host.fallback, p.name);
  check(`${p.name}: hosted-on domain matches the registry`, h === p.domain,
    `card says ${h}, platforms.ts says ${p.domain}`);
}

// ── 3. No platform is shadowed by an EARLIER platform's token ───────────────────────────────────
// Two platforms may legitimately share a branch only when they are the same site (Aqar family).
for (const p of PLATFORMS) {
  if (FALLBACK_OK.has(p.name)) continue;
  const owner = PLATFORMS.find((q) =>
    q !== p && indexOfMatch(host.branches, q.name) === indexOfMatch(host.branches, p.name)
    && resolve(host.branches, host.fallback, q.name) !== p.domain);
  check(`${p.name}: its cards are not stolen by another platform's token`, !owner,
    owner ? `shares a branch with ${owner.name}` : '');
}

// ── 4. Search-layer wiring is complete and symmetric ────────────────────────────────────────────
const remoteSrc = read('src/data/remote.ts');
const dbSrc = read('scrapers/common/db.py');
const slugOf = (t: string) => t.replace(/_(residential|commercial)_listings$/, '');
// EXECUTED, not text-parsed (2026-09-03). These were two hand-typed literals a regex could read;
// they are now DERIVED from the generated SEARCHABLE_TABLES inventory, and the old regex silently
// matched nothing — res=0, com=0 — which is exactly why a check must run the thing it is checking
// rather than read it. liftSymbols runs the real declarations out of remote.ts.
const lifted = await liftSymbols(join(ROOT, 'src/data/remote.ts'), [
  { header: 'const SEARCHABLE_TABLES = [', endsWith: /\];$/ },
  { header: 'const MONTHLY_ONLY_TABLE = ', endsWith: /;$/ },
  { header: 'const RES_TABLES = ', endsWith: /;$/ },
  { header: 'const COM_TABLES = ', endsWith: /;$/ },
  { header: 'const DEEPLINK_TABLES = [', endsWith: /^\];$/ },
], ['SEARCHABLE_TABLES', 'RES_TABLES', 'COM_TABLES', 'DEEPLINK_TABLES']);
const resTables = new Set(lifted.RES_TABLES as string[]);
const comTables = new Set(lifted.COM_TABLES as string[]);
check('RES_TABLES / COM_TABLES executed out of remote.ts', resTables.size > 25 && comTables.size > 25,
  `res=${resTables.size} com=${comTables.size}`);

// Every residential table has its commercial twin and vice versa — a half-registered platform is
// searchable for one macro category only, which reads as "this source has no shops" rather than as
// a wiring bug. (Gathern + Aqar Monthly are monthly-only RESIDENTIAL sources with no commercial
// table by design — documented in remote.ts right above these lists.)
const MONTHLY_ONLY = new Set(['gathern', 'aqarmonthly']);
for (const t of resTables) {
  const slug = slugOf(t);
  if (MONTHLY_ONLY.has(slug)) continue;
  check(`${slug}: commercial table registered alongside residential`,
    comTables.has(`${slug}_commercial_listings`));
}
for (const t of comTables) {
  check(`${slugOf(t)}: residential table registered alongside commercial`,
    resTables.has(`${slugOf(t)}_residential_listings`));
}

// db.py must expose both batch upserts for every registered table, or the scraper cannot write.
for (const t of resTables) {
  const slug = slugOf(t);
  if (MONTHLY_ONLY.has(slug)) continue;
  // `aqar` predates the batch convention and ships upsert_aqar_residential/_commercial; every
  // later platform uses the _batch spelling. Accept either — the invariant is "a writer exists".
  const hasUpsert = (kind: string) =>
    dbSrc.includes(`def upsert_${slug}_${kind}_batch`) || dbSrc.includes(`def upsert_${slug}_${kind}(`);
  check(`${slug}: db.py has both upsert helpers`, hasUpsert('residential') && hasUpsert('commercial'));
}

// The single-listing by-id lookup: a platform missing there cannot be reopened from a shared or
// saved link even though it is fully searchable.
//
// EXECUTED, and NO LONGER SKIPPING THE MONTHLY-ONLY SOURCES (2026-09-04). This used to slice the
// literal out of `for (const table of [` and text-match slugs in it, with `MONTHLY_ONLY` skipped —
// so the one platform actually missing from that list, aqarmonthly, was the one platform this check
// deliberately did not ask about. (gathern_commercial_listings was missing too.) The list is now
// DEEPLINK_TABLES, derived from the same SEARCHABLE_TABLES inventory, so ask the real question of
// the real value: every searchable table must be resolvable by id, monthly-only sources included.
const deeplink = new Set(lifted.DEEPLINK_TABLES as string[]);
check('DEEPLINK_TABLES executed out of remote.ts', deeplink.size > 50, `got ${deeplink.size}`);
for (const t of (lifted.SEARCHABLE_TABLES as string[])) {
  check(`${t}: resolvable by id (in DEEPLINK_TABLES)`, deeplink.has(t));
}

console.log(failed === 0
  ? '\n✅ every platform is registered end-to-end — none can render as Aqar.'
  : `\n❌ ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
