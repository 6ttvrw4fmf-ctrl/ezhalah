-- THE MONTHLY/ANNUAL BLACK HOLE (found 2026-08-10 driving the production Filter).
--
-- The rent-period predicate asked the same question two different ways:
--     (p_rent_period = 'شهري' and s.payment_monthly = true and not coalesce(s.rent_now_pay_later,false))
--  or (p_rent_period = 'سنوي' and s.rent_period_ar = 'سنوي')
-- Monthly read the DERIVED column `payment_monthly`; annual read the SOURCE column `rent_period_ar`.
-- A row where the two disagree therefore satisfies NEITHER branch and is unreachable: the UI always
-- sends one period for a rental, so the listing exists in the index and can never be found.
--
-- Live proof: aqar ad 6586188 (search_listings_ar listing_id 23235, حي الملقا, الرياض) —
-- production_ready, rent_period_ar='شهري' (aqar's own enum 2 = monthly, page renders «6,500 شهري»),
-- returned by the RPC with NO period filter, and by NEITHER 'شهري' nor 'سنوي'.
--
-- WHY the columns disagreed: `sync_payment_monthly()` encodes "RNPL = ANNUAL, every platform" and
-- forces payment_monthly=false whenever rent_now_pay_later is true. That is a DERIVED signal
-- overruling a SOURCE-published period, which the owner's permanent rule forbids
-- ([[feedback_derived-data-must-never-overrule-source]]). aqar publishes this listing as monthly AND
-- offers RNPL financing on it; financing is a payment option, not the rental period.
--
-- Measured before changing anything: 32,418 rows carry rent_period_ar='شهري' and exactly ONE also
-- carries the RNPL flag, while all 13,811 RNPL rentals already carry 'سنوي'. So the RNPL exclusion
-- protects zero rows and strands one — it is pure downside.
--
-- FIX: both branches now read the SOURCE column. The predicate becomes symmetric and total, so no
-- rent row can fall between the two buckets again. Applied to ALL THREE functions that carry the
-- clause — the results RPC and the two COUNT RPCs — because changing only the results path would
-- make the headline count disagree with the listings the user can actually reach.
--
-- Built by needle-editing each LIVE body (pg_get_functiondef) with the occurrence count asserted, so
-- a drifted body aborts the migration instead of being replaced by a stale snapshot.
do $mig$
declare
  fn     text;
  src    text;
  needle text := 'p_rent_period = ''شهري'' and s.payment_monthly = true and not coalesce(s.rent_now_pay_later, false)';
  repl   text := 'p_rent_period = ''شهري'' and s.rent_period_ar = ''شهري''';
  n int;
begin
  foreach fn in array array['location_search_candidates_ar',
                            'apartment_guided_counts_ar',
                            'property_age_option_counts_ar']
  loop
    select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = fn;

    if src is null then
      raise exception 'function % not found', fn;
    end if;

    n := (length(src) - length(replace(src, needle, ''))) / length(needle);
    if n <> 1 then
      raise exception 'expected exactly 1 monthly-branch occurrence in %, found %', fn, n;
    end if;

    execute replace(src, needle, repl);
  end loop;
end
$mig$;

-- `payment_monthly` must also stop contradicting the source, or the two will drift apart again the
-- next time anything reads it. Same rule: the source's own period wins; RNPL is a payment option.
create or replace function public.sync_payment_monthly()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n int;
begin
  with want as (
    select s.source_table, s.listing_id,
      coalesce(
            s.deal_ar = 'إيجار'
        and s.rent_period_ar = 'شهري'     -- the SOURCE's own recorded period, and nothing else.
                                          -- The `not rent_now_pay_later` term was REMOVED on
                                          -- 2026-08-10: a financing offer is not a rental period,
                                          -- and letting it override the source stranded aqar ad
                                          -- 6586188 outside both period filters.
      , false) as pm
    from search_listings_ar s
  )
  update search_listings_ar s
    set payment_monthly = want.pm
  from want
  where want.source_table = s.source_table and want.listing_id = s.listing_id
    and s.payment_monthly is distinct from want.pm;
  get diagnostics n = row_count;
  return n;
end $function$;

-- Self-verify: the clause is gone from all three, and the source-symmetric form is present.
do $verify$
declare fn text; src text; bad int := 0;
begin
  foreach fn in array array['location_search_candidates_ar','apartment_guided_counts_ar',
                            'property_age_option_counts_ar']
  loop
    select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public' and p.proname = fn;
    if position('s.payment_monthly = true' in src) > 0 then
      raise exception '% still filters monthly on the derived column', fn;
    end if;
    if position('p_rent_period = ''شهري'' and s.rent_period_ar = ''شهري''' in src) = 0 then
      raise exception '% does not read the source period for monthly', fn;
    end if;
  end loop;
end
$verify$;