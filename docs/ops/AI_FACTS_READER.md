# The AI facts reader — new ads nightly, the backlog once, 30 USD a month (owner, 2026-10-26)

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

**So every lesson ships as two acts:** the words (PR, selftest green, benchmark run `facts-words.yml`
`phase=benchmark` compared to the AI on the same ads), then the re-read —

```sql
update public.listing_text_facts set stale_at = now() where stale_at is null;   -- every overlay row
```

followed by `facts-words.yml` `phase=incremental` with `shards=8` (the first fill was the same). The hourly index
sync then merges the overlay under Rule B. Measure before/after with `ops_ai_facts_reader_gaps` and the Advanced
Filter counts in the real UI; the teacher's finds reach users only after the re-read, never on merge.

## Expected numbers (measured 2026-10-26)

~5,700 new ads a day → ≈ $0.6/day, ≈ $17/month at the 10-24 rate (less at the silent-ads rate). The one-time backlog
(≈ 385k unread active ads) fits inside the first month's remainder when run in 5 USD batches.
