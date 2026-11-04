// A SHARED URL IS A DUPLICATE ONLY WHEN THE SOURCE'S OWN AD NUMBER SAYS SO (2026-11-04).
//
// THE FALSE ALARMS THIS PINS. mon_detect_url_collisions_res_vs_com() raised "the user sees the SAME
// physical property twice" for every URL found in both a platform's residential and commercial table,
// without ever reading ad_number:
//   nufouth  `?ads-N4175=1` is the site's share link for a PROPERTY; its 10 rows across both tables are
//            10 distinct units NFZN4175A…, every one embedding the page id N4175 (alert 4566);
//   alajlan  every row links the homepage by design (no per-listing URL exists); ALJR1..10 and ALJI1
//            are 11 different ads (alert 5961).
// mon_detect_card_link_identity() called nufouth_residential per-listing at a 19.4% shared-URL share
// while nufouth_commercial (the same site and URLs) sat on the granularity ledger at 55% (alert 12388).
//
// WHAT MUST STILL RAISE — the half a change like this could silence:
//   wasalt   WST5904998 «فيلا سكنية» in BOTH tables: the same ad_number on one URL → P2 duplicate;
//   hajer    HJ1168 and the phantom HJ1512 on one Arabic slug (no id token) → P2;
//   a per-listing site where two different ads share a URL nobody can tie to them → P2 (card A → B).
//
// WHAT THIS CHECK IS. §1 EXECUTES the SQL's own two regular expressions — read out of the committed
// migration, not retyped — as listing_ad_embeds_url_id(), over a truth table. §2 executes the res-vs-com
// and card-link judgements as pure functions over the production cases above, and §3 executes the
// PRE-FIX URL-only judgement against the same cases, requiring it to disagree exactly on the false
// alarms (and agree on wasalt). §4 is a consistency read of the committed SQL: it cannot run PL/pgSQL,
// so it asserts the clauses the judgement depends on are present, and says so.
//
// Hermetic: reads one committed file. No network, no database.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const MIGRATION = 'supabase/migrations/20261104075037_url_collision_is_a_duplicate_only_when_the_ad_number_says_so.sql';

let failures = 0;
const ok = (c: boolean, m: string) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures++; };
const mustCatch = (label: string, caught: boolean) => ok(caught, `(mutation) ${label}`);

const path = join(ROOT, MIGRATION);
ok(existsSync(path), `${MIGRATION} is committed`);
const sql = existsSync(path) ? readFileSync(path, 'utf8') : '';

// ── §1 the predicate, from the SQL's own patterns ────────────────────────────────────────────────
const tokenPat = sql.match(/regexp_matches\(p_url, '([^']+)', 'g'\)/)?.[1] ?? '';
const boundPre = sql.match(/p_ad ~\* \('([^']+)' \|\| m\.tok\[1\] \|\| '([^']+)'\)/);
ok(tokenPat === '([A-Za-z]?[0-9]{3,})', `token pattern read from the SQL: ${tokenPat}`);
ok(!!boundPre, 'digit-bounded match pattern read from the SQL');
const PRE = boundPre?.[1] ?? '(^|[^0-9])';
const POST = boundPre?.[2] ?? '([^0-9]|$)';

export function makeEmbeds(tok: string, pre: string, post: string) {
  return (url: string, ad: string): boolean => {
    if (!url || !ad) return false;
    const toks = [...url.matchAll(new RegExp(tok, 'g'))].map((m) => m[1]);
    return toks.some((t) => new RegExp(pre + t + post, 'i').test(ad));
  };
}
const embeds = makeEmbeds(tokenPat || '([A-Za-z]?[0-9]{3,})', PRE, POST);

