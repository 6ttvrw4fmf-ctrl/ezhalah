// Fleet-wide TYPE round-trip guard (audit 2026-07-28). Several scrapers translate the source's
// Arabic property type into an ENGLISH canonical token before storing it (aqargate/run.py
// TYPE_MAP_AR, deal/run.py TYPE_MAP, toor/run.py …). search_listings_ar then translates it BACK via
// `left join type_label_ar t on t.en = v.property_type`. When a scraper emits an English token that
// type_label_ar has no row for, the join yields NULL and the very next arm of the live sync —
// `when v.property_type ~ '[A-Za-z]' then 'غير معروف'` — REPLACES a real source-published type with
// the unknown sentinel. The source said «مجمع»; the card said «غير معروف».
//
// That is a fidelity loss in our own favour, and it is SILENT: no error, no alert, and the affected
// row still renders — just with the wrong label. It cost aqargate listing 2116473 its real type until
// 2026-07-28. This tripwire makes the whole class loud at build time instead.
//   node --experimental-strip-types scripts/verify-scraper-type-tokens-mapped.ts   (wired into `npm test`)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let failed = 0;
const check = (label: string, ok: boolean) => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`); };

const root = new URL('../scrapers', import.meta.url).pathname;
const taxonomy = JSON.parse(readFileSync(new URL('../src/data/taxonomy.source.json', import.meta.url).pathname, 'utf8'));
const LABELS: Record<string, string> = taxonomy.labels;
check(`taxonomy labels loaded (${Object.keys(LABELS).length} EN→AR)`, Object.keys(LABELS).length >= 39);

// KNOWN-UNMAPPED, owner decision pending (2026-07-28). These three are emitted only by scrapers/toor,
// which has ZERO live rows today — verified: `select count(*) from search_listings_ar where
// platform='toor'` = 0. Unlike 'Compound' (whose Arabic «مجمع» was already canonical in known_type_ar
// and propertyTypes.ts), these have NO pre-existing canonical Arabic, so inventing one would be a
// guess — and guessing a mapping is exactly what the ask-first rule forbids. They stay listed here so
// this guard passes on today's state while still failing on any NEW unmapped token.
// TO RESOLVE: owner picks the Arabic label (or maps the token onto an existing clean type), then it
// moves into taxonomy.source.json labels + EN_TO_AR and comes off this list.
const OWNER_PENDING = new Set(['ATM', 'Hospital', 'Power Station']);

// INTENTIONALLY UNMAPPED — these tokens MEAN "the source published no usable type", so resolving
// them to «غير معروف» is the correct outcome, not a lost value. scrapers/october/run.py:161 uses
// 'Other' as its explicit last-resort fallback (`TYPE_MAP.get(tok) or … or "Other"`). Giving it an
// Arabic label would assert a type the source never published.
const MEANS_UNKNOWN = new Set(['Other']);

// Collect every python file under scrapers/.
const pyFiles: string[] = [];
(function walk(dir: string) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (e.endsWith('.py')) pyFiles.push(p);
  }
})(root);
check(`scanned a real fleet (${pyFiles.length} python files)`, pyFiles.length >= 20);

// A scraper's type map is a dict literal whose VALUES are the canonical English tokens we store.
// Match `"<anything>": "<Token>"` where Token is Title-Case-with-spaces ASCII — that is the shape of
// every canonical token ('Apartment', 'Gas Station', 'Telecom Tower'). Arabic keys are ignored; only
// the value side matters, because the value is what lands in <platform>_listings.property_type.
const PAIR = /["']([^"']+)["']\s*:\s*["']([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)*)["']/g;
// Only the AR→EN type DICTS, matched by the fleet's naming convention (…TYPE…MAP… / …MAP…TYPE… /
// TYPE_OVERRIDES…). Deliberately excludes the `*_TYPES` SETS (COMMERCIAL_TYPES, LAND_TYPES …): those
// are membership sets of already-canonical tokens, not translation sources, and their closing brace
// is often not at column 0, so including them made the block scan run on into the CITY_* dicts and
// report Saudi city names as unmapped types.
const TYPE_MAP_NAME = String.raw`[A-Z_]*(?:TYPE[A-Z_]*(?:MAP|OVERRIDES)|MAP[A-Z_]*TYPE)[A-Z_]*`;
const TYPE_MAP_DECL = new RegExp(`^${TYPE_MAP_NAME}\\s*=\\s*\\{`, 'm');

const unmapped = new Map<string, string[]>();
for (const f of pyFiles) {
  if (f.includes('/tests/')) continue;
  const src = readFileSync(f, 'utf8');
  if (!TYPE_MAP_DECL.test(src)) continue;
  const rel = f.replace(root, 'scrapers');
  // Restrict to the TYPE map block(s): from the declaration to the closing brace.
  for (const blockMatch of src.matchAll(new RegExp(`^${TYPE_MAP_NAME}\\s*=\\s*\\{([\\s\\S]*?)^\\}`, 'gm'))) {
    const block = blockMatch[1];
    for (const m of block.matchAll(PAIR)) {
      const token = m[2];
      if (token in LABELS || OWNER_PENDING.has(token) || MEANS_UNKNOWN.has(token)) continue;
      if (!unmapped.has(token)) unmapped.set(token, []);
      const hits = unmapped.get(token)!;
      if (!hits.includes(rel)) hits.push(rel);
    }
  }
}

const report = [...unmapped.entries()].map(([t, files]) => `${t} (${files.join(', ')})`);
if (report.length) {
  console.log('\nEnglish type tokens a scraper can store with NO type_label_ar reverse mapping —');
  console.log('each would be silently rewritten to «غير معروف» on the card:');
  for (const r of report) console.log(`  - ${r}`);
  console.log('\nFix: add the token to `labels` in src/data/taxonomy.source.json AND to EN_TO_AR in');
  console.log('src/data/propertyTypes.ts (the build gate asserts they are value-identical), then');
  console.log('`npm run verify:emit-sql` and apply sql/type_label_ar.generated.sql.');
  console.log('If the correct Arabic is not already canonical, it is an OWNER decision — ask, never guess.');
}
check('every English type token a scraper emits has a type_label_ar reverse mapping', report.length === 0);

// Regression pin for the exact row that motivated this guard.
check("'Compound' is mapped (aqargate «مجمع» round-trip, fixed 2026-07-28)", LABELS['Compound'] === 'مجمع');

console.log(failed ? `\n✗ ${failed} check(s) failed` : '\n✓ scraper type tokens all round-trip to Arabic');
process.exit(failed ? 1 : 0);
