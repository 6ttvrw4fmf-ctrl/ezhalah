// A MONTHLY RENT IS NEVER SHOWN AS A YEARLY ONE BECAUSE AQAR'S BOX SAID «سنوي» (owner, 2026-11-10).
//
// What happened: aqar ad 6560368 (a Jeddah flat) was the cheapest «yearly» rental on Ezhalah — 9,499 a year. Aqar's
// own price box says «/سنوي», but the seller's own words in the same ad say «السعر الشهري: 9499 ريال فقط». The real
// rent is 9,499 a MONTH (113,988 a year). A visitor saw a flat twelve times cheaper than it is.
//
// The rule (scrapers/aqar/enrich_residential.py, seller_says_monthly): when the seller's own text says — about the
// very figure aqar publishes — that it is the monthly rent, the ad is stored as monthly (period «monthly», yearly
// figure = the advertised figure × 12, the card says «السعر المعلن 9,499 شهرياً»). It is deliberately narrow:
//   • only between 8,000 and 10,000. Under 8,000 the serving rule already treats a «yearly» figure as monthly
//     (docs/ARCHITECTURE.md §20) — flipping it here too would multiply twice. Above 10,000 nothing is touched.
//   • only homes and business units (the same thirteen types as that serving rule) — never rooms, land, chalets…
//   • the monthly word must belong to THAT figure. A second figure beside it («9000 … شهري 900»), a yearly word,
//     «دفعة واحدة», or the fleet's own reader saying «yearly» all leave the ad exactly as aqar published it.
//   • the price itself is never read from the text. The figure is aqar's own; only its period comes from the seller.
//
// This guard RUNS the real Python reader on real seller texts taken from production (scripts/fixtures/
// aqar-seller-says-monthly.json — the same file the pytest reads), then breaks the rule fourteen different ways and
// requires every break to be noticed.
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { pyCall } from './lib/pythonMutant.ts';
import { npmTestRuns } from './lib/testRegistry.ts';
import { CHEAP_YEARLY_BELOW, CHEAP_YEARLY_TYPES_EN } from '../src/lib/rentPool.ts';

const ROOT = join(import.meta.dirname, '..');
const MOD = 'scrapers.aqar.enrich_residential';
const SRC = join(ROOT, 'scrapers/aqar/enrich_residential.py');
const FIXTURE = join(ROOT, 'scripts/fixtures/aqar-seller-says-monthly.json');

