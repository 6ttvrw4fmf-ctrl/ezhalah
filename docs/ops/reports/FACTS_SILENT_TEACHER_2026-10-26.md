# AI teacher pass on the silent ads — 2026-10-26

**Owner ask (2026-10-26):** «lets do the 10,000 ads ok then we move on to the next — give me a report: useful things we
got and things that match the Advanced Filter, make sure it's live.»

**Run id:** `facts-silent-2026-10-26` · **Table:** `public.listing_facts` (model `deepseek-flash`, run `facts_extract`) ·
**Picker:** `public.ops_text_facts_silent` (migration `20261025235031`), `scrapers/facts/extract.py --silent` (PR #8721) ·
**Workflow:** `facts-extract.yml` run 40248702477.

## What was tested

The free word reader (`word-checker-v1`) had read every active ad and found **nothing** in 82,505 of them (no filter fact,
no history fact). Those are where the reader is most likely blind. The paid teacher (DeepSeek, the same prompt and the same
PROOF-OR-DROP / PDPL code as the 10-24 test) read a seeded 10,000-ad sample of them, proportional per table (aqar 38k,
gathern 6.6k, dealapp 4.8k, aqar commercial 3.3k, wasalt 3.2k, muhaysini 1.9k, nofodh 1.7k …).

## Headline

| | |
|---|---|
| Ads planned / eligible / read | 10,000 / 8,713 (the rest had too little text after PDPL sanitising) / **8,713** |
| Cost | **$0.317** (545 calls, $0.000036 per ad; cap $5) |
| Ads with ≥ 1 fact | **1,235 (14.2 %)** — 86 % of the silent ads are silent for the teacher too |
| Facts stored | **1,619** (928 yes · 11 no · 680 numbers / text / `other:`) |
| Quotes dropped (not in the ad) | 9 (0.55 %) · PII drops 3 · invalid 5 · JSON failures 0 |

## What the teacher found (top facts)

| fact | rows | blank box | note |
|---|---|---|---|
| street_width_m | 353 | 110 | most are shapes the reader refuses **on purpose**: corners («على شارعين 16 م»), two widths («عرض الشوارع: 20/20», «شارع عرض40*15»), frontage («عرض الواجهه: ٢٠ م»), open bounds («يزيد عن ٢٠ م»), bare numbers («شارع ٢٠» = could be a street number) |
| boundaries (text) | 253 | 253 | the four-sides lines; no filter |
| **furnished** | 124 | 115 | **a real miss** — short-stay sellers (gathern, aqarmonthly) name the furniture: «بأثاث مودرن / فاخر / مريح / عصري», «بتأثيث فندقي», «متكاملة الأثاث» (118 of 124). Added to the reader (PR «furniture named by its kind»). |
| electricity / water_supply | 102 / 56 | 15 / 6 | mostly «عداد كهرباء», «تمديدات الكهرباء», «200 ريال كهرب و ماء» — meters, wiring and bills, which the reader excludes on purpose (a meter is not a supply); muhaysini «موصولة بشبكة الكهرباء والماء» is a genuine phrasing the reader has not got |
| payment_monthly | 47 | 47 | «الإيجار الشهري», «تقبل شهري» — **owner decision #2 still open** (does a monthly rental count as payment_monthly?) |
| electronic_deed | 43 | 43 | half are «صك مستقل» (a separate deed, not an electronic one) — the teacher is wrong there |
| two_entrances | 32 | 32 | all «على شارعين» — two **streets**, not two entrances; the teacher is wrong, the reader right |
| `other:دخول ذاتي` / `other:دخول ذكي` | 26 / 23 | — | self check-in on gathern — a new short-stay fact, **for the owner** |
| storage | 16 | 16 | «مستودع للإيجار» — the property IS a warehouse; not an amenity |
| warranty | 20 | 20 | «ضمانات توصل إلى 25 سنه», «10 سنوات تأمين ضد العيوب الخفية» — genuine; why the reader stayed silent on these ads is not explained yet (the phrase itself is in its selftest) |
| kitchen / air_conditioner | 12 / 14 | 1 / 7 | «مطابخ جاهزة», «مكيفات راكبة» — genuine; same open question as warranty |

## Hand check (40 random teacher «yes» rows, read in the ad's own words)

Clearly wrong or dubious: **11 of 40 (≈ 27 %)** — two_entrances for «على شارعين» (×2), storage for a warehouse listing (×3),
driver_room for «غرف سواق للإيجار» (rooms for rent), furnished for «شقة بصالة انيقة» (no furniture named), electricity for a
meter / a bill (×3), private_entrance for «دخول ذاتي» (self check-in). The rest are right.

**Verdict:** on the silent ads the teacher is far less reliable than on the 10-24 sample (27 % vs 1.7 % false-yes).
That is expected — these ads are silent because their text is ambiguous — and it is the main result: **the free
reader's refusals are mostly correct.** Nothing from this run is written into the filter directly; only the one
clear miss (furniture named by its kind) goes into the reader, and the reader's own nightly read is what reaches the
Advanced Filter.

## What reaches the Advanced Filter

- **Street width (Rule B for numbers, migration `20261025231203`, PR #8716)** — live: 67,203 quoted widths in the
  overlay after the re-read of 68,494 ads (12 min); the hourly sync fills the blank boxes (28.8k expected; 2,835 still
  blank at the first pass, cleared by the next). Proven like a user: Filter → الرياض / حي الملك فيصل / دور / بيع → the
  aqar ad at 1,325,000 ر.س (listing_id 8038963, box was blank) now carries 15 m in the index, and opening its card shows
  the source ad with «عرض الشارع: 15». The AF question itself (p_street_width_min) reads the same column, so it needs
  no change; it was not offered on that 87-ad search (the interview offered bathrooms and amenities first).
- **Furnished** — after the reader PR merges, the 82,505 silent ads are marked stale and re-read; the 118 furniture
  phrasings land in `listing_text_facts` and the hourly sync merges them (Rule B) into `search_listings_ar.furnished`.

## For the owner (decisions, not auto-added)

1. Monthly rental text («الإيجار الشهري», «تقبل شهري») → `payment_monthly`? (47 ads here, open decision #2)
2. Self check-in («دخول ذاتي / ذكي», 49 gathern ads) → a new short-stay fact?
3. «صك مستقل» is NOT an electronic deed; «على شارعين» is NOT two entrances — both stay out.

## Kept data

Every row of this run stays in `listing_facts` with its quote (`run_id = 'facts-silent-2026-10-26'`), as the answer key
for the silent class; the frozen set `ops_text_facts_silent` (82,505 rows) is the sampling frame for a later seed.

## Side finding

dealapp cards render a chip «عرض الشارع 0 متر» (card #4 and #9 of the Riyadh / الملك فيصل / دور search): a stored
`street_width_m = 0` shown as a width. Routed to Quality & Repair as a backlog item (a zero is not a width).
