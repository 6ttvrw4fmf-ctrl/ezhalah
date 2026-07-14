-- =============================================================================================
-- Sanadak price/row-fidelity repair — 2026-07-14
-- =============================================================================================
-- DO NOT EXECUTE AGAINST PRODUCTION WITHOUT OWNER SIGN-OFF. This file is a prepared, reviewed
-- artifact only (project rule: Approval-workflow-rule / Price-fidelity-rule — recommend, then WAIT).
--
-- ROOT CAUSE (scrapers/sanadak/run.py:143-172 `_extract_obj`, :253 `ad`, :297-323 `map_listing`):
-- Every Sanadak /property-details/... RSC flight response embeds the primary listing PLUS ~5
-- "similar listings" carousel card objects, and EVERY one of those cards also carries its own
-- "advertisementNumber" key. The old `_extract_obj()` did `body.find('"advertisementNumber"')` —
-- the FIRST byte-offset occurrence anywhere in the whole flight text — with no check that the
-- object it pulled out actually belonged to the URL being fetched. Because Next.js RSC streams
-- independently-resolved Suspense chunks in an order that is a per-request race (not a fixed page
-- layout), whichever chunk happened to resolve first — main detail query or the sibling
-- recommendation query — got captured as "the" listing. Every stored field (price_total/
-- price_annual, area_m2, bedrooms, property_type, city, district_ar, ad_number) was read off that
-- same object, so one wrong pick corrupts the ENTIRE row; only `listing_url` (passed in separately)
-- stayed correct. Fixed in this same branch: scrapers/sanadak/run.py now derives the URL's own
-- advertisementNumber (Sanadak's URL convention: every URL ends in the real ad number) and scans
-- ALL candidate objects in the flight stream for the one whose own advertisementNumber matches —
-- see `_url_ad_number` / `_iter_candidate_objs` / `_extract_obj_for_url`.
--
-- SCALE (detection heuristic — ad_number digits vs. the trailing digit run of listing_url; Sanadak's
-- own URL convention always ends "-{advertisementNumber}", confirmed on every sample fetched):
--   sanadak_residential_listings: 1,062 active → 328 mismatched (30.9%)
--   sanadak_commercial_listings:    145 active →  21 mismatched (14.5%)
--   TOTAL AFFECTED (active):        349 rows
--
-- THIS SCRIPT repairs ONLY the rows personally live-re-fetched and verified against sanadak.sa
-- today (2026-07-14) using the corrected extractor (see verify_fix.py output, run against the
-- live site with curl_cffi chrome124 impersonation + `RSC: 1` header, same method the scraper
-- uses). That is 4 of the 349 flagged rows. Every value in the UPDATEs below is copied verbatim
-- from that live re-fetch — nothing here is estimated, averaged, or guessed.
--
-- Live verification detail (fetched 2026-07-14, corrected `_extract_obj_for_url` result):
--   id=585647  url=.../فيلا-للبيع-في-الخبر-التحلية-9-غرفة-7100225844
--     real object: advertisementNumber=7100225844 price=1450000 propertyTypeText=فيلا (Villa)
--                  city=الخبر district=التحلية lotSize=250 numberBedrooms=9
--     stored (wrong, from the old bug): ad_number=SN7100232821 price_total=1350000
--                  property_type=Residential Land area_m2=625 district_ar=الصواري
--     (matches the originally-reported case exactly)
--   id=584712  url=.../دور-للبيع-في-الرياض-الرمال-5-غرفة-7100221550
--     real object: advertisementNumber=7100221550 price=1170000 propertyTypeText=دور (Floor)
--                  city=الرياض district=الرمال lotSize=276.72 numberBedrooms=5
--     stored (wrong): ad_number=SN7201012370 price_total=1113750 property_type=Residential Land
--                  area_m2=405 district_ar=المرجان
--   id=584753  url=.../أرض-للبيع-في-شقراء-الملك-عبدالله-7200897255
--     real object: advertisementNumber=7200897255 price=198450 propertyTypeText=أرض (Land)
--                  city=شقراء district=الملك عبدالله lotSize=630 numberBedrooms=null
--     stored (wrong): ad_number=SN7200996027 price_total=280000 property_type=Rest House
--                  area_m2=420 district_ar="مخطط رقم 133" (a Thadiq rest-house — confirms the
--                  "similar listings" cross-contamination mechanism)
--   id=584730  url=.../أرض-للبيع-في-المدينة-المطار-7100206528
--     real object: advertisementNumber=7100206528 price=2600448.75 propertyTypeText=أرض (Land)
--                  city=المدينة district=المطار lotSize=1091.25 numberBedrooms=null
--     stored (wrong): ad_number=SN7100231727 price_total=2000785 property_type=Residential Land
--                  area_m2=835 district_ar=أبوبريقاء
--     (price truncated to 2600448 and area to 1091 below — same int(float(x)) truncation the
--     scraper's own `_int()` helper already applies to every row; not a new rounding decision)
--
-- ALL FOUR verified rows are property_type="Residential Land" already in the corrected object too
-- (propertyTypeText أرض maps to "Residential Land" per TYPE_MAP_AR) EXCEPT 585647 (Villa) and
-- 584712 (Floor) — property_type, area_m2, bedrooms, city, and neighborhood are corrected alongside
-- price_total for every row below, because the bug swapped the WHOLE row, not just the price.
--
-- NEEDS MANUAL ATTENTION (345 rows: flagged as mismatched by the detection heuristic above, but
-- NOT independently live-verified in this task — do not repair these from any guess; re-run the
-- corrected scraper (scrapers/sanadak/run.py) against each and let the normal upsert path correct
-- them, or live-verify individually before hand-writing an UPDATE). Format: id(ad_number).
--
-- sanadak_residential_listings (324 rows):
--   584703(SN7100262410), 584718(SN7200721827), 584721(SN7100274682), 584722(SN7201008479),
--   584723(SN7200990634), 584733(SN7201004445), 584735(SN7201004403), 584739(SN7100290745),
--   584743(SN7100264723), 584755(SN7200998126), 584759(SN7100288564), 584762(SN7200997452),
--   584771(SN7200941288), 584775(SN7200995278), 584776(SN7100271745), 584780(SN7100288964),
--   584783(SN7100288843), 584800(SN7200987063), 584810(SN7100232949), 584813(SN7200915484),
--   584817(SN7200988378), 584818(SN7200988373), 584821(SN7200953998), 584824(SN7200965679),
--   584825(SN7200977718), 584826(SN7200685457), 584828(SN7200685446), 584831(SN7200982784),
--   584834(SN7200988988), 584835(SN7200988990), 584838(SN7200988993), 584840(SN7200685461),
--   584842(SN7200984185), 584844(SN7200984181), 584846(SN7200984137), 584850(SN7100287686),
--   584853(SN7200984115), 584859(SN7200992307), 584871(SN7100202198), 584883(SN7100263185),
--   584891(SN7100271063), 584925(SN7200942333), 584942(SN7100269509), 584947(SN7200996988),
--   584958(SN7100264465), 584962(SN7100247572), 584970(SN7200990682), 584991(SN7100252073),
--   584995(SN7200751783), 584999(SN7200946127), 585028(SN7200986317), 585057(SN7200989731),
--   585071(SN7200937984), 585073(SN7200987912), 585076(SN7200988448), 585083(SN7200899755),
--   585089(SN7100285937), 585094(SN7100188011), 585097(SN7200977685), 585106(SN7200907698),
--   585123(SN7200951143), 585127(SN7200811121), 585131(SN7200928816), 585132(SN7200980498),
--   585137(SN7200983191), 585144(SN7200953336), 585167(SN7200948507), 585181(SN7200882769),
--   585183(SN7200686074), 585195(SN7200942152), 585196(SN7200971082), 585197(SN7200970470),
--   585202(SN7200966452), 585208(SN7100212333), 585211(SN7200938307), 585223(SN7200967818),
--   585225(SN7200788910), 585236(SN7100281022), 585261(SN7200962665), 585262(SN7100280565),
--   585273(SN7200958563), 585279(SN7200951068), 585293(SN7100276905), 585296(SN7200939279),
--   585298(SN7200814818), 585299(SN7200929024), 585305(SN7200782076), 585311(SN7100275993),
--   585317(SN7100275661), 585321(SN7200940529), 585324(SN7200871467), 585334(SN7200937267),
--   585339(SN7200672026), 585355(SN7200934468), 585366(SN7200939172), 585368(SN7200697509),
--   585381(SN7100257741), 585395(SN7100265153), 585402(SN7100206722), 585408(SN7100262868),
--   585420(SN7100271907), 585422(SN7200949535), 585424(SN7100194880), 585472(SN7100258153),
--   585489(SN7100213167), 585490(SN7100242227), 585492(SN7200704813), 585494(SN7100253996),
--   585495(SN7100253396), 585502(SN7100221845), 585512(SN7200839389), 585522(SN7200829089),
--   585542(SN7100204758), 585543(SN7100277860), 585553(SN7100247393), 585560(SN7100246364),
--   585561(SN7100202210), 585579(SN7100237494), 585591(SN7200753736), 585600(SN7200753776),
--   585604(SN7200786552), 585608(SN7200745051), 585612(SN7100239020), 585640(SN7200761302),
--   585648(SN7200755779), 585657(SN7100188264), 585672(SN7100230821), 585688(SN7200721910),
--   585723(SN7200727175), 585724(SN7200680246), 585728(SN7100224667), 585735(SN7200722989),
--   585743(SN7100285499), 585778(SN7200683206), 585792(SN7100205273), 585819(SN7100211625),
--   585829(SN7200621248), 585836(SN7200650585), 585838(SN7200650592), 585840(SN7100205229),
--   585852(SN7200621264), 585922(SN7200973072), 585983(SN7100230334), 586009(SN7200999060),
--   586015(SN7100261390), 586017(SN7200947997), 586029(SN7200972347), 589921(SN7100287117),
--   589925(SN7200987927), 590061(SN7100201461), 590468(SN7200978762), 590470(SN7200843345),
--   590965(SN7100250449), 590971(SN7200819040), 591089(SN7100230425), 591095(SN7200729814),
--   591138(SN7200731939), 591181(SN7200944332), 591194(SN7200704344), 591286(SN7200650594),
--   591325(SN7100195137), 591379(SN7100196195), 591950(SN7201000522), 592289(SN7100279905),
--   592443(SN7100267546), 592693(SN7100238076), 592900(SN7100204543), 627350(SN7200985086),
--   628428(SN7200988376), 628432(SN7200986504), 628444(SN7200915516), 628459(SN7200982783),
--   628492(SN7201004776), 628498(SN7100215128), 629485(SN7200989211), 629503(SN7100284805),
--   629552(SN7200979126), 629554(SN7200634684), 629651(SN7100279910), 629653(SN7200973598),
--   629684(SN7201001230), 629714(SN7100214892), 629733(SN7200964018), 629811(SN7201000547),
--   629865(SN7100265307), 629888(SN7100262049), 629940(SN7100257988), 629947(SN7200874592),
--   629983(SN7100251418), 630097(SN7200754251), 630110(SN7200796713), 630126(SN7200701593),
--   630146(SN7200658931), 630199(SN7100208054), 630226(SN7200756817), 630262(SN7200731942),
--   630271(SN7100226587), 630314(SN7100291752), 641964(SN7201013464), 642018(SN7200999883),
--   642893(SN7200993343), 644391(SN7200947585), 644449(SN7100279370), 644454(SN7200866820),
--   644538(SN7100266891), 644684(SN7100257073), 644725(SN7100251755), 645011(SN7200721820),
--   645118(SN7100208592), 645159(SN7200633798), 664103(SN7200964408), 664901(SN7200697242),
--   664942(SN7200965643), 693929(SN7200872161), 694113(SN7100209743), 694540(SN7100197307),
--   719389(SN7201014472), 719392(SN7201009582), 719395(SN7201014407), 723875(SN7201009013),
--   786284(SN7201008583), 786294(SN7201015284), 786356(SN7201015071), 789821(SN7201000525),
--   867400(SN7201013912), 1035509(SN7201012402), 1035534(SN7100293241), 1035536(SN7201010298),
--   1035537(SN7201008283), 1036519(SN7200903968), 1036537(SN7200982770), 1036539(SN7200982785),
--   1037166(SN7100188196), 1037180(SN7200982039), 1037195(SN7200720876), 1037209(SN7200980784),
--   1037752(SN7200950483), 1037774(SN7100225306), 1037776(SN7100283217), 1037787(SN7200916423),
--   1037799(SN7200938331), 1038488(SN7100195145), 1038489(SN7200973118), 1038559(SN7200943582),
--   1039123(SN7200930083), 1039159(SN7200897255), 1039269(SN7200872201), 1039426(SN7200714256),
--   1039608(SN7200727173), 1039648(SN7100189602), 1039654(SN7100218180), 1039656(SN7200983919),
--   1039658(SN7100217141), 1039693(SN7100213163), 1039802(SN7100192852), 1122572(SN7201019922),
--   1122598(SN7201014375), 1122632(SN7201000314), 1123587(SN7200995812), 1123617(SN7200915517),
--   1125407(SN7100275203), 1125486(SN7100270085), 1125764(SN7100212271), 1125886(SN7200747323),
--   1203838(SN7201020481), 1205750(SN7200987071), 1205765(SN7100284810), 1205773(SN7200775519),
--   1205989(SN7201021979), 1206193(SN7200989755), 1272020(SN7201023104), 1272023(SN7201022217),
--   1273934(SN7100281024), 1384153(SN7201024596), 1384155(SN7200989081), 1384158(SN7201023118),
--   1387229(SN7201019907), 1387399(SN7201004639), 1387608(SN7200816830), 1387762(SN7100208055),
--   1498177(SN7200996164), 1498178(SN7201025208), 1498179(SN7200718639), 1498181(SN7200718419),
--   1498183(SN7200738745), 1498185(SN7200633940), 1498187(SN7200654966), 1498240(SN7200774165),
--   1500691(SN7200774162), 1569038(SN7201026314), 1569042(SN7201026035), 1721984(SN7100297781),
--   1721986(SN7201024216), 1721991(SN7100296002), 1805921(SN7201028548), 1806778(SN7201029798),
--   1846796(SN7201029777), 1889552(SN7100298476), 1964260(SN7201031695), 1966468(SN7200898920),
--   2034467(SN7201034564), 2034468(SN7201034234), 2034470(SN7201033658), 2034471(SN7201033284),
--   2117775(SN7201034433), 2117856(SN7201034066), 2204801(SN7201035097), 2204805(SN7201030907),
--   2204807(SN7201030887), 2204809(SN7201030905), 2204816(SN7201030740), 2204817(SN7201035867),
--   2206826(SN7201030787), 2291832(SN7201014025), 2291833(SN7201031228), 2496885(SN7201038473),
--   2496890(SN7201037656), 2496891(SN7201037520), 2496892(SN7201036796), 2497442(SN7201038196),
--   2681550(SN7201039616), 2681551(SN7201039617), 2681553(SN7201039656), 2682137(SN7201040195)
--
-- sanadak_commercial_listings (21 rows):
--   584790(SN7200946000), 584794(SN7200965610), 584882(SN7200807439), 585060(SN7100257632),
--   585150(SN7200971946), 585256(SN7201002841), 585430(SN7100262716), 585432(SN7200935944),
--   585445(SN7100252023), 585532(SN7100200393), 585711(SN7200707993), 585713(SN7200764473),
--   590692(SN7200881528), 592679(SN7200794824), 630284(SN7200740765), 642052(SN7100287767),
--   1039836(SN7200642053), 1498309(SN7200991758), 2117861(SN7201033956), 2117864(SN7100298340),
--   2681682(SN7100300341)
--
-- Note: 584794/585256 and 585060/585532 are reciprocal SWAPS (two listings that each appeared in
-- the other's similar-listings carousel and got cross-mixed) — see the root-cause audit; still
-- needs live re-verification against sanadak.sa before either row can be repaired.
-- =============================================================================================

BEGIN;

-- ---------------------------------------------------------------------------------------------
-- Step 1: backup EVERY affected row (all 349 — verified and needs-manual-attention alike) before
-- touching anything. Additive, create-if-not-exists — never overwrites a prior backup run.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sanadak_residential_listings_backup_20260714
  (LIKE sanadak_residential_listings INCLUDING ALL);

CREATE TABLE IF NOT EXISTS sanadak_commercial_listings_backup_20260714
  (LIKE sanadak_commercial_listings INCLUDING ALL);

INSERT INTO sanadak_residential_listings_backup_20260714
SELECT * FROM sanadak_residential_listings
WHERE id IN (
  584703, 584712, 584718, 584721, 584722, 584723, 584730, 584733, 584735, 584739, 584743, 584753,
  584755, 584759, 584762, 584771, 584775, 584776, 584780, 584783, 584800, 584810, 584813, 584817,
  584818, 584821, 584824, 584825, 584826, 584828, 584831, 584834, 584835, 584838, 584840, 584842,
  584844, 584846, 584850, 584853, 584859, 584871, 584883, 584891, 584925, 584942, 584947, 584958,
  584962, 584970, 584991, 584995, 584999, 585028, 585057, 585071, 585073, 585076, 585083, 585089,
  585094, 585097, 585106, 585123, 585127, 585131, 585132, 585137, 585144, 585167, 585181, 585183,
  585195, 585196, 585197, 585202, 585208, 585211, 585223, 585225, 585236, 585261, 585262, 585273,
  585279, 585293, 585296, 585298, 585299, 585305, 585311, 585317, 585321, 585324, 585334, 585339,
  585355, 585366, 585368, 585381, 585395, 585402, 585408, 585420, 585422, 585424, 585472, 585489,
  585490, 585492, 585494, 585495, 585502, 585512, 585522, 585542, 585543, 585553, 585560, 585561,
  585579, 585591, 585600, 585604, 585608, 585612, 585640, 585647, 585648, 585657, 585672, 585688,
  585723, 585724, 585728, 585735, 585743, 585778, 585792, 585819, 585829, 585836, 585838, 585840,
  585852, 585922, 585983, 586009, 586015, 586017, 586029, 589921, 589925, 590061, 590468, 590470,
  590965, 590971, 591089, 591095, 591138, 591181, 591194, 591286, 591325, 591379, 591950, 592289,
  592443, 592693, 592900, 627350, 628428, 628432, 628444, 628459, 628492, 628498, 629485, 629503,
  629552, 629554, 629651, 629653, 629684, 629714, 629733, 629811, 629865, 629888, 629940, 629947,
  629983, 630097, 630110, 630126, 630146, 630199, 630226, 630262, 630271, 630314, 641964, 642018,
  642893, 644391, 644449, 644454, 644538, 644684, 644725, 645011, 645118, 645159, 664103, 664901,
  664942, 693929, 694113, 694540, 719389, 719392, 719395, 723875, 786284, 786294, 786356, 789821,
  867400, 1035509, 1035534, 1035536, 1035537, 1036519, 1036537, 1036539, 1037166, 1037180, 1037195,
  1037209, 1037752, 1037774, 1037776, 1037787, 1037799, 1038488, 1038489, 1038559, 1039123, 1039159,
  1039269, 1039426, 1039608, 1039648, 1039654, 1039656, 1039658, 1039693, 1039802, 1122572, 1122598,
  1122632, 1123587, 1123617, 1125407, 1125486, 1125764, 1125886, 1203838, 1205750, 1205765, 1205773,
  1205989, 1206193, 1272020, 1272023, 1273934, 1384153, 1384155, 1384158, 1387229, 1387399, 1387608,
  1387762, 1498177, 1498178, 1498179, 1498181, 1498183, 1498185, 1498187, 1498240, 1500691, 1569038,
  1569042, 1721984, 1721986, 1721991, 1805921, 1806778, 1846796, 1889552, 1964260, 1966468, 2034467,
  2034468, 2034470, 2034471, 2117775, 2117856, 2204801, 2204805, 2204807, 2204809, 2204816, 2204817,
  2206826, 2291832, 2291833, 2496885, 2496890, 2496891, 2496892, 2497442, 2681550, 2681551, 2681553,
  2682137
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO sanadak_commercial_listings_backup_20260714
SELECT * FROM sanadak_commercial_listings
WHERE id IN (
  584790, 584794, 584882, 585060, 585150, 585256, 585430, 585432, 585445, 585532, 585711, 585713,
  590692, 592679, 630284, 642052, 1039836, 1498309, 2117861, 2117864, 2681682
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------------------------
-- Step 2: repair batches (≤25 rows each). Only the 4 rows independently live-re-fetched and
-- verified today (2026-07-14) against sanadak.sa are here. Every WHERE clause is guarded by the
-- CURRENTLY-STORED wrong ad_number so this is a no-op / 0-rows-affected if the row already
-- changed (e.g. a scraper run already fixed it) rather than blindly overwriting.
-- ---------------------------------------------------------------------------------------------

-- Batch 1 of 1 (4 rows — sanadak_residential_listings only; no commercial rows were live-verified)

-- id=585647 — https://sanadak.sa/property-details/فيلا-للبيع-في-الخبر-التحلية-9-غرفة-7100225844
-- real object (live 2026-07-14): advertisementNumber=7100225844 price=1450000 propertyTypeText=فيلا
--   city=الخبر district=التحلية lotSize=250 numberBedrooms=9
UPDATE sanadak_residential_listings
SET ad_number       = 'SN7100225844',
    price_total     = 1450000,
    property_type   = 'Villa',
    area_m2         = 250,
    bedrooms        = 9,
    city            = 'Khobar',
    city_ar         = 'الخبر',
    neighborhood    = 'التحلية',
    district_ar     = 'التحلية'
WHERE id = 585647
  AND ad_number = 'SN7100232821';

-- id=584712 — https://sanadak.sa/property-details/دور-للبيع-في-الرياض-الرمال-5-غرفة-7100221550
-- real object (live 2026-07-14): advertisementNumber=7100221550 price=1170000 propertyTypeText=دور
--   city=الرياض district=الرمال lotSize=276.72 numberBedrooms=5
UPDATE sanadak_residential_listings
SET ad_number       = 'SN7100221550',
    price_total     = 1170000,
    property_type   = 'Floor',
    area_m2         = 276,  -- int(float(276.72)) truncation, matching the scraper's own _int()
    bedrooms        = 5,
    city            = 'Riyadh',
    city_ar         = 'الرياض',
    neighborhood    = 'الرمال',
    district_ar     = 'الرمال'
WHERE id = 584712
  AND ad_number = 'SN7201012370';

-- id=584753 — https://sanadak.sa/property-details/أرض-للبيع-في-شقراء-الملك-عبدالله-7200897255
-- real object (live 2026-07-14): advertisementNumber=7200897255 price=198450 propertyTypeText=أرض
--   city=شقراء district=الملك عبدالله lotSize=630 numberBedrooms=null
UPDATE sanadak_residential_listings
SET ad_number       = 'SN7200897255',
    price_total     = 198450,
    property_type   = 'Residential Land',
    area_m2         = 630,
    bedrooms        = NULL,
    city            = NULL,  -- 'شقراء' (Shaqra) is not in CITY_AR map; normalize.map_city() result
                              -- not independently confirmed here — leave city NULL rather than guess
    city_ar         = 'شقراء',
    neighborhood    = 'الملك عبدالله',
    district_ar     = 'الملك عبدالله'
WHERE id = 584753
  AND ad_number = 'SN7200996027';

-- id=584730 — https://sanadak.sa/property-details/أرض-للبيع-في-المدينة-المطار-7100206528
-- real object (live 2026-07-14): advertisementNumber=7100206528 price=2600448.75 propertyTypeText=أرض
--   city=المدينة district=المطار lotSize=1091.25 numberBedrooms=null
UPDATE sanadak_residential_listings
SET ad_number       = 'SN7100206528',
    price_total     = 2600448,  -- int(float(2600448.75)) truncation, matching the scraper's _int()
    property_type   = 'Residential Land',
    area_m2         = 1091,     -- int(float(1091.25)) truncation
    bedrooms        = NULL,
    city            = 'Medina',
    city_ar         = 'المدينة',
    neighborhood    = 'المطار',
    district_ar     = 'المطار'
WHERE id = 584730
  AND ad_number = 'SN7100231727';

-- No commercial-table batch: none of the 21 flagged sanadak_commercial_listings rows were
-- independently live-verified in this task. All 21 remain in "needs manual attention" above.

COMMIT;

-- ---------------------------------------------------------------------------------------------
-- Post-repair verification query (run after applying, before trusting the result):
-- ---------------------------------------------------------------------------------------------
-- SELECT id, ad_number, listing_url, price_total, property_type, area_m2, bedrooms, city, district_ar
-- FROM sanadak_residential_listings
-- WHERE id IN (585647, 584712, 584753, 584730)
-- ORDER BY id;
-- =============================================================================================
