// Regression guard (live-site hunt, 2026-08-23).
//
// THE BUG THIS EXISTS TO PREVENT — HTML MARKUP shown to the user as if it were listing text.
//
// Live-reproduced on https://ezhalah-app.vercel.app before the fix:
//   شراء → بريدة → الأراضي السكنية → المساحة 360–360 → السعر 144,000–144,000 → «بحث»
//   → «لقينا 1 إعلان يطابق طلبك.» and the single card (ديل · dealapp.sa, الشفق, بريدة) rendered:
//     «‏أرض للبيع - شمال ضراس (مخطط النخلة)📍 &amp;bull; السعر: 165,000 &amp;bull; …
//        &amp;lrm;&amp;quot;مكتب واجهة الافق العقارية&amp;quot;»
//   i.e. nine literal escape sequences inside the first three (clamped) lines of the description.
//
// Root cause: dealapp_residential_listings:8891630.description literally stores `&amp;bull;` (the
// markup), finalize() in src/data/remote.ts passed `r.description` straight into the Listing, and
// React Native <Text> renders a string as a string — the app has no HTML parser anywhere, so the
// escape sequence IS what the user reads. Measured that day: 5,652 ACTIVE rows across 8 platforms
// (aqar, dealapp, gathern, eaqartabuk, abeea, aqargate, aqarcity, fursaghyr) carry at least one
// entity in title/description, 61 aqar rows carry one in street_name, and Gathern's house_rules
// panel value carries `&amp;#34;`.
//
// The class this guards is NOT "&bull;": it is "source markup reaches a text-only renderer
// undecoded". Both halves are asserted — the decoder's behaviour (including the fidelity rules that
// make decoding legal at all: never invent a character, never touch a digit) and the WIRING at the
// single row boundary, because either half alone lets the class back in.
import { readFileSync } from 'node:fs';
import { decodeEntities } from '../src/lib/htmlEntities.ts';

const REMOTE = readFileSync(new URL('../src/data/remote.ts', import.meta.url), 'utf8');

let failed = 0;
function check(name: string, ok: boolean, hint?: string) {
  if (ok) { console.log(`  ✓ ${name}`); return; }
  failed++;
  console.error(`  ✗ ${name}${hint ? `\n      ${hint}` : ''}`);
}

console.log('source-text-entities-decoded: HTML escapes must never reach the card as literal text');

// The exact production string (dealapp_residential_listings:8891630), truncated to the clamped lines.
const PROD_DESC =
  'أرض للبيع - شمال ضراس (مخطط النخلة)📍 &amp;bull; السعر: 165,000 &amp;bull; الموقع: شمال ضراس - مخطط النخلة. '
  + '&amp;bull; المساحة: 360م. &amp;lrm;&amp;quot;مكتب واجهة الافق العقارية&amp;quot;';
const ENTITY_RE = /&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,9});/;

// ── 1. The reported defect, on the real row ──────────────────────────────────────────────────────
const decoded = decodeEntities(PROD_DESC);
check('the production dealapp description decodes to zero escape sequences',
  !ENTITY_RE.test(decoded), `still contains markup: ${decoded.slice(0, 90)}`);
check('&amp;bull; becomes a real bullet', decodeEntities('&amp;bull;') === '•');
check('the double-escaped quote pair becomes real quotes',
  decoded.includes('"مكتب واجهة الافق العقارية"'), decoded.slice(-60));
check('&amp;lrm; becomes the invisible bidi mark, not visible text',
  decoded.includes('‎') && !decoded.includes('lrm'));

// ── 2. Single-escaped and numeric forms (aqar/gathern/eaqartabuk publish all of these) ───────────
check('&quot; → "', decodeEntities('&quot;') === '"');
check('&ndash; / &mdash; → – / —', decodeEntities('&ndash;&mdash;') === '–—');
check('&#8211; (decimal) → –', decodeEntities('&#8211;') === '–');
check('&#x27; (hex) → \'', decodeEntities('&#x27;') === "'");
check('&nbsp; → a space character', decodeEntities('&nbsp;') === ' ');
check('&rlm; → U+200F', decodeEntities('&rlm;') === '‏');
check('gathern house_rules `&amp;#34;` decodes to a quote',
  decodeEntities('يمنع تدخين المعسل &amp;#34;السكن مخصص للعوايل') === 'يمنع تدخين المعسل "السكن مخصص للعوايل');