let failed = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok || !detail ? '' : ` — ${detail}`}`);
  if (!ok) failed++;
};
const mustCatch = (what: string, caught: boolean, detail = '') => check(`MUTATION: catches ${what}`, caught, detail);

type Monthly = { row: number; price: number; type: string; text: string; flips: boolean; why_left?: string };
type Yearly = { row: number; price: number; type: string; text: string };
type Tricky = { price: number; text: string; monthly: boolean };
const F = JSON.parse(readFileSync(FIXTURE, 'utf8')) as { monthly: Monthly[]; yearly: Yearly[]; tricky: Tricky[] };

// ── every case: [label, price, seller text, type, the right answer] ─────────────────────────────────────────────
type Case = { label: string; price: number | null; text: unknown; type: string | null; want: boolean; say: string };
const worded = (n: number) => `الايجار الشهري ${n} ريال`;
const CASES: Case[] = [
  ...F.monthly.map((c) => ({ label: `M${c.row}`, price: c.price, text: c.text, type: c.type, want: c.flips,
    say: c.flips ? `row ${c.row} (${c.price}): the seller says monthly → monthly` : `row ${c.row} (${c.price}): left alone on purpose — ${c.why_left}` })),
  ...F.yearly.map((c) => ({ label: `Y${c.row}/own`, price: c.price, text: c.text, type: c.type, want: false,
    say: `row ${c.row} (${c.price}, ${c.type}): a yearly ad stays yearly` })),
  ...F.yearly.map((c) => ({ label: `Y${c.row}`, price: c.price, text: c.text, type: 'Apartment', want: false,
    say: `row ${c.row} (${c.price}): the same words on a flat still stay yearly` })),
  ...F.tricky.map((c, i) => ({ label: `T${i}`, price: c.price, text: c.text, type: 'Apartment', want: c.monthly,
    say: `«${c.text}» at ${c.price} → ${c.monthly ? 'monthly' : 'left alone'}` })),
  { label: 'room', price: 9000, text: worded(9000), type: 'Room', want: false, say: 'a room is never touched' },
  { label: 'land', price: 9000, text: worded(9000), type: 'Residential Land', want: false, say: 'land is never touched' },
  { label: 'over', price: 12000, text: worded(12000), type: 'Apartment', want: false, say: '12,000 is above the band — left as aqar says' },
  { label: 'under', price: 5000, text: worded(5000), type: 'Apartment', want: false, say: '5,000 is under the band — the serving rule already handles it' },
  { label: '7999', price: 7999, text: worded(7999), type: 'Apartment', want: false, say: '7,999 is just under the band' },
  { label: '10001', price: 10001, text: worded(10001), type: 'Apartment', want: false, say: '10,001 is just above the band' },
  { label: '8000', price: 8000, text: worded(8000), type: 'Apartment', want: true, say: '8,000 is the first figure in the band' },
  { label: '10000', price: 10000, text: worded(10000), type: 'Apartment', want: true, say: '10,000 is the last figure in the band' },
  { label: 'no-text', price: 9000, text: null, type: 'Apartment', want: false, say: 'an ad with no seller text is left alone' },
  { label: 'no-price', price: null, text: worded(9000), type: 'Apartment', want: false, say: 'an ad with no price is left alone' },
  { label: 'no-type', price: 9000, text: worded(9000), type: null, want: false, say: 'an ad of unknown type is left alone' },
];

const real = readFileSync(SRC, 'utf8');
/** The labels the reader gets WRONG (real module, or a broken copy of it). */
const wrong = (source?: string): string[] => {
  const got = pyCall(ROOT, MOD, 'seller_says_monthly', CASES.map((c) => [c.price, c.text, c.type]), source) as boolean[];
  return CASES.filter((c, i) => got[i] !== c.want).map((c) => c.label);
};

// ── the real reader on the real texts ───────────────────────────────────────────────────────────────────────────
{
  const bad = new Set(wrong());
  for (const c of CASES) check(c.say, !bad.has(c.label));
  const flips = F.monthly.filter((c) => c.flips).length;
  check(`the fixture is not empty or thinned: ${F.monthly.length} monthly ads (${flips} corrected), ${F.yearly.length} yearly, ${F.tricky.length} tricky`,
    F.monthly.length >= 24 && flips >= 22 && F.yearly.length >= 9 && F.tricky.length >= 21);
  check('the ad the owner saw (aqar 6560368, row 14990555, 9,499) is among the corrected ones',
    F.monthly.some((c) => c.row === 14990555 && c.price === 9499 && c.flips) && !bad.has('M14990555'));
}

// ── break the rule every way we know; each break must be noticed ────────────────────────────────────────────────
const YEARLY_VETO = 'if _seller_ties(price, text, _Y_HEAD, _Y_TAIL, smaller_owns=False) or _seller_lump_sum(price, text):';
const MUTATIONS: { what: string; from: string; to: string; breaks: string[] }[] = [
  { what: 'a reader with no yearly veto at all', from: `    ${YEARLY_VETO}\n        return False\n`, to: '', breaks: ['T2', 'T17'] },
  { what: 'a reader that ignores a yearly word beside the figure', from: YEARLY_VETO, to: 'if _seller_lump_sum(price, text):', breaks: ['T2'] },
  { what: 'a reader that ignores «دفعة واحدة» beside the figure', from: YEARLY_VETO,
    to: 'if _seller_ties(price, text, _Y_HEAD, _Y_TAIL, smaller_owns=False):', breaks: ['T17'] },
  { what: "a reader that no longer asks the fleet's own period reader",
    from: '    if N.stated_rent_period(price, text) == "annual":   # the fleet\'s own reader disagrees → not certain\n        return False\n', to: '', breaks: ['T20'] },
  { what: 'a reader that touches every type (rooms, land)', from: ' or property_type not in SELLER_MONTHLY_TYPES:', to: ':', breaks: ['room', 'land'] },
  { what: 'a reader with no price band', from: '    if not (SELLER_MONTHLY_MIN <= price <= N.MONTHLY_LOOKING_MAX):\n        return False\n', to: '',
    breaks: ['over', 'under', '7999', '10001'] },
  { what: 'a naive reader (a monthly word anywhere in the ad)', from: '    return _seller_ties(price, text, _M_HEAD, _M_TAIL, smaller_owns=True)\n',
    to: '    return bool(re.search(_M_AR, text))\n', breaks: ['M17936801', 'Y2538571', 'T0', 'T7', 'T12', 'T13', 'T18', 'T19'] },
  { what: 'the rule switched off (the bug the owner saw)',
    from: '    """True only when the seller\'s own text says, about aqar\'s own figure, that it is the MONTHLY rent."""\n', to: '    return False\n',
    breaks: ['M14990555', 'M2314166', 'M21413572', 'T1', 'T6', 'T10', 'T11', 'T14', '8000', '10000'] },
  { what: 'a reader that ignores a second figure AFTER the monthly word (the deposit, the real monthly)',
    from: '                if not (nxt and other_owns(nxt.group(1))):', to: '                if True:', breaks: ['M17936801', 'T0'] },
  { what: 'a reader that ignores a second figure BEFORE the monthly word', from: '                if not (prev and other_owns(prev.group(1))):',
    to: '                if True:', breaks: ['T19'] },
  { what: 'a reader that takes «شهرين» (two months) for «شهري»', from: '_AR = r"(?![ء-ي])"', to: '_AR = r""', breaks: ['T3'] },
  { what: 'a reader that ties a word to the figure BEFORE it when the word heads what follows («شهري: 900»)',
    from: '                if re.match(r"\\s*[=:：]", rest):\n                    continue', to: '                if False:\n                    continue', breaks: ['T18'] },
  { what: 'a reader that finds the figure inside a longer number (9500 in 19500, 9500.50)',
    from: 'rf"(?<![\\d,.]){re.escape(num)}(?![,.]?\\d)", text):\n            before, after = text[:m.start()], text[m.end():]',
    to: 'rf"{re.escape(num)}", text):\n            before, after = text[:m.start()], text[m.end():]', breaks: ['T13'] },
  { what: 'a band lowered under 8,000 (would multiply twice with the serving rule)', from: 'SELLER_MONTHLY_MIN = 8_000', to: 'SELLER_MONTHLY_MIN = 300',
    breaks: ['under', '7999'] },
];
for (const m of MUTATIONS) {
  const once = real.split(m.from).length === 2;
  if (!once) { mustCatch(m.what, once, 'the line this break edits is not in the reader exactly once — update this guard with the reader'); continue; }
  const bad = new Set(wrong(real.replace(m.from, m.to)));
  const missed = m.breaks.filter((l) => !bad.has(l));
  mustCatch(m.what, missed.length === 0, `not noticed on: ${missed.join(', ')}`);
}

// ── the whole reader, on a page shaped like aqar's ──────────────────────────────────────────────────────────────
const HARNESS = `

