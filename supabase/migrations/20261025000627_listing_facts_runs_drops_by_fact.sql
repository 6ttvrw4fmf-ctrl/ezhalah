-- listing_facts_runs.drops_by_fact — the per-FACT drop counts of the facts-extraction test (2026-10-24).
--
-- The accuracy report must state an unverified-quote rate PER FACT («the model paraphrased pool 2% of
-- the time, boundaries 30%»), but a dropped row is, by the PROOF-OR-DROP rule, never stored in
-- listing_facts — so the only place its fact name survives is the call log. One jsonb per call:
--   {"pool": {"unverified": 1}, "boundaries": {"unverified": 3, "pii": 1}, "other:شبكة ري": {"invalid": 1}}
alter table public.listing_facts_runs add column if not exists drops_by_fact jsonb;
comment on column public.listing_facts_runs.drops_by_fact is
  'Per-fact drop counts for this call: {fact: {unverified|pii|invalid: n}}. Dropped rows are never stored, so this is where their fact name survives.';
