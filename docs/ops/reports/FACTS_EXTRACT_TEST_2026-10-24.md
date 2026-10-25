# Facts-extraction test — 10,000 ads, 2026-10-24/25

**Run id:** `facts-test-2026-10-24` (pilot: `facts-test-2026-10-24-pilot`, 500 ads) · **Table:** `public.listing_facts` (service-role only; nothing serves it) · **Cost log:** `public.listing_facts_runs` · **Code:** `scrapers/facts/extract.py`, `supabase/functions/facts-extract`, `.github/workflows/facts-extract.yml` (PRs #8541, #8552, #8558; migrations `20261024235440`, `20261025000627`, mirror PR #8540).

## What was tested

An LLM (`deepseek-chat`, billed as **deepseek-flash**, non-reasoning) reads each ad's own title + description and lists the facts the ad **names**, each with the ad's exact words as proof. The code — not the model — enforces the owner's rules:

| Rule | How it is enforced |
|---|---|
| SOURCE IS TRUTH, three outcomes | `true` only when named, `false` only on an explicit negation («بدون مسبح», «غير مفروشة»), **no row** when silent, "prepared only" («تأسيس مسبح») or about the neighbourhood («قريب من …»). Nearby is never stored. |
| PROOF OR DROP | every `quote` must be a literal substring of the normalised text that was sent (tatweel/diacritics/bidi marks stripped, أإآ→ا, ى→ي, ة→ه, digits unified, punctuation folded). Not found → dropped and counted as `unverified`. |
| PDPL | phones (every shape and digit set), emails, URLs, WhatsApp/contact clauses and «أبو …» kunyas are stripped **before** the text leaves; a fact whose quote/value still looks like contact data or a name is dropped (`pii`). No ad text is logged anywhere. |
| No opinions | catalogue keys only; `other:` must be a physical fact with a verbatim quote. |
| Spend fail-closed | proxy asks `ai_spend_gate()` before every paid call; script caps 10,500 calls / $5 per run; 500-ad checkpoint (unverified > 5 %, cost/ad > $0.001, JSON failures > 2 % → stop). Costs logged to `listing_facts_runs`, **not** `ai_usage` — the live product's $0.50/h breaker sums every `ai_usage` row and never saw this job (0 rows written there; breaker still `closed`). |

Ground truth: each source table's **own structured column** for the same fact (`elevator`, `kitchen`, `parking`, `reception_rooms_majlis` → majlis, `street_width_m`, `property_age`, `num_apartments` …) is snapshotted into `source_value` at extraction time, so accuracy is a SQL question. Nine small-site tables lack `furnished`/`num_apartments`; only that column is dropped for them.

## Headline numbers

| | |
|---|---|
| Distinct ads recorded | **10,558** (plan 10,000; the run stopped once at ad 3,776 on a transient 401 and was resumed with `--skip-done`; the second sample drifted, so more distinct ads were read — see *Caveats*) |
| Ads with ≥ 1 fact | **9,005 (85.3 %)** |
| Facts stored | **36,349** (3.44 per ad), of which `other:` 1,854 rows / 552 distinct labels |
| Paid calls | 697 (696 ok, 16 ads per call, avg 5.6 s) |
| **Cost** | **$1.1433** for 11,135 ad-reads → **$0.000103 per ad** (pilot: $0.0487 / 500 ads; grand total ≈ $1.19) |
| Tokens | prompt 3.23 M (cache hit 0.89 M = 27.6 %, miss 2.34 M), completion 0.94 M |
| JSON failures | **0 of 697 calls** |
| Unverified quotes (dropped) | **63 of 36,479 returned = 0.17 %** |
| PII-looking facts (dropped) | 35 (0.10 %) |
| Invalid shape (dropped) | 32 (0.09 %) |
| Ads lost to failures | 0 |
| Model billed | `deepseek-flash` on every call; 0 reasoning tokens |

**At fleet scale (404k ads):** ≈ 1.4 M facts, ≈ **$42 off-peak / ≈ $84 if run entirely in DeepSeek's peak window**, ≈ 27 h single-threaded at this pace (parallelisable by platform).

## Per fact — rows, true/false, agreement with the source's own field

`both known` = rows where the source table has a value for the same fact. `true agree` = model `true` and source `true`; `true disagree` = model `true`, source `false` (**not** automatically a model error — see the spot-checks below, most are the source's box being unticked while the text plainly names the thing). `gain` = rows where the source field is NULL (or the table has no such column) but the text gives a value.

| fact | rows | true | false | num | both known | true agree / disagree | false agree / disagree | num agree / disagree | gain (source NULL) | unverified |
|---|---|---|---|---|---|---|---|---|---|---|
| kitchen | 4,027 | 4,001 | 26 | | 3,100 | 2,975 / 106 (96.6 %) | 10 / 9 | | 927 | 18 |
| electricity | 3,071 | 3,067 | 4 | | 1,894 | 1,881 / 11 (99.4 %) | 1 / 1 | | 1,177 | 1 |
| water_supply | 2,783 | 2,780 | 3 | | 1,657 | 1,645 / 10 (99.4 %) | 1 / 1 | | 1,126 | 1 |
| street_width_m | 2,396 | | | 2,396 | 1,591 | | | 1,484 / 107 (93.3 %) | 805 | 2 |
| majlis | 2,370 | 2,370 | 0 | | 78 | 78 / 0 (100 %) | | | 2,292 | 1 |
| parking | 1,610 | 1,600 | 10 | | 452 | 435 / 14 (96.9 %) | 0 / 3 | | 1,158 | 2 |
| air_conditioner | 1,374 | 1,333 | 41 | | 897 | 731 / 142 (83.7 %) | 20 / 4 | | 477 | 0 |
| sanitation | 1,165 | 1,163 | 2 | | 1,091 | 1,082 / 8 (99.3 %) | 0 / 1 | | 74 | 0 |
| roof | 1,060 | 1,059 | 1 | | — | | | | 1,060 | 1 |
| warranty | 1,053 | 1,047 | 6 | | — | | | | 1,053 | 0 |
| elevator | 1,007 | 979 | 28 | | 798 | 651 / 138 (82.5 %) | 7 / 2 | | 209 | 2 |
| maid_room | 919 | 919 | 0 | | 453 | 365 / 88 (80.6 %) | | | 466 | 2 |
| furnished | 830 | 643 | 187 | | 637 | 405 / 93 (81.3 %) | 105 / 34 (75.5 %) | | 193 | 1 |
| laundry_room | 819 | 818 | 1 | | 225 | 223 / 2 (99.1 %) | | | 594 | 0 |
| storage | 809 | 809 | 0 | | — | | | | 809 | 4 |
| two_entrances | 765 | 762 | 3 | | — | | | | 765 | 1 |
| separate_electricity_meter | 753 | 752 | 1 | | 24 | 23 / 1 | | | 729 | 3 (+1 pii) |
| water_tank | 739 | 739 | 0 | | — | | | | 739 | 0 |
| yard | 720 | 719 | 1 | | — | | | | 720 | 1 |
| property_age_years | 675 | | | 675 | 594 | | | 431 / 163 (72.6 %) | 81 | 0 (+9 invalid) |
| car_entrance | 516 | 515 | 1 | | 405 | 245 / 160 (60.5 %) | | | 111 | 1 |
| optical_fibers | 501 | 501 | 0 | | 444 | 444 / 0 (100 %) | | | 57 | 1 |
| annex | 493 | 493 | 0 | | — | | | | 493 | 5 |
| private_entrance | 420 | 419 | 1 | | 281 | 200 / 80 (71.4 %) | 1 / 0 | | 139 | 0 |
| balcony | 382 | 382 | 0 | | 96 | 94 / 2 (97.9 %) | | | 286 | 0 |
| floors | 369 | | | 369 | — | | | | 369 | 2 |
| payment_monthly | 353 | 342 | 11 | | — | | | | 353 | 0 |
| driver_room | 340 | 339 | 1 | | 211 | 160 / 50 (76.2 %) | 0 / 1 | | 129 | 0 |
| boundaries (text) | 297 | | | | — | | | | 297 | 4 (+3 invalid) |
| pool | 265 | 265 | 0 | | — | | | | 265 | 2 (+3 invalid) |
| gym | 249 | 249 | 0 | | — | | | | 249 | 2 |
| garage | 220 | 220 | 0 | | — | | | | 220 | 0 |
| garden | 201 | 201 | 0 | | — | | | | 201 | 1 |
| apartments_count | 180 | | | 180 | 27 | | | 24 / 3 (88.9 %) | 153 | 0 |
| basement | 174 | 174 | 0 | | — | | | | 174 | 2 |
| electronic_deed | 174 | 172 | 2 | | — | | | | 174 | 0 |
| separate_water_meter | 166 | 164 | 2 | | 9 | 7 / 2 | | | 157 | 0 |
| grill | 119 | 119 | 0 | | — | | | | 119 | 1 |
| shops_count | 81 | | | 81 | — | | | | 81 | 0 (+1 invalid) |
| well | 50 | 47 | 3 | | — | | | | 50 | 0 |
| installment_available | 0 | | | | | | | | | |
| rent_now_pay_later | 0 | | | | | | | | | |

Reading the table honestly:

- **Where the source publishes the field and both agree in ≥ 96 %** — kitchen, electricity, water, sanitation, parking, laundry, balcony, optical fibres, majlis, street width (93 %) — the reader is as good as the structured field.
- **The 80 %-class facts (air_conditioner, elevator, maid_room, furnished, driver_room) and the 60–71 % ones (car_entrance, private_entrance)** are dominated by *text TRUE, source false*. Every spot-checked case had the ad plainly naming the thing («يوجد مصعد», «مدخل سياره», «غرفة للخادمة», «مكيفات راكبة»); the aqar box is simply unticked. That is the parking case-law pattern of 2026-08-09 again, and it is the owner's call which side to trust — the reader exposes it, it does not decide it.
- **`furnished` false-disagreements (34) are almost all muhaysini**: the page text says «مفروشة: لا» / «غير مؤثثة» while the scraped `furnished` column says `true`. That is a **scraper lead**, not a reader error (routed below).
- **`property_age_years` (72.6 %)**: aqar's `property_age` stores a bucket code (10 for «21 سنة», «30 سنة», «11 سنه»; 0 for «سنتين ونصف»), the text gives the year count. The reader is the more precise value; the AF age ranges should be checked against which one they read.
- **`street_width_m` disagreements (107)** are mostly corner plots with two streets («زاوية على شارع 20م شرقي» vs source 15) — the catalogue rule says omit when two widths are stated; the model omitted when both were in one sentence but not when only one was named.
- **`installment_available` / `rent_now_pay_later`: 0 rows.** Ads do not say this in prose; it is a platform feature. Prose cannot replace the structured field here.
- **Facts with no structured counterpart anywhere** (roof 1,060 · warranty 1,053 · storage 809 · two_entrances 765 · water_tank 739 · yard 720 · annex 493 · floors 369 · payment_monthly 353 · boundaries 297 · pool 265 · gym 249 · garage 220 · garden 201 · basement 174 · electronic_deed 174 · grill 119 · shops 81 · well 50) are pure gain and can only be judged by eye — 30 rows below.

### What the 24 existing filter columns would gain

Rows where the ad's text states the fact but the source's own field is NULL (or the table has no such column): **≈ 10,100 new values over 10,558 ads (0.96 per ad)** — kitchen 927 · electricity 1,177 · water 1,126 · parking 1,158 · street width 805 · AC 477 · laundry 594 · separate electricity meter 729 · maid room 466 · balcony 286 · elevator 209 · furnished 193 · separate water meter 157 · apartments 153 · private entrance 139 · driver room 129 · car entrance 111 · property age 81 · sanitation 74 · optical fibres 57 · plus pool 265, gym 249, garden 201, payment_monthly 353 which have no column on these tables at all. Scaled to the fleet ≈ 390k new filter values.

## Per platform — coverage

`ads seen` = distinct ads the model read (facts or a `_none` marker). Low coverage usually means the site's descriptions are short boilerplate (aqalemhajer, raghdan, arkaan) — worth a look before blaming the reader.

| platform | ads seen | with ≥ 1 fact | % | facts | per ad |
|---|---|---|---|---|---|
| aqar | 4,997 | 3,953 | 79.1 | 17,909 | 3.58 |
| haraj | 1,650 | 1,611 | 97.6 | 7,230 | 4.38 |
| wasalt | 1,500 | 1,455 | 97.0 | 3,875 | 2.58 |
| dealapp | 392 | 257 | 65.6 | 993 | 2.53 |
| muhaysini | 260 | 248 | 95.4 | 957 | 3.68 |
| gathern | 169 | 120 | 71.0 | 250 | 1.48 |
| abralosol | 145 | 133 | 91.7 | 280 | 1.93 |
| ialqarawi | 125 | 99 | 79.2 | 233 | 1.86 |
| aqarmonthly | 120 | 94 | 78.3 | 276 | 2.30 |
| dwelleo | 120 | 116 | 96.7 | 770 | 6.42 |
| muktamel | 120 | 115 | 95.8 | 309 | 2.58 |
| tuba | 120 | 111 | 92.5 | 516 | 4.30 |
| rakez | 100 | 94 | 94.0 | 318 | 3.18 |
| sakan | 100 | 100 | 100 | 503 | 5.03 |
| arkaan | 80 | 71 | 88.8 | 75 | 0.94 |
| aqarcity | 80 | 73 | 91.3 | 325 | 4.06 |
| rightcompound | 60 | 60 | 100 | 376 | 6.27 |
| aqalemhajer | 50 | 3 | **6.0** | 12 | 0.24 |
| mustqr | 50 | 46 | 92.0 | 117 | 2.34 |
| reinvest | 50 | 47 | 94.0 | 254 | 5.08 |
| sirdab | 50 | 44 | 88.0 | 132 | 2.64 |
| abaad | 40 | 21 | 52.5 | 84 | 2.10 |
| eaqartabuk | 40 | 32 | 80.0 | 123 | 3.08 |
| therc | 30 | 26 | 86.7 | 113 | 3.77 |
| raghdan | 30 | 4 | **13.3** | 4 | 0.13 |
| sakani | 30 | 27 | 90.0 | 122 | 4.07 |
| sukna | 20 | 20 | 100 | 86 | 4.30 |
| alshawaf | 20 | 15 | 75.0 | 41 | 2.05 |
| goldendeal | 10 | 10 | 100 | 66 | 6.60 |
| **total** | **10,558** | **9,005** | **85.3** | **36,349** | **3.44** |

## Top 30 `other` facts (words the catalogue does not have)

552 distinct labels on 1,854 rows. Several are one fact in many spellings — a v2 catalogue would merge them:

| label | rows | sites | | label | rows | sites |
|---|---|---|---|---|---|---|
| كاميرات مراقبة | 370 | 18 | | ساونا | 16 | 4 |
| دخول ذكي | 155 | 11 | | كاميرات | 16 | 4 |
| غاز مركزي | 71 | 8 | | نظام منزل ذكي | 15 | 7 |
| غرفة حارس | 49 | 9 | | واي فاي | 13 | 4 |
| نظام دخول ذكي | 42 | 5 | | غسالة | 12 | 6 |
| إنترنت | 38 | 10 | | إنترنت عالي السرعة | 12 | 4 |
| سمارت هوم | 25 | 4 | | جاكوزي | 12 | 9 |
| حارس | 24 | 3 | | ثلاجة | 11 | 5 |
| نظام سمارت هوم | 23 | 3 | | نظام المنزل الذكي | 10 | 2 |
| أمن وحراسة | 21 | 3 | | ملعب تنس | 9 | 2 |
| كاميرات أمنية | 20 | 1 | | حضانة أطفال | 9 | 5 |
| غسالة ملابس | 18 | 6 | | مكنسة مركزية | 9 | 2 |
| دخول ذاتي | 17 | 4 | | سكن عمال | 8 | 4 |
| | | | | حراسة أمنية | 7 | 5 |
| | | | | فرن | 7 | 4 |
| | | | | منزل ذكي | 7 | 2 |
| | | | | حارس للمبنى | 7 | 4 |

Merged, the candidates for a v2 catalogue are: **cctv** (≈ 406), **smart_access / smart_home** (≈ 300), **central_gas** (71), **guard** (≈ 108), **internet / wifi** (≈ 63), **appliances** (غسالة/ثلاجة/فرن ≈ 48), **sauna / jacuzzi / steam** (≈ 30).

## 30 random rows for the owner to eyeball

(`md5(id || 'eyeball-2026-10-25')` order — not hand-picked. `source` = the source's own field, `—` = it has none.)

| platform | listing | fact | value | quote | source |
|---|---|---|---|---|---|
| aqar | [6874128](https://sa.aqar.fm/مجمعات-للإيجار/الرياض/شمال-الرياض/حي-القيروان/شارع-عقرباء-119-حي-عقرباء-مدينة-الجبيلة-منطقة-الرياض-6874128) | kitchen | true | مطبخًا | — |
| aqar | [6882810](https://sa.aqar.fm/شقق-للبيع/الرياض/شرق-الرياض/حي-المونسية/شارع-الصباح-حي-المونسية-مدينة-الرياض-منطقة-الرياض-6882810) | parking | true | موقف خاص بالقبو | — |
| aqar | [6832321](https://sa.aqar.fm/شقق-للبيع/جدة/شمال-جدة/حي-الصوارى/شارع-الامير-عبدالمجيد-حي-الصواري-مدينة-جدة-منطقة-مكة-المكرمة-6832321) | parking | true | وموقف خاص | — |
| dwelleo | [al-mahdiyah 4br](https://dwelleo.sa/ar/properties/distinctive-apartment-in-al-mahdiyah-4-bedrooms-riyadh) | kitchen | true | ومجلس رجال مستقل، ومطبخ | true |
| dwelleo | [granada floor](https://dwelleo.sa/ar/properties/3-bedroom-floor-for-sale-in-al-granada-district-riyadh) | garage | true | مزود بباب كراج | — |
| reinvest | [ghrf-llaygar-11](https://reinvest.sa/for-rent/rooms/residential/riyadh/ar-rimal/ghrf-llaygar-11) | kitchen | true | مطبخ | true |
| rightcompound | [al-jawhara-village](https://rightcompound.com/compounds/riyadh/al-jawhara-village) | laundry_room | true | laundry services | — |
| wasalt | [5955042](https://wasalt.sa/en/property/apartment-8538-sqm-with-2-bedrooms-5955042) | kitchen | true | مطبخ راكب | — |
| haraj | [11185816790](https://haraj.com.sa/11185816790/شقة_مفروشة_للايجار/) | payment_monthly | true | الدفع شهري | — |
| aqar | [6914674](https://sa.aqar.fm/فلل-للبيع/جدة/شمال-جدة/حي-الرياض/شارع-عبدالعزيز-محمد-الربيع-حي-الرياض-مدينة-جدة-منطقة-مكة-المكرمة-6914674) | garden | true | حديقه | — |
| aqar | [6827029](https://sa.aqar.fm/دور-للبيع/الرياض/شمال-الرياض/حي-القيروان/شارع-قطب-الدين-بن-ظهيره-حي-القيروان-مدينة-الرياض-منطقة-الرياض-6827029) | laundry_room | true | غرفة غسيل | — |
| dwelleo | [al-taibah building](https://dwelleo.sa/ar/properties/residential-building-for-sale-in-al-taibah-district-jeddah) | annex | true | بالإضافة إلى ملحق | — |
| ialqarawi | [3378](https://ialqarawi.com/index.php?router=card&id=3378&catid=45) | annex | true | الملحق العلوي | — |
| aqar | [6884104](https://sa.aqar.fm/دور-للبيع/الرياض/شمال-الرياض/حي-العقيق/شارع-الفتح-حي-العقيق-مدينة-الرياض-منطقة-الرياض-6884104) | balcony | true | بلكونه | — |
| rightcompound | [al-ansari two](https://rightcompound.com/compounds/khobar/al-ansari-compound-two-al-khobar) | other:غرفة بخار | true | Sauna , Jacuzzi, Steam Room | — |
| sakan | [99323](https://sa.sakan.co/ar/property/details/99323-شقة---جدة---حي-الروضة) | warranty | true | ضمانات على السباكة والكهرباء | — |
| haraj | [11189114742](https://haraj.com.sa/11189114742/فله_للايجار_بالحي_العاشر_بالقرب_من_المستشفي_الالماني/) | annex | true | دورين وملحق | — |
| haraj | [11190958051](https://haraj.com.sa/11190958051/ارض_تجارية_راس_تنورة/) | water_supply | true | Waters | true |
| muhaysini | [14148](https://aqaralmuhaysini.com/propertydetails/14148) | laundry_room | true | غرفة غسيل ملابس | true |
| muhaysini | [17989](https://aqaralmuhaysini.com/propertydetails/17989) | electricity | true | المرافق والخدمات: كهرباء، ماء، صرف صحي | true |
| aqar | [6803105](https://sa.aqar.fm/فلل-للبيع/الطائف/حي-الشهداء-الجنوبية/حي-شارع-الجولان-حي-الشهداء-الجنوبية-الطائف-الطائف-6803105) | floors | 2 | دورين | — |
| aqar | [6693588](https://sa.aqar.fm/شقق-للبيع/الرياض/غرب-الرياض/حي-ظهرة-نمار/شارع-زينب-الثقفية-حي-العوالي-مدينة-الرياض-منطقة-الرياض-6693588) | parking | true | وموقف خاص لكل شقه | — |
| haraj | [11188197422](https://haraj.com.sa/11188197422/فيلا_للإيجار_في_حي_سدرة/) | private_entrance | true | مدخل خاص للعائلة | true |
| aqar | [6930630](https://sa.aqar.fm/شقق-للبيع/الدمام/حي-الشاطئ-الغربي/شارع-الملك-عبد-الله-بن-عبدالعزيز-حي-الشاطئ-الغربي-مدينة-الدمام-المنطقة-الشرقية-6930630) | kitchen | true | مطبخ، غرفة عاملة | — |
| ialqarawi | [1678](https://ialqarawi.com/index.php?router=card&id=1678&catid=34) | air_conditioner | true | مكيفات راكبه | true |
| sakan | [99479](https://sa.sakan.co/ar/property/details/99479-شقة-سكني-للبيع-في-منطقة-مكة-المكرمة-جدة-المنار) | kitchen | true | مطبخ | true |
| aqar | [6905034](https://sa.aqar.fm/شقق-للإيجار/الرياض/شمال-الرياض/حي-العليا/شارع-داود-بن-عروة-حي-العليا-مدينة-الرياض-منطقة-الرياض-6905034) | air_conditioner | true | مكيف سبليت | **false** |
| aqar | [6913054](https://sa.aqar.fm/فلل-للبيع/الرياض/شرق-الرياض/حي-الرمال/شارع-يحيى-بن-جزلة-حي-الرمال-مدينة-الرياض-منطقة-الرياض-6913054) | maid_room | true | غرفه خادمه | true |
| haraj | [11185800732](https://haraj.com.sa/11185800732/فيلا_للإيجار_مناسبة_للعوائل_والشركات_100_الف_دفعه/) | electricity | true | خدمات العقار: كهرباء | true |
| aqar | [6795104](https://sa.aqar.fm/شقق-للبيع/جدة/شمال-جدة/حي-ابحر-الجنوبية/حي-أبحر-الجنوبية-مدينة-جدة-منطقة-مكة-المكرمة-6795104) | parking | true | موقف خاص | — |

Two of the thirty show the reader's limits honestly: `Waters` (haraj, English stub) and `laundry services` (a compound amenity, not the unit's room) — true to the text, thin as facts.

## Disagreements, sampled (random, not hand-picked)

**Text says yes, source box says no** — in every one the words are the ad's own:
«يوجد مصعد» (aqar 6915281) · «مصعد» (aqar 6606695, 6613089, 6676942) · «مدخل سياره» (aqar 6809506) · «مدخل سيارة» (aqar 6641486) · «حوش + كراج + مدخلين» → car_entrance (aqar 6677335) · «غرفة للخادمة» (aqar 6832200) · «مطبخ راكب» (wasalt 5834811) · «صالة عائلية-مطبخ» (aqar 6586404).

**Text says no, source says yes** — seven of eight are **muhaysini `furnished`**: «مفروشة: لا», «مؤثثة: غير مؤثثة», «مفروش: لا (غير مفروش)» with the scraped column `true`; plus «مطبخ غير راكب» (muhaysini 16457, kitchen `true`) and «بدون اثاث» (haraj 11186182705, `true`).

**Number differs** — «شارع ٨٠ م غربي» vs source 60 · «الواجهة: شمالية على شارع 36م» vs 29 · «عمر العقار اكثر من 30 سنة» vs 10 · «عمر الفيلا ٢١ سنة» vs 10 · «عمر الفله: 11 سنه» vs 5 · «العمر قرابة سنتين ونصف» vs 0 · «زاوية على شارع 20م شرقي» vs 15 (corner plot — should have been omitted).

**Negations the reader stored as `false`** — «مطبخ (SPLIT) (غير راكب)» · «الفيلا غير مؤثثة» · «شقة غير مفروشة للبيع» · «لا يوجد عداد ماء» · «التأثيث: غير مؤثثة». All literal.

## Leads for the engineers (not acted on here — this test writes nothing outside its own tables)

1. **muhaysini `furnished` (and at least one `kitchen`) contradicts the page's own text** in every sampled row — the scraper reads the wrong field or a default. 🔧 quality/repair.
2. **aqar `property_age` is a bucket code, not years** (10 for 11–30+ years, 0 for 2.5 years). Check what the Advanced Filter age ranges read.
3. **aqar's unticked amenity boxes** (elevator, AC, maid room, car/private entrance): 142 + 138 + 88 + 160 + 80 ads name the thing in prose while the structured field says `false`. Owner decision: which side the search index trusts, and whether prose may *add* a `true` on a `false` box (today the rule is: structured field wins, prose never consulted).
4. **aqalemhajer (6 %), raghdan (13 %), arkaan (0.94 facts/ad)** — descriptions are boilerplate or missing; check what the scraper stores as `description` there.

## Caveats

- The first leg stopped at ad 3,776 on a single 401 from the proxy (a PostgREST hiccup during the caller-key check was read as "not service role"); fixed in #8558 (tri-state check, retries with back-off), then resumed with `--skip-done`. The second leg's random offsets drew a partly different sample, so 10,558 distinct ads were recorded (plan 10,000); ≤ 576 first-leg ads that yielded no fact and were not re-drawn are read but unrecorded (no `_none` marker existed yet), so true distinct reads are 10.6–11.1k.
- `ads seen` counts distinct ads with any row; cost per ad uses ad-reads (11,135), which is the conservative (higher) figure.
- Nine small-site tables have no `furnished` / `num_apartments` column, so those facts have no ground truth there and count as "gain".
- Cache hit rate (27.6 %) is the system prompt only; the ad text is new every call. A smaller catalogue or larger batches would not change the per-ad price much — completion tokens are 55 % of the bill.
- Proxy, migrations and workflow are production objects but touch no served table, RPC, scraper or the `agent` function. `listing_facts` can be dropped at any time with no product effect.