_BARRIER_HTML = ""

def get(url, *a, **k):
    import types
    return types.SimpleNamespace(text=_BARRIER_HTML)

def _barrier_page(listing, slot, rnpl):
    import json as _json
    inner = _json.dumps({"listing": listing}, ensure_ascii=False)
    blob = "<script>self.__next_f.push([1,%s])</script>" % _json.dumps(inner, ensure_ascii=False)
    extra = '<a href="/rnpl/apply">x</a><p>استأجر الآن وأدفع لاحقًا ابتداءً من981 § ريال شهريا</p>' if rnpl else ""
    return ("<html><body><h1>شقة للإيجار</h1><div><h3><span>%s</span></h3></div><div>تفاصيل الإعلان المساحة 120 م²</div>"
            "<p>%s</p>%s%s</body></html>") % (slot, listing.get("content") or "", extra, blob)

def _barrier_e2e(listing, slot, slug, deal, rnpl):
    global _BARRIER_HTML
    _BARRIER_HTML = _barrier_page(listing, slot, rnpl)
    import contextlib, io
    with contextlib.redirect_stdout(io.StringIO()):
        row = enrich_residential("https://sa.aqar.fm/شقق-للإيجار/جدة/حي-الشاطئ/x-6560368", type_slug=slug, deal_slug=deal)
    if row is None:
        return None
    sc = row.get("source_capture") or {}
    ev = row.get("price_evidence") or {}
    return [row.get("rent_period"), row.get("price_annual"), row.get("price_total"), sc.get("rent_period_from"), ev.get("origin")]

