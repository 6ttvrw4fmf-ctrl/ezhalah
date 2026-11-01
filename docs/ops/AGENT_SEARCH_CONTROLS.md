# Owner-approved agent search controls

Approved 2026-10-15. Implementation status and observed production evidence are recorded in [PR #7126](https://github.com/6ttvrw4fmf-ctrl/ezhalah/pull/7126). A merged PR alone does not establish production verification.

This supersedes Chapter 1’s city-only restriction when the user explicitly requests a region or nationwide search. Surrounding interface language remains independently selected; message language does not switch the application shell. Source listing content remains verbatim.

EZHALAH GLOBAL INSTRUCTIONS

USER-CONTROLLED SEARCH, WEBSITE SELECTION, RESULT QUANTITY AND GEOGRAPHIC COVERAGE

Priority: Mandatory

Applies to: All property-search conversations, DeepSeek Flash interpretation, backend filtering, search summaries and property cards.

1. Fundamental Principle: The User Controls the Search

Ezhalah must give users maximum control over their property searches through natural-language instructions.

The AI must understand the user’s requested search settings and translate them into the existing backend architecture.

Users may control:

1. Which supported websites to search.
2. Which websites to exclude.
3. Whether to search all supported websites.
4. How many properties to display.
5. Whether to display additional results.
6. Which page of results to display.
7. Which city to search.
8. Which districts to include.
9. Which region to search.
10. Whether to search across Saudi Arabia.
11. Property types.
12. Buy or rent.
13. Budgets.
14. Currencies.
15. Property measurements.
16. Amenities.
17. Other supported filters.

The AI must respect the user’s explicit choices whenever they are valid and supported by Ezhalah’s backend.

2. Geographic Search Levels

Ezhalah must recognize three geographic search levels:

LEVEL 1: CITY

Examples:

* الرياض
* جدة
* الدمام
* الخبر
* مكة
* المدينة

This remains the default geographic search level.

LEVEL 2: REGION

Examples:

* منطقة الرياض
* المنطقة الشرقية
* منطقة مكة المكرمة
* منطقة المدينة المنورة
* منطقة عسير
* منطقة القصيم
* منطقة تبوك
* منطقة حائل
* منطقة جازان
* منطقة نجران
* منطقة الباحة
* منطقة الجوف
* منطقة الحدود الشمالية

LEVEL 3: NATIONWIDE

Examples:

* كل السعودية
* جميع أنحاء المملكة
* المملكة العربية السعودية بالكامل
* أي مدينة بالسعودية
* Anywhere in Saudi Arabia
* Across Saudi Arabia
* Nationwide

3. City Search Remains the Default

When the user specifies a city, search that city.

Example:

“أبي شقة بالرياض.”

Search Riyadh.

Do not automatically expand to the Riyadh Region or all of Saudi Arabia.

4. Explicit Region Search

When the user explicitly requests a region, search the entire requested region.

Example:

“أبي فيلا بالمنطقة الشرقية.”

Search the Eastern Province across its supported cities and locations.

Do not restrict the search to Dammam or another individual city.

5. Explicit Nationwide Search

When the user explicitly requests all of Saudi Arabia, allow a nationwide search.

Example:

“أبي أراضي للبيع في كل السعودية.”

Search supported listings across Saudi Arabia.

Do not ask the user to select one city.

6. Never Expand Geographic Coverage Without Permission

Do not automatically change:

* City → Region.
* City → Nationwide.
* Region → Nationwide.

The user must explicitly request broader coverage.

7. Geographic Changes During Conversations

Example:

User: أبي شقة بالرياض.

Follow-up: لا، خل البحث في منطقة الرياض كاملة.

Update the geographic scope from CITY to REGION.

Preserve compatible property filters.

Example:

User: أبي أرض بالمنطقة الشرقية.

Follow-up: خلها بكل السعودية.

Update the geographic scope to NATIONWIDE.

8. Ambiguous Geographic Expressions

If the user says “الرياض”, interpret it according to established context and approved geographic mappings.

If the user explicitly says “منطقة الرياض”, use REGION.

Do not silently assume that every reference to Riyadh means the entire region.

9. Region and District Compatibility

District filters must remain geographically valid.

If a user expands from one city to an entire region, preserve district restrictions only when the user’s intent clearly requires them and the combination remains valid.

Otherwise, clarify or update the geographic filters appropriately.

10. Supported Website Selection

Users must be allowed to select specific supported real estate websites.

Examples:

“ابحث في عقار فقط.”

“أبي النتائج من واصلـت.”

“ابحث في عقار وواصلت.”

“Search only Aqar.”

“Only show listings from these two websites.”

The backend must search only the requested supported sources.

11. Multiple Website Selection

Users may select multiple supported websites.

Example:

“ابحث في عقار وواصلت فقط.”

Apply a source-inclusion filter containing those two websites.

Do not include listings from other websites.

12. Website Exclusion

Users may exclude specific websites.

Example:

“أبي شقق بالرياض بس لا تجيب لي من عقار.”

Exclude Aqar from the search.

Search the remaining supported sources.

13. Search All Supported Websites

Example:

“ابحث في كل المواقع.”

Use all supported active sources.

Do not claim Ezhalah searches every real estate website in existence.

14. Website Names and Aliases

Recognize:

* Official website names.
* Arabic names.
* English names.
* Common spelling variations.
* Approved aliases.

Match these to the backend’s canonical source identifiers.

15. Unsupported Websites

If the user requests a website that Ezhalah does not support, do not pretend it was searched.

Explain the limitation briefly.

Offer to search supported websites instead.

16. Website Selection Must Be Visible

The search summary must accurately display which websites were included or excluded.

Example:

“شقق للإيجار في الرياض، من موقع عقار فقط.”

Do not display “all websites” when the user selected one website.

17. User-Controlled Result Quantity

Users must be allowed to specify how many properties they want to see.

Examples:

* ورني ١٠ عقارات.
* أبي ٢٠ نتيجة.
* اعرض ٥٠ عقار.
* ورني ١٠٠ عقار.
* أبي ٢٠٠ نتيجة.
* Show 25 properties.
* Display 100 listings.

Interpret the requested number as the result quantity, not a property attribute.

18. Result Quantity and Backend Limits

Respect the user’s requested quantity within supported backend limits.

Do not invent a limit.

Claude must inspect the existing pagination and result-count architecture.

If the user requests more results than the backend can return in one batch, use supported pagination or batching.

19. Additional Results

Example:

User: ورني ٥٠ عقار.

Follow-up: ورني ٥٠ زيادة.

Display the next 50 matching results.

Do not restart from the first result.

20. Result Pagination

Recognize:

* الصفحة الثانية.
* الصفحة الثالثة.
* النتائج التالية.
* كمل.
* ورني زيادة.
* Next page.
* Show more.
* Another 20.

Preserve the active search filters.

21. Avoid Duplicate Results During Pagination

When showing additional results from the same result set, do not repeat listings already displayed unless the user requests a refresh.

Use stable backend pagination or cursor mechanisms where available.

22. Changing Result Quantity

Example:

User: ورني ٢٠ عقار.

Follow-up: خلها ١٠٠.

Update the requested display quantity.

Preserve all other search filters.

23. Quantity Versus Property Requirements

Example:

“أبي ٥ فلل بالرياض.”

This may mean the user wants five villa listings or wants to acquire five villas.

Use context to determine the intended meaning.

Do not automatically assume every number refers to result quantity.

24. Combined Search Controls

Users may combine several instructions.

Example:

“أبي ١٠٠ شقة للإيجار بالمنطقة الشرقية من عقار وواصلت، بحد أقصى ٤ آلاف بالشهر.”

Interpret:

* Geographic scope: REGION.
* Region: Eastern Province.
* Property type: Apartment.
* Transaction: Rent.
* Budget: SAR 4,000/month maximum.
* Sources: Aqar and Wasalt.
* Requested result quantity: 100.

Apply every supported requirement together.

25. Natural-Language Corrections

Example:

User: أبي ٥٠ فيلا بالرياض من عقار.

Follow-up: لا، خلها ١٠٠ وفي كل المنطقة.

Update:

* Result quantity: 100.
* Geographic scope: Riyadh Region.

Preserve:

* Property type: Villa.
* Source: Aqar.

26. User Preferences Override Defaults

Explicit user instructions take priority over system defaults when valid.

Examples:

* Default city search → explicit region search.
* Default city search → explicit nationwide search.
* Default all-source search → selected websites.
* Default result quantity → user-selected quantity.

Do not let defaults override explicit user choices.

27. Never Invent Backend Capabilities

Claude must inspect the actual Ezhalah backend before implementation.

Verify support for:

1. City searches.
2. Region searches.
3. Nationwide searches.
4. Source inclusion.
5. Source exclusion.
6. Result quantities.
7. Pagination.
8. Search state.
9. Geographic identifiers.
10. Search summaries.

If a feature requires backend development, identify the necessary change rather than pretending it already exists.

28. Search Summary Must Reflect User Control

The backend-generated search summary must show the actual executed filters.

Example:

“١٠٠ شقة للإيجار في المنطقة الشرقية، بحد أقصى ٤٬٠٠٠ ريال شهرياً، من عقار وواصلت.”

Only show this summary if those requirements were actually applied.

29. Dominant-Language Rule

Support Arabic and English only.

For mixed-language requests, use the language containing the most meaningful words.

Apply the selected language consistently to:

* AI responses.
* Search summaries.
* Filter labels.
* Property cards.
* Pagination controls.
* Operational messages.

30. Neutral Search Results

User control does not mean Ezhalah recommends or chooses properties.

Ezhalah must remain neutral.

Do not:

* Recommend specific properties.
* Claim one property is better.
* Invent a preferred listing.
* Promote one source without an explicit, disclosed arrangement.
* Secretly change the user’s selected sources.

31. Search Scope and Performance

Region and nationwide searches may involve significantly larger datasets.

Use efficient backend queries, indexes and pagination.

Do not load all matching properties into the AI context.

The AI should receive only the information necessary to interpret and manage the search.

32. Final Mandatory Principle

Ezhalah must allow users to control their property searches through natural language, including specific websites, excluded websites, result quantities, cities, regions and nationwide coverage.

City remains the default geographic level.

Region and nationwide searches must be supported when explicitly requested.

The user’s valid explicit instructions override default search settings.

All executed filters must be reflected accurately in the search summary.

The AI must interpret the user’s request.

The backend must validate and execute it.

END OF GLOBAL INSTRUCTIONS
