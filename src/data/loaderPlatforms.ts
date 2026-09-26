// Platform roster + logos for the SEARCH-LOADING animation (the Perplexity-style "checking the
// platforms" strip shown while a search runs). This is STATUS DISPLAY ONLY — it never changes the
// search, filters, ranking, or which listings return. Every entry is a REAL platform we scrape.
//
// PRODUCT RULE (owner 2026-08-29, supersedes the 2026-07-09 "always show all logos" rule):
// The strip is a HONEST CLAIM about which platforms Ezhalah currently searches — one logo per
// platform users can actually reach in results. If a scraper goes cold and no user can reach that
// platform's listings any more, its logo does not belong in the strip until it comes back. This is
// fairness to users (no logos they cannot reach) AND to platforms (no advertising a platform we
// cannot deliver).
//
// TWO-LAYER HONESTY. The static PLATFORM_META list below is the CATALOG (every platform we have a
// logo asset for AND that we consider a real scraping target). At runtime, SearchLoader calls
// `fetchActivePlatformNames()` — an RPC over `search_listings_ar` — and filters PLATFORM_META down
// to platforms that currently have any active row. If the RPC fails, SearchLoader falls back to
// the full PLATFORM_META (safe degradation — the user might see one platform they cannot reach
// during that outage, never fewer). `scripts/verify-loader-platforms-match-active.ts` enforces at
// CI time that PLATFORM_META, when mapped through SOURCE_TOKENS, equals the production active set —
// so the two lists cannot silently drift.
//
// The logo require() map is deliberately DUPLICATED from ResultCard.tsx rather than shared, so the
// result-card rendering path is never touched by this feature. If a logo asset is renamed, update it
// in both places.

// name MUST match the `name` in PLATFORMS exactly (so platform(name) resolves allowsRent/allowsBuy).
// i18nKey is the English source string in the AR dictionary → t(i18nKey) gives the Arabic display name
// (same label the result card uses). logo is the bundled asset.
// logoOnly: the brand is shown in the strip by owner decision while it has NO scraper, NO tables and
// is NEVER searchable (2026-09-24: maskanre, wetheaddress). verify-loader-platforms-match-active.ts
// reads this flag as its exemption; nothing else may use it.
export type LoaderPlatform = { name: string; i18nKey: string; logo: number; logoOnly?: true };

