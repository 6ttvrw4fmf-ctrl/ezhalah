# The AI facts reader — new ads nightly, the backlog once, 30 USD a month (owner, 2026-10-26)

> **Cadence change (2026-11-03, migration 20261103013129):** the free word reader's incremental run (pg_cron `gh-facts-words-nightly`, name kept) now fires every hour at :01 UTC instead of 07:05 nightly (it was :25 for its first day; migration 20261103101143 moved it to :01 so each ~12-minute run ends before the :22 search sync — at :25 every read missed that hour's sync and waited for the next, up to about two hours), so a new ad's own words reach its chip within about an hour (owner: «whenever we get a new listing the description immediately matches»). One run reads only new / changed ads in ~12 minutes, no paid AI. Where this file says «nightly» about the free reader, read «hourly».

> **Missed real AC (2026-11-04 live walk, after the prose-box clear).** The reader stays silent — never «no» — when in
> doubt, and the 11-03 clear used that silence; a live walk then found ~1 in 3 cleared DealApp AC ads did say AC.
> Two leaks: a near word in the bullet BEFORE («بلكونة مطلة على لاندسكيب 🔹مكيفات راكبة», «قريب من المسجد 9 مكيفات»)
> silenced the unit's AC, and an entrance word two words back («مدخلان🔹 مكيفات راكبة») read the AC units as the lobby's.
> Fixed for the AC only (`_NEAR_NEVER_FACTS`; plural «مكيفات» is never the lobby's — «مداخل مكيفة» still is), plus
> «قابل للتفاوض» (negotiable) no longer counts as «can be fitted» except for public places. Proof: old-vs-new on 115
> real trigger snippets (34 changes, all right) and 120 «قابل للتفاوض» snippets (4 changes, all right). A kitchen or a
> lift CAN be a nearby place's, so they keep the near rule. The clear's backup is `ops_prose_box_cleared`.

> **Owner decision — the grill chip (2026-11-03): «grill is grill, microwave isn't a grill».** A «شواية» / «شواء» counts for
> the grill chip wherever the ad names it, including a kitchen appliance («فرن شواية», «مطبخ … فرن - شواية - ميكرويف»).
> A microwave is never a grill (the reader has no microwave token for it). Do not add an «oven nearby» exclusion to the
> grill fact — it was proposed (PR #10269) and closed on this decision.

> **Precision audit (2026-11-03, owner: «make sure everything I select appears like matches»).** Chip *counts* were
> exact (17,004 chips × 78 groups = a plain count of the index, 0 differences); some chip *matches* were not. The free
> reader answered yes for look-alike words: «بنت» (a name, «بنت هاوس») as Wi-Fi/internet, «ونشتري» as a crane, a bare
> «الرمال» (the district) as a dunes view, «غرفة شغالة» as a producing farm, «أبواب مرتفعة» as a raised plot,
> «للشبابيك» as for-youth, «يسعدنا استقبال عروضكم» as reception, «صاحب / تاريخ انتهاء الترخيص» (the REGA ad licence)
> as a licence, a bare «معتمد» as an approved plan, «واجهة العقار: Eastern» as frontage, a bearing («جنوب طريق
> الملك») as on a main road, and near words it lacked («بقرب», «قربها», «مقابلة», «دقيقتين»). «عدا / باستثناء» and a
> 🚫/❌ mark now read as no. Proof was old-vs-new on ~2,000 real active ads: only wrong yeses turned off, no new yes.
> **How to re-run it:** list each key's top quotes from `listing_text_facts` (v = true), read the sentence around
> any quote that is not the fact's own word, and fix the catalogue in `scrapers/facts/word_checker.py` with the real
> sentence as a selftest line. The selftest now gates every scrapers PR
> (`scrapers/common/tests/test_word_checker_selftest.py`, run by common-location-tests.yml).
>
> **Round 2 + the evidence-phrase barrier (2026-11-03 evening, PR #10211, migration 20261103213947).** Three reviewers
> read real sentences for all ~180 chips; ~40 more look-alike classes were fixed (e.g. «صالة عائلية» a room → for families,
> «مغسلة» a basin → car wash, «كافية» enough → cafe, «ارتداد» a setback → floors, the ad's own «في شارع X,» address,
> landmarks «خلف شبيلي مول», «تصلح سكن عمال» a possible use, refusals «يمنع سكن العزاب»). Wasalt's elevator/AC/private
> entrance now come from this same reader (one reader). After the 8-shard re-read, all 17,004 chip counts again equal the
> index, and a live walk (Riyadh short-stay rest houses → «عوائل» 17 = DB 17; Gathern unit 26129 «مخصص ل عوائل فقط») matched
> the source. **The barrier:** `ops_af_evidence_phrase` lists the phrases that may turn a chip on (1,759 trusted, 57
> rejected). `mon_detect_af_evidence_phrases()` (daily, on the roster) raises **P1 `af_rejected_evidence_served`** if a
> rejected phrase serves any ad again, and **P2 `af_new_evidence_phrase`** when an unreviewed phrase reaches 25 served ads.
> To clear the P2: read 5 real sentences, insert the phrase as trusted, or as rejected AND fix the reader. Never trust a
> rejected phrase to silence the P1.
> **Still open (owner decision):** some scrapers fill elevator / AC / maid room from the ad text with the older
> `normalize.prose_amenities` (dealapp, rakez, aqar non-villa maid/driver …) and Rule B serves those as the site's field;
> the code switch is easy but the stored yeses do not self-heal, so clearing them is a bulk data change for the owner.

**Owner's words:** «I don't mind us using the AI … make a very good plan … the max budget for the AI backend is
30 dollars monthly … start now with the more listings.»

## What it is

The paid teacher (`scrapers/facts/extract.py` → the `facts-extract` edge function → `deepseek-chat`, ≈ $0.00004–0.0001
per ad) reads an ad's title + description once and stores every fact it names — pool, majlis, roof, warranty, street
width, self check-in, «other:» facts — with the seller's exact words as proof (`public.listing_facts`, model
`deepseek-flash`). PROOF-OR-DROP and PDPL stripping are the same as the 10-24 test; nothing of the ad's text is logged.

## What it is NOT

It is **not** a writer of Advanced Filter values. The free word reader (`word_checker.py`, nightly `facts-words.yml`
07:05 UTC) stays the only text source the filter serves (Rule B, `docs/ops/ADVANCED_FILTER_SOURCE_TRUTH.md`). Measured
2026-10-26 on the hardest ads (the ones the reader found nothing in) the AI was wrong 27 % of the time; on ordinary ads
it agrees with the reader 99.8 %. So the AI's rows are **saved context** and the **teacher**: `ops_ai_facts_reader_gaps`
lists, per fact, what the AI found on ads where the reader wrote nothing — the weekly lesson that turns into reader
words (with selftest phrases), after a human reads the sample quotes.

## How it runs

| piece | where | what |
|---|---|---|
| nightly run | `cron gh-facts-ai-new` 07:40 UTC → `facts-extract.yml` defaults | `--mode new`: ads first seen ≤ 3 days the AI never read, ≤ 10,000, ≤ 1.5 USD per run |
| backlog | `facts-extract.yml` with `mode=backlog`, `limit`, `max_usd` ≤ 5 | any active ad the AI never read, seeded order, resumable (the picker skips ads already read) |
| pickers | `facts_ai_plan(mode)`, `facts_ai_todo_ids(table, n, mode, seed)` | per-table counts from `search_listings_ar`; ids with no `deepseek%` row in `listing_facts` |
| **the cap** | `ai_facts_budget` (one row: 30 USD, switch) · `facts_ai_budget(estimate)` | spent = `listing_facts_runs` this calendar month; `allow` = spent + estimate ≤ cap |
| where it bites | the **proxy** asks `facts_ai_budget` before every paid fetch (fail closed); the **script** asks at start and every 25 calls | a spent month = no paid call, anywhere |
| barrier | `scripts/verify-ai-facts-budget-gate.ts` (in `npm test`) | the four files hold the contract; 6 mutation proofs |

Costs are logged per call in `listing_facts_runs` (never in `ai_usage`, which is the live product's own breaker).
Raising the cap is the owner's decision: `update public.ai_facts_budget set month_usd_cap = …, changed_at = now()`.

## Teaching the reader — and why a lesson needs a RE-READ (2026-10-27)

`ops_ai_facts_reader_gaps` lists, per fact, the ads the AI found a fact on where the free reader has no row. Read
2026-10-27 against the ads' own text, the gap had **two causes, and the bigger one is not a missing word**:

1. **Stale reads.** The nightly `incremental` phase re-reads an ad only when its text changed, it was never read, or
   `listing_text_facts.stale_at` is set (`text_facts_todo`). A reader that learned new words on 10-25 / 10-26 never
   went back to the ads read before. Most "missed" phrasings (`خدمات العقار: مياه, كهرباء`, `موقف خاص`, `غرفة خادمة`,
   `بأثاث مريح`) already pass today's reader.
2. **Real gaps**, taught in PR «reader-ai-teacher-pass-2» with a selftest phrase each (cues for the generated
   boilerplate, «كهرب», a meter is a supply, the REGA warranty label's yes-values, hidden-defects insurance, more maid
   room / parking / furnished shapes).

**A lesson ships as words, and the re-read is AUTOMATIC (since 2026-10-27, migration `20261027111648`).** The
words: a PR with a selftest phrase each, then a benchmark (`facts-words.yml` `phase=benchmark`) compared to the AI on
the same ads, merged only if agreement does not drop and the new rows survive a hand check. The re-read needs no
hand: every overlay row carries the `reader_version` that read it (a hash of `word_checker.py` + `normalize.py`),
`text_facts_todo(…, p_reader_version)` hands back every row an older version read, and a merge that touches the
reader runs `facts-words.yml` on 8 shards by itself. The hourly index sync then merges the overlay under Rule B.
Do NOT set `stale_at` by hand for a lesson any more.

- **The alarm:** `mon_detect_text_facts` check 7 raises P2 `text_facts_reader_version_lag` when indexed ads are
  still read by an older version 36 h after the current one appeared. `select * from ops_text_facts_reader_lag();`
  is the standing answer.
- **The barrier:** `scripts/verify-reader-lesson-rereads-old-ads.ts` (in `npm test`, 8 mutation proofs).
- **First run, 2026-10-27:** 393k ads re-read in ~4 h on 8 shards, 0 behind. Yes-rows gained: electricity +29,769 ·
  water +10,857 · separate electricity meter +1,791 · majlis +1,215 · furnished +977 · maid room +966 · parking
  +594. Every new value was served by the index (`ops_text_facts_vs_index` not-applied = 0). Live check: Riyadh ·
  حي الزهرة · villa · buy, the chip «عداد كهرباء مستقل» read 39 in the UI = 39 in `search_listings_ar`. Aqar ad
  6928102 (1,090,000 SAR, 400 m², source text «عدادين كهرباء») is result #6, tagged «مطابق لطلبك».

Measure before/after with `ops_ai_facts_reader_gaps` and the Advanced Filter counts in the real UI. The teacher's
finds reach users only after the re-read and the next index sync, never on merge alone.

## Backlog window and the OpenRouter reader key (owner, 2026-10-27)

Owner: «for now no budget … we have a lot of ads for you to check … for new listings it will be 30 dollars a month».
So `ai_facts_budget.month_usd_cap` = **100** while the one-time backlog runs (it equals the 100 USD of OpenRouter credits
the owner adds; the per-run 5 USD cap and the cost-per-ad checkpoint still apply), and goes back to **30** the day the
backlog is done. The reader moves from the DeepSeek key to an **OpenRouter reader key** (`OPENROUTER_API_KEY`, its own
credit limit, auto top-up off): the proxy pins one non-thinking model (`deepseek/deepseek-v3.2`), pins the DeepSeek
provider with fallbacks off, and logs OpenRouter`s own billed cost per call. A cheaper model is tried only after a
500-ad pilot. The user-facing chat uses a different provider and key; the two budgets never share money.

## The choice, 2026-10-28: DeepSeek V3.2 through OpenRouter (owner: «let's focus on deep … the deep seek final price idm»)

Four cheap models read the same kind of unread residential ads through the OpenRouter reader key (500 asked each):

| model | cost / ad | quotes not verbatim | ads skipped / lost | broken JSON | agrees with word reader |
|---|---|---|---|---|---|
| **deepseek/deepseek-v3.2** | $0.000110 | **0.6 %** | **0** | **0 %** | 99.8 % |
| mistral-small-3.2, 20 ads/call | $0.000036 | 6.0 % | 54 | 0 % | 100 % |
| mistral-small-3.2, 5 ads/call | $0.000067 | 3.1 % | 1 | 12.5 % | 98.8 % |
| gemini-2.5-flash-lite | $0.000068 | 3.6 % | 23 | 4.2 % | 100 % |
| qwen3-235b | — | — | — | — | too slow (> 1 h) |

DeepSeek is the only one that passes every bar, so it is the default (`facts-extract.yml` provider `openrouter`, proxy
model `deepseek/deepseek-v3.2`, hosts DeepInfra / AtlasCloud / Baidu). A Mistral-first, DeepSeek-fixes-it mix was
weighed and refused: it saves ~$4/month, and Mistral's non-verbatim quotes are dropped silently rather than retried.
Expected: ~170k new ads/month ≈ $19–20/month; one-time backlog ≈ $30.

## Expected numbers (measured 2026-10-26)

~5,700 new ads a day → ≈ $0.6/day, ≈ $17/month at the 10-24 rate (less at the silent-ads rate). The one-time backlog
(≈ 385k unread active ads) fits inside the first month's remainder when run in 5 USD batches.
