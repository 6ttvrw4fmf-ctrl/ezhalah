# Facts from ad text — free word checker + vectors (VECTOR COMBO), 2026-10-25

**Run ids:** benchmarks `facts-words-bench-v1` → `-v2` → `-v3` (the 10,558 ads of LLM run `facts-test-2026-10-24`), full run `facts-words-2026-10-25` · **Tables:** `public.listing_facts` (`model = 'word-checker-v1'`), `public.listing_embeddings` (migration `20261025064103`, mirror PR #8607) · **Code:** `scrapers/facts/word_checker.py`, `scrapers/facts/words.py`, `.github/workflows/facts-words.yml` (PRs #8608, #8622, #8633, #8664, #8681).

**Nothing is wired into the filter.** This report is for the owner to read first.

## Headline

- **Full run:** 404,981 active ads on 149 platforms read; 394,737 had text; **322,242 ads got at least one fact (81.6 %)**; **1,209,515 facts** stored (1,045,701 yes · 41,879 no · 121,935 numbers/text), each with the ad's own words as proof.
- **Against the LLM on the same 10,558 ads:** where both wrote a value they agree **99.8 %** (31,445 same, 66 different). The LLM wrote 2,982 rows the checker left silent (8.6 % of its rows — mostly things the checker refuses on purpose or owner decisions below); the checker wrote 5,379 the LLM skipped.
- **False-yes hand check:** the last two random checks (bench-v3 and the full run, 60 rows each) found **1 clearly wrong row each (1.7 %)**, inside the 2 % bar; both classes are fixed in code and their rows removed. Counting the two borderline "shared amenity" rows as wrong it is 3.3 %.
- **Cost:** **$0 AI, no API key.** 560 GitHub Actions minutes (free on this public repo). Database **+0.77 GiB** (approved ≈ 0.8 GB).
- **Vectors:** they recognise the topic but **found no usable new words**; every spelling variant added came from the LLM comparison and SQL samples.
- **Filter (nothing wired):** under the current law (**Rule A**) the filter would gain ≈ **349k** yes/no values; under the proposed 5-case rule (**Rule B**) ≈ **746k** plus **830** box-yes values turned into conflicts (NULL + flag).
- **PDPL:** 2 LLM-run rows held a neighbour's name → deleted; the checker's rows hold none.

## What was tested

The owner's free combo, no paid AI and no API key (cost = GitHub Actions minutes only):

| part | what it does | can it write a yes/no? |
|---|---|---|
| **Word checker** (`word_checker.py`) | Fixed word lists per fact, read from each ad's own title + description (PDPL-sanitised line by line; wasalt HTML turned into lines first). Three outcomes, exactly as the LLM run: `true` = the ad names it, `false` = the ad explicitly negates it (the negator must touch the word), **no row** = silent, prepared-only («مصعد مؤسس»), possible-only («يمكن عمل مسبح», «رخصة بناء … ملاحق»), nearby («قريب من», «مقابل», English «… nearby»). Every row keeps `quote` = the ad's exact words and passes the same PROOF-OR-DROP check as the LLM run. | **Yes — the only thing that does** |
| **Vectors** (`words.py`) | `intfloat/multilingual-e5-small` at revision `614241f6`, CPU, `query: ` prefix, max 256 tokens, stored as `halfvec(384)`. A finder loop: for each fact, blank ads as close to the fact's "yes" ads as the bottom quarter of those ads are to each other (cap 3 % or 2,000) become candidates; n-grams over-represented in the candidates are listed for owner review. | **Never** — it only proposes words |

## The hand check (false-yes must be ≤ 2 %)

Random `true` rows (`md5(id || seed)` order, not hand-picked), each read in its ad's own words:

| run | rows checked | clearly wrong | borderline | what was wrong → fixed in |
|---|---|---|---|---|
| bench-v1 | 30 | 2 (6.7 %) | 0 | both the REGA form **label** «الضمانات ومدتها: -» / «… لايوجد» read as warranty = yes → #8622 |
| bench-v1 rows the LLM did not have | ≈ 90 | many (garden 5 of 7, water meter 6 of 7, warranty 6 of 7) | | «حدائق» = district parks, boundary lines («الوجهة: غرب حديقة»), «خزان المياه مستقل» / «دورة مياه مستقلة» read as a separate water meter, «لضمان الخصوصية», «2دورات مياه» → #8622 |
| bench-v2 | 30 + 36 | 3 (4.5 %) | 1 | «مدخل مكيّف» (the lobby), «توجد رخصة بناء تسوير وملاحق» (a permit), «احواش» in a list of lot types; borderline «نظام الكهرباء: الفنار» (wiring brand) → #8633 |
| bench-v3 | 60 | 1 (1.7 %) | 1 | «… مثل المياه وتكييف الهواء ومواقف السيارات، حيث لم يتم ذكرها في العرض» (a list the ad says it did NOT state) → #8664; borderline: a project's shared «تراس علوي» read as balcony |
| **full run** | 60 | 1 (1.7 %) | 1 | «غرفة نوم **ب**دورة مياه مستقلة» (a bathroom) read as a separate water meter → #8681, and the 900 fleet rows of that shape removed from the run; borderline: «السطح مشترك لجميع سكان العماره» (a shared roof) |

**Also found while building Rule B's list below:** muhaysini writes «مفروشة: لا» and runs straight into the next sentence («مفروشة: لا يُعرف حي …», «مؤثثة: لا تتضمن …»), which read as furnished = yes — 458 furnished + 12 electricity + 1 two_entrances rows (+ 7 in bench-v3). Fixed in #8681 (a clause break after «: لا») and removed from the runs. Both repairs only **delete** rows of my own runs (→ NULL, the safe side); the next run writes the correct `false` values.

**Verdict:** 2 clearly wrong of the last 120 random rows (1.7 %) — at the bar, with both classes now fixed. Repairs removed 1,371 full-run rows (0.13 % of all yes rows). A fresh 60-row check after the next run is the honest way to confirm.

## Per fact — checker next to the LLM, against the source's own field (bench-v3, same 10,558 ads)

Read each cell as **words / LLM**. `true vs source` = rows where the checker says yes and the source table's own column is known: agree / disagree. As in the LLM report, a "disagree" is usually the source's unticked box while the text plainly names the thing (aqar elevator, AC, maid room, car/private entrance) — not a reader error. `gain` = rows where the source column is NULL or missing.

| fact | rows | true | false | true vs source (words) | true vs source (LLM) | false · or number vs source: agree / disagree | gain (source NULL) | note |
|---|---|---|---|---|---|---|---|---|
| kitchen | 4225 / 4027 | 4206 / 4001 | 19 / 26 | 3120 / 113 (96.5 %) | 2975 / 106 (96.6 %) | 6 / 10 · LLM 10 / 9 | 976 / 927 |  |
| electricity | 2914 / 3071 | 2913 / 3067 | 1 / 4 | 1764 / 7 (99.6 %) | 1881 / 11 (99.4 %) | 1 / 0 · LLM 1 / 1 | 1142 / 1177 |  |
| water_supply | 2785 / 2783 | 2782 / 2780 | 3 / 3 | 1640 / 8 (99.5 %) | 1645 / 10 (99.4 %) | 1 / 1 · LLM 1 / 1 | 1135 / 1126 |  |
| majlis | 2623 / 2370 | 2623 / 2370 | 0 / 0 | 89 / 0 (100.0 %) | 78 / 0 (100.0 %) | — | 2534 / 2292 |  |
| warranty | 2623 / 1053 | 931 / 1047 | 1692 / 6 | — | — | — | 2623 / 1053 | no source field |
| street_width_m | 2237 / 2396 |  |  |  |  | 1447 / 88 (94.3 %) · LLM 1484 / 107 (93.3 %) | 702 / 805 |  |
| parking | 1813 / 1610 | 1806 / 1600 | 7 / 10 | 524 / 15 (97.2 %) | 435 / 14 (96.9 %) | 0 / 1 · LLM 0 / 3 | 1273 / 1158 |  |
| air_conditioner | 1338 / 1374 | 1297 / 1333 | 41 / 41 | 723 / 137 (84.1 %) | 731 / 142 (83.7 %) | 20 / 6 · LLM 20 / 4 | 452 / 477 |  |
| roof | 1156 / 1060 | 1151 / 1059 | 5 / 1 | — | — | — | 1156 / 1060 | no source field |
| sanitation | 1143 / 1165 | 1141 / 1163 | 2 / 2 | 1065 / 9 (99.2 %) | 1082 / 8 (99.3 %) | 0 / 1 · LLM 0 / 1 | 68 / 74 |  |
| elevator | 1056 / 1007 | 1029 / 979 | 27 / 28 | 664 / 164 (80.2 %) | 651 / 138 (82.5 %) | 6 / 2 · LLM 7 / 2 | 220 / 209 |  |
| property_age_years | 979 / 675 |  |  |  |  | 774 / 147 (84.0 %) · LLM 431 / 163 (72.6 %) | 58 / 81 |  |
| storage | 877 / 809 | 877 / 809 | 0 / 0 | — | — | — | 877 / 809 | no source field |
| maid_room | 867 / 919 | 867 / 919 | 0 / 0 | 347 / 86 (80.1 %) | 365 / 88 (80.6 %) | — | 434 / 466 |  |
| laundry_room | 807 / 819 | 806 / 818 | 1 / 1 | 227 / 3 (98.7 %) | 223 / 2 (99.1 %) | — | 577 / 594 |  |
| furnished | 775 / 830 | 610 / 643 | 165 / 187 | 414 / 95 (81.3 %) | 405 / 93 (81.3 %) | 121 / 7 · LLM 105 / 34 | 138 / 193 | 7 «مفروشة: لا …» rows removed |
| water_tank | 770 / 739 | 770 / 739 | 0 / 0 | — | — | — | 770 / 739 | no source field |
| yard | 770 / 720 | 767 / 719 | 3 / 1 | — | — | — | 770 / 720 | no source field |
| two_entrances | 751 / 765 | 720 / 762 | 31 / 3 | — | — | — | 751 / 765 | no source field |
| separate_electricity_meter | 733 / 753 | 714 / 752 | 19 / 1 | 23 / 2 (92.0 %) | 23 / 1 (95.8 %) | — | 708 / 729 |  |
| annex | 702 / 493 | 699 / 493 | 3 / 0 | — | — | — | 702 / 493 | no source field |
| floors | 616 / 369 |  |  |  |  | — | 616 / 369 | no source field |
| optical_fibers | 487 / 501 | 487 / 501 | 0 / 0 | 445 / 0 (100.0 %) | 444 / 0 (100.0 %) | — | 42 / 57 |  |
| car_entrance | 469 / 516 | 468 / 515 | 1 / 1 | 229 / 145 (61.2 %) | 245 / 160 (60.5 %) | — | 95 / 111 |  |
| private_entrance | 424 / 420 | 396 / 419 | 28 / 1 | 203 / 69 (74.6 %) | 200 / 80 (71.4 %) | 7 / 3 · LLM 1 / 0 | 142 / 139 |  |
| balcony | 396 / 382 | 396 / 382 | 0 / 0 | 97 / 3 (97.0 %) | 94 / 2 (97.9 %) | — | 296 / 286 |  |
| driver_room | 304 / 340 | 302 / 339 | 2 / 1 | 150 / 42 (78.1 %) | 160 / 50 (76.2 %) | 0 / 2 · LLM 0 / 1 | 110 / 129 |  |
| pool | 258 / 265 | 258 / 265 | 0 / 0 | — | — | — | 258 / 265 | no source field |
| gym | 247 / 249 | 247 / 249 | 0 / 0 | — | — | — | 247 / 249 | no source field |
| garden | 246 / 201 | 246 / 201 | 0 / 0 | — | — | — | 246 / 201 | no source field |
| boundaries (text) | 235 / 295 |  |  | — | — | — | 235 / 295 | no source field |
| garage | 231 / 220 | 231 / 220 | 0 / 0 | — | — | — | 231 / 220 | no source field |
| apartments_count | 221 / 180 |  |  |  |  | 18 / 4 (81.8 %) · LLM 24 / 3 (88.9 %) | 199 / 153 |  |
| basement | 211 / 174 | 211 / 174 | 0 / 0 | — | — | — | 211 / 174 | no source field |
| separate_water_meter | 133 / 166 | 126 / 164 | 7 / 2 | 8 / 1 (88.9 %) | 7 / 2 (77.8 %) | 0 / 1 · LLM 0 / 0 | 123 / 157 | 24 bathroom rows removed (see hand check) |
| grill | 140 / 119 | 140 / 119 | 0 / 0 | — | — | — | 140 / 119 | no source field |
| electronic_deed | 128 / 174 | 127 / 172 | 1 / 2 | — | — | — | 128 / 174 | no source field |
| shops_count | 98 / 81 |  |  |  |  | — | 98 / 81 | no source field |
| payment_monthly | 51 / 353 | 49 / 342 | 2 / 11 | — | — | — | 51 / 353 | no source field |
| well | 51 / 50 | 51 / 47 | 0 / 3 | — | — | — | 51 / 50 | no source field |

## Checker vs LLM on the same ads (bench-v3)

`same` / `different` = both wrote a row for the same ad and fact. `LLM only` = the LLM wrote a row and the checker stayed silent. `checker only` = the reverse.

| fact | same value | different value | agreement where both speak | LLM only | checker only |
|---|---|---|---|---|---|
| kitchen | 3974 | 4 | 99.9 % | 49 (1 % of LLM) | 247 |
| electricity | 2790 | 0 | 100.0 % | 281 (9 % of LLM) | 124 |
| water_supply | 2615 | 1 | 100.0 % | 167 (6 % of LLM) | 169 |
| warranty | 907 | 20 | 97.8 % | 126 (12 % of LLM) | 1696 |
| majlis | 2337 | 0 | 100.0 % | 33 (1 % of LLM) | 286 |
| street_width_m | 1964 | 10 | 99.5 % | 422 (18 % of LLM) | 263 |
| parking | 1532 | 2 | 99.9 % | 76 (5 % of LLM) | 279 |
| air_conditioner | 1297 | 3 | 99.8 % | 74 (5 % of LLM) | 38 |
| roof | 997 | 1 | 99.9 % | 62 (6 % of LLM) | 158 |
| sanitation | 1124 | 0 | 100.0 % | 41 (4 % of LLM) | 19 |
| elevator | 978 | 1 | 99.9 % | 28 (3 % of LLM) | 77 |
| property_age_years | 551 | 6 | 98.9 % | 118 (17 % of LLM) | 422 |
| storage | 759 | 0 | 100.0 % | 50 (6 % of LLM) | 118 |
| maid_room | 841 | 0 | 100.0 % | 78 (8 % of LLM) | 26 |
| laundry_room | 775 | 0 | 100.0 % | 44 (5 % of LLM) | 32 |
| furnished | 727 | 3 | 99.6 % | 100 (12 % of LLM) | 45 |
| yard | 690 | 0 | 100.0 % | 30 (4 % of LLM) | 80 |
| water_tank | 710 | 0 | 100.0 % | 29 (4 % of LLM) | 60 |
| two_entrances | 700 | 0 | 100.0 % | 65 (8 % of LLM) | 51 |
| separate_electricity_meter | 675 | 1 | 99.9 % | 77 (10 % of LLM) | 57 |
| annex | 437 | 0 | 100.0 % | 56 (11 % of LLM) | 265 |
| floors | 322 | 4 | 98.8 % | 43 (12 % of LLM) | 290 |
| optical_fibers | 484 | 0 | 100.0 % | 17 (3 % of LLM) | 3 |
| car_entrance | 468 | 0 | 100.0 % | 48 (9 % of LLM) | 1 |
| private_entrance | 370 | 0 | 100.0 % | 50 (12 % of LLM) | 54 |
| balcony | 375 | 0 | 100.0 % | 7 (2 % of LLM) | 21 |
| driver_room | 300 | 1 | 99.7 % | 39 (11 % of LLM) | 3 |
| pool | 247 | 0 | 100.0 % | 18 (7 % of LLM) | 11 |
| gym | 225 | 0 | 100.0 % | 24 (10 % of LLM) | 22 |
| garden | 157 | 0 | 100.0 % | 44 (22 % of LLM) | 89 |
| boundaries (text) | 119 | 0 | 100.0 % | 176 (60 % of LLM) | 116 |
| garage | 213 | 0 | 100.0 % | 7 (3 % of LLM) | 18 |
| apartments_count | 115 | 3 | 97.5 % | 62 (34 % of LLM) | 103 |
| basement | 171 | 0 | 100.0 % | 3 (2 % of LLM) | 40 |
| separate_water_meter | 116 | 0 | 100.0 % | 50 (30 % of LLM) | 17 |
| grill | 117 | 0 | 100.0 % | 2 (2 % of LLM) | 23 |
| electronic_deed | 127 | 1 | 99.2 % | 46 (26 % of LLM) | 0 |
| shops_count | 56 | 0 | 100.0 % | 25 (31 % of LLM) | 42 |
| payment_monthly | 44 | 3 | 93.6 % | 306 (87 % of LLM) | 4 |
| well | 39 | 2 | 95.1 % | 9 (18 % of LLM) | 10 |
| **total** | **31,445** | **66** | **99.8 %** | **2,982 (8.6 % of LLM rows)** | **5,379** |

### What the LLM caught that the checker missed — 2,982 rows

Most of it is on purpose (the checker refuses what the text does not literally state) or an owner decision:

- **payment_monthly 306** — 151 are «للإيجار الشهري» / «ايجار شهري» (a **monthly rental**) and most of the rest a monthly price («الايجار 1800 شهري», «2,500 ريال شهريًا») — the rent period, not "pays monthly on a yearly contract". A handful are real («يمكن دفعات شهرية», «سنه تقبل شهري»), which the checker reads as possible-only. Owner decision (list below); not added.
- **street_width_m 422** — bare «شارع 16» (could be a street number), «شوارع 15 م», «شارع واسع 30م»; and corners, which both readers must omit.
- **electricity 281 · water 167** — «عداد كهرباء» (a meter, which the checker keeps as its own fact), «شامل الكهرباء والماء» in sentences longer than its cue window, and lists the cue rule does not reach.
- **boundaries 176** — free-form side lists («شمالًا: القطعتان 915 و916 بطول 20م …») the checker's two shapes do not cover. **The LLM is clearly better here.**
- **property_age_years 118** — open bounds and approximations the checker refuses on purpose («اكثر من عشر سنوات», «حوالي ١٣ او ١٤ سنة», «تقريبا»); the LLM stored «اكثر من عشر سنوات» as 10.
- **apartments_count 62 · shops_count 25** — «كل دور شقتين» (per-floor), «المجموع 8 شقق», «عدد الشقق:1»: the LLM multiplies and totals, the checker does not.
- **separate_water_meter 50** — «عداد مويه» (a meter without «مستقل»), «عدادات لكل وحدة».
- **electronic_deed 46** — mostly «بصك», «صك. محضر فرز»: a deed, not an *electronic* deed — the LLM over-reads.

10 random examples (md5 order):

| platform | ad | fact | LLM value | LLM quote |
|---|---|---|---|---|
| wasalt | WST5877286 | furnished | false | «شقة غير مفروشة للتأجير» |
| aqar | 6636465 | majlis | true | «وصاله ومجلس» |
| alshawaf | SHW20788 | separate_electricity_meter | true | «عداد الكهرب عدد 4 عدادات» |
| aqar | 6723896 | sanitation | true | «الصرف الصحي راكب» |
| aqar | 6930895 | separate_water_meter | true | «عداد مويه» |
| aqar | 6817758 | separate_electricity_meter | true | «عدادات كهرباء لكل وحده» |
| aqar | 6920094 | separate_electricity_meter | true | «كهرب مشترك بعداد يحسب استهلاكك مستقل» |
| aqar | 6884818 | floors | 2 | «دورين» |
| aqar | 6905181 | electricity | true | «شامل الكهرباء والماء» |
| wasalt | WST5958110 | floors | 2 | «مكونة من: 2 دور» |

### What the checker caught that the LLM did not — 5,379 rows

- **warranty = false 1,692** — the REGA form line «الضمانات ومدتها: لا يوجد» (haraj, dealapp). Literally an explicit "none"; the LLM skipped it. **Owner decision** whether a form default counts (list below).
- **property_age_years 422** — haraj's form «عمر العقار: Four Year», «عمر العقار: جديد» → 0 (the scrapers' own labelled-age reader), which the LLM mostly skipped. Against the source field the checker agrees **84.0 %** vs the LLM's 72.6 %.
- **floors 290 · majlis 286 · parking 279 (mostly «كراج») · annex 265 · street_width_m 263 · kitchen 247** — plain mentions, mostly inside long floor-plan lists, that the LLM did not return.

