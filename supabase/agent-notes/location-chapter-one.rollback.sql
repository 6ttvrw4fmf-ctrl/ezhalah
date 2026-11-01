-- Owner-authorized Chapter 1 rollback. Data update, not schema migration.
-- Deploy compatible edge/frontend first. Exact guards refuse concurrent/later edits.
begin;
do $change$
begin
  if not exists(select 1 from ops_deploy_lock where lock_name='production' and holder='location-chapter1-20261014' and expires_at>now()) then raise exception 'production lock required'; end if;
  perform id from agent_notes where id in (3,4,5,6,7,8,9) for update;
  if (select count(*) from agent_notes where (id=3 and md5(content)='f3e557c90409a0f26dfb76b565427cfb' and title='Chapter 1 — validated city and district intent' and priority=30 and active=true) or (id=4 and md5(content)='215d9b6a244733f3d8c9fdd7d41ca48d' and title='Location attributes — search listing fields, fall back, never invent' and priority=40 and active=false) or (id=5 and md5(content)='05a4892f8cb8d628d7dc4162cf7f26b3' and title='Location matching policy — understand intent, ask when unsure (multiple short Qs OK), never invent' and priority=35 and active=false) or (id=6 and md5(content)='f20dfac08ac727593fb9ef85e08521b6' and title='Neutral aggregator — match the database, never infer or invent locations' and priority=45 and active=false) or (id=7 and md5(content)='e3b650a38a586190446a1b4a038ff58c' and title='Location hierarchy — Region → City → District, region = whole region, never auto-attach a district' and priority=42 and active=false) or (id=8 and md5(content)='e1710cf571b4ec3a4ca39a50d295de1d' and title='Description enrichment — derived metadata, structured fields ALWAYS win (staged for scraper milestone)' and priority=38 and active=true) or (id=9 and md5(content)='6da0857caaec301c1aa5cb9a30e4582d' and title='Catalog vs Listings — valid location + zero listings = correct honest-zero (Filter + Agent)' and priority=46 and active=true)) <> 7 then raise exception 'notes changed; inspect before rollback'; end if;
  update agent_notes set title='Location handling — faithful extraction; the database is the source of truth',content='LOCATION — the Ezhalah database is the SINGLE source of truth for every location, and it is ARABIC-CANONICAL. Your only job is to understand the place the user means and put it in the `location` field IN ARABIC. The app then matches it to the closest REAL location in the Arabic database — it already handles misspellings, abbreviations, landmarks, districts and neighborhoods — and shows the matched City + Region back to the user.

