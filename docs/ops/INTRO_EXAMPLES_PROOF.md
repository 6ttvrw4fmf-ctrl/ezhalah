# Rotating composer examples — parser-truth proof artifact

Owner brief 2026-08-23 (§5 / addendum): **a rotating marketing example may only ship if its intended
parsed state is proven against the real production search pipeline.** This file is that proof, and
it is machine-enforced: `scripts/verify-intro-rotator-contract.ts` (in `npm test`) fails CI if any
sentence in `src/data/introExamples.ts` does not appear VERBATIM in the PROVEN table below — so a
future edit that adds an unproven example turns CI red until the proof is re-run and recorded here.

## Method

Each sentence was POSTed to the **production** `agent` edge function
(`https://aannarbkwcymrotzwdbo.supabase.co/functions/v1/agent`) with the exact body the app sends
(`src/data/agent.ts` `callAgentBackend`: `{text, locale:'ar', loggedIn:false, order, history:[]}`),
**3 repetitions per sentence** (2026-08-23). A sentence PASSES only if every asserted field below
came back identical on all 3 runs. Deterministic client-side layers (`queryFromBackend`,
`resolveDistrictsFromText`, `parseProximity`, `parseSizeRange`, the official `sa-locations.json`
catalog) were verified from source / executed directly where noted. Price semantics: the agent
path's single price slot is a **ceiling by design** (edge `extractPrice` + SYSTEM prompt), and a
single stated size becomes a **±15% band** (`parseSizeRange`) — both are the documented product
behaviors these examples are worded around.

## PROVEN — shipped examples (3/3 identical reps)

| # | Example (verbatim) | Proven parse (edge query, stable 3×) |
|---|---|---|
| 1 | أبي فيلا شمال الرياض | type=Villa, loc=شمال الرياض, deal=Both (unstated); client expands شمال الرياض → north-Riyadh district list (`resolveDistrictsFromText`, regex-proven) |
| 2 | أبي شقة في الرياض ثلاث غرف بحدود ٨٠ ألف بالسنة | Apartment, الرياض, detail=3, price=80000, rentPeriod=annual, priceIsAnnual — Arabic-Indic ٨٠ + word ثلاث both exact |
| 3 | دور لي مستودع في الدمام | Warehouse, Dammam, deal=Both (unstated) |
| 4 | أبي شقة شهرية في الخبر، غرفتين، بحدود ٥٥٠٠ ريال بالشهر | Apartment, الخبر, detail=2 (غرفتين), rentPeriod=monthly, price=66000 (5,500 × 12 — the documented monthly→annual compare), priceIsAnnual |
| 5 | أبحث عن أرض سكنية في جدة مساحتها ٥٠٠ متر | Residential Land, جدة, Buy, detail=500 (size → ±15% band, price stays empty) |
| 6 | دور لي شقة رخيصة في جدة | Apartment, جدة, sort=price_asc (رخيصة → objective cheapest-first, stable 3×) |
| 7 | أبي فيلا للبيع شمال الرياض، خمس غرف، وميزانيتي إلى ٣ مليون | Villa, Buy, شمال الرياض (+district expansion), detail=5+, price=3000000 |
| 8 | دور لي استراحة في الرياض | Rest House, Riyadh |
| 9 | أبي عقار للبيع في حي العارض بحدود مليون ونص | Buy, loc=حي العارض (bare district — catalog-unique: exactly 1 hit in sa-locations.json, so it resolves without a guess), price=1500000 (مليون ونص exact) |
| 10 | أبي مكتب للإيجار في الرياض مساحته حول ١٥٠ متر | Office, الرياض, Rent, detail=150 (حول → the documented ±15% size band) |
| 11 | شقة شهرية في الخبر | Apartment, الخبر, rentPeriod=monthly |
| 12 | دور لي شقة سنوية في جدة، ثلاث غرف، وميزانيتي ٩٠ ألف | Apartment, جدة, detail=3, rentPeriod=annual, price=90000 |
| 13 | أبي مصنع للإيجار في المنطقة الشرقية | Factory, المنطقة الشرقية (region scope), Rent |
| 14 | شقة غرفتين في مكة | Apartment, مكة, detail=2 |
| 15 | أبي مستودع في الدمام وإيجاره أقل من ٢٠٠ ألف بالسنة | Warehouse, الدمام, Rent, price=200000, rentPeriod=annual |
| 16 | أبي شاليه للإيجار في جدة | Chalet, جدة, Rent |
| 17 | أبي فيلا ما تتجاوز ٣,٠٠٠,٠٠٠ ريال | Villa, Buy, price=3000000 (Arabic-Indic comma-separated ٣,٠٠٠,٠٠٠ exact) |
| 18 | أبي مكتب للإيجار في حي العليا بالرياض | Office, Rent, loc=حي العليا، الرياض (user named both → kept; bare «العليا» alone is 14-way ambiguous in the catalog, which is why this example carries the city) |
| 19 | أرض للبيع في الرياض | Residential Land, Buy, الرياض |
| 20 | أبحث عن أرض سكنية في الرياض وميزانيتي مليون ونص | Residential Land, Buy, الرياض, price=1500000 |
| 21 | أبي شقة شهرية في جدة قريبة من البحر | Apartment, جدة, rentPeriod=monthly; client `parseProximity` (executed directly) → `{relationship:near, category:sea}` + sea keyword terms (بحر/كورنيش/واجهة بحرية) feed the keyword filter, which by design shows real text-matches when they exist and otherwise keeps the area with an honest note — never invents proximity |
| 22 | أبي شقة ٣ غرف في الدمام | Apartment, الدمام, detail=3 (Western digit form) |
| 23 | ميزانيتي ١٢٠ ألف بالسنة وأبي مكتب بالرياض | Office, الرياض, Rent, price=120000, rentPeriod=annual (budget-first word order parses too) |
| 24 | أبحث عن محل للإيجار في الرياض | Shop, الرياض, Rent |
| 25 | أبي شقة شهرية ما تتعدى ٦ آلاف ريال | Apartment, rentPeriod=monthly, price=72000 (٦ آلاف × 12), priceIsAnnual; no city → searches all of Saudi (documented behavior, never an invented city) |

