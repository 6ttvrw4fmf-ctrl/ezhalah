// AQAR CATEGORY COVERAGE — every category we crawl must map to a real type, and an unmapped slug
// must never be silent.
//
// Owner, 2026-08-19, investigating a Duplex undercount: "check aqar, I believe we have a lot more
// duplex there". Verified four ways that Aqar publishes NO duplex category — its crawl surface is an
// explicit enumeration of its own menu (scrapers/aqar/discover.py CATEGORIES), its slug map has no
// duplex entry, live listing URLs read فلل/عمائر, and a live page fetch showed the token only in
// seller prose. Aqar Duplex = 0 is CORRECT, and its ~2.4k villas whose text mentions دوبلكس are villas
// with a duplex layout — relabelling them would invent a type the source never published.
//
// The real exposure is the opposite one: if Aqar EVER adds a category (a duplex one, say), we would
// simply not crawl it, and any slug that did reach the parser would resolve to None and write a
// type-less, unreachable row in silence. This file makes both failure modes loud:
//
//   1. every (type_key) in discover.CATEGORIES has a normalize.SLUG_TO_TYPE mapping — you cannot add
//      a crawl surface without giving it a type;
//   2. the parser's unmapped-slug path prints a warning naming the slug, instead of writing None.
//
//   node --experimental-strip-types scripts/verify-aqar-category-coverage.ts     (wired into `npm test`)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const discover = readFileSync(join(root, 'scrapers/aqar/discover.py'), 'utf8');
const normalize = readFileSync(join(root, 'scrapers/common/normalize.py'), 'utf8');
const parser = readFileSync(join(root, 'scrapers/aqar/enrich_residential.py'), 'utf8');

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  if (ok) { console.log(`PASS  ${label}`); return; }
  failures++;
  console.error(`FAIL  ${label}${detail ? `\n      ${detail}` : ''}`);
};

console.log('\nAqar category coverage — no crawl surface without a type, no silent unmapped slug\n');

// discover.CATEGORIES = { ("apartment", "rent"): "شقق-للإيجار", ... }
const catBlock = discover.slice(discover.indexOf('CATEGORIES = {'));
const typeKeys = new Set([...catBlock.matchAll(/\(\s*"([a-z_]+)"\s*,\s*"(?:rent|buy)"\s*\)\s*:/g)].map(m => m[1]));
check('discover.CATEGORIES parsed', typeKeys.size >= 10, `found ${typeKeys.size} type keys`);

// normalize.SLUG_TO_TYPE = { "apartment": "Apartment", ... }
const slugBlock = normalize.slice(normalize.indexOf('SLUG_TO_TYPE = {'));
const mapped = new Set([...slugBlock.matchAll(/"([a-z_]+)"\s*:\s*"[^"]+"/g)].map(m => m[1]));
check('normalize.SLUG_TO_TYPE parsed', mapped.size >= 10, `found ${mapped.size} slugs`);

const unmapped = [...typeKeys].filter(k => !mapped.has(k));
check('every crawled Aqar category has a SLUG_TO_TYPE mapping', unmapped.length === 0,
  `unmapped: ${unmapped.join(', ')} — these listings would get property_type = None and never be searchable`);

check('the parser does not silently accept an unmapped slug',
  /UNMAPPED category slug/.test(parser) && /property_type is None/.test(parser),
  'a silent None writes a type-less row that no search can ever reach');

// Aqar has no duplex category. If that ever changes, this check flips and forces a deliberate decision
// (add the slug + the crawl category) rather than letting the listings vanish.
const aqarHasDuplex = [...typeKeys].some(k => /duplex/i.test(k)) || /"duplex"/i.test(slugBlock);
console.log(aqarHasDuplex
  ? '\nNOTE: Aqar now exposes a duplex category — make sure BOTH discover.CATEGORIES and SLUG_TO_TYPE carry it.'
  : '\nNOTE: Aqar publishes no duplex category (verified live 2026-08-19). Its villas that merely mention\n      دوبلكس in seller text are villas — never relabel them.');

console.log(failures === 0
  ? '\n✓ Aqar category coverage intact\n'
  : `\n✗ ${failures} check(s) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
