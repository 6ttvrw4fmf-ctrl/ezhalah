// A DISTRICT READ FROM AN AD'S PIN IS LABELLED «تقريبي», AND A FAILED LOOKUP HIDES IT (owner 2026-10-25).
//
// Executes the pure helper (src/lib/pinDistrictApprox.ts) and pins the wiring, so the label cannot be dropped from a card, the ad page
// cannot build district prices on an approximate district, and a lookup that fails can never leave a pin district shown unlabelled.
//   node --experimental-strip-types scripts/verify-pin-district-approx-label.ts   (discovered by `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyPinVerdict, districtWithLabel, needsPinProbe, pinKey, pinVerdict } from '../src/lib/pinDistrictApprox.ts';

const root = join(import.meta.dirname, '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
let failed = 0;
const check = (name: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };
const mustCatch = (name: string, caught: boolean) => { if (!caught) failed++; console.log(`${caught ? 'PASS' : 'FAIL'}  (mutation) catches ${name}`); };

// ── the pure rules ──────────────────────────────────────────────────────────────────────────────
check('only an ad with a BLANK own district and a SET index district is asked about', needsPinProbe('', 'حي الروابي') && needsPinProbe(null, 'حي الروابي') && needsPinProbe('  ', 'حي الروابي'));
check('an ad that has its own district word is never asked about (Aqar, Deal App…)', !needsPinProbe('Al Malqa', 'حي الملقا') && !needsPinProbe('الملقا', 'حي الملقا'));
check('an ad with no district at all is not asked about (nothing to label)', !needsPinProbe('', '') && !needsPinProbe(undefined, null));
const set = new Set([pinKey('aqar_residential_listings', 5)]);
check('in the answer → approximate', pinVerdict(pinKey('aqar_residential_listings', 5), set) === 'approx');
check('answered but not in the set → the source\'s own word', pinVerdict(pinKey('aqar_residential_listings', 6), set) === 'source');
check('NO answer (lookup failed) → unknown', pinVerdict(pinKey('aqar_residential_listings', 5), null) === 'unknown');
const a = applyPinVerdict({ district: 'حي الروابي', districtCanonical: 'حي الروابي' } as { district: string; districtCanonical: string; districtApprox?: boolean }, 'approx');
check('approx marks the card and keeps the district', a.districtApprox === true && a.district === 'حي الروابي');
const u = applyPinVerdict({ district: 'حي الروابي', districtCanonical: 'حي الروابي' } as { district: string; districtCanonical: string; districtApprox?: boolean }, 'unknown');
check('unknown HIDES the displayed district but never the match field', u.district === '' && u.districtCanonical === 'حي الروابي' && u.districtApprox === false);
const s = applyPinVerdict({ district: 'حي الملقا' } as { district: string; districtApprox?: boolean }, 'source');
check('the source\'s own district is left alone', s.district === 'حي الملقا' && !s.districtApprox);
check('label text: «حي X (تقريبي)», nothing added when exact or empty', districtWithLabel('حي الروابي', true, 'تقريبي') === 'حي الروابي (تقريبي)' && districtWithLabel('حي الروابي', false, 'تقريبي') === 'حي الروابي' && districtWithLabel('', true, 'تقريبي') === '');

// ── the wiring ──────────────────────────────────────────────────────────────────────────────────
const remote = read('src/data/remote.ts');
const card = read('src/components/ResultCard.tsx');
const prev = read('src/components/ListingPreview.tsx');
const i18n = readFileSync(join(root, 'src/i18n.tsx'), 'utf8');
check('the results path asks pin_district_approx_ar through the in-file bounded()', /bounded<[\s\S]{0,120}?>\(\s*supabase\.rpc\('pin_district_approx_ar'/.test(remote));
check('the results path applies the verdict to each listing', /applyPinVerdict\(l, pinUnknown\.has\(pk\) \? 'unknown' : pinVerdict\(pk, pinApprox\)\)/.test(remote));
check('a chunk that still fails after one retry marks its ads UNKNOWN (district hidden), never "source"', /for \(let attempt = 0; attempt < 2 && !ok; attempt\+\+\)[\s\S]{0,700}if \(!ok\) for \(const k of chunk\) pinUnknown\.add/.test(remote));
check('no Supabase client at all also means unknown, not "source"', /else if \(pinKeys\.length\) \{ for \(const k of pinKeys\) pinUnknown\.add/.test(remote));
check('the lookup is chunked (500 keys, under the database cap of 1000) and asks only about blank-own-district ads', /at \+= 500\) \{/.test(remote) && /needsPinProbe\(l0\.district,/.test(remote));
check('both card layouts print the label (one shared districtShown)', (card.match(/districtShown \|\| place\(cityAr\)/g) ?? []).length === 2 && /districtWithLabel\(/.test(card));
check('the ad page header prints the label', /districtWithLabel\(district, l\.districtApprox, t\('approx\.'\)\)/.test(prev));
check('the ad page builds no district prices, deals or similar ads on an approximate district', /if \(l\.districtApprox\) return;[\s\S]{0,260}pricesBlockEligible\(row\)/.test(prev));
check('«approx.» has its Arabic', /'approx\.': 'تقريبي'/.test(i18n));
check('the Listing type carries districtApprox', /districtApprox\?: boolean/.test(read('src/data/listings.ts')));

// ── mutations: the barrier fails on the regressions it exists for ───────────────────────────────
mustCatch('a failed chunk treated as "nobody is approximate" (unlabelled pin district)', !/if \(!ok\) for \(const k of chunk\) pinUnknown\.add/.test(remote.replace('if (!ok) for (const k of chunk) pinUnknown.add(pinKey(k[0], k[1]));', '')));
mustCatch('asking in one call for a whole search (past the database cap)', !/at \+= 500\) \{/.test(remote.replace('at += 500) {', 'at += 5000) {')));
mustCatch('a card layout that forgot the label', (card.replace('districtShown || place(cityAr)', 'place(cityAr)').match(/districtShown \|\| place\(cityAr\)/g) ?? []).length !== 2);
mustCatch('the ad page pricing an approximate district', !/if \(l\.districtApprox\) return;[\s\S]{0,260}pricesBlockEligible\(row\)/.test(prev.replace('if (l.districtApprox) return;', '')));
mustCatch('asking about every ad (a whole page of Aqar)', ((_raw: string, idx: string) => !!idx)('Al Malqa', 'حي الملقا') === true);

console.log(failed ? `\n${failed} FAILED` : '\npin-district approx label: all checks passed');
process.exit(failed ? 1 : 0);