const TRUTH: [string, string, boolean, string][] = [
  ['https://nufouth.com/latest-offers?ads-N4175=1', 'NFZN4175A01725U81b4213d', true, 'nufouth unit of N4175'],
  ['https://nufouth.com/latest-offers?ads-h133=1', 'NFZH133A01288Uae94ca3d', true, 'lower-cased URL, letter token'],
  ['https://nufouth.com/latest-offers?ads-N250=1', 'NFZN2501A01754Uf30fba0b', false, 'N250 is not N2501'],
  ['https://wasalt.sa/en/property/undefined-5904998', 'WST5904998', true, 'wasalt id in the slug'],
  ['https://alajlan-re.com/', 'ALJR3', false, 'homepage has no id'],
  ['https://hajerhouses.com/property/%d8%af%d8%a8%d9%84%d9%83/', 'HJ1512', false, 'percent-encoded Arabic slug has no id'],
];
for (const [u, a, want, why] of TRUTH) ok(embeds(u, a) === want, `embeds(${why}) = ${want}`);
const unbounded = makeEmbeds(tokenPat || '([A-Za-z]?[0-9]{3,})', '', '');
mustCatch('an unbounded match would call NFZN2501A… a unit of the N250 page',
  unbounded(TRUTH[2][0], TRUTH[2][1]) !== embeds(TRUTH[2][0], TRUTH[2][1]));

// ── §2 the judgements ────────────────────────────────────────────────────────────────────────────
type Row = { table: 'res' | 'com'; url: string; ad: string };
type Verdict = 'P2' | 'resolve';

/** mon_detect_url_collisions_res_vs_com, as the new SQL decides one platform. */
export function judgeResCom(rows: Row[], onLedger: boolean, hasAd = true): Verdict {
  const urls = new Set(rows.filter((r) => r.table === 'res').map((r) => r.url.toLowerCase()));
  const inter = [...new Set(rows.filter((r) => r.table === 'com').map((r) => r.url.toLowerCase()))].filter((u) => urls.has(u));
  let sameAd = 0, unproven = 0;
  for (const u of inter) {
    const on = rows.filter((r) => r.url.toLowerCase() === u);
    const res = on.filter((r) => r.table === 'res'), com = on.filter((r) => r.table === 'com');
    const same = hasAd && res.some((r) => com.some((c) => c.ad === r.ad));
    if (same) sameAd++;
    else if (!hasAd || on.some((r) => !embeds(u, r.ad))) unproven++;
  }
  const distinctOnly = onLedger && hasAd ? 0 : unproven;
  return sameAd + distinctOnly > 0 ? 'P2' : 'resolve';
}

/** The pre-fix judgement: any URL in both tables. */
export function judgeResComOld(rows: Row[]): Verdict {
  const res = new Set(rows.filter((r) => r.table === 'res').map((r) => r.url.toLowerCase()));
  return rows.some((r) => r.table === 'com' && res.has(r.url.toLowerCase())) ? 'P2' : 'resolve';
}

/** card_link_identity's per-listing branch (share under 20%), as the new SQL decides one table. */
export function judgeCardLink(rows: { url: string; ad: string }[], hasAd = true): 'P2 dupe' | 'P3 granularity' | 'resolve' {
  const by = new Map<string, string[]>();
  for (const r of rows) by.set(r.url, [...(by.get(r.url) ?? []), r.ad]);
  const shared = [...by].filter(([, ads]) => ads.length > 1);
  if (!shared.length) return 'resolve';
  const repeat = shared.some(([, ads]) => new Set(ads).size < ads.length);
  const unproven = shared.some(([u, ads]) => ads.some((a) => !embeds(u, a)));
  return hasAd && !repeat && !unproven ? 'P3 granularity' : 'P2 dupe';
}

const N = 'https://nufouth.com/latest-offers?ads-N4175=1';
const nufouth: Row[] = [
  { table: 'com', url: N, ad: 'NFZN4175A01725U81b4213d' }, { table: 'com', url: N, ad: 'NFZN4175A01043U16255899' },
  { table: 'res', url: N, ad: 'NFZN4175A01442U3d17d610' }, { table: 'res', url: N, ad: 'NFZN4175A01635U49bf511f' },
];
const H = 'https://alajlan-re.com/';
const alajlan: Row[] = [{ table: 'res', url: H, ad: 'ALJR3' }, { table: 'res', url: H, ad: 'ALJR10' }, { table: 'com', url: H, ad: 'ALJI1' }];
const W = 'https://wasalt.sa/en/property/undefined-5904998';
const wasalt: Row[] = [{ table: 'res', url: W, ad: 'WST5904998' }, { table: 'com', url: W, ad: 'WST5904998' }];
const P = 'https://example.sa/property/villa-in-narjis';
const perListing: Row[] = [{ table: 'res', url: P, ad: 'EX101' }, { table: 'com', url: P, ad: 'EX202' }];

