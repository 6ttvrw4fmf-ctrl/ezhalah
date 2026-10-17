// Barrier: the AF option-card live check tells «could not measure» from «cannot occur» (backlog 598).
//
// verify-af-option-card-truth-live.ts failed every run on six permanent SKIPs against a correct
// production (run 39003098853: 0 FAILED, 6 SKIPPED, exit 1). scripts/lib/afLiveSkipLedger.ts now
// (a) names the NULL column for every «😔 did not mention» caption, so four of those SKIPs are real
// checks, and (b) lets only a REGISTERED case whose code fact holds be NOT APPLICABLE. This file
// executes both against deliberately broken inputs. Offline, hermetic.
//
//   node --experimental-strip-types scripts/verify-af-live-skip-ledger.ts   (in `npm test`)
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AMENITY_TOKEN_COL } from './lib/afOracleFilter.ts';
import { STRAY_OVERLAY_SRC } from './lib/liveClick.ts';
import { windowBetween } from './lib/sourceWindow.ts';
import { AMEN_UNKNOWN_COLUMNS, NOT_APPLICABLE, classifySkip, runFails, unknownColumnFilter } from './lib/afLiveSkipLedger.ts';

const ROOT = join(import.meta.dirname, '..');
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const mustCatch = (label: string, caught: boolean) => check(`(mutation) catches ${label}`, caught);

const AMEN = new Set(Object.keys(AMENITY_TOKEN_COL).filter((k) => k !== 'rent_now_pay_later'));

// ── 1. every question's caption has its column ────────────────────────────────────────────────
const cases: Array<[string[], string, string | null]> = [
  [['kitchen', 'parking', 'driver_room'], 'cnt_amen_unknown', null],
  [['1', '2', '3'], 'cnt_bath_unknown', 'bathrooms=is.null'],
  [['20', '25'], 'cnt_stw_unknown', 'street_width_m=is.null'],
  [['9.5', '9.0'], 'cnt_rating_unknown', 'rating=is.null'],
  [['استديو', 'شقة'], 'cnt_sub_unknown', 'unit_subtype_ar=is.null'],
  [['rnpl'], 'cnt_rnpl_unknown', 'rent_now_pay_later=is.null'],
];
for (const [keys, rpcCol, qs] of cases) {
  const u = unknownColumnFilter(keys, AMEN);
  check(`${keys.join(',')} → ${rpcCol}`, u?.rpcCol === rpcCol && (qs == null || u?.qs === qs), JSON.stringify(u));
}
const age = unknownColumnFilter(['new', 'upto2', 'upto5'], AMEN);
check('the age ladder → property_age IS NULL (unchanged from before)', age?.qs === 'property_age=is.null');
check('furnished yes/no → furnished IS NULL', unknownColumnFilter(['yes', 'no'], AMEN)?.qs === 'furnished=is.null');
check('a compass card → direction_ar IS NULL', unknownColumnFilter(['شمال', 'شرق'], AMEN)?.qs === 'direction_ar=is.null');
check('keys no question owns → null (the caller SKIPs, inconclusive)', unknownColumnFilter(['zzz'], AMEN) === null);

// The amenity conjunction must name EVERY column the RPC folds into cnt_amen_unknown — read from the
// committed migration that defines it, so a column added to the RPC and not here turns this red.
const amen = unknownColumnFilter(['kitchen'], AMEN)!;
const inQs = new Set([...amen.qs.matchAll(/([a-z_]+)\.is\.null/g)].map((m) => m[1]));
const mig = readFileSync(join(ROOT, 'supabase/migrations/20261003184909_af_guided_counts_unknown_count_for_every_question.sql'), 'utf8');
const block = windowBetween(mig, 'as cnt_rnpl_unknown', 'as cnt_amen_unknown', 'the cnt_amen_unknown filter');
const rpcCols = new Set([...block.matchAll(/([a-z_]+) is null/g)].map((m) => m[1]));
check('the amenity conjunction == the RPC\'s cnt_amen_unknown columns', rpcCols.size > 0 && [...rpcCols].every((c) => inQs.has(c)) && inQs.size === rpcCols.size,
  `qs=${[...inQs].sort().join(',')} rpc=${[...rpcCols].sort().join(',')}`);

