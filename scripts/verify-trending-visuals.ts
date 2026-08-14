// Static invariant checks for the selector's LOC_IMG visual identity (findings 2026-08-13, task
// #32): the designed city/district art (assets/images/loc) must appear on the Top-6 Trending rows
// (it was silently dropped when TrendingRows replaced the plain rows — never by the owner's
// simplification), on the typed rows (never regressed), beside the selected city value, and inside
// each selected district chip. Reuses EXISTING assets only — no new art, no per-name art.
//
//   node --experimental-strip-types scripts/verify-trending-visuals.ts   (wired into `npm test`)

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const indexSrc = readFileSync(join(root, 'src/app/index.tsx'), 'utf8');
const trendSrc = readFileSync(join(root, 'src/components/TrendingList.tsx'), 'utf8');

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

// ── The art itself must exist on disk (Metro require() fails the BUILD if missing, but this makes
//    an accidental asset deletion fail the cheap offline suite first). ──
for (const f of ['city', 'district']) {
  check(`assets/images/loc/${f}.png exists on disk`, existsSync(join(root, `assets/images/loc/${f}.png`)));
}

// ── TrendingRows renders the optional icon, 20×20 like the typed rows' suggLocIcon, rank kept. ──
check('TrendingItem carries an optional icon', /export type TrendingItem = \{ key: string; label: string; sublabel\?: string; icon\?: any \}/.test(trendSrc));
check('TrendingRows renders the icon before the label', /\{item\.icon \? <RowIcon source=\{item\.icon\} \/> : null\}/.test(trendSrc));
check('icon sizing mirrors the typed rows (20×20 contain)', /rowIcon: \{ width: 20, height: 20, resizeMode: 'contain' \}/.test(trendSrc));
check('rank number stays', /\{i \+ 1\}\./.test(trendSrc));
// Graceful degradation: a broken image renders NOTHING — it must never take the row down with it.
check('hide-on-error fallback (onError → render nothing)', /const \[failed, setFailed\] = useState\(false\);\s*if \(failed\) return null;\s*return <Image source=\{source\} style=\{s\.rowIcon\} onError=\{\(\) => setFailed\(true\)\} \/>;/.test(trendSrc));

// ── index.tsx passes the kind-keyed art to BOTH Top-6 lists… ──
check('city Top-6 rows get LOC_IMG.city', /icon: LOC_IMG\.city,/.test(indexSrc));
check('district Top-6 rows get LOC_IMG.district', /icon: LOC_IMG\.district,/.test(indexSrc));
// …while the typed rows keep the art they always had.
check('typed city rows keep LOC_IMG.city', /<Image source=\{LOC_IMG\.city\} style=\{s\.suggLocIcon\} \/>/.test(indexSrc));
check('typed district rows keep LOC_IMG.district', /<Image source=\{LOC_IMG\.district\} style=\{\[s\.suggLocIcon, isEmpty && s\.suggIconEmpty\]\} \/>/.test(indexSrc));

// ── Selected-value identity: the confirmed pick shows the SAME art it was picked from. ──
check('selected city renders LOC_IMG.city in the field (testID selected-city-visual, ~18px)', /citySelected \? \(\s*<Image testID="selected-city-visual" source=\{LOC_IMG\.city\} style=\{s\.fieldLocIcon\} \/>/.test(indexSrc) && /fieldLocIcon: \{ width: 18, height: 18, resizeMode: 'contain' \}/.test(indexSrc));
check('each district chip carries LOC_IMG.district (14px, testID district-chip)', /testID="district-chip"/.test(indexSrc) && /<Image source=\{LOC_IMG\.district\} style=\{s\.districtChipIcon\} \/>/.test(indexSrc) && /districtChipIcon: \{ width: 14, height: 14, resizeMode: 'contain' \}/.test(indexSrc));
// The chip image must never be what overflows: the TEXT shrinks/truncates, the art is fixed-size.
check('chip text shrinks, image never causes overflow', /districtChipText: \{[^}]*flexShrink: 1[^}]*\}/.test(indexSrc) && /<Text style=\{s\.districtChipText\} numberOfLines=\{1\}>/.test(indexSrc));

// No remote-URI images anywhere in the selector surfaces — require()-only means a missing asset
// fails the build, never renders broken at runtime (findings[0] §2 invariant).
check('no source={{ uri: … }} in selector surfaces', !/source=\{\{\s*uri:/.test(indexSrc) && !/source=\{\{\s*uri:/.test(trendSrc));

console.log(failed === 0 ? '\n✓ all trending-visuals assertions passed' : `\n✗ ${failed} trending-visuals assertion(s) FAILED`);
process.exit(failed === 0 ? 0 : 1);
