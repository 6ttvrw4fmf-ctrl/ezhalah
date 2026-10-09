# Website picker logos and listing locations

Owner requirement (2026-10-08, final clarification): Arabic is the current goal. One short sentence describes **where the site's listings are and its verified listing focus**, helping users choose one or more websites to search exclusively. Office addresses do not establish listing coverage. Selecting a website saves immediately and slides the picker down without a «تم» button; reopening allows further selections, × also closes it, selected logos appear alone on a transparent control with no rounded logo tiles or visible names (pale artwork uses a small dark green backing without tinting), and reopening preserves checkmarks. The all-sites icon is the eagle magnifier. The picker is a restrained bottom sheet with uniform 96×48 logo frames with artwork fitting 88×40, plain rows with a dark green checkmark only; no selection fill, border or logo recoloring, only pale artwork receives a contrast backing, and no confirmation footer. The layout is a simple full-width scrollable list: nationwide coverage first, then regional sections, followed by multi-region and unclassified sites. Each website appears once. An explicit all-sites choice clears inherited conversation/refinement source restrictions; untouched picker state continues to accept free-text source requests.

Use the collected official logo ZIP unchanged and preserve original proportions. The picker uses 142 matched pack logos; seven absent from the ZIP retain their existing artwork.

Coverage was measured at 2026-10-08T21:34:05.864Z through production's RLS-respecting `top_cities_by_deal_ar` RPC with `p_deal: null` and the website's platform slugs. Aqar includes its Aqar Monthly vertical. `total_in_cohort` is the denominator; group city counts by their canonical region. No office addresses or business descriptions are used to infer inventory coverage.

`src/lib/platformCoverageSentence.ts` derives the sentence: a city holding the entire cohort gets a city sentence; a sole region covering at least 95% gets a regional sentence; a region with at least 70% gets “أغلب”; otherwise six or more regions gets “مختلف مناطق المملكة”; a smaller scope with a strict regional majority gets “أغلب”; other scopes list up to three observed regions. Unknown/empty location breakdowns get an explicit unavailable-location sentence, never invented nationwide coverage or a claim of no listings.

The Alhoshan fallback names regions in actual visible source listings (Riyadh/Badr; Qassim/Shamasiyah and Buraidah; Eastern/Khobar), observed in a real browser on 2026-10-08. It makes no majority claim and does not use the office's Al Mithnab address.

Refresh the measured snapshot when coverage changes with `node --experimental-strip-types scripts/generate-platform-picker-coverage.ts`. Reads are bounded, sequential and paced below the documented sustained-search ceiling. A failed request refuses to replace the snapshot; a successful empty city breakdown does not assert empty inventory. This snapshot is measured evidence, not a live per-picker request.

The original PNG bytes stay unchanged. Regenerate layout measurements with `python3 scripts/measure-platform-picker-logos.py`. `platformPickerLogoLayout.json` measures visible bounds to position artwork within equal 96×48 slots: visible artwork fits 88×40 without distortion. Pale artwork uses a small dark green backing; no logo receives a display tint. Deal uses its original yellow listing-card asset. Selection applies immediately and closes the sheet (owner clarification, 2026-10-08). Focus describes the measured inventory mix, not a company-wide exclusivity claim, and comes from Residential/Commercial cohort counts using the same public RPC: ≥70% describes the dominant category, otherwise both categories are named. Missing counts are unknown, not proof a category is absent.