def _barrier_consts():
    return [SELLER_MONTHLY_MIN, sorted(SELLER_MONTHLY_TYPES), N.MONTHLY_LOOKING_MAX]
`;
const BASE = { id: 6560368, published: true, location: { lat: 21.6, lng: 39.1 } };
const YEARLY_SLOT = '9,499 <span>§</span> ريال /سنوي';
const SAYS_MONTHLY = 'شقة فاخرة السعر الشهري: 9499 ريال فقط';
const ad = (over: Record<string, unknown>) => ({ ...BASE, price: 9499, rent_period: 3, content: SAYS_MONTHLY, ...over });
type Out = [string | null, number | null, number | null, string | null, string | null] | null;
const PAGES: { say: string; args: unknown[]; want: Out }[] = [
  { say: "aqar's box says yearly, the seller says monthly → stored monthly, 9,499 × 12, marked as the seller's word, price still aqar's own",
    args: [ad({}), YEARLY_SLOT, 'apartment', 'rent', false], want: ['monthly', 113988, null, 'seller_text', 'structured'] },
  { say: 'aqar gives no period, the seller says monthly → the same',
    args: [ad({ rent_period: null }), '9,499 <span>§</span> ريال', 'apartment', 'rent', false], want: ['monthly', 113988, null, 'seller_text', 'structured'] },
  { say: 'the seller says yearly → untouched (9,499 a year)',
    args: [ad({ content: 'الايجار السنوي 9499 ريال' }), YEARLY_SLOT, 'apartment', 'rent', false], want: ['annual', 9499, null, null, 'structured'] },
  { say: "aqar's own box already says monthly → monthly, and NOT marked as the seller's word",
    args: [ad({ rent_period: 2 }), '9,499 <span>§</span> ريال /شهري', 'apartment', 'rent', false], want: ['monthly', 113988, null, null, 'structured'] },
  { say: 'a room → untouched', args: [ad({}), YEARLY_SLOT, 'room', 'rent', false], want: ['annual', 9499, null, null, 'structured'] },
  { say: '12,000 → untouched (above the band)',
    args: [ad({ price: 12000, content: 'السعر الشهري: 12000 ريال' }), '12,000 <span>§</span> ريال /سنوي', 'apartment', 'rent', false], want: ['annual', 12000, null, null, 'structured'] },
  { say: '5,000 → untouched here (the serving rule handles it; flipping here too would multiply twice)',
    args: [ad({ price: 5000, content: 'السعر الشهري: 5000 ريال' }), '5,000 <span>§</span> ريال /سنوي', 'apartment', 'rent', false], want: ['annual', 5000, null, null, 'structured'] },
  { say: 'a pay-later (RNPL) page where the seller says monthly about 9,499 → monthly (aqar 6560368 is one)',
    args: [ad({}), YEARLY_SLOT, 'apartment', 'rent', true], want: ['monthly', 113988, null, 'seller_text', 'structured'] },
  { say: "a pay-later page where only aqar's instalment line says «شهريا» → untouched (981 is never the published figure)",
    args: [ad({ content: 'شقة مفروشة راقية 3 غرف نوم' }), YEARLY_SLOT, 'apartment', 'rent', true], want: ['annual', 9499, null, null, 'structured'] },
  { say: 'a sale ad → no rent period at all, the price is the sale price',
    args: [ad({}), '9,499 <span>§</span> ريال', 'apartment', 'sale', false], want: [null, null, 9499, null, 'structured'] },
];
const pages = (source: string) => pyCall(ROOT, MOD, '_barrier_e2e', PAGES.map((p) => p.args), source + HARNESS) as Out[];
const same = (a: Out, b: Out) => JSON.stringify(a) === JSON.stringify(b);
{
  const out = pages(real);
  PAGES.forEach((p, i) => check(`whole page: ${p.say}`, same(out[i], p.want), `got ${JSON.stringify(out[i])}`));
  // The call site, not only the rule: a reader that never asks the rule, and one that skips pay-later pages.
  const CALL = '            if rent_period != "monthly" \\\n                    and seller_says_monthly(s_price, (obj or {}).get("content"), property_type):';
  const off = real.split(CALL).length === 2 ? pages(real.replace(CALL, '            if False:')) : null;
  mustCatch('a reader that has the rule but never asks it', !!off && !same(off[0], PAGES[0].want) && !same(off[1], PAGES[1].want));
  const ASKS = '            if rent_period != "monthly" \\\n';
  const rnpl = real.split(ASKS).length === 2 ? pages(real.replace(ASKS, '            if rent_period != "monthly" and not is_rnpl_page \\\n')) : null;
  mustCatch('a reader that skips pay-later (RNPL) pages — the audit ad 6560368 stays «yearly»', !!rnpl && !same(rnpl[7], PAGES[7].want));
  const MARK = '                rent_period_from = "seller_text"\n';
  const unmarked = real.split(MARK).length === 2 ? pages(real.replace(MARK, '')) : null;
  mustCatch("a corrected ad that does not record it was the seller's word", !!unmarked && !same(unmarked[0], PAGES[0].want));
}

// ── the band and the type list are the serving rule's own (never two lists that can drift apart) ────────────────
{
  const [min, types, max] = pyCall(ROOT, MOD, '_barrier_consts', [[]], real + HARNESS)[0] as [number, string[], number];
  check(`the band starts exactly where the serving rule stops (${CHEAP_YEARLY_BELOW}) — no ad is multiplied twice, none falls between`,
    min === CHEAP_YEARLY_BELOW, `scraper ${min}, serving rule ${CHEAP_YEARLY_BELOW}`);
  check('the band ends at 10,000 (the fleet\'s own «looks monthly» ceiling) — nothing above it is touched', max === 10000, `got ${max}`);
  const served = [...CHEAP_YEARLY_TYPES_EN].sort();
  check('the types are the serving rule\'s thirteen — homes and business units, no rooms, land, chalets or farms',
    JSON.stringify(types) === JSON.stringify(served) && types.length === 13, `scraper ${JSON.stringify(types)} vs serving ${JSON.stringify(served)}`);
}

check('npm test runs this guard', npmTestRuns(ROOT, 'verify-aqar-seller-says-monthly'));

console.log(failed === 0
  ? '\n✅ verify-aqar-seller-says-monthly: an aqar rent the seller calls monthly is stored and shown as monthly; yearly ads are untouched.\n'
  : `\n❌ verify-aqar-seller-says-monthly: ${failed} check(s) failed.\n`);
process.exit(failed === 0 ? 0 : 1);