// The catalog of platforms with a bundled logo asset. Kept in lock-step with production's active
// set (`search_listings_ar.platform`). When a platform goes cold with zero reachable rows, remove
// its entry here in the same PR that also confirms it should stop being advertised. Barrier:
// `scripts/verify-loader-platforms-match-active.ts`.
//
// Aqar Monthly is Aqar's own monthly-rental vertical (same site, same brand), so it is NOT a
// separate tile (owner 2026-09-23: dropped the duplicate — it reused aqar-logo.png). A raw
// `aqarmonthly` source resolves to the single Aqar tile via SOURCE_TOKENS, so its listings still
// show the Aqar logo.
export const PLATFORM_META: LoaderPlatform[] = [
  { name: 'Aqar',         i18nKey: 'AQAR',                                    logo: require('../../assets/images/aqar-logo.png') },
  { name: 'Wasalt',       i18nKey: 'Wasalt',                                  logo: require('../../assets/images/wasalt-logo.png') },
  { name: 'Aldarim',      i18nKey: 'Aldarim Real Estate',                     logo: require('../../assets/images/aldarim.png') },
  { name: 'Aqargate',     i18nKey: 'Aqar Gate',                               logo: require('../../assets/images/aqargate-logo.png') },
  { name: 'Alhoshan',     i18nKey: 'Al Hoshan',                               logo: require('../../assets/images/alhoshan.png') },
  { name: 'Hajer',        i18nKey: 'Hajer Houses Real Estate',                logo: require('../../assets/images/hajer-logo.png') },
  { name: 'Sanadak',      i18nKey: 'Sanadak',                                 logo: require('../../assets/images/sanadak-logo.png') },
  { name: 'Eastabha',     i18nKey: 'East Abha Real Estate',                   logo: require('../../assets/images/eastabha-logo.png') },
  { name: 'Aqarcity',     i18nKey: 'Aqar City',                               logo: require('../../assets/images/aqarcity-logo.png') },
  { name: 'Raghdan',      i18nKey: 'Raghdan Real Estate',                     logo: require('../../assets/images/raghdan.png') },
  { name: 'Eaqartabuk',   i18nKey: 'Eqar Tabuk',                              logo: require('../../assets/images/eaqartabuk.png') },
  { name: 'Satel',        i18nKey: 'Satel',                                   logo: require('../../assets/images/satel.png') },
  { name: 'Sadin',        i18nKey: 'Sadin for Real Estate',                   logo: require('../../assets/images/sadin.png') },
  { name: 'Mustqr',       i18nKey: 'Mustaqarr Real Estate',                   logo: require('../../assets/images/mustaqr.png') },
  { name: 'Ramzalqasim',  i18nKey: 'Ramz Al Qassim Real Estate Investment',  logo: require('../../assets/images/ramzalqassim.png') },
  { name: 'Fursaghyr',    i18nKey: 'Fursa Ghyr Real Estate',                  logo: require('../../assets/images/fursaghyr.png') },
  { name: 'Jazwtn',       i18nKey: 'Jazan Watan',                             logo: require('../../assets/images/jazan-watan.png') },
  { name: 'Mizlaj',       i18nKey: 'Mizlaj Real Estate',                      logo: require('../../assets/images/mizlaj.png') },
  { name: 'Aqaratikom',   i18nKey: 'Nawait',                                  logo: require('../../assets/images/aqaratikom.png') },
  { name: 'Al Khaas',     i18nKey: 'Al Khaas',                                logo: require('../../assets/images/alkhaas.png') },
  { name: 'Abeea',        i18nKey: 'Abeea Real Estate',                       logo: require('../../assets/images/abeea.png') },
  { name: 'Jurash',       i18nKey: 'Jurash Real Estate',                      logo: require('../../assets/images/jurash.png') },
  { name: 'Gathern',      i18nKey: 'Gathern',                                 logo: require('../../assets/images/gathern.png') },
  { name: 'Deal App',     i18nKey: 'Deal App',                                logo: require('../../assets/images/dealapp.png') },
  { name: '24 Souq',      i18nKey: '24 Souq',                                 logo: require('../../assets/images/souq24.png') },
  { name: 'Era Pulse',    i18nKey: 'Era Pulse',                               logo: require('../../assets/images/erapulse.png') },
  { name: 'Al Nowaisiry', i18nKey: 'Al Nowaisiry Real Estate',               logo: require('../../assets/images/nowaisiry.png') },
  { name: '1 October',    i18nKey: '1 October Real Estate',                   logo: require('../../assets/images/october.png') },
  { name: 'Muktamel',     i18nKey: 'Muktamel',                                logo: require('../../assets/images/muktamel.png') },
  { name: 'Arkaan',       i18nKey: 'Arkaan Al Aqar',                          logo: require('../../assets/images/arkaan.png') },
  { name: 'Abralosol',    i18nKey: 'Abr Al Osol Real Estate',                 logo: require('../../assets/images/abralosol.png') },
  { name: 'THERC',        i18nKey: 'The Right Choice Real Estate',            logo: require('../../assets/images/therc.png') },
  { name: 'Rawasi Dark',  i18nKey: 'Rawasi Dark Real Estate',                 logo: require('../../assets/images/rawasidark.png') },
  { name: 'Aouj',         i18nKey: 'Aouj Estates',                            logo: require('../../assets/images/aouj.png') },
  { name: 'Bahadhabab',     i18nKey: 'Bahadhabab Real Estate',    logo: require('../../assets/images/bahadhabab.png') },
  { name: 'Alobid',         i18nKey: 'Alobid Office Real Estate', logo: require('../../assets/images/alobid.png') },
  { name: 'Abwbna',         i18nKey: 'Abwbna Real Estate',              logo: require('../../assets/images/abwbna.png') },
  { name: 'Remal',          i18nKey: 'Remal Real Estate',              logo: require('../../assets/images/remal.png') },
  { name: 'Amaall',         i18nKey: 'Amaall Real Estate Services',    logo: require('../../assets/images/amaall.png') },
  { name: 'AqarAlSaudia',   i18nKey: 'Aqar Al Saudia Real Estate',    logo: require('../../assets/images/aqaralsaudia.png') },
  { name: 'Amlakalahsa',    i18nKey: 'Amlak Al-Ahsa Real Estate',      logo: require('../../assets/images/amlakalahsa.png') },
  { name: 'Alta',           i18nKey: 'Alta Real Estate Services',      logo: require('../../assets/images/alta.png') },
  { name: 'Shmou Al Shmal', i18nKey: 'Shmou Al Shmal Real Estate',     logo: require('../../assets/images/shmoualshmal.png') },
  { name: 'Awal',         i18nKey: 'Awal United for Real Estate',             logo: require('../../assets/images/awal.png') },
  { name: 'Azdad',        i18nKey: 'Azdad Al Aqariah',                        logo: require('../../assets/images/azdad.png') },
  { name: 'Suwar',        i18nKey: 'Suwar Real Estate',                       logo: require('../../assets/images/suwar.png') },
  { name: 'Rakez',        i18nKey: 'Rakez Real Estate',                       logo: require('../../assets/images/rakez.png') },
  { name: 'Akariyoun',    i18nKey: 'Akariyoun',                               logo: require('../../assets/images/akariyoun.png') },
  { name: 'KSA Aqar',     i18nKey: 'KSA Aqar Real Estate',                    logo: require('../../assets/images/ksaaqar.png') },
  { name: 'Sadiq Eltajer', i18nKey: 'Sadiq Eltajer Real Estate',              logo: require('../../assets/images/sadiq-eltajer.png') },
  // توور — OWNER DECISION 2026-09-19, made with the trade-off stated. toor currently returns ZERO
  // searchable listings (its site self-declares «نسخة تجريبية … المعلومات … ليست حقيقية» — a beta
  // serving dummy data, one sample listing repeated across every PropertyId), so it does NOT meet
  // the 2026-08-29 rule that this strip equals the active-searchable set. The owner chose to keep
  // toor's brand on the list anyway. It is listed LAST and called out here so the exception is
  // visible rather than looking like drift, and so that whoever reads
  // verify-loader-platforms-match-active.ts next finds the reason instead of a mystery.
  { name: 'Toor',         i18nKey: 'Toor',                                    logo: require('../../assets/images/toor.png') },
  // ── onboarded 2026-09-20 ──────────────────────────────────────────────────────────────────────
  // These seven share the NEUTRAL placeholder asset while the owner supplies their real marks.
  // A placeholder is deliberate, not laziness: the alternative — omitting them — makes the strip
  // under-claim what Ezhalah searches, and reusing ANOTHER platform's logo is the misattribution
  // the owner called a legal problem. Swap each require() as a real file lands; nothing else here
  // or in ResultCard.tsx needs to change.
  { name: 'Gudai',                 i18nKey: 'Gudai Real Estate',                       logo: require('../../assets/images/gudai.png') },
  { name: 'Safera',                i18nKey: 'Safera Real Estate',                      logo: require('../../assets/images/safera.png') },
  { name: 'Al Humaidan',           i18nKey: 'Al Humaidan Real Estate Office',        logo: require('../../assets/images/alhumaidan.png') },
  { name: 'Aqar Najran',           i18nKey: 'Aqar Najran',                             logo: require('../../assets/images/aqarnajran.png') },
  { name: 'Maqam Al Wisam',        i18nKey: 'Maqam Al Wisam Real Estate',              logo: require('../../assets/images/fahadalshahri.png') },
  { name: 'CompoundIn',            i18nKey: 'CompoundIn',                              logo: require('../../assets/images/compoundin.png') },
  { name: 'Waslna',                i18nKey: 'Waslna Real Estate',                      logo: require('../../assets/images/wslnaa.png') },
  // ── onboarded 2026-09-21 ──────────────────────────────────────────────────────────────────────
  // All eleven wear the SAME neutral placeholder until the owner supplies their real marks — never
  // another company's logo. `name` is the stored db `source` value (the scraper's SOURCE constant),
  // the same convention as 'Al Khaas' / 'KSA Aqar' / 'Rawasi Dark' above.
  { name: 'Al Sidra', i18nKey: 'Al Sidra Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'Moftah', i18nKey: 'Moftah Al Aqar', logo: require('../../assets/images/moftah.png') },
  { name: 'مسار المستقبل', i18nKey: 'Masar Al Mustaqbal Real Estate', logo: require('../../assets/images/masar.png') },
  { name: 'منصات', i18nKey: 'Menassat Real Estate', logo: require('../../assets/images/gomenassat.png') },
  { name: 'Sakan Saudi', i18nKey: 'Sakan', logo: require('../../assets/images/sakan.png') },
  { name: 'مكتب بوصبيح', i18nKey: 'Bossbih Real Estate Office', logo: require('../../assets/images/bossbih.png') },
  { name: 'Al Shawaf', i18nKey: 'Al Shawaf Real Estate Office', logo: require('../../assets/images/alshawaf.png') },
  { name: 'Ibrahim Alqarawi', i18nKey: 'Ibrahim Alqarawi Real Estate Investments', logo: require('../../assets/images/ialqarawi.png') },
  { name: 'Al Jassim', i18nKey: 'Al Jassim Real Estate Services', logo: require('../../assets/images/aljassim.png') },
  { name: 'Almotmkenah', i18nKey: 'Almotmkenah Real Estate', logo: require('../../assets/images/almotmkenah.png') },
  { name: 'نفوذ', i18nKey: 'Nufouth Development Real Estate', logo: require('../../assets/images/nufouth.png') },
  // ── onboarded 2026-09-24 (batch 36) ─────────────────────────────────────────────────────────────
  // All 35 wear the SAME neutral placeholder until the owner supplies their real marks — never
  // another company's logo. `name` is the stored db `source` (the scraper's SOURCE constant).
  { name: 'دويليو', i18nKey: 'Dwelleo', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'مكتب أقاليم هجر للخدمات العقارية', i18nKey: 'Aqalem Hajer Real Estate Services Office', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'سكني', i18nKey: 'Sakani', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'الشاطري للتطوير العقاري', i18nKey: 'Shatri Real Estate Development', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'القاسم العقارية', i18nKey: 'Alqasem Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'فكر الإعمار', i18nKey: 'Fkr Alemar', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'ودود العقارية', i18nKey: 'Wadod Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'آل متعب العقارية', i18nKey: 'Al Muteb Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'البراك للعقارات', i18nKey: 'Al Barrak Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'الرفاعي للعقار', i18nKey: 'Al Rifai Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'سداسيات العقارية', i18nKey: 'Sodasyat Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'حصاد الاقتصادية للعقارات', i18nKey: 'Hasaad Economic Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'عقار الرياض', i18nKey: 'Aqar Alriyadh', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'فقط نقطة العقارية', i18nKey: 'Just Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'سنام العقارية', i18nKey: 'Snam Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'جواهر للوساطة والتسويق العقاري', i18nKey: 'Jawher Real Estate Brokerage', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'مقر المعتمد', i18nKey: 'Maqar Al Motamad', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'سنان العقارية', i18nKey: 'Senan Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'الصفقة الذهبية العقارية', i18nKey: 'Golden Deal Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: '1000 العقارية', i18nKey: '1000 Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'يمين العقارية', i18nKey: 'Yameen Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'إبريزة العقارية', i18nKey: 'Ebriza Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'علم الريادة الإدارية', i18nKey: 'Eilm Alriyada', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'دار يوسف العقارية', i18nKey: 'Dar Yusuf Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'البداح للعقارات', i18nKey: 'Albdah Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'الإيضاح', i18nKey: 'Eydah', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'تمايز العقارية', i18nKey: 'Tamyaz Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'حازم', i18nKey: 'Hazim', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'فلل', i18nKey: 'Villas SA', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'مار العقارية', i18nKey: 'Mar Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'RightCompound', i18nKey: 'RightCompound', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'LivingCompound', i18nKey: 'LivingCompound', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'Azure', i18nKey: 'Azure', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'Expat Trusted Housing', i18nKey: 'Expat Trusted Housing', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'Flow', i18nKey: 'Flow', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'أبعاد', i18nKey: 'Abaad', logo: require('../../assets/images/platform-placeholder.png') },
  // WAVE 1, 2026-09-25 — the ten crawled and are reachable, so this barrier's HIDES-NO-LIVE
  // direction demands a tile for each. Placeholder artwork until the owner supplies logos.
  { name: 'آل سعيدان', i18nKey: 'Al Saedan', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'إيجو عقار', i18nKey: 'Ego Real Estate', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'أحمد المحيسني العقارية', i18nKey: 'Ahmed Almuhaysini', logo: require('../../assets/images/platform-placeholder.png') },
  // NO TILE for نفوذ للاستثمار العقاري yet: its first crawl was CANCELLED on the workflow timeout
  // (2026-09-25, 2,601 listings against a 45-minute budget), so it has zero reachable rows and this
  // barrier refuses a logo nobody can reach. Its SOURCE_TOKENS entry stays below, so the moment the
  // crawl lands the HIDES-NO-LIVE direction goes red and names it — which is how the tile arrives.
  { name: 'راز العقارية', i18nKey: 'Razre', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'ري إنفست', i18nKey: 'Reinvest', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'صفا للاستثمار', i18nKey: 'Safa Investment', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'صكوك العقارية', i18nKey: 'Sokok', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'سكنة', i18nKey: 'Sukna', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'طوبة العقارية', i18nKey: 'Tuba', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'آي باكس', i18nKey: 'iBaax', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'RE/MAX', i18nKey: 'RE/MAX Saudi', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'قمرا للتطوير العقاري', i18nKey: 'Qmra', logo: require('../../assets/images/platform-placeholder.png') },
  { name: 'العجلان للتسويق العقاري', i18nKey: 'Al Ajlan', logo: require('../../assets/images/platform-placeholder.png') },
  // LOGO-ONLY (owner decision 2026-09-24): brand shown in the strip, no scraper, no tables, never searchable.
  { name: 'Maskanre', i18nKey: 'Maskan United', logo: require('../../assets/images/platform-placeholder.png'), logoOnly: true },
  { name: 'Wetheaddress', i18nKey: 'The Address', logo: require('../../assets/images/platform-placeholder.png'), logoOnly: true },
];

// Ordered SPECIFIC-first token → platform name map, mirroring ResultCard's SourceBadge matching so a
// raw listing/source value ("aqargate", "aqar_commercial", "gathern", "aqarmonthly") resolves to
// exactly ONE platform. Generic "aqar" is LAST so aqargate/aqarcity/aqaratikom/aqarmonthly win first.
// Used to (a) resolve a user's `sources` filter, (b) figure out which pool platforms actually appear
// in a result set, AND (c) filter PLATFORM_META against the live-active set returned by
// loader_active_platforms_ar().
const SOURCE_TOKENS: Array<[string, string]> = [
  ['wasalt', 'Wasalt'], ['aldarim', 'Aldarim'], ['aqargate', 'Aqargate'], ['aqarcity', 'Aqarcity'],
  ['aqaratikom', 'Aqaratikom'], ['aqarmonthly', 'Aqar'],
  ['alhoshan', 'Alhoshan'], ['alkhaas', 'Al Khaas'],
  ['aqalemhajer', 'مكتب أقاليم هجر للخدمات العقارية'], ['مكتب أقاليم هجر للخدمات العقارية', 'مكتب أقاليم هجر للخدمات العقارية'], // 2026-09-24: BEFORE 'hajer', which the slug 'aqalemhajer' contains
  ['hajer', 'Hajer'], ['sanadak', 'Sanadak'], ['eastabha', 'Eastabha'], ['raghdan', 'Raghdan'],
  ['eaqartabuk', 'Eaqartabuk'], ['satel', 'Satel'], ['sadin', 'Sadin'],
  ['mustqr', 'Mustqr'], ['mustaqr', 'Mustqr'], ['ramzalqasim', 'Ramzalqasim'], ['ramzalqassim', 'Ramzalqasim'],
  ['fursaghyr', 'Fursaghyr'], ['jazwtn', 'Jazwtn'], ['jazan', 'Jazwtn'],
  ['mizlaj', 'Mizlaj'], ['abeea', 'Abeea'], ['jurash', 'Jurash'],
  ['goldendeal', 'الصفقة الذهبية العقارية'], ['الصفقة الذهبية العقارية', 'الصفقة الذهبية العقارية'], // 2026-09-24: BEFORE 'deal', which the slug 'goldendeal' contains
  ['gathern', 'Gathern'], ['dealapp', 'Deal App'], ['deal', 'Deal App'], ['souq', '24 Souq'],
  ['erapulse', 'Era Pulse'], ['pulse', 'Era Pulse'], ['nowaisiry', 'Al Nowaisiry'], ['october', '1 October'],
  ['muktamel', 'Muktamel'], ['arkaan', 'Arkaan'],
  ['abralosol', 'Abralosol'], ['therc', 'THERC'], ['rawasidark', 'Rawasi Dark'], ['aouj', 'Aouj'],
  ['bahadhabab', 'Bahadhabab'],
  ['alobid', 'Alobid'],
  ['abwbna', 'Abwbna'],
  ['remal', 'Remal'],
  ['amaall', 'Amaall'],
  ['aqaralsaudia', 'AqarAlSaudia'],
  ['amlakalahsa', 'Amlakalahsa'],
  ['alta', 'Alta'],
  ['shmoualshmal', 'Shmou Al Shmal'],
  ['awal', 'Awal'],
  ['azdad', 'Azdad'],
  ['suwar', 'Suwar'],
  ['rakez', 'Rakez'],
  ['akariyoun', 'Akariyoun'],
  ['عقاريون', 'Akariyoun'],
  // MUST stay above the bare 'aqar' token below: the slug 'ksaaqar' CONTAINS 'aqar', so a
  // specific-first order is what stops عقار's mark being stamped on another company's listing.
  ['ksaaqar', 'KSA Aqar'],
  ['عقارات السعودية', 'KSA Aqar'],
  ['gudai', 'Gudai'],
  ['غدي', 'Gudai'],
  ['safera', 'Safera'],
  ['سفيرة', 'Safera'],
  ['alhumaidan', 'Al Humaidan'],
  ['al humaidan', 'Al Humaidan'],
  ['الحميدان', 'Al Humaidan'],
  ['aqarnajran', 'Aqar Najran'],
  ['aqar najran', 'Aqar Najran'],
  ['عقار نجران', 'Aqar Najran'],
  ['fahadalshahri', 'Maqam Al Wisam'],
  ['fahad alshahri', 'Maqam Al Wisam'],
  ['فهد الشهري', 'Maqam Al Wisam'],
  ['compoundin', 'CompoundIn'],
  ['كومباوند', 'CompoundIn'],
  ['waslna', 'Waslna'],
  ['wslnaa', 'Waslna'],
  ['وصلنا', 'Waslna'],
  ['sadiqeltajer', 'Sadiq Eltajer'],
  ['sadiq-eltajer', 'Sadiq Eltajer'],
  ['صادق التاجر', 'Sadiq Eltajer'],
  ['toor', 'Toor'],
  ['توور', 'Toor'],
  // onboarded 2026-09-21. Each covers the slug (what loader_active_platforms_ar() returns), the
  // table name and the stored source. Bare «سكن» is NOT a token — «سكني» means residential.
  ['alsidra', 'Al Sidra'],
  ['al sidra', 'Al Sidra'],
  ['السدرة', 'Al Sidra'],
  ['moftah', 'Moftah'],
  ['مفتاح العقار', 'Moftah'],
  ['masar', 'مسار المستقبل'],
  ['مسار المستقبل', 'مسار المستقبل'],
  ['menassat', 'منصات'],
  ['منصات', 'منصات'],
  ['sakani', 'سكني'], ['سكني', 'سكني'], // 2026-09-24: BEFORE 'sakan', which the slug 'sakani' contains
  ['sakan', 'Sakan Saudi'],
  ['bossbih', 'مكتب بوصبيح'],
  ['بوصبيح', 'مكتب بوصبيح'],
  ['alshawaf', 'Al Shawaf'],
  ['al shawaf', 'Al Shawaf'],
  ['الشواف', 'Al Shawaf'],
  ['alqarawi', 'Ibrahim Alqarawi'],
  ['القرعاوي', 'Ibrahim Alqarawi'],
  ['aljassim', 'Al Jassim'],
  ['al jassim', 'Al Jassim'],
  ['الجاسم', 'Al Jassim'],
  ['almotmkenah', 'Almotmkenah'],
  ['المتمكنة', 'Almotmkenah'],
  ['nufouth', 'نفوذ'],
  ['نفوذ', 'نفوذ'],
  // onboarded 2026-09-24 (batch 36). Slug + stored source; Arabic sources are matched on the FULL stored string
  // («فلل», «حازم», «سكني» are whole source values, never bare words inside a title). aqalemhajer,
  // goldendeal and sakani sit ABOVE the generic 'hajer' / 'deal' / 'sakan' tokens that contain them.
  ['dwelleo', 'دويليو'],
  ['دويليو', 'دويليو'],
  ['shatri', 'الشاطري للتطوير العقاري'],
  ['الشاطري للتطوير العقاري', 'الشاطري للتطوير العقاري'],
  ['alqasem', 'القاسم العقارية'],
  ['القاسم العقارية', 'القاسم العقارية'],
  ['fkralemar', 'فكر الإعمار'],
  ['فكر الإعمار', 'فكر الإعمار'],
  ['wadod', 'ودود العقارية'],
  ['ودود العقارية', 'ودود العقارية'],
  ['almuteb', 'آل متعب العقارية'],
  ['آل متعب العقارية', 'آل متعب العقارية'],
  ['aalbarrak', 'البراك للعقارات'],
  ['البراك للعقارات', 'البراك للعقارات'],
  ['alrifai', 'الرفاعي للعقار'],
  ['الرفاعي للعقار', 'الرفاعي للعقار'],
  ['sodasyat', 'سداسيات العقارية'],
  ['سداسيات العقارية', 'سداسيات العقارية'],
  ['hasaad', 'حصاد الاقتصادية للعقارات'],
  ['حصاد الاقتصادية للعقارات', 'حصاد الاقتصادية للعقارات'],
  ['aqaralriyadh', 'عقار الرياض'],
  ['عقار الرياض', 'عقار الرياض'],
  ['justsa', 'فقط نقطة العقارية'],
  ['فقط نقطة العقارية', 'فقط نقطة العقارية'],
  ['snam', 'سنام العقارية'],
  ['سنام العقارية', 'سنام العقارية'],
  ['jawher', 'جواهر للوساطة والتسويق العقاري'],
  ['جواهر للوساطة والتسويق العقاري', 'جواهر للوساطة والتسويق العقاري'],
  ['m3tmd', 'مقر المعتمد'],
  ['مقر المعتمد', 'مقر المعتمد'],
  ['senan', 'سنان العقارية'],
  ['سنان العقارية', 'سنان العقارية'],
  ['thousand', '1000 العقارية'],
  ['1000 العقارية', '1000 العقارية'],
  ['yameen', 'يمين العقارية'],
  ['يمين العقارية', 'يمين العقارية'],
  ['ebriza', 'إبريزة العقارية'],
  ['إبريزة العقارية', 'إبريزة العقارية'],
  ['eilmalriyada', 'علم الريادة الإدارية'],
  ['علم الريادة الإدارية', 'علم الريادة الإدارية'],
  ['daryusuf', 'دار يوسف العقارية'],
  ['دار يوسف العقارية', 'دار يوسف العقارية'],
  ['albdah', 'البداح للعقارات'],
  ['البداح للعقارات', 'البداح للعقارات'],
  ['eydah', 'الإيضاح'],
  ['الإيضاح', 'الإيضاح'],
  ['tamyaz', 'تمايز العقارية'],
  ['تمايز العقارية', 'تمايز العقارية'],
  ['hazim', 'حازم'],
  ['حازم', 'حازم'],
  ['villassa', 'فلل'],
  ['فلل', 'فلل'],
  ['marksa', 'مار العقارية'],
  ['مار العقارية', 'مار العقارية'],
  ['rightcompound', 'RightCompound'],
  ['livingcompound', 'LivingCompound'],
  ['azure', 'Azure'],
  ['expattrusted', 'Expat Trusted Housing'],
  ['expat trusted housing', 'Expat Trusted Housing'],
  ['flow', 'Flow'],
  ['abaad', 'أبعاد'],
  ['أبعاد', 'أبعاد'],
  // نفوذ للاستثمار العقاري BEFORE the older نفوذ, for the same substring reason as ResultCard's
  // matchers: «نفوذ» is contained in the longer name and the first match wins.
  ['نفوذ للاستثمار العقاري', 'نفوذ للاستثمار العقاري'],
  ['nofodh', 'نفوذ للاستثمار العقاري'],
  ['alsaedan', 'آل سعيدان'],
  ['آل سعيدان', 'آل سعيدان'],
  ['ego', 'إيجو عقار'],
  ['إيجو عقار', 'إيجو عقار'],
  ['muhaysini', 'أحمد المحيسني العقارية'],
  ['أحمد المحيسني العقارية', 'أحمد المحيسني العقارية'],
  ['razre', 'راز العقارية'],
  ['راز العقارية', 'راز العقارية'],
  ['reinvest', 'ري إنفست'],
  ['ري إنفست', 'ري إنفست'],
  ['safa', 'صفا للاستثمار'],
  ['صفا للاستثمار', 'صفا للاستثمار'],
  ['sokok', 'صكوك العقارية'],
  ['صكوك العقارية', 'صكوك العقارية'],
  ['sukna', 'سكنة'],
  ['سكنة', 'سكنة'],
  ['tuba', 'طوبة العقارية'],
  ['طوبة العقارية', 'طوبة العقارية'],
  ['ibaax', 'آي باكس'],
  ['آي باكس', 'آي باكس'],
  ['remaxsa', 'RE/MAX'],
  ['re/max', 'RE/MAX'],
  ['qmra', 'قمرا للتطوير العقاري'],
  ['قمرا للتطوير العقاري', 'قمرا للتطوير العقاري'],
  ['alajlan', 'العجلان للتسويق العقاري'],
  ['العجلان للتسويق العقاري', 'العجلان للتسويق العقاري'],
  ['aqar', 'Aqar'],
];

// Raw source/table value → canonical platform name (or null if it matches nothing we know).
export function normalizeSource(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  for (const [tok, name] of SOURCE_TOKENS) if (s.includes(tok)) return name;
  return null;
}

// RUNTIME truth source lives in a separate file (loaderActivePlatforms.ts) so this file has zero
// dependency on the Supabase client — the barrier (scripts/verify-loader-platforms-match-active.ts)
// can import PLATFORM_META and normalizeSource without pulling Metro-only path aliases into a
// plain-Node test process. See loaderActivePlatforms.ts for fetchActivePlatformNames().

// A rotating cursor so each search shows a DIFFERENT mix and, over many searches, every platform
// eventually appears (instead of replaying the same handful). Seeded from localStorage on web so the
// rotation continues across reloads; a plain module counter on native.
const ROT_KEY = 'ezhalah:loaderRot';
function readRot(): number {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    const v = ls?.getItem(ROT_KEY);
    const n = v ? parseInt(v, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch { return _rot; }
}
let _rot = 0;
export function currentRotation(): number { return readRot(); }
export function bumpRotation(): void {
  _rot = (readRot() + 1) % 100000;
  try { (globalThis as { localStorage?: Storage }).localStorage?.setItem(ROT_KEY, String(_rot)); } catch {}
}

// Rotate an array left by `by` (non-mutating).
function rotate<T>(arr: T[], by: number): T[] {
  if (arr.length === 0) return arr;
  const k = ((by % arr.length) + arr.length) % arr.length;
  return [...arr.slice(k), ...arr.slice(0, k)];
}

// Choose which platforms the searching strip shows for THIS search.
//
// If `activeNames` is provided (from fetchActivePlatformNames), the roster is FILTERED to just
// platforms that currently have reachable rows in production — a scraper that went cold today
// stops advertising within one page-load without a deploy. If undefined (RPC not yet resolved, or
// the request failed), the full PLATFORM_META is used — safe degradation, never fewer than reality.
//
// `resultSources` (raw source values from the listings that actually came back, once known) only
// REORDERS the display — platforms that truly contributed lead the strip — it never removes a
// platform. `offset` rotates the rest per search so repeat searches don't always show the same
// visual order.
export function pickLoaderPlatforms(
  resultSources: string[] | undefined,
  offset: number,
  activeNames?: Set<string> | null,
): LoaderPlatform[] {
  const catalog = activeNames && activeNames.size
    ? PLATFORM_META.filter((p) => activeNames.has(p.name))
    : PLATFORM_META;
  const inResults = new Set((resultSources ?? []).map((s) => normalizeSource(s)).filter(Boolean) as string[]);
  const pri = catalog.filter((p) => inResults.has(p.name));
  const rest = rotate(catalog.filter((p) => !inResults.has(p.name)), offset);
  return [...pri, ...rest];
}