| Site | Official source | Arabic location sentence | Evidence |
| --- | --- | --- | --- |
| Aqar | https://sa.aqar.fm | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 172627 in cohort; 184 cities; 13 regions |
| Wasalt | https://wasalt.sa | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 80318 in cohort; 158 cities; 13 regions |
| Aldarim | https://aldarim.sa | عقارات سكنية بالدرجة الأولى، أغلبها في منطقة الرياض. | 162 in cohort; 9 cities; 3 regions |
| Aqargate | https://aqargate.com | عقارات سكنية وتجارية في مختلف مناطق المملكة. | 174 in cohort; 22 cities; 9 regions |
| Alhoshan | https://alhoshan.sa | عقارات في منطقة الرياض، منطقة القصيم، المنطقة الشرقية. | Visible source listing locations |
| Hajer | https://hajerhouses.com | عقارات سكنية في المنطقة الشرقية. | 121 in cohort; 2 cities; 1 regions |
| Sanadak | https://sanadak.sa | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 807 in cohort; 45 cities; 13 regions |
| Eastabha | https://eastabha.sa | عقارات سكنية بالدرجة الأولى، أغلبها في منطقة عسير. | 168 in cohort; 11 cities; 4 regions |
| Aqarcity | https://aqarcity.net | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 1762 in cohort; 62 cities; 13 regions |
| Raghdan | https://raghdan.sa | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 380 in cohort; 15 cities; 9 regions |
| Eaqartabuk | https://eaqartabuk.com | عقارات سكنية بالدرجة الأولى في تبوك. | 563 in cohort; 1 cities; 1 regions |
| Satel | https://satel.sa | عقارات سكنية في الرياض. | 66 in cohort; 1 cities; 1 regions |
| Sadin | https://sadin.com.sa | بيانات نطاق العقارات غير متاحة حالياً. | No usable city breakdown; no coverage claim |
| Mustqr | https://mustqr.sa | عقارات سكنية بالدرجة الأولى في حائل. | 1283 in cohort; 1 cities; 1 regions |
| Ramzalqasim | https://ramzalqasim.com | عقارات سكنية في منطقة القصيم. | 108 in cohort; 8 cities; 1 regions |
| Fursaghyr | https://fursaghyr.com | عقارات سكنية، أغلبها في منطقة مكة المكرمة. | 9 in cohort; 7 cities; 5 regions |
| Jazwtn | https://jazwtn.sa | عقارات سكنية في منطقة جازان. | 108 in cohort; 3 cities; 1 regions |
| Mizlaj | https://mizlaj.com.sa | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 33 in cohort; 10 cities; 7 regions |
| Aqaratikom | https://nawait.sa | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 123 in cohort; 12 cities; 6 regions |
| Al Khaas | https://alkhaas.net | عقارات سكنية بالدرجة الأولى في عنيزة. | 209 in cohort; 1 cities; 1 regions |
| Abeea | https://abeea.com.sa | عقارات سكنية بالدرجة الأولى في المنطقة الشرقية. | 162 in cohort; 6 cities; 1 regions |
| Jurash | https://jurash.sa | عقارات سكنية في منطقة عسير. | 11 in cohort; 2 cities; 1 regions |
| Gathern | https://gathern.co | عقارات سكنية في مختلف مناطق المملكة. | 5183 in cohort; 73 cities; 13 regions |
| Deal App | https://dealapp.sa | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 17915 in cohort; 141 cities; 13 regions |
| 24 Souq | https://24.com.sa | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 46 in cohort; 16 cities; 7 regions |
| Era Pulse | https://erapulse.sa | عقارات سكنية بالدرجة الأولى في منطقة القصيم. | 42 in cohort; 4 cities; 1 regions |
| Al Nowaisiry | https://alnowaisiry.com | عقارات سكنية، أغلبها في منطقة الرياض. | 16 in cohort; 2 cities; 2 regions |
| 1 October | https://1october.com.sa | عقارات تجارية بالدرجة الأولى في منطقة مكة المكرمة. | 5 in cohort; 2 cities; 1 regions |
| Muktamel | https://muktamel.com | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 4874 in cohort; 64 cities; 13 regions |
| Arkaan | https://arkaanalaqar.com | عقارات سكنية بالدرجة الأولى في الهفوف. | 1791 in cohort; 1 cities; 1 regions |
| Abralosol | https://abralosol.com | عقارات سكنية بالدرجة الأولى في المنطقة الشرقية. | 2796 in cohort; 4 cities; 1 regions |
| THERC | https://therc.sa | عقارات سكنية بالدرجة الأولى، أغلبها في منطقة الرياض. | 457 in cohort; 10 cities; 4 regions |
| Rawasi Dark | https://rawasi-dark.com | عقارات سكنية بالدرجة الأولى، أغلبها في المنطقة الشرقية. | 101 in cohort; 7 cities; 3 regions |
| Aouj | https://aoujestates.com | عقارات سكنية بالدرجة الأولى في المنطقة الشرقية. | 70 in cohort; 4 cities; 1 regions |
| Bahadhabab | https://bahadhabab-res.com | عقارات سكنية بالدرجة الأولى في الباحة. | 53 in cohort; 1 cities; 1 regions |
| Alobid | https://alobidoffice.com | عقارات سكنية بالدرجة الأولى في حائل. | 101 in cohort; 1 cities; 1 regions |
| Abwbna | https://abwbna.com | عقارات سكنية بالدرجة الأولى في المنطقة الشرقية. | 138 in cohort; 2 cities; 1 regions |
| Remal | https://remalre.com | عقارات سكنية بالدرجة الأولى في منطقة مكة المكرمة. | 81 in cohort; 2 cities; 1 regions |
| Amaall | https://amaall.com | عقارات سكنية بالدرجة الأولى، أغلبها في منطقة مكة المكرمة. | 32 in cohort; 7 cities; 4 regions |
| AqarAlSaudia | https://aqaralsaudia.com | بيانات نطاق العقارات غير متاحة حالياً. | No usable city breakdown; no coverage claim |
| Amlakalahsa | https://amlakalahsa.com | عقارات سكنية في المنطقة الشرقية. | 263 in cohort; 10 cities; 1 regions |
| Alta | https://alta.com.sa | عقارات سكنية، أغلبها في منطقة مكة المكرمة. | 7 in cohort; 2 cities; 2 regions |
| Shmou Al Shmal | https://shmoua-alshmal.com | عقارات سكنية في تبوك. | 6 in cohort; 1 cities; 1 regions |
| Awal | https://awaalun.com | عقارات سكنية بالدرجة الأولى في عرعر. | 51 in cohort; 1 cities; 1 regions |
| Azdad | https://azdadalaqaria.com | عقارات سكنية بالدرجة الأولى في أبها. | 25 in cohort; 1 cities; 1 regions |
| Suwar | https://suwar.sa | عقارات سكنية في منطقة مكة المكرمة. | 97 in cohort; 2 cities; 1 regions |
| Rakez | https://rakez.sa | عقارات سكنية، أغلبها في منطقة الرياض. | 3248 in cohort; 6 cities; 5 regions |
| Akariyoun | https://akariyoun.sa | عقارات سكنية بالدرجة الأولى في الرياض. | 300 in cohort; 1 cities; 1 regions |
| KSA Aqar | https://ksaaqar.com | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 1429 in cohort; 28 cities; 11 regions |
| Sadiq Eltajer | https://sadiq-eltajer.sa | عقارات سكنية بالدرجة الأولى، أغلبها في منطقة القصيم. | 1687 in cohort; 15 cities; 3 regions |
| Toor | https://toor.ooo | بيانات نطاق العقارات غير متاحة حالياً. | No usable city breakdown; no coverage claim |
| Gudai | https://gudai.inblaj.net | عقارات سكنية وتجارية في منطقة الرياض، منطقة مكة المكرمة، المنطقة الشرقية ومناطق أخرى. | 12 in cohort; 6 cities; 4 regions |
| Safera | https://safera.inblaj.net | عقارات سكنية بالدرجة الأولى في بريدة. | 9 in cohort; 1 cities; 1 regions |
| Al Humaidan | https://al-humaidan.inblaj.net | بيانات نطاق العقارات غير متاحة حالياً. | No usable city breakdown; no coverage claim |
| Aqar Najran | https://aqarnajran.com | عقارات سكنية بالدرجة الأولى في نجران. | 39 in cohort; 1 cities; 1 regions |
| Maqam Al Wisam | https://fahadalshahri.com | عقارات سكنية في جدة. | 5 in cohort; 1 cities; 1 regions |
| CompoundIn | https://compoundin.com | عقارات سكنية، أغلبها في منطقة الرياض. | 273 in cohort; 6 cities; 4 regions |
| Waslna | https://wslnaa.com | عقارات سكنية وتجارية في منطقة الرياض. | 61 in cohort; 2 cities; 1 regions |
| Al Sidra | https://alsidra.com.sa | عقارات سكنية بالدرجة الأولى في المنطقة الشرقية، منطقة حائل، منطقة القصيم ومناطق أخرى. | 27 in cohort; 16 cities; 5 regions |
| Moftah | https://moftah-aleaqar.com | عقارات سكنية بالدرجة الأولى، أغلبها في منطقة الرياض. | 13 in cohort; 4 cities; 2 regions |
| مسار المستقبل | https://masaraqarat.com | عقارات سكنية في الرياض. | 1 in cohort; 1 cities; 1 regions |
| منصات | https://gomenassat.com | عقارات سكنية وتجارية في مختلف مناطق المملكة. | 153 in cohort; 12 cities; 6 regions |
| Sakan Saudi | https://sa.sakan.co | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 3213 in cohort; 46 cities; 13 regions |
| مكتب بوصبيح | https://bossbihoffice.com.sa | عقارات سكنية بالدرجة الأولى في الاحساء. | 1506 in cohort; 1 cities; 1 regions |
| Al Shawaf | https://alshawaf.com.sa | عقارات سكنية بالدرجة الأولى في المنطقة الشرقية. | 1005 in cohort; 6 cities; 1 regions |
| Ibrahim Alqarawi | https://ialqarawi.com | عقارات سكنية بالدرجة الأولى، أغلبها في منطقة القصيم. | 2596 in cohort; 80 cities; 13 regions |
| Al Jassim | https://aljassimaqar.com | عقارات سكنية بالدرجة الأولى في الهفوف. | 91 in cohort; 1 cities; 1 regions |
| Almotmkenah | https://almotmkenah.com | عقارات سكنية بالدرجة الأولى، أغلبها في منطقة الرياض. | 22 in cohort; 3 cities; 3 regions |
| نفوذ | https://nufouth.com | عقارات سكنية وتجارية في مختلف مناطق المملكة. | 302 in cohort; 37 cities; 10 regions |
| دويليو | https://dwelleo.sa | بيانات نطاق العقارات غير متاحة حالياً. | No usable city breakdown; no coverage claim |
| مكتب أقاليم هجر للخدمات العقارية | https://aqalemhajer.com | عقارات سكنية بالدرجة الأولى في الاحساء. | 1138 in cohort; 1 cities; 1 regions |
| سكني | https://sakani.sa | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 295 in cohort; 19 cities; 9 regions |
| الشاطري للتطوير العقاري | https://shatrirealestate.com | عقارات سكنية، أغلبها في منطقة مكة المكرمة. | 50 in cohort; 3 cities; 3 regions |
| القاسم العقارية | https://alqasem.com.sa | عقارات سكنية بالدرجة الأولى في الرياض. | 23 in cohort; 1 cities; 1 regions |
| فكر الإعمار | https://fkralemar.com | عقارات سكنية في جدة. | 10 in cohort; 1 cities; 1 regions |
| ودود العقارية | https://wadod.sa | عقارات سكنية في الرياض. | 7 in cohort; 1 cities; 1 regions |
| آل متعب العقارية | https://almuteb.sa | عقارات سكنية في الرياض. | 11 in cohort; 1 cities; 1 regions |
| البراك للعقارات | https://aalbarrak.com | عقارات سكنية في الرياض. | 9 in cohort; 1 cities; 1 regions |
| الرفاعي للعقار | https://alrifai.com.sa | عقارات سكنية في جدة. | 17 in cohort; 1 cities; 1 regions |
| سداسيات العقارية | https://sodasyat.sa | عقارات سكنية في جدة. | 13 in cohort; 1 cities; 1 regions |
| حصاد الاقتصادية للعقارات | https://hasaadestate.com | عقارات سكنية في جدة. | 12 in cohort; 1 cities; 1 regions |
| عقار الرياض | https://aqaralriyadh.com | عقارات سكنية في الرياض. | 14 in cohort; 1 cities; 1 regions |
| فقط نقطة العقارية | https://just.sa | عقارات سكنية في الرياض. | 78 in cohort; 1 cities; 1 regions |
| سنام العقارية | https://snam.sa | عقارات سكنية في الرياض. | 32 in cohort; 1 cities; 1 regions |
| جواهر للوساطة والتسويق العقاري | https://jawher2030.com | عقارات سكنية بالدرجة الأولى، أغلبها في منطقة مكة المكرمة. | 40 in cohort; 3 cities; 2 regions |
| مقر المعتمد | https://m3tmd.com | عقارات سكنية بالدرجة الأولى في الخرج. | 37 in cohort; 1 cities; 1 regions |
| سنان العقارية | https://senanrealestate.sa | عقارات سكنية في منطقة عسير. | 57 in cohort; 3 cities; 1 regions |
| الصفقة الذهبية العقارية | https://goldendeal.sa | عقارات سكنية بالدرجة الأولى، أغلبها في منطقة مكة المكرمة. | 293 in cohort; 8 cities; 5 regions |
| 1000 العقارية | https://1000.com.sa | عقارات سكنية بالدرجة الأولى، أغلبها في منطقة الرياض. | 104 in cohort; 3 cities; 3 regions |
| يمين العقارية | https://yameen.sa | عقارات سكنية، أغلبها في منطقة الرياض. | 10 in cohort; 3 cities; 2 regions |
| إبريزة العقارية | https://ebriza.com.sa | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 201 in cohort; 17 cities; 9 regions |
| علم الريادة الإدارية | https://eilmalriyada.com | عقارات سكنية بالدرجة الأولى، أغلبها في منطقة الرياض. | 266 in cohort; 5 cities; 3 regions |
| دار يوسف العقارية | https://daryusuf.com | عقارات سكنية بالدرجة الأولى، أغلبها في منطقة المدينة المنورة. | 250 in cohort; 6 cities; 3 regions |
| البداح للعقارات | https://albdah.sa | عقارات سكنية في بريدة. | 9 in cohort; 1 cities; 1 regions |
| الإيضاح | https://eydah.com | عقارات سكنية في الرياض. | 2 in cohort; 1 cities; 1 regions |
| تمايز العقارية | https://tamyaz-sa.com | عقارات سكنية في جدة. | 7 in cohort; 1 cities; 1 regions |
| حازم | https://hazim.sa | عقارات سكنية بالدرجة الأولى في المنطقة الشرقية. | 5 in cohort; 2 cities; 1 regions |
| فلل | https://villas-sa.com | عقارات سكنية بالدرجة الأولى في منطقة الرياض، المنطقة الشرقية، منطقة مكة المكرمة ومناطق أخرى. | 11 in cohort; 6 cities; 5 regions |
| مار العقارية | https://mar-ksa.com | عقارات سكنية في جدة. | 7 in cohort; 1 cities; 1 regions |
| RightCompound | https://rightcompound.com | عقارات سكنية، أغلبها في منطقة الرياض. | 884 in cohort; 8 cities; 4 regions |
| LivingCompound | https://livingcompound.com | عقارات سكنية في جدة. | 17 in cohort; 1 cities; 1 regions |
| Azure | https://azure.sa | عقارات سكنية، أغلبها في منطقة الرياض. | 32 in cohort; 2 cities; 2 regions |
| Expat Trusted Housing | https://expattrustedhousingriyadh.com | عقارات سكنية، أغلبها في منطقة الرياض. | 50 in cohort; 4 cities; 3 regions |
| Flow | https://flow.life | عقارات سكنية في الرياض. | 17 in cohort; 1 cities; 1 regions |
| أبعاد | https://app.abaadapp.sa | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 410 in cohort; 28 cities; 12 regions |
| آل سعيدان | https://alsaedan.com | عقارات سكنية بالدرجة الأولى، أغلبها في المنطقة الشرقية. | 326 in cohort; 2 cities; 2 regions |
| إيجو عقار | https://ego-aqar.com | عقارات سكنية في مختلف مناطق المملكة. | 27 in cohort; 9 cities; 6 regions |
| أحمد المحيسني العقارية | https://aqaralmuhaysini.com | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 11352 in cohort; 92 cities; 13 regions |
| نفوذ للاستثمار العقاري | https://nofodh.sa | عقارات سكنية وتجارية، أغلبها في منطقة الرياض. | 2554 in cohort; 6 cities; 5 regions |
| راز العقارية | https://razre.sa | عقارات سكنية في جدة. | 94 in cohort; 1 cities; 1 regions |
| ري إنفست | https://reinvest.sa | عقارات سكنية وتجارية، أغلبها في منطقة الرياض. | 866 in cohort; 24 cities; 8 regions |
| صفا للاستثمار | https://safainv.sa | عقارات سكنية، أغلبها في منطقة الرياض. | 44 in cohort; 2 cities; 2 regions |
| صكوك العقارية | https://sokok.sa | عقارات سكنية بالدرجة الأولى، أغلبها في منطقة القصيم. | 400 in cohort; 2 cities; 2 regions |
| سكنة | https://sukna.app | عقارات سكنية في الرياض. | 286 in cohort; 1 cities; 1 regions |
| طوبة العقارية | https://tuba.com.sa | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 4043 in cohort; 49 cities; 12 regions |
| آي باكس | https://ibaax.sa | عقارات سكنية بالدرجة الأولى، أغلبها في منطقة الرياض. | 146 in cohort; 5 cities; 3 regions |
| RE/MAX | https://remax.sa | عقارات سكنية في منطقة الرياض. | 7 in cohort; 2 cities; 1 regions |
| قمرا للتطوير العقاري | https://qmra.sa | عقارات سكنية في الرياض. | 5 in cohort; 1 cities; 1 regions |
| العجلان للتسويق العقاري | https://alajlan-re.com | عقارات سكنية بالدرجة الأولى في الرياض. | 11 in cohort; 1 cities; 1 regions |
| وحدات | https://wahadat.sa | عقارات سكنية في الرياض. | 976 in cohort; 1 cities; 1 regions |
| شركة المربعات العقارية | https://squares.com.sa | عقارات سكنية بالدرجة الأولى، أغلبها في منطقة الرياض. | 16 in cohort; 4 cities; 3 regions |
| رواف | https://rawaf.ai | عقارات سكنية في الرياض. | 19 in cohort; 1 cities; 1 regions |
| المسوق الافتراضي | https://vm-ksa.com | عقارات سكنية وتجارية في مختلف مناطق المملكة. | 191 in cohort; 13 cities; 9 regions |
| مكسب العقارية | https://macsaib.sa | عقارات سكنية وتجارية في بريدة. | 63 in cohort; 1 cities; 1 regions |
| MAQRAT | https://maqrat.com | عقارات سكنية بالدرجة الأولى، أغلبها في منطقة مكة المكرمة. | 90 in cohort; 14 cities; 5 regions |
| عرش العقارية | https://arshglobal.com.sa | عقارات سكنية بالدرجة الأولى، أغلبها في المنطقة الشرقية. | 21 in cohort; 4 cities; 2 regions |
| سوبر أوفيس | https://superoffice.sa | عقارات تجارية في الرياض. | 25 in cohort; 1 cities; 1 regions |
| شموع العقار | https://shomoalaqar.com.sa | عقارات سكنية بالدرجة الأولى في الاحساء. | 154 in cohort; 1 cities; 1 regions |
| منصة مكتب | https://maktab.sa | عقارات تجارية، أغلبها في منطقة الرياض. | 11 in cohort; 2 cities; 2 regions |
| سرداب | https://marketplace.sirdab.co | عقارات تجارية في مختلف مناطق المملكة. | 558 in cohort; 31 cities; 12 regions |
| عشاب العقارية | https://ashab.sa | عقارات سكنية وتجارية، أغلبها في منطقة القصيم. | 598 in cohort; 15 cities; 5 regions |
| منافع العقارية | https://manafe.com.sa | عقارات سكنية بالدرجة الأولى في جدة. | 77 in cohort; 1 cities; 1 regions |
| وجف العقارية | https://wajaf.sa | عقارات سكنية بالدرجة الأولى في بريدة. | 44 in cohort; 1 cities; 1 regions |
| البكيري العقارية | https://albukaeri.sa | عقارات سكنية وتجارية، أغلبها في المنطقة الشرقية. | 23 in cohort; 5 cities; 2 regions |
| ريادة العقارية | https://ryadah.com.sa | عقارات سكنية وتجارية في المنطقة الشرقية. | 18 in cohort; 3 cities; 1 regions |
| مجموعة صالح القرشي العقارية | https://sqcc.sa | عقارات سكنية بالدرجة الأولى، أغلبها في المنطقة الشرقية. | 27 in cohort; 6 cities; 2 regions |
| دارا للتطوير العقاري | https://daraa.sa | عقارات سكنية في مكة المكرمة. | 7 in cohort; 1 cities; 1 regions |
| مكتب طوية للعقار | https://tawia.sa | عقارات سكنية في الجبيل. | 5 in cohort; 1 cities; 1 regions |
| مانزو | https://manzo.com.sa | عقارات سكنية في الظهران. | 1 in cohort; 1 cities; 1 regions |
| الطابق الثامن | https://www.8floor.sa | عقارات سكنية في الرياض. | 2 in cohort; 1 cities; 1 regions |
| حلول | https://holoul.io | عقارات سكنية في الرياض. | 30 in cohort; 1 cities; 1 regions |
| السوق المفتوح | https://sa.opensooq.com | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 87 in cohort; 14 cities; 10 regions |
| معرض نافذة | https://nafithh.sa | بيانات نطاق العقارات غير متاحة حالياً. | No usable city breakdown; no coverage claim |
| مباشر | https://mobasher.sa | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 28 in cohort; 13 cities; 6 regions |
| مؤاجرة | https://muajarh.com | عقارات سكنية في الرياض. | 11 in cohort; 1 cities; 1 regions |
| دلّالي | https://dallali.com | عقارات سكنية بالدرجة الأولى، أغلبها في منطقة مكة المكرمة. | 9 in cohort; 3 cities; 2 regions |
| شركة مقام للتطوير العقاري | https://property.maqamco.sa | عقارات سكنية في الرياض. | 42 in cohort; 1 cities; 1 regions |
| تطبيق أرض | https://earthapp.com.sa | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 58 in cohort; 14 cities; 7 regions |
| نوافذ الوطن | https://nawafethalwatan.com | عقارات سكنية بالدرجة الأولى في مختلف مناطق المملكة. | 10 in cohort; 7 cities; 6 regions |

## Homepage source strip (owner, 2026-10-08)

`HomeWebsiteStrip` appears above the headline as a continuous, linear horizontal ticker, with two identical copies for a seamless loop. The owner removed the website-count caption and requested ALL 149 unique picker profiles, including Dealapp (`Deal App`, Arabic «ديل»), without registry filtering. Web images load eagerly so offscreen logos are ready before entering the strip. CSS transform animation runs on the compositor; reduced-motion users see static logos. Native uses the same full catalog and a linear Animated loop. No scraper, inventory or search eligibility changes. Picker search ignores whitespace so `dealapp` finds `Deal App`.

The picker heading is «بحث عميق» with «اختر موقعاً أو أكثر للبحث في عقاراتها فقط.» underneath (owner, 2026-10-08). «كل المواقع» is a separate plain reset option with no nationwide subtitle. This labels source-restricted search over indexed inventory; it does not claim an on-demand crawl of the selected website.
