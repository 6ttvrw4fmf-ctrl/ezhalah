// HTML-entity decoding for SOURCE-CAPTURED FREE TEXT (listing description / title / street / the
// additional-info panel). Zero-dependency and DOM-free ON PURPOSE — this runs on iOS/Android too,
// where `document` does not exist (mirrors src/lib/arabicText.ts's design).
//
// THE DEFECT THIS EXISTS TO FIX (live on ezhalah-app.vercel.app, 2026-08-23)
//   شراء → بريدة → الأراضي السكنية → المساحة 360–360, السعر 144,000–144,000 → «بحث» returns exactly
//   one card (ديل · dealapp.sa, الشفق, بريدة), and its description line read, verbatim:
//     «‏أرض للبيع - شمال ضراس (مخطط النخلة)📍 &amp;bull; السعر: 165,000 &amp;bull; …
//       &amp;lrm;&amp;quot;مكتب واجهة الافق العقارية&amp;quot;»
//   dealapp_residential_listings:8891630.description literally stores `&amp;bull;` — the markup, not
//   the character. React Native <Text> renders a string as a string (no HTML parser anywhere in the
//   app), so the escape sequence itself is what the user reads. 5,652 ACTIVE rows across 8 platforms
//   (aqar, dealapp, gathern, eaqartabuk, abeea, aqargate, aqarcity, fursaghyr) carry at least one.
//
// WHY DECODING IS SOURCE-FAITHFUL, NOT A REWRITE (owner rule: never rewrite what a source published)
//   Nothing here invents, estimates, rounds or derives a listing FACT: an entity decodes to the exact
//   character it encodes, digits/Arabic/Latin letters are untouched, and a string with no entity comes
//   back byte-identical (`decodeEntities(x) === x`). The escape depth is an artefact of OUR capture
//   path, not of the source's meaning: dealapp.sa's own rendered page carries `&amp;bull;` in its
//   HTML — i.e. the site displays «&bull;» to its own visitors, and our scraper stored the markup for
//   that, one layer deeper still. So we repeat the decode until it is stable (bounded at 3 passes),
//   which lands on the character the escaping was encoding, and stops.
//   An UNKNOWN named entity is left EXACTLY as published — we never guess at a character we don't know.
//
// Not an XSS surface: the output is only ever rendered as text (RN <Text> / React children escape it).

/** Named entities observed in production source text, plus the everyday HTML/typographic set.
 *
 * NULL-PROTOTYPE ON PURPOSE. As a plain object literal this map inherits Object.prototype, so a
 * source description containing `&toString;` or `&valueOf;` — both inside the 2-10 char name the
 * regex accepts — would look up a FUNCTION and render the invented English string
 * «function toString() { [native code] }» into an Arabic listing. That is fabricated listing text,
 * which SOURCE IS TRUTH forbids outright. `Object.create(null)` removes the inherited names, so an
 * unknown entity can only ever fall through and be left exactly as the source published it. */
const NAMED: Record<string, string> = Object.assign(Object.create(null) as Record<string, string>, {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', shy: '­',
  // Bidi / joiner controls — Arabic listings really do publish these (915 &rlm; + 627 &lrm; live).
  lrm: '‎', rlm: '‏', zwj: '‍', zwnj: '‌',
  bull: '•', middot: '·', hellip: '…',
  mdash: '—', ndash: '–', minus: '−',
  ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
  sbquo: '‚', bdquo: '„', laquo: '«', raquo: '»',
  times: '×', divide: '÷', plusmn: '±', asymp: '≈',
  ne: '≠', le: '≤', ge: '≥', infin: '∞', radic: '√',
  deg: '°', sup1: '¹', sup2: '²', sup3: '³',
  frac14: '¼', frac12: '½', frac34: '¾',
  prime: '′', Prime: '″', permil: '‰', micro: 'µ',
  larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔',
  curren: '¤', euro: '€', pound: '£', yen: '¥', cent: '¢',
  copy: '©', reg: '®', trade: '™', sect: '§', para: '¶',
  dagger: '†', Dagger: '‡',
  agrave: 'à', eacute: 'é', egrave: 'è', ccedil: 'ç',
  ntilde: 'ñ', auml: 'ä', ouml: 'ö', uuml: 'ü',
});

const ENTITY = /&(#[xX][0-9a-fA-F]{1,6}|#\d{1,7}|[a-zA-Z][a-zA-Z0-9]{1,9});/g;

/** ONE decode pass — exactly what a browser does to this markup. Unknown names pass through. */
function decodeOnce(s: string): string {
  return s.replace(ENTITY, (whole, body: string) => {
    if (body.charAt(0) === '#') {
      const hex = body.charAt(1) === 'x' || body.charAt(1) === 'X';
      const cp = parseInt(hex ? body.slice(2) : body.slice(1), hex ? 16 : 10);
      // Out-of-range / lone-surrogate / NUL → leave the published text alone rather than emit junk.
      if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return whole;
      return String.fromCodePoint(cp);
    }
    const hit = NAMED[body];
    return hit === undefined ? whole : hit;
  });
}

/**
 * Decode HTML entities in source free text. Byte-identical no-op for text without entities (and for
 * null/undefined, so call sites stay one-liners). Repeats until stable — our capture path stores
 * double- (dealapp `&amp;bull;`) and even triple-escaped (aqar `&amp;amp;12`) markup — bounded at 3
 * passes so no input can loop.
 */
export function decodeEntities<T extends string | null | undefined>(s: T): T {
  if (typeof s !== 'string' || s.indexOf('&') === -1) return s;
  let out: string = s;
  for (let i = 0; i < 3; i++) {
    const next = decodeOnce(out);
    if (next === out) break;
    out = next;
  }
  return out as T;
}
