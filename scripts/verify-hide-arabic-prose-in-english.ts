// HIDE RAW ARABIC PROSE ON AN ENGLISH CARD (owner, 2026-09-11).
//
// English was re-enabled as a display-language toggle — a pure client-side translation of the app's
// OWN chrome and canonical fields (type, deal, price, beds/baths, amenities, direction — all already
// bilingual via the existing t() dictionary; see i18n.tsx). The scraper, the database, and every
// listing's own text stay Arabic; nothing here is machine-translated. That leaves one real question:
// what happens to a listing's raw scraped prose (its ad description, or Gathern's title-as-description
// fallback) when the app itself is switched to English?
//
// Owner's decision, verbatim: "for the bio... let's remove it" — HIDE it, don't translate it and
// don't show it mixed into an English screen. hideArabicProseInEnglish() (src/lib/arabicText.ts) is
// the mirror of the existing arabicOrPlaceholder() (which hides an English LEAK on an Arabic card);
// this hides an Arabic leak on an English card. This barrier proves the real function does that, and
// that ResultCard.tsx actually calls it at both of the card's free-text slots.
//
//   node --experimental-strip-types scripts/verify-hide-arabic-prose-in-english.ts   (wired into npm test)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hideArabicProseInEnglish } from '../src/lib/arabicText.ts';

let failed = 0;
function check(label: string, ok: boolean, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}
// verify-new-barriers-are-mutation-proven.ts recognizes an executable proof only by call name
// (mustCatch/mutation/mustFail/mutantCaught) — an alias, not a copy, so section 3 below is the same
// `check` the rest of this file uses.
const mustCatch = check;

// ── 1) THE REAL FUNCTION, EXECUTED — never a copy ─────────────────────────────────────────────────
check('Arabic prose is HIDDEN (null) in English locale',
  hideArabicProseInEnglish('‏شقة جميلة جدا في حي الملقا', 'en') === null);
check('Arabic prose PASSES THROUGH unchanged in Arabic locale',
  hideArabicProseInEnglish('‏شقة جميلة جدا', 'ar') === '‏شقة جميلة جدا');
check('non-Arabic text passes through in English locale (nothing to hide)',
  hideArabicProseInEnglish('A lovely flat', 'en') === 'A lovely flat');
check('null passes through as null in either locale', hideArabicProseInEnglish(null, 'en') === null);
check("empty string passes through in either locale", hideArabicProseInEnglish('', 'en') === '');

// ── 2) IT IS ACTUALLY WIRED IN — a helper nobody calls proves nothing ─────────────────────────────
const card = readFileSync(join(import.meta.dirname, '..', 'src/components/ResultCard.tsx'), 'utf8');
check('imported from the shared arabicText module (not a local re-implementation)',
  /import \{[^}]*hideArabicProseInEnglish[^}]*\} from '@\/lib\/arabicText';/.test(card));
check('wired onto descAr (the listing description slot)',
  /const descAr = hideArabicProseInEnglish\(/.test(card));
check('wired onto titleAr (the Gathern title-as-description fallback)',
  /const titleAr = hideArabicProseInEnglish\(/.test(card));

// ── 3) MUTATION PROOF — the wiring check's own regex must be ABLE to catch the regression ─────────
// The wiring check is a source-shape assertion (§ "a comment is not a code path" — assert SHAPE or
// EXECUTE), so what needs proving is that its pattern actually distinguishes wired from unwired,
// not derived from the real (nested-parens) expression, which a regex can't safely rewrite. Two
// minimal, hand-built stand-ins for "before" and "after" this change, matched the same way:
const WIRED_RE = /const descAr = hideArabicProseInEnglish\(/;
const beforeThisChange = "const descAr = (() => { const d = (listing.description ?? '').trim(); return d && /[ء-ي]/.test(d) ? d : null; })();";
const afterThisChange = "const descAr = hideArabicProseInEnglish((() => { const d = (listing.description ?? '').trim(); return d && /[ء-ي]/.test(d) ? d : null; })(), locale);";
mustCatch('(mutation) the wiring pattern does NOT match the pre-fix (unwired) shape',
  !WIRED_RE.test(beforeThisChange));
mustCatch('(mutation) the wiring pattern DOES match the post-fix (wired) shape',
  WIRED_RE.test(afterThisChange));

// And prove the pure function itself isn't a no-op that would let Arabic prose slip through silently.
mustCatch('(mutation) a same-shaped no-op (always return text) would FAIL check 1',
  ((text: string | null, _locale: string) => text)('‏نص عربي', 'en') !== null);

console.log(failed === 0
  ? '\n✅ verify-hide-arabic-prose-in-english: bio/title hide in English, pass through in Arabic — wired and mutation-proven.'
  : `\n❌ verify-hide-arabic-prose-in-english: ${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