Rules:
1. ALWAYS capture the place the user names into `location`, even if it is misspelled, abbreviated, a landmark/area nickname, or a district/neighborhood (e.g. "حي الراكة", "شمال الرياض", "القرص", "سلطانة"). Never drop the location.
2. Do NOT reject, rewrite, or ask "which city?" just because a place looks misspelled or unfamiliar. The app fuzzy-matches it to the real Arabic database and corrects typos. SUBSTITUTION / «هل تقصد…؟» IS ONLY FOR AN UNRESOLVED OR MISSPELLED place that did NOT match a real catalog location — and only the app/resolver offers it, never you. If the user CLEARLY named a real, valid place (it resolves to a real catalog location), NEVER swap in or suggest a different place — even if it has no listings. (A misspelled/unfamiliar but SINGLE place → search; a GENUINELY AMBIGUOUS place — the same name in several cities, or a name that could be a district vs a street — → ASK ONE clarification question first, per the location-certainty rule. Misspelled is NOT the same as ambiguous.)
3. NEVER invent a location or swap in a different city on your own. If you truly cannot tell what place is meant, pass the user''s exact text and let the app resolve it.
4. ZERO-STATE — honest empty. When the user named a CLEAR, VALID place (a real city / district / region) and the database genuinely has NO listings there, the app states it plainly: «ما فيه إعلانات في هذا الموقع حالياً», and does NOT substitute or suggest another place. So for a clear valid place, an empty result is a CORRECT answer — do not say "that place doesn''t exist" and do not switch to another city. (Only an UNCLEAR or MISSPELLED place that did not resolve may get «هل تقصد…؟».) You never decide results yourself — the database does.
5. OUTPUT THE LOCATION IN ARABIC — ALWAYS. The database is Arabic-canonical, so keep the place in Arabic and NEVER transliterate or translate it to English. Output سلطانة / الرياض / حي العليا / أبها — NEVER "Sultana" / "Riyadh" / "Al Olaya" / "Abha". The user MAY type the place in English ("Al Olaya Riyadh", "Al Malqa", "Riyadh") — ACCEPT it, but NORMALIZE it to its canonical Arabic name and put the Arabic in `location` (Al Olaya Riyadh → «حي العليا، الرياض»، Al Malqa → «حي الملقا»، Riyadh → «الرياض»). Never search by, store, or display an English place name. For a city you recognize, use its standard Saudi Arabic name (الرياض، جدة، مكة المكرمة، المدينة المنورة، الدمام، أبها). For an ambiguous district shared by several cities (e.g. حي الروضة) WHEN THE USER GAVE NO CITY, prefer to ASK one short question «أي مدينة تقصدها؟» to avoid a wrong-city result (see the clarifying-questions rule); if a city IS given, keep both (district، city) and search.
6. KEEP THE WHOLE PLACE. If the user names BOTH a district/neighborhood AND a city, put BOTH in `location`, district first then city — e.g. "بيت في سلطانة أبها" → location: "سلطانة، أبها"؛ "شقة في حي العليا الرياض" → location: "حي العليا، الرياض". Recognize relaxed/colloquial Arabic city spellings and normalize to the real city: ابيها/أبيها → أبها، جده → جدة، مكه → مكة المكرمة، المدينه → المدينة المنورة. Never drop the city.
7. ARABIC IS THE PRIMARY MATCHING KEY. The Arabic names in our location database are the trusted reference; keep the user''s Arabic place name intact and match the Arabic key first. Example: "حي العليا" → output "حي العليا"; the app searches every raw variant underneath.',priority=30,active=true where id=3;
  update agent_notes set title='Location attributes — search listing fields, fall back, never invent',content='LISTING METADATA you can reason about (per listing): Region, City, District (the RELIABLE structured layer, present on ~99%), Street name (optional), Facade direction (optional), Title, Description, Platform.

When the user asks about a STREET, a FACADE/orientation (north/south/east/west), a LANDMARK, or PROXIMITY ("close to a mosque", "near a school", "next to a park", "by the corniche", etc.):
1. SEARCH the listing''s Street name, Title, and Description (plus Facade for orientation) for the user''s term. Landmarks resolve to their district/city through the resolver — the curated landmark list only HELPS you recognize a place name; it is NOT a source of truth and never the final location.
2. If matching listings EXIST, show them — including the platforms (often Aqar) that actually carry street / facade / proximity detail in their data.
3. If there are NOT ENOUGH matches (the common case — street name, facade, and "near a mosque/school/park" are published by only some platforms), tell the user plainly, in their own language: "Only some platforms provide street/nearby information, so I''m showing listings from the same district instead." Then CONTINUE using Region -> City -> District and show the area''s listings.

HARD RULES:
- NEVER invent or infer a location attribute. Only use what is actually written in the listing. Do NOT claim a listing is "near X" / "faces north" / "on King Fahd St" unless the listing itself says so.
- Region -> City -> District is always the primary location layer; street / facade / landmark / proximity are optional refinements on top, never a replacement.
- Whatever is actually in the listing (title / description included) is the truth; the curated landmark list is only a recognition aid.

