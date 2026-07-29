-- aqar licence-number-as-price, SECOND cohort: the «72…» licence range. Owner-approved follow-up to
-- PR#257 (which fixed the parser and repaired the «71…» cohort).
--
-- WHY PR#257 MISSED THESE. That migration gated on the observed numeric window
-- [100,000,000-101,000,000), because every row found at the time came from a REGA licence beginning
-- «71». But licences are also issued as «72…», and the parser captured the last 9 digits either way:
--     licence 7100267943 -> stored 100267943   (cohort 1, repaired in #257)
--     licence 7200922371 -> stored 200922371   (cohort 2, THIS migration)
-- Gating on a numeric window was the mistake. This migration gates on the MECHANISM instead — the
-- stored price is the 9-digit tail of a "7…" number present in the row's OWN capture — so any future
-- licence prefix is covered by the same predicate.
--
-- The 254 rows reported as "unproven" yesterday are already resolved and are NOT this cohort: their
-- captures changed on the 2026-07-29 01:00 re-crawl, so the FIXED parser recomputed them correctly and
-- 0 rows remain in the «71» window (verified: raw active + search index both 0). Sample id 15593 went
-- 100,267,943 -> 460,000 — which also confirms yesterday's decision to NULL rather than write
-- aqar_parse's "460": the truncated capture had lost the thousands, and the real price is 460,000.
-- LESSON: a stale/truncated capture is unreliable no matter which parser reads it.
--
-- THIS COHORT DID NOT SELF-HEAL because trg_aqar_parse short-circuits on
-- (UPDATE, source_capture unchanged, fullparse_done) — these pages did not change, so nothing
-- recomputed them.
--
-- EVIDENCE, 68 rows, every independent signal agreeing:
--   * all 68 land in [200,594,585 - 201,034,086] — a 440k-wide window, i.e. a licence SERIAL range,
--     not any plausible price distribution;
--   * 17 are confirmed by the separately-parsed `license_number` column: license_number = '7'||price;
--   * `aqar_parse` (the DB parser, which requires the full word «ريال», never a bare «ر») returns the
--     corrupt value for 0 of 68 — so the corruption came solely from the Python regex, now fixed;
--   * 66 of 68 are not even round to 10, versus 6.5% across 23,680 genuine aqar Buy prices;
--   * 68 of 68 have price_per_meter arithmetically equal to the fabricated price / area.
--   The captures show the licence under many seller-written labels — «ترخيص اعلاني»,
--   «رقم الترخيص», «ترخيص الإعلان», «رقم الاعلان» — which is why a label-anchored text gate alone
--   found only 23 of them. Several of those same descriptions state the REAL asking price in words
--   («المطلوب: 1.500.000», «البيع 250 الف»), confirming the stored figure is not the price.
--
-- Scope check: aqar_commercial Buy = 0 rows, aqar residential Rent (price_annual) = 0 rows. Residential
-- Buy only. A 9-digit floor is required: without it, `'7' || price` matches trivially for tiny prices
-- (a row with price_total = 1 matches "71" anywhere) — that produced 7 false positives in a looser
-- gate and they are excluded here.
--
-- ACTION: NULL, not a corrected value — same reasoning as #257 and now empirically vindicated. The
-- false number is provable; the true one is not recoverable from a stale capture. trg_aqar_parse only
-- assigns on a non-null parse, so a fresh capture refills it and a NULL can never become garbage.
-- fullparse_done is pinned in the SAME statement so the trigger's short-circuit preserves the NULL.
-- price_per_meter is nulled ONLY where it equals round(price/area) (±1) — provably derived from the
-- value removed; a source-published «سعر المتر» is untouched.

do $$
declare
  n_expected constant int := 68;
  n_gate int;
  n_upd  int;
begin
  select count(*) into n_gate
    from public.aqar_residential_listings
   where active and transaction_type = 'Buy'
     and price_total is not null
     and length(price_total::text) = 9
     and price_total >= 100000000
     and source_capture->>'source_text' ~ ('7' || price_total::text);

  if n_gate <> n_expected then
    raise exception 'aqar licence-price (72 range) gate matched % rows, expected % — aborting rather '
                    'than nulling an unverified set', n_gate, n_expected;
  end if;

  update public.aqar_residential_listings a
     set price_total     = null,
         price_per_meter = case
           when a.area_m2 > 0
            and a.price_per_meter is not null
            and abs(a.price_per_meter - round(a.price_total::numeric / a.area_m2)) <= 1
           then null
           else a.price_per_meter
         end,
         fullparse_done  = true
   where a.active and a.transaction_type = 'Buy'
     and a.price_total is not null
     and length(a.price_total::text) = 9
     and a.price_total >= 100000000
     and a.source_capture->>'source_text' ~ ('7' || a.price_total::text);

  get diagnostics n_upd = row_count;
  if n_upd <> n_expected then
    raise exception 'aqar licence-price (72 range) repair updated % rows, expected % — rolling back',
                    n_upd, n_expected;
  end if;

  raise notice 'aqar licence-price (72 range): % row(s) nulled (price + derived ppm)', n_upd;
end $$;

-- ── Permanent tripwire for the whole class ───────────────────────────────────────────────────────
-- Cheap by design: compares two already-parsed COLUMNS, no regex over the capture text, so the daily
-- audit can read it every run. `license_number` is parsed independently of the price, so
-- license_number = '7' || price_total is the price wearing the licence's digits — never a coincidence.
-- Covers every aqar table and both deal sides, and is prefix-agnostic (71…, 72…, any future range).
create or replace view public.mon_aqar_price_equals_licence_tail as
select coalesce(sum(n), 0)::int as price_equals_licence_tail
from (
  select (xpath('/row/c/text()', query_to_xml(format(
           'select count(*) c from public.%I where active '
        || 'and license_number is not null '
        || 'and (   license_number = ''7'' || price_total::text '
        || '     or license_number = ''7'' || price_annual::text)',
           tablename), false, true, '')))[1]::text::int as n
  from pg_tables
  where schemaname = 'public' and tablename in ('aqar_residential_listings', 'aqar_commercial_listings')
) s;

comment on view public.mon_aqar_price_equals_licence_tail is
  'Audit invariant (2026-07-29): active aqar rows whose stored price equals the 9-digit tail of their '
  'own REGA licence number — the enrich_residential.py bare-«ر» capture bug (PR#257/#266). Must be 0. '
  'Prefix-agnostic: catches 71…, 72… and any future licence range.';

grant select on public.mon_aqar_price_equals_licence_tail to service_role;
