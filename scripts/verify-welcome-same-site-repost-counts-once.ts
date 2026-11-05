// THE SAME PROPERTY POSTED TWICE ON ONE SITE COUNTS ONCE IN THE WELCOME FACTS (owner 2026-11-05, «make it a rule»).
// aqar 6891846 / 6891844 (حفر الباطن, حي الصفاء, 780 m², 642 SAR/m², same pin) are one plot and moved the city's median
// land price. Both the builder (build_welcome_insights) and its independent recount (audit_welcome_insights) must fold a
// same-site repost — and ONLY when both pins exist and are within 10 m, never on size/price alone (neighbouring plots).
// Hermetic: reads the committed SQL. For each function the governing text is the LAST committed migration that either
// re-creates it or patches it with the rule; a later full re-create without the rule would silently drop it.
import { readdirSync, readFileSync } from 'node:fs';

let failed = 0;
const check = (name: string, ok: boolean) => { console.log(`${ok ? '✓' : '✗'} ${name}`); if (!ok) failed++; };
const mustCatch = (name: string, caught: boolean) => { console.log(`${caught ? '✓' : '✗'} mutation caught: ${name}`); if (!caught) failed++; };

const DIR = new URL('../supabase/migrations/', import.meta.url);
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort().map((f) => ({ f, s: readFileSync(new URL(f, DIR), 'utf8') }));

/** A same-site fold: same platform, both pins required, a 10 m radius (power-sum < 100), and the attribute match. */
export function foldsSameSiteRepost(src: string, a: 'x' | 'y', b: 'x' | 'y'): boolean {
  const samePlatform = new RegExp(`${a}\\.platform = ${b}\\.platform`).test(src);
  const pinsRequired = /x\.lat is not null and y\.lat is not null and x\.lng is not null and y\.lng is not null/.test(src);
  const tenMetres = /cos\(radians\(x\.lat\)\), 2\) < 100\)?;/.test(src);
  const attrs = /area_m2 = [xy]\.area_m2/.test(src) && /coalesce\([xy]\.price_total, [xy]\.price_annual\) = coalesce\([xy]\.price_total, [xy]\.price_annual\)/.test(src);
  return samePlatform && pinsRequired && tenMetres && attrs;
}

function governing(fn: string, marker: string) {
  const touching = files.filter(({ s }) => new RegExp(`create or replace function public\\.${fn}\\s*\\(`, 'i').test(s) || s.includes(marker));
  return touching.at(-1);
}

const B_MARK = 'same_site repost (owner 2026-11-05)';
const A_MARK = 'same_site repost, written again';
const b = governing('build_welcome_insights', B_MARK);
const a = governing('audit_welcome_insights', A_MARK);
check(`builder's governing migration (${b?.f ?? 'none'}) carries the same-site rule`, !!b && b.s.includes(B_MARK) && foldsSameSiteRepost(b.s, 'x', 'y'));
check(`recount's governing migration (${a?.f ?? 'none'}) carries the same-site rule`, !!a && a.s.includes(A_MARK) && foldsSameSiteRepost(a.s, 'y', 'x'));

if (b) {
  mustCatch('size/price alone (pins no longer required)', !foldsSameSiteRepost(b.s.replace('x.lat is not null and y.lat is not null and x.lng is not null and y.lng is not null', 'true'), 'x', 'y'));
  mustCatch('radius widened to the cross-site 200 m', !foldsSameSiteRepost(b.s.replace(/cos\(radians\(x\.lat\)\), 2\) < 100;/, 'cos(radians(x.lat)), 2) < 40000;'), 'x', 'y'));
  mustCatch('rule removed from the builder', !foldsSameSiteRepost(b.s.replace(/x\.platform = y\.platform/g, 'x.platform <> y.platform'), 'x', 'y'));
}
// the recount keeps listing_id as TEXT; comparing it as text ('999' > '1000') kept a different copy than the builder
// and failed 100 facts on 2026-11-05 12:02. The governing recount text must compare the ids as numbers.
const recountNumeric = (src: string) => /y\.listing_id::bigint < x\.listing_id::bigint/.test(src);
const recountLast = files.filter(({ s }) => s.includes(A_MARK) || /y\.listing_id::bigint < x\.listing_id::bigint/.test(s) || /create or replace function public\.audit_welcome_insights\s*\(/i.test(s)).at(-1);
check(`the recount (${recountLast?.f ?? 'none'}) compares same-site ids as numbers, like the builder`, !!recountLast && recountNumeric(recountLast.s));
if (recountLast) mustCatch('ids compared as text again', !recountNumeric(recountLast.s.replace(/y\.listing_id::bigint < x\.listing_id::bigint/g, 'y.listing_id < x.listing_id')));
if (a) mustCatch('rule removed from the recount', !foldsSameSiteRepost(a.s.replace(/y\.platform = x\.platform/g, 'y.platform <> x.platform'), 'y', 'x'));

if (failed) { console.error(`\n❌ verify-welcome-same-site-repost-counts-once: ${failed} check(s) failed.`); process.exit(1); }
console.log('\n✅ verify-welcome-same-site-repost-counts-once: a repost on one site is counted once, and only on a shared pin.');
