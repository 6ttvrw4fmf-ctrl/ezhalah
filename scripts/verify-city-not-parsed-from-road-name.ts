/**
 * verify-city-not-parsed-from-road-name
 *
 * A city name that appears ONLY as the target of a road word («طريق المدينة» = "Madinah Road") is
 * naming the road, not the locality. `normalize.map_city()`'s longest-substring pass used to match
 * it anyway.
 *
 * Found 2026-08-21 (data-integrity run #36). aqarcity ad 30334 publishes, in its own schema.org
 * block, addressRegion «منطقة تبوك» and addressLocality «مزارع جنوب طريق المدينه (الاولى)», and its
 * description reads «اراضي للبيع في طريق المدينة - تبوك». map_city matched the key «المدينه» inside
 * «طريق المدينه» and returned Medina, so a Tabuk farm plot was served to real users in
 * منطقة المدينة المنورة — a region its own source contradicts.
 *
 * This is the §6 rule ("no ambiguous name silently selects the first ID; never guess") and the §21
 * retraction rule together: fixing the parser is only half the job, because
 * db._unknown_must_not_overwrite_known() would let the stored 'Medina' survive every future crawl.
 * The paired retraction is migration 20260821_retract_road_name_city_aqarcity_4573610.
 *
 * Measured blast radius before shipping (SQL differential over every distinct raw city string in
 * phasea_src_arabic, 105 CITY_MAP_AR keys replicated in SQL): the road rule changes EXACTLY ONE
 * string in the whole corpus — «مزارع جنوب طريق المدينه (الاولى)» Medina -> None. Every other
 * string, including the control «مزارع البكيريه الشماليه» -> Al Bukayriyah, is byte-identical.
 *
 * Deliberately NOT shipped in the same change (measured, rejected, recorded so it is not
 * re-derived): a token-BOUNDARY requirement on the substring pass. It correctly kills
 * «سبت العلاية» -> Al Ula (العلا inside العلاية) and «محائل» -> Hail (حائل inside محائل, a
 * different region), but it also breaks «صبياء» -> Sabya, a legitimate spelling variant the
 * substring pass was covering. Shipping it needs explicit alias entries for the variants it would
 * drop, measured across every platform's raw strings — not just the phasea corpus.
 */
import { execFileSync } from 'node:child_process';

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    pass++;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail++;
    console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function mapCity(raw: string): string | null {
  const out = execFileSync(
    'python3',
    [
      '-c',
      [
        'import sys, json',
        'sys.path.insert(0, ".")',
        'from scrapers.common import normalize as N',
        'print(json.dumps(N.map_city(sys.argv[1])))',
      ].join('\n'),
      raw,
    ],
    { encoding: 'utf8' },
  );
  return JSON.parse(out.trim());
}

console.log('verify-city-not-parsed-from-road-name: a city name used as a ROAD name must not');
console.log('  become the listing’s city, while every genuine substring match still resolves.');

// ── The defect itself ────────────────────────────────────────────────────────────────────────
check(
  'the aqarcity 30334 locality no longer yields a city',
  mapCity('مزارع جنوب طريق المدينه (الاولى)') === null,
  'source publishes «منطقة تبوك», never Medina',
);
check('a bare road reference yields no city', mapCity('طريق المدينة') === null);
check('a street reference yields no city', mapCity('شارع مكة') === null);
check('an exit reference yields no city', mapCity('مخرج الرياض') === null);

// ── The behaviour that must survive (mutation bait) ──────────────────────────────────────────
// If someone "simplifies" the rule to drop the candidate whenever a road word appears ANYWHERE,
// or to reject on the first road-qualified occurrence, these are what break.
check('an exact city name still resolves', mapCity('المدينة المنورة') === 'Medina');
check('a bare exact city still resolves', mapCity('تبوك') === 'Tabuk');
check(
  'a genuine longest-substring match still resolves',
  mapCity('مزارع البكيريه الشماليه') === 'Al Bukayriyah',
  'the control that proves this is surgical, not a blanket "مزارع" ban',
);
check(
  'the multi-token key that motivated the substring pass still resolves',
  mapCity('احد المسارحة') === 'Ahad Al Masarihah',
);
check(
  'a city named alongside a DIFFERENT road still resolves',
  mapCity('الرياض طريق مكة') === 'Riyadh',
  'road-qualified «مكة» suppressed, unqualified «الرياض» still wins',
);
check('a compound facet label still resolves', mapCity('الدمام و سيهات') === 'Dammam');
check('an unknown locality is still an honest null', mapCity('مزارع غرب وشرق عسيله') === null);

console.log('');
if (fail > 0) {
  console.log(`❌ verify-city-not-parsed-from-road-name: ${fail} check(s) failed.`);
  process.exit(1);
}
console.log(`✓ verify-city-not-parsed-from-road-name: all ${pass} checks passed.`);