10 random examples (md5 order; the 1,692 form rows left out):

| platform | ad | fact | checker value | checker quote |
|---|---|---|---|---|
| haraj | HRJ11186180075 | parking | true | «كراج» |
| aqar | 6675113 | street_width_m | 18 | «شارع جنوب 18م» |
| haraj | HRJ11186712624 | property_age_years | 0 | «عمر العقار: جديد» |
| haraj | HRJ11189741534 | furnished | true | «مؤثث» |
| therc | AQ499892 | two_entrances | false | «مدخل واحد» |
| haraj | HRJ11188178623 | property_age_years | 0 | «عمر العقار: جديد» |
| haraj | HRJ11184891694 | storage | true | «مستودع» |
| aqar | 6746347 | annex | true | «الملحق» |
| abaad | ABD1076 | property_age_years | 0 | «عمر البناء: جديد» |
| haraj | HRJ11189174414 | annex | true | «ملحق» |

## The vectors — honest verdict: they did not find new words

- **Neighbours do know the topic.** A pool ad's 5 nearest neighbours mention a pool 39 % of the time (base rate 2.6 %); majlis 72.5 % (25 %), elevator 49 % (10 %), annex 52 % (7 %). So the embeddings work.
- **But the finder's candidates are mostly the same TEMPLATE, not the same FACT.** Over all facts, 9,777 candidates held 281 ads where the LLM later found the fact the checker missed: **2.9 % precision** (base 0.64 % → 4.5× lift), covering **13.5 %** of the 2,080 LLM-only ads. The best facts were electricity (29 of 229), water (26 of 233), payment_monthly (35 of 315) and warranty (25 of 238); pool, balcony, basement, well: 0.
- **The new-words list is boilerplate.** bench-v1 listed only floor-plan words («الدور», «مجلس», «الاول», «ماستر»). With a 2 % document-frequency cap (#8622) bench-v3 still lists project, city and form n-grams: pool → «الفيلا · درج · الارضي مجلس»; kitchen → «غرض الاعلان ايجار · ايجار سعر الوحده»; warranty → «خزانات · اسقف · الياقوت مدينه»; electricity → «العقار لا · لا يوجد خدمات». **Not one spelling variant came from the vectors**; every one added in step 4 came from the LLM comparison and SQL samples.
- If the owner wants vectors to earn their place, the next free step is **word-level** search (embed each catalogue word and every distinct corpus word/2-gram, list the nearest unknown words — «باركينج» next to «موقف»), not whole-ad similarity. Not built.

The full run's per-shard lists tell the same story: pool → «الارضي مجلس · المهديه مدينه · تفاصيل الفيلا»; majlis → «الياقوت مدينه · اسقف مرتفعه · الهيكل الانشائي»; parking → «نوافذ زجاج · 1 مميزات العقار». The 394,754 stored vectors are ready for the word-level search above if the owner wants it.

## Spelling variants added (step 4, each verified on bench samples, each a selftest phrase)

«باركينج / باركنج» (parking) · «صمانات / ظمانات» (warranty; never bare «صمان» — «وادي الصمان» is a street) · digit-glued words «2مجلس», «1مطبخ» · «اربع ادور» (floors) · «اربع شقق» (apartments) · «شارع شرقي 15 م», «شارع جنوبي ١٥» (bearing before the width) · «بشارع عرض 15 متر» · «عمر العقار/ 5 سنين», «عمرها ٦سنوات», «وعمره 5 سنوات» · a utility list running across a comma («خدمات العقار: Electricity, Waters الضمانات …») · English cues «has … connections», «… included» · **owner nit:** English «car park nearby», «pool and gym nearby» → no row.

Rejected after checking samples: «2 دور» as a floor count — in every sample it was a floor *number* or a permit («رقم 25 دور علوي», «حتى 12 دور»).

## For the owner — words NOT auto-added (need a decision)

| # | words | would mean | count (bench) | question |
|---|---|---|---|---|
| 1 | «للإيجار الشهري», «ايجار شهري», «الايجار 1800 شهري» | payment_monthly = yes | 306 (LLM-only) | A monthly **rental** is not "pays monthly". Count it, or keep payment_monthly for yearly contracts paid monthly? |
| 2 | «الضمانات ومدتها: لا يوجد» (REGA form) | warranty = no | 1,692 (fleet: 28,097) | It is an explicit "none" in the form; many sellers leave the default. Keep as `false`, or treat as silent? |
| 3 | «عداد كهرباء», «عداد ماء» (no «مستقل») | electricity / water = yes | 94 | A meter implies a connection — enough for "electricity connected"? |
| 4 | «عدادات كهرباء لكل وحدة», «عداد الكهرب عدد 4 عدادات» | separate electricity meter = yes | 16 | Phrasing, not spelling. Add? |
| 5 | «غرفة حارس» | driver_room = yes (the LLM's choice) | 13 | A guard room is not a driver room — a new `guard_room` fact instead? |
| 6 | «مغسلة», «غسالة ملابس» | laundry_room = yes (the LLM's choice) | 33 | «مغسلة» is a washbasin, «غسالة» a machine. Keep out? |
| 7 | «عمر العقار 3 سنوات تقريبا», «حوالي ١٣ او ١٤ سنة» | property_age = 3 / 13 | 29 (+ 36 open bounds «اكثر من», which stay refused) | Approximate ages are refused today. Accept "about N"? |
| 8 | project / shared amenities («مرافق المشروع: تراس علوي، مسبح، نادي», «السطح مشترك لجميع سكان العماره») | balcony / pool / gym / roof = yes | — (both hand-check borderlines) | Today a project's pool counts for the unit (as in the LLM run). A shared terrace or roof too? |
| 9 | v2 catalogue from the LLM's `other:` labels | cctv (≈ 406), smart access/home (≈ 300), guard (≈ 108), central gas (71), internet (≈ 63) | — | New facts for later filter questions? |

## PDPL

- **Guard (#8633, PDPL request 10-25):** a person-name marker «بن / ابن / بنت / آل» followed by a word, in any quote or text value, drops the whole row — unless a street, road, mosque, school or similar word sits within the four words before it («طريق الملك … بن …» is an address). Tests use the placeholder «فلان».
- **Scan of existing rows** (same rule in SQL): `facts-test-2026-10-24` — 6 rows held a marker, 4 were street/place names (kept), **2 aqar `boundaries` rows held a person's name → deleted** (boundaries 297 → 295). `facts-test-2026-10-24-pilot`, `facts-words-bench-v1`, `-v2`: 0. `-v3` and the full run: 0 names — bench-v3 holds no marker; the full run holds 3 markers, all street/place names (kept).
- Contact data is stripped before any word is read (the LLM run's sanitizer, line by line); logs and artifacts carry counts and n-grams only. The quotes in this report are a few words each, as in the LLM report.

## Per platform — coverage (full run)

Counts as written by the job (the table holds 1,997 fewer rows: 626 duplicates of the same ad in a platform's residential and commercial tables, and the 1,371 rows removed by the two repairs below). `checked` = ads with at least 20 characters of text after PDPL cleaning.

| platform | ads read | checked | ≥ 1 fact | % | facts | per ad | too short |
|---|---|---|---|---|---|---|---|
| aqar | 175,062 | 175,061 | 133,488 | 76.3 | 594,612 | 3.40 | 1 |
| wasalt | 89,795 | 88,624 | 84,919 | 95.8 | 214,492 | 2.42 | 1,171 |
| dealapp | 39,354 | 39,215 | 34,129 | 87.0 | 119,877 | 3.06 | 139 |
| muhaysini | 20,467 | 20,454 | 18,447 | 90.2 | 76,772 | 3.75 | 13 |
| haraj | 12,802 | 12,779 | 12,598 | 98.6 | 66,926 | 5.24 | 23 |
| gathern | 10,464 | 9,688 | 3,788 | 39.1 | 6,024 | 0.62 | 776 |
| muktamel | 3,919 | 3,919 | 3,699 | 94.4 | 16,588 | 4.23 | 0 |
| dwelleo | 3,839 | 3,839 | 3,648 | 95.0 | 21,312 | 5.55 | 0 |
| aqarmonthly | 3,690 | 3,425 | 2,277 | 66.5 | 5,133 | 1.50 | 265 |
| rakez | 3,622 | 2,363 | 2,135 | 90.4 | 6,572 | 2.78 | 1,259 |
| tuba | 3,514 | 3,473 | 3,231 | 93.0 | 13,210 | 3.80 | 41 |
| abralosol | 2,918 | 2,918 | 2,568 | 88.0 | 5,995 | 2.05 | 0 |
| ialqarawi | 2,612 | 2,612 | 1,632 | 62.5 | 4,792 | 1.83 | 0 |
| nofodh | 2,556 | 21 | 1 | 4.8 | 2 | 0.10 | 2,535 |
| sakan | 2,554 | 2,554 | 2,536 | 99.3 | 13,495 | 5.28 | 0 |
| aqarcity | 2,098 | 2,098 | 1,882 | 89.7 | 8,339 | 3.97 | 0 |
| arkaan | 1,880 | 1,880 | 1,430 | 76.1 | 1,502 | 0.80 | 0 |
| sadiqeltajer | 1,719 | 0 | 0 | 0.0 | 0 | 0.00 | 1,719 |
| bossbih | 1,543 | 1,504 | 452 | 30.1 | 1,539 | 1.02 | 39 |
| ksaaqar | 1,458 | 1,058 | 123 | 11.6 | 143 | 0.14 | 400 |
| mustqr | 1,329 | 1,327 | 679 | 51.2 | 1,903 | 1.43 | 2 |
| aqalemhajer | 1,028 | 1,028 | 357 | 34.7 | 1,457 | 1.42 | 0 |
| alshawaf | 1,007 | 980 | 268 | 27.3 | 944 | 0.96 | 27 |
| wahadat | 994 | 122 | 0 | 0.0 | 0 | 0.00 | 872 |
| rightcompound | 885 | 885 | 793 | 89.6 | 3,272 | 3.70 | 0 |
| reinvest | 881 | 876 | 709 | 80.9 | 2,837 | 3.24 | 5 |
| sanadak | 847 | 846 | 0 | 0.0 | 0 | 0.00 | 1 |
| ashab | 613 | 447 | 73 | 16.3 | 148 | 0.33 | 166 |
| eaqartabuk | 574 | 574 | 465 | 81.0 | 1,521 | 2.65 | 0 |
| sirdab | 568 | 568 | 468 | 82.4 | 1,226 | 2.16 | 0 |
| abaad | 458 | 447 | 368 | 82.3 | 1,134 | 2.54 | 11 |
| therc | 457 | 457 | 294 | 64.3 | 1,433 | 3.14 | 0 |
| 117 more platforms | 9,474 | 8,695 | 5,045 | 58.0 | 18,312 | 2.11 | 779 |
| **total** | **404,981** | **394,737** | **322,502** | **81.7** | **1,211,512** | **3.07** | **10,244** |

**Leads for the scraper engineers (not acted on):** `nofodh` (2,556 ads, 21 with text), `sadiqeltajer` (1,719, none), `wahadat` (994, 122) store almost no description; `sanadak` (846 ads with text, 0 facts), `akariyoun` and `alsaedan` (314 each, 0 facts), `sokok` (400, 1 %) and `ksaaqar` (1,058, 11.6 %) carry text with no facts in it — worth a look at what the scraper keeps as `description` (as `aqalemhajer` / `raghdan` in the LLM report). `gathern` (39 %) is short stay descriptions.

## Verdict, fact by fact — is the free combo good enough?

"Good enough" = on the bench it agrees with the LLM where both speak (≥ 99 % for every fact below), its false-yes classes are fixed, and the LLM's extra rows are few or are things the owner's rules exclude.

| fact | verdict | why |
|---|---|---|
| kitchen, majlis, parking, roof, sanitation, elevator, laundry_room, storage, yard, water_tank, two_entrances, annex, optical_fibers, balcony, garage, basement, grill, pool, gym | **good enough** | ≥ 99.7 % same value as the LLM; LLM-only ≤ 11 %; vs source as good as the LLM |
| air_conditioner, maid_room, driver_room, car_entrance, private_entrance | **good enough** | same as the LLM (99.7–100 %); both show the same "text yes, box no" disagreement with aqar's unticked boxes (owner rule decides) |
| electricity, water_supply | **good enough** | 99.5 %+ vs source; misses 9 % / 6 % of the LLM's rows (meter mentions, "bills included" in long sentences) |
| furnished | **good enough** | 99.6 % same as the LLM (after the «مفروشة: لا …» fix); vs source false agree 121 / 7 (the LLM 105 / 34, before today's muhaysini source repair); misses 12 % of the LLM's rows |
| warranty | **good enough, owner decision** | true rows match the LLM 97.8 %; the 1,692 form «لا يوجد» rows need decision #2 |
| property_age_years | **checker better** | 84.0 % vs source (LLM 72.6 %); refuses open bounds the LLM stored as numbers |
| street_width_m, floors | **good enough (conservative)** | 94.3 % vs source (LLM 93.3 %); misses 18 % / 12 % of the LLM's rows by refusing ambiguous numbers |
| separate_electricity_meter | **good enough** | 99.9 % same; misses 10 % («عدادات لكل وحدة» — decision #4) |
| separate_water_meter | **LLM better** | misses 30 % of the LLM's rows («عداد مويه», «لكل وحدة») |
| electronic_deed | **good enough** | the LLM's extra 26 % are mostly «بصك» — a deed, not an electronic one |
| garden | **mixed** | false-yes fixed (district parks, boundaries, nearby); now misses 22 % of the LLM's rows |
| apartments_count, shops_count | **LLM better** | misses 34 % / 31 %: per-floor and totals arithmetic («كل دور شقتين») |
| boundaries | **LLM clearly better** | misses 60 % of the LLM's rows — free-form side lists |
| payment_monthly | **owner decision** | the LLM's 306 extra are monthly *rentals* (decision #1); as defined, the checker is right but thin |
| well | too few rows (51) to judge | |
| installment_available, rent_now_pay_later | not read from prose | 0 rows in the LLM run too — a platform feature |

## What the filter would get under this rule

The owner's rule (2026-10-25), counted fleet-wide on the full run against each source table's own column (`source_value`, snapshotted at read time):

| box (source column) | text says | result |
|---|---|---|
| NULL / no column | yes or no | **text** |
| false / unticked | explicitly names it | **text** (false → true) |
| true | silent | box (no change) |
| true | explicitly negates it | **CONFLICT → NULL** + flag for Quality & Repair |
| false | silent | box (no change) |

**Rule A — the current law** (`docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md`, «Prose is not a source field»): if the platform publishes the field structurally, prose is never consulted for it, and a structured NULL outranks prose. Prose fills only fields with no structured counterpart on that platform (true / false on an explicit negation / NULL). "Publishes" is measured here as: at least one active ad of the platform has a non-NULL value in that column (1,089 platform × fact pairs).

**Rule B — the coordinator's proposal** (the 5-case table above).

Every number is ads (one row per ad and fact), fleet-wide, after the two repairs.

| fact | text rows | **A:** NULL → yes | **A:** NULL → no | **A:** not used (platform publishes the box) | **B:** NULL → yes | **B:** NULL → no | **B:** no → **yes** | **B:** yes → **NULL** (conflict) | **B:** agrees with box |
|---|---|---|---|---|---|---|---|---|---|
| kitchen | 145,362 | 143 | 0 | 145,219 | 34,225 | 121 | 3,896 | **249** | 106,871 |
| electricity | 101,285 | 394 | 4 | 100,887 | 69,542 | 7 | 291 | **20** | 31,425 |
| water_supply | 95,241 | 682 | 2 | 94,557 | 64,502 | 5 | 417 | **35** | 30,282 |
| majlis | 91,031 | 35,200 | 14 | 55,817 | 88,464 | 35 | 0 | **2** | 2,530 |
| parking | 64,506 | 100 | 0 | 64,406 | 43,244 | 102 | 308 | **2** | 20,850 |
| warranty | 63,330 | 35,233 | 28,097 | 0 | 35,233 | 28,097 | 0 | **0** | 0 |
| air_conditioner | 44,263 | 542 | 0 | 43,721 | 13,436 | 222 | 5,400 | **211** | 24,994 |
| roof | 41,500 | 41,221 | 279 | 0 | 41,221 | 279 | 0 | **0** | 0 |
| elevator | 39,474 | 101 | 4 | 39,369 | 6,146 | 226 | 5,472 | **34** | 27,596 |
| maid_room | 36,304 | 93 | 0 | 36,211 | 17,596 | 12 | 3,567 | **16** | 15,113 |
| laundry_room | 30,324 | 472 | 0 | 29,852 | 19,312 | 24 | 203 | **10** | 10,775 |
| water_tank | 29,640 | 29,634 | 6 | 0 | 29,634 | 6 | 0 | **0** | 0 |
| two_entrances | 28,270 | 27,241 | 1,029 | 0 | 27,241 | 1,029 | 0 | **0** | 0 |
| separate_electricity_meter | 28,193 | 7,456 | 179 | 20,558 | 25,813 | 632 | 38 | **11** | 1,699 |
| furnished | 27,497 | 2,661 | 1,398 | 23,438 | 3,495 | 1,759 | 3,211 | **69** | 18,963 |
| yard | 27,051 | 27,016 | 35 | 0 | 27,016 | 35 | 0 | **0** | 0 |
| storage | 26,838 | 26,822 | 16 | 0 | 26,822 | 16 | 0 | **0** | 0 |
| annex | 26,431 | 26,393 | 38 | 0 | 26,393 | 38 | 0 | **0** | 0 |
| car_entrance | 17,655 | 846 | 1 | 16,808 | 2,853 | 9 | 3,616 | **1** | 11,176 |
| sanitation | 16,881 | 1,211 | 0 | 15,670 | 1,743 | 1 | 328 | **18** | 14,791 |
| balcony | 14,931 | 525 | 0 | 14,406 | 10,587 | 13 | 164 | **3** | 4,164 |
| private_entrance | 14,284 | 338 | 10 | 13,936 | 4,278 | 424 | 1,987 | **129** | 7,466 |
| driver_room | 13,186 | 28 | 0 | 13,158 | 5,042 | 34 | 1,636 | **15** | 6,459 |
| garden | 10,083 | 10,079 | 4 | 0 | 10,079 | 4 | 0 | **0** | 0 |
| pool | 8,416 | 8,391 | 25 | 0 | 8,391 | 25 | 0 | **0** | 0 |
| gym | 8,272 | 8,271 | 1 | 0 | 8,271 | 1 | 0 | **0** | 0 |
| garage | 7,142 | 7,134 | 8 | 0 | 7,134 | 8 | 0 | **0** | 0 |
| optical_fibers | 7,056 | 370 | 0 | 6,686 | 2,136 | 4 | 13 | **0** | 4,903 |
| basement | 5,384 | 5,377 | 7 | 0 | 5,377 | 7 | 0 | **0** | 0 |
| grill | 5,349 | 5,349 | 0 | 0 | 5,349 | 0 | 0 | **0** | 0 |
| separate_water_meter | 5,080 | 1,362 | 59 | 3,659 | 4,617 | 140 | 9 | **5** | 309 |
| electronic_deed | 4,001 | 3,966 | 35 | 0 | 3,966 | 35 | 0 | **0** | 0 |
| payment_monthly | 1,691 | 1,540 | 151 | 0 | 1,540 | 151 | 0 | **0** | 0 |
| well | 1,629 | 1,620 | 9 | 0 | 1,620 | 9 | 0 | **0** | 0 |
| **total** | **1,087,580** | **317,811** | **31,411** | **738,358** | **682,318** | **33,510** | **30,556** | **830** | **340,366** |

Numbers and text (the 5-case rule has no case for two different numbers, so B only fills blanks here and counts the differences for the owner):

| fact | text rows | **A:** NULL → value | **A:** not used | **B:** NULL → value | same as box | differs from box (no rule yet) |
|---|---|---|---|---|---|---|
| street_width_m | 66,866 | 21,796 | 45,070 | 28,787 | 34,551 | 3,528 |
| floors | 20,205 | 20,205 | 0 | 20,205 | 0 | 0 |
| property_age_years | 17,252 | 1,623 | 15,629 | 2,549 | 10,407 | 4,296 |
| apartments_count | 7,763 | 2,654 | 5,109 | 6,814 | 715 | 234 |
| boundaries (text) | 7,642 | 7,642 | 0 | 7,642 | 0 | 0 |
| shops_count | 2,207 | 2,207 | 0 | 2,207 | 0 | 0 |

**Reading it:** A adds 317,811 yes and 31,411 no — almost all on facts no platform has a box for (roof, warranty, water tank, two entrances, yard, storage, annex, garden, pool, gym, garage, basement, grill, well, e-deed, monthly payment), plus majlis (35,200) and the separate meters on platforms without those columns. B adds **364,507 more yes** (a NULL box on a platform that does publish the field), **2,099 more no**, turns **30,556 unticked boxes into yes**, and turns **830 ticked boxes into NULL**. Of B's 30,556 «no → yes», 29,124 are aqar (elevator 5,466 · AC 5,356 · car entrance 3,615 · maid room 3,526 · furnished 3,193 · kitchen 2,959 …) — the "unticked box" pattern both readers saw in the benchmark. Warranty «no» (28,097) is the REGA form line — decision #2 applies under both rules.

### Rule B only — what it adds: «box false, text yes», per platform (3 example quotes each, md5 order)

| platform | ads | by fact | 3 examples (the ad's own words) |
|---|---|---|---|
| aqar | 29,124 | elevator 5466 · air_conditioner 5356 · car_entrance 3615 · maid_room 3526 · furnished 3193 · kitchen 2959 · private_entrance 1963 · driver_room 1623 · water_supply 413 · sanitation 328 · electricity 290 · laundry_room 135 · parking 123 · balcony 108 · optical_fibers 13 · separate_electricity_meter 10 · separate_water_meter 3 | kitchen «ومطبخ» / furnished «مؤثثة» / elevator «مصعد» |
| wasalt | 1,265 | kitchen 908 · parking 154 · laundry_room 58 · balcony 56 · maid_room 41 · separate_electricity_meter 28 · driver_room 12 · separate_water_meter 6 · electricity 1 · water_supply 1 | kitchen «مطبخ» / balcony «بلكونات» / kitchen «ومطبخ» |
| aqarmonthly | 104 | parking 28 · private_entrance 22 · kitchen 21 · air_conditioner 20 · laundry_room 9 · elevator 4 | air_conditioner «تكييف» / laundry_room «غسيل» / elevator «مصعد» |
| dwelleo | 25 | air_conditioner 17 · furnished 6 · private_entrance 2 | furnished «مفروشة» / air_conditioner «مكيف» / air_conditioner «مكيف» |
| muhaysini | 14 | furnished 11 · kitchen 1 · elevator 1 · air_conditioner 1 | kitchen «مطبخ» / elevator «مصعد» / furnished «مفروشة» |
| dealapp | 7 | air_conditioner 4 · parking 2 · elevator 1 | air_conditioner «مكيف» / elevator «مصعد» / air_conditioner «مكيفات» |
| aqarcity | 4 | water_supply 3 · air_conditioner 1 | water_supply «والمياه» / air_conditioner «مكيفات» / water_supply «المياه» |
| aqaratikom | 4 | kitchen 4 | kitchen «مطبخ» / kitchen «مطبخ» / kitchen «مطبخ» |
| wslnaa | 2 | kitchen 2 | kitchen «ومطبخ» / kitchen «ومطبخ» |
| reinvest | 2 | laundry_room 1 · car_entrance 1 | car_entrance «مدخل سيارة» / laundry_room «غرفة غسيل» |
| nufouth | 1 | air_conditioner 1 | air_conditioner «مكيف» |
| gathern | 1 | parking 1 | parking «موقف» |
| sodasyat | 1 | driver_room 1 | driver_room «وغرفة سائق» |
| ialqarawi | 1 | kitchen 1 | kitchen «مطبخ» |
| ksaaqar | 1 | furnished 1 | furnished «مفروشه» |
| **total** | **30,556** | | |

### Rule B only — conflicts (box yes, text explicitly no → NULL), the flag list for Quality & Repair

| platform | ads | by fact |
|---|---|---|
| aqar | 595 | kitchen 167 · air_conditioner 152 · private_entrance 123 · furnished 53 · water_supply 28 · elevator 23 · electricity 16 · sanitation 11 · maid_room 7 · driver_room 6 · separate_electricity_meter 4 · majlis 2 · parking 1 · car_entrance 1 · balcony 1 |
| dealapp | 71 | kitchen 35 · air_conditioner 17 · furnished 5 · water_supply 4 · sanitation 4 · private_entrance 2 · electricity 2 · driver_room 1 · elevator 1 |
| muhaysini | 43 | air_conditioner 25 · kitchen 6 · furnished 5 · electricity 2 · laundry_room 1 · sanitation 1 · elevator 1 · water_supply 1 · maid_room 1 |
| dwelleo | 37 | laundry_room 9 · maid_room 8 · driver_room 8 · kitchen 7 · balcony 2 · elevator 1 · air_conditioner 1 · furnished 1 |
| haraj | 28 | kitchen 14 · air_conditioner 9 · elevator 2 · furnished 2 · parking 1 |
| wasalt | 16 | separate_electricity_meter 7 · separate_water_meter 5 · elevator 4 |
| reinvest | 11 | kitchen 6 · air_conditioner 4 · elevator 1 |
| tuba | 5 | furnished 3 · air_conditioner 2 |
| abaad | 4 | kitchen 2 · sanitation 2 |
| nufouth | 4 | kitchen 4 |
| aqarmonthly | 3 | private_entrance 3 |
| ibaax | 2 | water_supply 2 |
| aqalemhajer | 2 | private_entrance 1 · kitchen 1 |
| raghdan | 2 | air_conditioner 1 · kitchen 1 |
| eaqartabuk | 2 | kitchen 2 |
| therc | 2 | elevator 1 · kitchen 1 |
| ebriza | 1 | kitchen 1 |
| aqaratikom | 1 | kitchen 1 |
| aqarcity | 1 | kitchen 1 |
| **total** | **830** | |

## Cost, time, database

| | |
|---|---|
| Paid AI calls / API keys | **0 / none** |
| Actions minutes (billable) | bench-v1 18 · bench-v2 20 · bench-v3 20 · full 502 (8 shards, 497 actual) = **560** — free for a public repo on GitHub-hosted runners |
| Full run | dispatched 11:18 UTC, done 14:06 UTC = **2 h 48 min** (≈ 28 min of it waiting for free runners in a busy queue); shards took 23–138 min — the id slices were unbalanced, two shards held most of aqar and wasalt |
| Embedding speed | 384,196 ads in 18,582 runner-seconds ≈ **21 ads/s per runner**; 10,541 skipped (same text as the benchmark) |
| `listing_facts` | 17 MiB → 408 MiB (**+391 MiB**, 1.36 M rows incl. the LLM and bench runs) |
| `listing_embeddings` | 0 → 382 MiB (**+382 MiB**, 394,754 rows) |
| Database total | **+0.77 GiB** from this work (approved ≈ 0.8 GB); whole database 8,279 MB → 9,071 MB over the day, other sessions included |
| DB load | `pg_stat_activity` checked before every run and during the full run; never above the AGENTS.md thresholds from these jobs (reads paged 500 rows with a pause) |

## Caveats

- **Source values moved between the runs.** muhaysini's «مفروشة: لا» repair (#8631) landed today, so `furnished` "false vs source" differs between the LLM run (snapshotted 10-24) and the checker (10-25). Same ads, different box.
- **Hand-check contexts** were read around the quote's first occurrence in the ad.
- Labelled-age quotes sometimes carry the next form label («عمر العقار: جديد مساحة»); the value (0) is right, the quote is one word long. Cosmetic.
- bench-v3 read 10,557 ads (one was removed at source since bench-v1); its tables above already exclude the 31 rows removed by the two repairs.
- `listing_url` is NULL on full-run rows by design; nothing was written to `listing_facts_runs`.
- `listing_facts` and `listing_embeddings` are read by nothing in the product; both can be dropped at any time with no product effect.