ok(judgeResCom(nufouth, true) === 'resolve', 'nufouth: ten units of one property page are not a duplicate (ledgered)');
ok(judgeResCom(nufouth, false) === 'resolve', 'nufouth: … and not even without the ledger (every ad embeds N4175)');
ok(judgeResCom(alajlan, true) === 'resolve', 'alajlan: homepage-only platform on the granularity ledger resolves');
ok(judgeResCom(alajlan, false) === 'P2', 'alajlan without a ledger entry: different ads on one URL nobody can tie → P2');
ok(judgeResCom(wasalt, true) === 'P2', 'wasalt: one ad_number in both tables → P2, ledger or not');
ok(judgeResCom(wasalt, false) === 'P2', 'wasalt without ledger → P2');
ok(judgeResCom(perListing, false) === 'P2', 'per-listing site, two different ads on one untied URL → P2 (card A → B)');
ok(judgeResCom(perListing, false, false) === 'P2', 'a platform without ad_number keeps the URL-only judgement');

const NUF_RES = [{ url: 'https://nufouth.com/latest-offers?ads-N1230=1', ad: 'NFZN1230A01107Uc4043972' },
  { url: 'https://nufouth.com/latest-offers?ads-N1230=1', ad: 'NFZN1230A01038U21a5bf79' }];
const HAJER = [{ url: 'https://hajerhouses.com/property/%d8%af%d8%a8%d9%84/', ad: 'HJ1168' },
  { url: 'https://hajerhouses.com/property/%d8%af%d8%a8%d9%84/', ad: 'HJ1512' }];
ok(judgeCardLink(NUF_RES) === 'P3 granularity', 'card_link: nufouth_residential units of N1230 are proven page granularity');
ok(judgeCardLink(HAJER) === 'P2 dupe', 'card_link: hajer HJ1168/HJ1512 on one slug stays P2');
ok(judgeCardLink([NUF_RES[0], NUF_RES[0]]) === 'P2 dupe', 'card_link: a REPEATED ad number on a page stays P2');
ok(judgeCardLink(NUF_RES, false) === 'P2 dupe', 'card_link: without ad_number nothing is proven');

// ── §3 the pre-fix judgement raised the false alarms, and only those ─────────────────────────────
mustCatch('the URL-only sweep raised nufouth (the new one does not)', judgeResComOld(nufouth) !== judgeResCom(nufouth, true));
mustCatch('the URL-only sweep raised alajlan (the new one does not)', judgeResComOld(alajlan) !== judgeResCom(alajlan, true));
ok(judgeResComOld(wasalt) === judgeResCom(wasalt, true), 'old and new agree on the real wasalt duplicate');

// ── §4 the committed SQL carries the clauses the judgement depends on (consistency, not execution) ─
const body = sql.split('create or replace function public.mon_detect_url_collisions_res_vs_com()')[1] ?? '';
ok(/join com c on c\.u = r\.u and c\.ad = r\.ad/.test(body), 'res-vs-com: a duplicate needs the SAME ad in both tables');
ok(/not public\.listing_ad_embeds_url_id\(i\.u, a\.ad\)/.test(body), 'res-vs-com: distinct ads must each embed the URL id');
ok(/ops_card_link_granularity/.test(body), 'res-vs-com: the granularity ledger is consulted');
ok(/v_distinct_only := case when v_on_ledger and v_has_ad then 0 else v_unproven end/.test(body), 'res-vs-com: ledger only excuses distinct ads, never a shared ad_number');
ok(/mon_resolve_key\('duplicate_card_surface_routed'/.test(body), 'res-vs-com: still resolves the routed copy');
ok(/elsif v_has_ad and coalesce\(v_repeat_ads, 0\) = 0 and coalesce\(v_unproven_urls, 0\) = 0 then/.test(sql),
  'card_link: proven page units need no repeated ad AND every row embedding its URL id');
ok(/not found exactly once — live body moved/.test(sql), 'card_link patch is anchored and fails closed');

if (failures) { console.log(`\n❌ verify-url-collision-needs-the-same-ad: ${failures} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-url-collision-needs-the-same-ad: all checks passed.');