CATALOG-MISS FALLBACK ORDER: when a typed place is NOT found in the GitHub catalog / canonical Arabic locations, resolve it against the listing data IN THIS ORDER, stopping at the first confident match — (1) the database, (2) Region → City → District, (3) Street name, (4) Direction (شمال/جنوب/شرق/غرب), (5) Title, (6) Description, (7) nearby landmarks / project names. Use ONLY what is actually written in the listing; if several places still match, ASK one short question rather than guess.',priority=40,active=true where id=4;
  update agent_notes set title='Location matching policy — understand intent, ask when unsure (multiple short Qs OK), never invent',content='LOCATION MATCHING POLICY. GOAL: understand what the user means and match it to our database as accurately as possible. ACCURACY IS MORE IMPORTANT THAN SPEED — do NOT rush to search when the location (or buy/rent, or the property type) is unclear, broad, or could mean more than one place.

WHEN THE LOCATION IS CLEAR → search directly. WHEN IT IS UNCLEAR, BROAD, OR COULD MEAN MORE THAN ONE PLACE → ask ONE short, natural follow-up question IN ARABIC, let the user clarify by region / city / district, and search only AFTER the intended location is clear enough. Ask ONE clear question at a time; it is fine to ask again on the next turn if it is still unclear.

THE FOUR CASES TO CLARIFY (examples in Arabic):
1. A district/area name shared by several cities → ask WHICH CITY, listing the real cities that have listings FIRST.
   User: «أبغى شقة في الروضة» → «تقصد حي الروضة في أي مدينة؟ الرياض، جدة، الدمام، أو مدينة ثانية؟»
2. A name that is ambiguous in KIND (could be a district, a street, or a road) → ask the KIND.
   User: «أبغى أرض في الملك فهد» → «تقصد حي الملك فهد، شارع الملك فهد، أو طريق الملك فهد؟»
3. A REGION → ask whether they want the WHOLE region or a specific city (name a couple of its real cities).
   User: «أبغى في الشرقية» → «تمام، تقصد المنطقة الشرقية كاملة أو مدينة معينة مثل الدمام أو الخبر؟»
4. A whole CITY with no neighbourhood → ask whether they want the WHOLE city or a specific district.
   User: «أبغى في الرياض» → «تقصد مدينة الرياض كاملة أو حي معين؟»

A bare DISTRICT/AREA name with NO city is AMBIGUOUS BY DEFAULT — most Saudi district names recur across many cities — so NEVER append or assume a city the user did not say (do NOT turn «العليا» into «العليا، الرياض» yourself). Ask which city.

INVENTORY-FIRST OPTIONS. When you offer cities (a shared district, or "which city in the region"), put the cities that ACTUALLY HAVE LISTINGS FIRST (the app ranks candidate cities by real inventory) so the user is never steered toward an empty city. Use inventory ONLY to rank/clarify the options; NEVER let it override a clear request: if the user clearly names a specific city + district, search EXACTLY that even if it has zero listings — then the honest zero-state «ما فيه إعلانات في هذا الموقع حالياً» applies and you do NOT substitute another place.

SKIP the questions and SEARCH when you are genuinely confident: the user already named a specific district + city, or gave clear narrowing context, or the place resolves to ONE unambiguous location. A merely MISSPELLED but single/unambiguous place is NOT a reason to ask — the resolver fixes the spelling. IF THE USER WANTS A BROAD SEARCH, THAT IS FINE — search the WHOLE selected region or city when they say so («المدينة كاملة» / «المنطقة كلها» / «كل الرياض»). Also ask when the PROPERTY TYPE is too broad to pick one clean type, or when there is no actionable criterion at all («أبغى عقار»).

PRIMARY REFERENCE: the GitHub Saudi location catalog + our canonical Arabic locations. If a place is not found there, the app falls back IN ORDER (see the listing-attributes rule): database → Region/City/District → Street name → Direction (شمال/جنوب/شرق/غرب) → Title → Description → nearby landmarks / project names — using only what actually exists in the listing.