// ── 2. NOT APPLICABLE is narrow ───────────────────────────────────────────────────────────────
for (const id of Object.keys(NOT_APPLICABLE)) {
  check(`registered «${id}» with a holding fact → not-applicable`, classifySkip(id, true) === 'not-applicable');
  check(`registered «${id}» carries a reason`, NOT_APPLICABLE[id].reason.length > 40);
}
check('a run with only not-applicable cases passes', runFails(0, 0) === false);
check('an inconclusive skip still fails the run', runFails(0, 1) === true);
check('a failure still fails the run', runFails(1, 0) === true);

// ── 3. mutations: each broken input must be caught ────────────────────────────────────────────
mustCatch('an UNREGISTERED id called not-applicable', classifySkip('anything-i-like', true) === 'inconclusive');
mustCatch('a registered id whose fact does NOT hold', classifySkip('network-page-below-cap', false) === 'inconclusive');
mustCatch('a null id', classifySkip(null, true) === 'inconclusive');
mustCatch('an inherited key (toString) passed as an id', classifySkip('toString', true) === 'inconclusive');
mustCatch('a runFails that ignores skips', !(((f: number, _s: number) => f > 0)(0, 1)) && runFails(0, 1));
const dropped = AMEN_UNKNOWN_COLUMNS.filter((c) => c !== 'furnished');
mustCatch('an amenity conjunction that forgot one column (furnished)', !(rpcCols.size === dropped.length && [...rpcCols].every((c) => (dropped as readonly string[]).includes(c))));
mustCatch('a bathrooms card read as amenities', unknownColumnFilter(['1', '2'], AMEN)?.rpcCol !== 'cnt_amen_unknown');

// ── 4. the live check really uses the ledger (code, not a comment) ────────────────────────────
const live = readFileSync(join(ROOT, 'scripts/verify-af-option-card-truth-live.ts'), 'utf8')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
check('the live check resolves the caption column through unknownColumnFilter', /unknownColumnFilter\(st\.options/.test(live));
check('the live check exits through runFails', /const bad = runFails\(failures, skips\)/.test(live));
check('both registered ids are used by the live check', Object.keys(NOT_APPLICABLE).every((id) => live.includes(`notApplicableOr('${id}'`)));
check('the old blanket «no single unknown column» SKIP is gone', !live.includes("'this question has no single unknown column'"));

// ── 5. the stray-viewer probe (backlog 597) sees a visible viewer behind a hidden one ─────────
// Executed against a stub DOM: the app keeps a hidden viewer mounted, and the forced case on production
// showed the first-match probe answering «no viewer» while a visible one swallowed every press.
const runProbe = (src: () => boolean, viewers: Array<{ w: number; display?: string }>) => {
  const els = viewers.map((v) => ({ getBoundingClientRect: () => ({ width: v.w, height: v.w }), display: v.display ?? 'flex' }));
  const g = globalThis as any;
  const prev = { document: g.document, getComputedStyle: g.getComputedStyle };
  g.document = { querySelector: () => els[0] ?? null, querySelectorAll: () => els };
  g.getComputedStyle = (e: any) => ({ display: e.display });
  try { return src(); } finally { g.document = prev.document; g.getComputedStyle = prev.getComputedStyle; }
};
const firstOnly = () => {
  const v = (globalThis as any).document.querySelector('[data-testid="ad-viewer"]');
  if (!v) return false;
  const r = v.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && (globalThis as any).getComputedStyle(v).display !== 'none';
};
check('a visible viewer behind a hidden one is seen', runProbe(STRAY_OVERLAY_SRC, [{ w: 0, display: 'none' }, { w: 800 }]) === true);
check('no visible viewer → false', runProbe(STRAY_OVERLAY_SRC, [{ w: 0, display: 'none' }]) === false && runProbe(STRAY_OVERLAY_SRC, []) === false);
mustCatch('the first-match probe that missed the visible viewer', runProbe(firstOnly, [{ w: 0, display: 'none' }, { w: 800 }]) !== runProbe(STRAY_OVERLAY_SRC, [{ w: 0, display: 'none' }, { w: 800 }]));

console.log(failures ? `\n✗ ${failures} failed` : '\n✓ the live AF card check fails only on a real failure or a real inconclusive');
process.exit(failures ? 1 : 0);