## FAILED / DROPPED — candidates that would have been lies (do NOT re-add without new proof)

| Candidate (owner pool) | Probe result — why it was dropped |
|---|---|
| «أبي فيلا عمرها أقل من خمس سنوات …» (property age) | Age is silently IGNORED on the AI free-text path: the edge query has no age field (`BackendQuery`), probe returned a plain Villa/Riyadh search with the age constraint dropped. Age is an Advanced-Filter capability, not an AI-parse promise. |
| «شقة مفروشة …» (furnished) | مفروشة silently ignored — no furnished capture on the agent path (probe: plain monthly apartment query). |
| «… أربع حمامات أو أكثر» (bathrooms) | No bathroom field exists on the agent path (`BackendQuery`); bathMin is interview/AF-only. |
| «بين ١٢٠ و١٨٠ متر» (area range) | Actively MISPARSED: probe returned price=180000 — the area range's upper bound became a BUDGET. Single sizes only. |
| «من ٦٠ إلى ٩٠ ألف» (price range promising a minimum) | The agent price slot is a ceiling ONLY (documented in the edge source + `verify-agent-price-range-ceiling.ts`): a range takes the max as ceiling and the stated minimum is not enforced. Ceiling wording (أقل من / بحدود / ما يتجاوز / إلى) is used instead. |
| «شارع عرضه ٢٠ متر» (street width), «جهة شمالية» (facing) | No street-width/direction capture on the agent path — AF cohort features only. |
| «أبي دوبلكس …» | Model maps دوبلكس → Villa (matching the ingestion fold), so results are ALL villas — over-broad vs. the specific promise. |
| «سكن عمال …» | Probe returned invented type "Staff Housing" (not canonical) → client normalizes to no type; unreliable. |
| «فيلا جديدة» | جديدة becomes sort=newest (newest LISTINGS) — not "newly built" (age). Ambiguous promise, dropped. |
| «فيها مسبح / بمدخل سيارة ومطبخ / بمدخل خاص وموقف» (amenities) | No amenity capture on the agent free-text path (amenities are interview/AF answers). |
| Foreign-currency budgets (USD/AED/…) | Conversion code exists (pinned approx rates) but the owner's bar is "proven + genuinely supported"; not needed for the Saudi audience, so none shipped. |
| «أبي مكتب في العليا» (bare العليا) | «العليا» has 14 catalog hits across cities → triggers a which-city clarification rather than a direct search; the shipped version names الرياض. |

Raw probe outputs (full JSON, 3 reps each) were captured in the implementing session
(2026-08-23, PR: feat/ai-intro-rotating-examples); re-run the probe by POSTing the sentences to the
edge function as described above.