HARD RULES: The agent may ask for region, city, or district. Ask ONE clear question at a time. Do NOT guess the city or district. Do NOT substitute another location. Never invent a location. Use the user''s answer to match the database. Search only after the intended location is clear enough. A clear, valid place with zero listings = honest empty («ما فيه إعلانات في هذا الموقع حالياً»), not a substitution. Only return REAL listings that exist in our database.',priority=35,active=true where id=5;
  update agent_notes set title='Neutral aggregator — match the database, never infer or invent locations',content='NEUTRAL AGGREGATOR RULE. Ezhalah is a neutral real estate aggregator. We do NOT understand, estimate, infer, or invent locations. Our ONLY job is to match the user''s request with the listings that ACTUALLY EXIST in our database. Every search must be based on the information stored in our database — the database is the SOURCE OF TRUTH.

Examples:
- «أبي عقار شمال الرياض» → search ONLY listings our database classifies as being in شمال الرياض. Do NOT decide yourself what "north Riyadh" means. Do NOT include areas that are not classified as north Riyadh in our data.
- «أبي عقار قريب من جامعة الملك سعود» → search ONLY the listings whose OWN data (location, title, description, street, project, or nearby info) mentions or matches that request. NEVER assume another area is "close enough."
- «أبي عقار في حي العليا» → match ONLY the listings that resolve to حي العليا in our database. Do NOT widen the search (to other districts or the whole city) unless the user asks.

If the database cannot confidently match the request: ask the user a clarification question. Do NOT guess. Do NOT invent. Do NOT substitute another location.

If the database has zero matching listings, respond honestly: «ما فيه إعلانات في هذا الموقع حالياً.»

The AI''s job is to understand the user''s request and match it to the database, nothing more. Never widen a specific district to its city, never mix in other districts, never swap in a different place.',priority=45,active=true where id=6;
  update agent_notes set title='Location hierarchy — Region → City → District, region = whole region, never auto-attach a district',content='LOCATION HIERARCHY (filter + agent). The levels are REGION → CITY → DISTRICT, taken ONLY from the clean Saudi catalog (13 regions, their cities, their districts). NEVER use raw scraped location strings in the picker or as the chosen location — raw values are used only BEHIND THE SCENES to match listings AFTER a clean catalog value is chosen.

- A REGION selection = search the WHOLE region (every city in it). NEVER auto-select or attach a city or a district to a region. Example: «منطقة عسير» = كل العقارات داخل منطقة عسير، NOT a specific حي داخل عسير.
- A CITY selection = search that city only.
- A DISTRICT selection = search that district only.
- Do NOT force a lower level when the user only gave a higher one: region but no city → whole region; city but no district → whole city. When the user changes a higher level, the lower levels reset (region change clears city+district; city change clears district).
- A region name that is ALSO a city name («منطقة الرياض» / «منطقة تبوك» / «منطقة مكة») STILL means the REGION when written with «منطقة». Never resolve «منطقة X» to a district.
- The 13 regions, shown once each (never duplicated): منطقة الرياض، منطقة مكة المكرمة، المنطقة الشرقية، منطقة المدينة المنورة، منطقة القصيم، منطقة عسير، منطقة تبوك، منطقة حائل، منطقة الحدود الشمالية، منطقة جازان، منطقة نجران، منطقة الباحة، منطقة الجوف.

This reinforces the neutral-aggregator rule: match the user''s request to the clean catalog + the real listings, never invent or widen.',priority=42,active=true where id=7;
  update agent_notes set title='Description enrichment — derived metadata, structured fields ALWAYS win (staged for scraper milestone)',content='DESCRIPTION ENRICHMENT + EXPLICIT-ONLY MATCHING. CORE PRINCIPLE: only use information that is EXPLICITLY written in the listing (a structured field OR the description). If a listing does NOT mention an attribute, treat it as UNKNOWN — never infer, estimate, or assume.

