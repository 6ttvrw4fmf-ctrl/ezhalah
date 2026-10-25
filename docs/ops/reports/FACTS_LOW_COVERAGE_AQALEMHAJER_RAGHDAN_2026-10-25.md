# Why aqalemhajer (6 %) and raghdan (13 %) gave so few facts — 2026-10-25

Follow-up to `FACTS_EXTRACT_TEST_2026-10-24.md` (run `facts-test-2026-10-24`). Question: is our stored
`description` boilerplate, or do the sites really publish little text? Each ad below was opened live
(server HTML via curl, and the rendered page in a real browser for the ones marked 🖥) and compared field by
field with the row in `aqalemhajer_residential_listings` / `raghdan_residential_listings`.

## aqalemhajer — PROVEN SILENT (our capture is exact; nothing changed)

The sample was skewed, not the capture: **47 of the 50 sampled ads are residential land**, and **all 3
non-land ads (an apartment, a building and villa AQH5443) gave facts (3 of 3)**. A land ad on this site is
a short WhatsApp-style card: plot number, area, street width, frontage, boundaries, price, and one line of
prose — almost always the tax/commission note «غير شامل الضريبة والسعي». The structured lines are already
stored in columns / `additional_info` (`street_width_m`, `direction`, `area_m2`, `plot_no`,
`plot_dimensions`); the prose (`wsf-al-qar`) is stored verbatim as `description`. The reader only gets
title + description, so a land ad has nothing for it to read.