check('the triple-escaped aqar street (`&amp;amp;12`) stops when stable, never loops',
  decodeEntities('( مجلس 7&amp;amp;12 ، صالة طعام 6&amp;amp; 8 )') === '( مجلس 7&12 ، صالة طعام 6& 8 )');

// ── 3. SOURCE FIDELITY — decoding may not invent, drop or alter anything else ────────────────────
const PLAIN = '‏فيلا للبيع في حي الشفق، بريدة — 360 م² بسعر 144,000 ر.س';
check('entity-free source text comes back byte-identical', decodeEntities(PLAIN) === PLAIN);
check('a bare ampersand is left exactly as published', decodeEntities('مكتب الأفق & شركاه') === 'مكتب الأفق & شركاه');
// The name must be 2-10 chars or the ENTITY regex never matches it and the probe proves nothing —
// the original `&notarealentity;` (14) sailed past the lookup untested.
check('an UNKNOWN named entity is left exactly as published (never guessed)',
  decodeEntities('&notreal;') === '&notreal;');
// PROTOTYPE LEAK: `toString`/`valueOf`/`constructor` are inherited names that a plain object literal
// would resolve to a FUNCTION, rendering «function toString() { [native code] }» into a listing.
// Fabricated listing text is a SOURCE-IS-TRUTH violation, so these must pass through untouched.
for (const proto of ['toString', 'valueOf', 'hasOwnPr', 'constructo']) {
  check(`inherited Object.prototype name &${proto}; is NOT decoded (never fabricate listing text)`,
    decodeEntities(`&${proto};`) === `&${proto};`,
    `got ${JSON.stringify(decodeEntities(`&${proto};`))}`);
}
check('an out-of-range numeric entity is left as published',
  decodeEntities('&#1114112;') === '&#1114112;');
check('null / undefined pass through untouched',
  decodeEntities(null) === null && decodeEntities(undefined) === undefined);
const digits = (s: string) => (s.match(/\d+/g) || []).join('|');
check('every digit sequence survives decoding unchanged (no price/area/date can shift)',
  digits(decoded) === digits(PROD_DESC), `${digits(PROD_DESC)} → ${digits(decoded)}`);
check('Arabic letters survive decoding unchanged',
  (decoded.match(/[ء-ي]/g) || []).length === (PROD_DESC.match(/[ء-ي]/g) || []).length);

// ── 4. WIRING — the decode must live at the row boundary, not at one lucky call site ─────────────
check('remote.ts imports the decoder', /import \{ decodeEntities \} from '@\/lib\/htmlEntities';/.test(REMOTE));
const finalizeBody = /function finalize\(rows: any\[\][\s\S]*?\n\}/.exec(REMOTE)?.[0] ?? '';
check('finalize() is still the single row→Listing boundary', finalizeBody.length > 0,
  'if it was renamed or split, re-point this guard at the new boundary');
for (const field of ['title', 'description', 'street_name', 'project_name', 'direction', 'residence_type']) {
  check(`finalize() decodes ${field}`,
    new RegExp(`${field}: decodeEntities\\(`).test(finalizeBody),
    `${field} is source free text rendered verbatim on the card`);
}
check('finalize() decodes the street shown in the card headline (road)',
  /road: decodeEntities\(/.test(finalizeBody));
check('the additional-info panel decodes its values (Gathern house_rules)',
  /v = decodeEntities\(v\);/.test(REMOTE) && /value: decodeEntities\(r\.value\)/.test(REMOTE));
check('no field is passed through raw again (`description: r.description`)',
  !/description: r\.description/.test(REMOTE) && !/title: r\.title \?\?/.test(REMOTE),
  'that verbatim pass-through is exactly what shipped the markup to the card');

console.log(failed ? `\nFAIL — ${failed} check(s)` : '\nPASS');
process.exit(failed ? 1 : 0);