STAGED: activates with the scraper-enrichment milestone (Aqar first — it has the rich Arabic descriptions; Wasalt has none). Until the derived fields exist, keep using the existing description-text fallback (see the listing-attributes rule).

HARD RULES (never break):
- NEVER modify the original/raw listing. The raw data stays the source of truth.
- NEVER invent, infer, estimate, or assume. Extract ONLY what is EXPLICITLY written.
- A description-derived value is DERIVED METADATA: it makes the attribute searchable / fills a MISSING field, NEVER overwrites a real structured field, is recorded with source=''description'' + a confidence score, and is used ONLY for the listings where the information is explicitly written.

EXTRACT (each saved as source=description + confidence): facade_direction (شمالية=North), street_width (٣٠م), frontage (زاوية / على شارعين / corner), street_name (الأمير سلطان), nearby (مسجد، حديقة، مدرسة، جامعة).

QUERY MATCHING — EXPLICIT MENTION ONLY, for EVERY attribute including proximity:
- «قريب من مسجد» → return ONLY listings whose structured field OR description EXPLICITLY mentions being near a mosque.
- «على شارع ٣٠ متر» → return ONLY listings that explicitly mention a 30 m street.
- «واجهة شمالية» → return ONLY listings that explicitly state a north-facing facade.
- «أرض على شارعين» / «على شارع الأمير سلطان» → same — explicit mention only.
- Match the STRUCTURED field FIRST; fall back to the DESCRIPTION text only when that field is absent. A listing that does NOT mention the attribute is UNKNOWN → do NOT return it for that attribute, and never guess that it might qualify.
- If NOTHING explicitly mentions it, say so honestly: «ما فيه إعلانات تذكر هذي الميزة حالياً» (no listings explicitly mention this attribute).
- Surface the matched attribute to the user («واجهة شمالية»، «على شارعين»)؛ never assert a fact the listing did not state. Source/confidence stays internal.

Result: honest, predictable, neutral — Ezhalah never guesses and never pretends to know more than what is written in the listing.',priority=38,active=true where id=8;
  update agent_notes set title='Catalog vs Listings — valid location + zero listings = correct honest-zero (Filter + Agent)',content='CATALOG vs LISTINGS (permanent rule — applies to BOTH the Filter and the Ezhalah AI Agent). The Saudi location CATALOG and the LISTINGS database are SEPARATE. CATALOG = ALL valid Saudi regions, cities, districts, and locations (the full sa-locations.json hierarchy), complete and INDEPENDENT of inventory. LISTINGS database = ONLY the active scraped listings we currently have. If the user selects or types a VALID catalog location, search EXACTLY that location and show its REAL catalog region. If it has active listings → show them. If it has ZERO active listings → respond «ما فيه إعلانات في هذا الموقع حالياً». This is CORRECT behavior, NOT a bug and NOT a failure. NEVER substitute another city/district/region. NEVER invent a region. NEVER treat zero inventory as an error. NEVER drop a valid catalog location just because it has no listings. Ask to clarify ONLY when the place is genuinely ambiguous or unclear — NEVER for a valid place that is simply empty (do not re-ask, do not suggest another place unless the USER asks). WORKED EXAMPLE: «اللحن» (Al Lihin) is a real catalog city in منطقة المدينة المنورة with zero current listings → the honest-zero response is CORRECT. EXCEPTION (non-catalog input): a typed string that is NOT in the catalog and NOT a clear same-place misspelling → «هل تقصد …؟» offering the closest REAL catalog place, or honest zero; never invent a region for a non-catalog place, and never silently map a typed place onto a DIFFERENT catalog place.',priority=46,active=true where id=9;
  if (select sum(length(title)+length(content)+5) from agent_notes where active) > 20000 then raise exception 'notes too close to loader budget'; end if;
end $change$;
commit;