| ad | what the page shows as the ad's text (`wsf-al-qar`) | stored `description` | also on the page → where we keep it |
|---|---|---|---|
| [4005](https://aqalemhajer.com/4005) 🖥 | «👌قريبة من الحي الخامس👌 ✅سهلة الدخول والخروج ✅ السعر غير شامل الضريبة والسعي» | same | plot 405-2, 390 م, شارع 15 → columns |
| [3681](https://aqalemhajer.com/3681) | «الارض مضافة» | same | 840 م, شارع 15, 30*28 |
| [4939](https://aqalemhajer.com/4939) | «غير شامل الضريبة والسعي» | same | 420 م, شارع 15, جنوب, 13.98*30.11 |
| [5512](https://aqalemhajer.com/5512) | «ملاحظة / غير شامل الضريبة والسعي» | same | 440 م, 20 ✖️ 22 |
| [4227](https://aqalemhajer.com/4227) | «ملاحظة /غير شامل الضريبه والسعي» | same | 324 م, شارع 15 |
| [4510](https://aqalemhajer.com/4510) | «ملاحظة : غير شامل السعي والضريبة» | same | 750 م, شارع 15, شمال, 25 * 30 |
| [4847](https://aqalemhajer.com/4847) | «ملاحظة / غير شامل الضريبة والسعي» | same | 375 م, شارع 15, جنوب, 12.5 × 30 |
| [5022](https://aqalemhajer.com/5022) | «ملاحظه / غير شامل الضريبة والسعي» | same | 390 م, شارع 15, غرب, 15*26 |
| [5316](https://aqalemhajer.com/5316) | «ملاحظه / غير شامل الضريبة والسعي» | same | 375 م, شارع 15, جنوب, 12.5 * 30 |
| [5409](https://aqalemhajer.com/5409) | «السعر غير شامل الضريبة والسعي» | same | 270 م, شارع 15, شمال, 15*18 |

10 of 10 identical. The rendered page (🖥 4005) shows nothing else for the ad: the rest of the page is the
office's phone block (never stored, PDPL) and a table of *other* ads. The template's floor / rooms /
features / notes fields are empty on every page (already documented in `scrapers/aqalemhajer/run.py` §8).
Villas on the same site carry full prose and it is stored (e.g. AQH5443 «محتوى الدور الأرضي: صالة - مجلس رجال
- … 3 غرف نوم - مطبخ - 4 دورات مياه …»).

## raghdan — OUR BUG, fixed

We stored the JSON-LD `description`, a line the site **generates** from its fields and **never shows** on the
page («المساحة 224.08 م²، عدد الغرف 4، العمر: جديد»). The text the customer reads is the broker's own block,
which the scraper already parsed for amenities but threw away. Real browser on
[0eu5PuVIUV2gnt8dOoxQ](https://raghdan.sa/ar/property/0eu5PuVIUV2gnt8dOoxQ/) 🖥: the generated line is absent
from the visible page; the broker's block reads «… شارع عرض 40 متر … 4 غرف نوم … 4 حمامات … ديوانية + مجلس رجال
… مطبخ + كراج سيارة مستقل …».

12 live ads from the facts sample:

| ad | broker's block on the page | stored before | stored after the fix |
|---|---|---|---|
| [0eu5PuVIUV2gnt8dOoxQ](https://raghdan.sa/ar/property/0eu5PuVIUV2gnt8dOoxQ/) 🖥 | 367 chars (above) | generated line | broker's text |
| [291692081414](https://raghdan.sa/ar/property/291692081414/) | «متوفر في حي السعادة سكن عمال موظفين شركات» | generated line | broker's text |
| [319051662226](https://raghdan.sa/ar/property/319051662226/) | 650 chars («4 غرف … مطبخ … 3 دورات مياه …») | generated line | broker's text (phone redacted) |
| [521209826506](https://raghdan.sa/ar/property/521209826506/) | 1,060 chars («6 غرف … مجلس رجال … مطبخ … 4 دورات مياه …») | generated line | broker's text (phone + broker name cut) |
| [MDusszj4Mnx239zbDV6B](https://raghdan.sa/ar/property/MDusszj4Mnx239zbDV6B/) | 361 chars («غرفة خادمة … عداد كهرب خاص … 4 مكيفات … مصعد … موقف») | generated line | broker's text |
| [TXX0OSWX2x9tR5bkjtDO](https://raghdan.sa/ar/property/TXX0OSWX2x9tR5bkjtDO/) | 439 chars («مدخل سيارة + مجلس + مطبخ + مستودع + غرفة سائق …») | generated line | broker's text |
| [194723340572](https://raghdan.sa/ar/property/194723340572/) 🖥 | none — a REGA-sourced ad: structured panels only | generated line | generated line (its only text) |
| [203226654461](https://raghdan.sa/ar/property/203226654461/), [257403307229](https://raghdan.sa/ar/property/257403307229/), [384875400833](https://raghdan.sa/ar/property/384875400833/), [442182317049](https://raghdan.sa/ar/property/442182317049/), [4hgidbOCG4HzZiYNbt6k](https://raghdan.sa/ar/property/4hgidbOCG4HzZiYNbt6k/) | none — REGA-sourced, structured panels only | generated line | generated line |

So half the sample had a real broker description we were dropping; the other half are REGA-sourced pages whose
only text is a red site notice («نأمل مطابقة الموقع على الخريطة مع الموقع حسب الصك: …», the deed location we
already keep as `deed_location_text`) — those are silent for prose and keep the generated line.

**Also captured now (owner 10-13 «store every extra info»)**, from the REGA legal/use panel every page shows and
nothing read, verbatim into `additional_info`: «هل يوجد قيود / رهن / وقف / وصية ؟» (`registry_restrictions_q`,
`mortgage_q`, `waqf_q`, `will_q` — e.g. TXX0OSWX2x9tR5bkjtDO «رهن: نعم»), «نوع منع التصرف» (`disposal_ban_type`),
«استخدام العقار» (`property_use`, e.g. «استعمال مختلط»), the full «المرافق» list as printed (`utilities_listed`,
incl. هاتف / تصريف الفيضانات that have no column), and the generated line itself (`ld_description`).
**Not yet captured:** the deed boundaries block («الحدود»: four sides with length + neighbour) — a different
page structure; left for a follow-up.

Code: `scrapers/raghdan/run.py` (`map_listing`, `_rendered_panel`); check:
`scripts/verify-raghdan-description-is-the-brokers-text.ts` (real page snippet; the old line is mutation-proven
caught). Stored rows are repaired by re-crawling raghdan (`small-sources-sync.yml`, `source=raghdan`); the
crawl rewrites every live row.
