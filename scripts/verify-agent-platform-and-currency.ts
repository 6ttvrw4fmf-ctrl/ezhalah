// Regression guard for two AI Agent edge-function bugs found live 2026-07-26 (round-7 filter/backend
// audit):
//
// 1. A legacy "PLATFORM NEUTRALITY (deterministic)" block (PLATFORM_EN/PLATFORM_AR/isPlatformRestriction/
//    stripPlatform/platformNote) predated and conflicted with the newer, correct "PLATFORM FILTERING
//    (ALLOWED and EXPECTED)" system-prompt feature. It stripped the platform name out of the user's
//    text for Aqar/Wasalt/Aldarim BEFORE the model ever saw it, then force-injected a "we always
//    search every platform" note — so a real "عقار بس" (Aqar only) request silently came back with
//    query.platforms:[] while the identical phrasing for Gathern/Deal App (not in the legacy list)
//    worked correctly. The fix removes the legacy block entirely; the model-driven `platforms` field
//    (already proven correct for every OTHER platform) now handles all of them uniformly.
//
// 2. originalCurrency() had no Arabic-currency-word fallback, unlike extractPrice() (which already
//    has one via AR_CURRENCY) — so query.priceOriginal never populated for a budget stated in Arabic
//    (e.g. "5000 دينار كويتي"), even though the SAR conversion itself (query.price) was correct.
//
//   node --experimental-strip-types scripts/verify-agent-platform-and-currency.ts   (wired into `npm test`)

import { readFileSync } from 'node:fs';

let failed = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
};

const src = readFileSync(new URL('../supabase/functions/agent/index.ts', import.meta.url), 'utf8');

// ── source-text: the legacy platform-neutrality block is gone ──
check('the legacy PLATFORM_EN/PLATFORM_AR constants are gone', !/const PLATFORM_EN\s*=/.test(src) && !/const PLATFORM_AR\s*=/.test(src));
check('isPlatformRestriction()/stripPlatform()/platformNote() are gone', !/function isPlatformRestriction/.test(src) && !/function stripPlatform/.test(src) && !/function platformNote/.test(src));
check('platformPinned is gone (no more forced "we search every platform" note)', !/platformPinned/.test(src));
check('the model is sent the RAW user text, not a platform-stripped modelText', /Message: """\$\{text\}"""/.test(src) && !/modelText/.test(src));
check('the newer PLATFORM FILTERING system-prompt feature is still intact (untouched by this fix)', /PLATFORM FILTERING \(ALLOWED and EXPECTED/.test(src));
check('new prompt guidance distinguishes incidental platform mentions from a real restriction request', /NOT A FILTER REQUEST/.test(src) && /is a nice site/.test(src));

// ── source-text: originalCurrency now has an Arabic fallback ──
check('originalCurrency() has an Arabic currency-word table (AR_CUR_LABEL)', /const AR_CUR_LABEL: Array<\[RegExp, string\]>/.test(src));
check('originalCurrency() falls back to scanning Arabic currency words when no Latin match is found', /No Latin match — scan for a number followed/.test(src));

// ── EXECUTED tests: verbatim copy of the fixed originalCurrency() logic ──
const CUR_LABEL: Record<string, string> = {
  usd: 'USD', dollar: 'USD', dollars: 'USD', aed: 'AED', dh: 'AED', dhm: 'AED', dhs: 'AED', dirham: 'AED',
  eur: 'EUR', euro: 'EUR', gbp: 'GBP', pound: 'GBP', kwd: 'KWD', kd: 'KWD', dinar: 'KWD', bhd: 'BHD', bd: 'BHD',
  qar: 'QAR', qr: 'QAR', omr: 'OMR', egp: 'EGP',
};
const AR_CUR_LABEL: Array<[RegExp, string]> = [
  [/دينار\s*كويتي/, 'KWD'],
  [/دينار\s*بحريني/, 'BHD'],
  [/دينار\s*أردني|دينار\s*اردني/, 'JOD'],
  [/دينار/, 'KWD'],
  [/درهم/, 'AED'],
  [/دولار/, 'USD'],
  [/يورو/, 'EUR'],
  [/جنيه\s*(?:استرليني|إسترليني)/, 'GBP'],
  [/جنيه/, 'EGP'],
];
function originalCurrency(input: string): string {
  const t = input.toLowerCase();
  const RE = /(\d[\d,.]*)\s*(k|m|mn|million|thousand|bn|billion)?\s*(usd|dollars?|aed|dirham|dhm|dhs|dh|eur|euro|gbp|pound|kwd|kd|dinar|bhd|bd|qar|qr|omr|egp)\b/i;
  const m = RE.exec(t);
  if (m) {
    let n = parseFloat(m[1].replace(/,/g, ''));
    if (isFinite(n)) {
      const scale = (m[2] || '').toLowerCase();
      if (scale === 'k' || scale === 'thousand') n *= 1_000;
      else if (scale === 'm' || scale === 'mn' || scale === 'million') n *= 1_000_000;
      else if (scale === 'bn' || scale === 'billion') n *= 1_000_000_000;
      const code = CUR_LABEL[(m[3] || '').toLowerCase()] ?? '';
      if (code) return `${code} ${Math.round(n).toLocaleString('en-US')}`;
    }
  }
  const AR_NUM_RE = /(\d[\d,.]*)\s*(ألف|الف|آلاف|مليون|ملايين|مليار)?/g;
  for (const mm of input.matchAll(AR_NUM_RE)) {
    const after = input.slice(mm.index! + mm[0].length, mm.index! + mm[0].length + 24);
    const hit = AR_CUR_LABEL.find(([re]) => re.test(after));
    if (!hit) continue;
    let n = parseFloat(mm[1].replace(/,/g, ''));
    if (!isFinite(n)) continue;
    if (mm[2] === 'ألف' || mm[2] === 'الف' || mm[2] === 'آلاف') n *= 1_000;
    else if (mm[2] === 'مليون' || mm[2] === 'ملايين') n *= 1_000_000;
    else if (mm[2] === 'مليار') n *= 1_000_000_000;
    return `${hit[1]} ${Math.round(n).toLocaleString('en-US')}`;
  }
  return '';
}

const eq = (label: string, actual: unknown, expected: unknown) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) console.error(`  expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  check(label, ok);
};

eq("real repro: 'بميزانية 100000 دولار' -> USD 100,000 (was silently dropped before the fix)", originalCurrency('أبغى فيلا في الرياض بميزانية 100000 دولار'), 'USD 100,000');
eq("real repro: 'بميزانية 5000 دينار كويتي' -> KWD 5,000 (was silently dropped before the fix)", originalCurrency('شقة في جدة بميزانية 5000 دينار كويتي'), 'KWD 5,000');
eq('English control (unchanged behavior)', originalCurrency('I want a villa in Riyadh with budget 100000 USD'), 'USD 100,000');
eq('a SAR-only budget returns empty (never a false "original currency")', originalCurrency('فيلا بميزانية 500000 ريال'), '');
eq('no currency mentioned at all returns empty', originalCurrency('فيلا في الرياض 3 غرف'), '');
eq("Jordanian dinar disambiguates from the bare/Kuwaiti default", originalCurrency('شقة بميزانية 5000 دينار أردني'), 'JOD 5,000');

console.log(
  failed === 0
    ? '\n✓ AI Agent platform-restriction removal + Arabic currency fallback verified'
    : `\n✗ ${failed} check(s) FAILED`,
);
process.exit(failed === 0 ? 0 : 1);
