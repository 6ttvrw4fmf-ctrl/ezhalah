-- THE MONTHLY/ANNUAL BLACK HOLE — found 2026-08-10 by driving the PRODUCTION Filter as a user.
--
-- Mirror of the applied migration (the DB is authoritative). Squashes 20260810133024 →
-- 20260810133702, because the first attempt was corrected twice within the hour and a mirror should
-- show what production actually runs. Both wrong turns are recorded here on purpose.
--
-- SYMPTOM. aqar ad 6586188 (search_listings_ar listing_id 23235, حي الملقا, الرياض) is
-- production_ready and returned by the results RPC with NO period filter — but by NEITHER 'شهري'
-- NOR 'سنوي'. The UI always sends a period for a rental, so the listing was unreachable.
--
-- WHY. The predicate asked the same question two different ways:
--     (p_rent_period='شهري' and s.payment_monthly = true and not coalesce(s.rent_now_pay_later,false))
--  or (p_rent_period='سنوي' and s.rent_period_ar = 'سنوي')
-- Monthly read the DERIVED column, annual read the SOURCE column. A row where they disagreed
-- satisfied neither branch. The same clause lives in THREE functions — the results RPC and both
-- COUNT RPCs — so every count agreed with every other count and nothing detected it. Only comparing
-- the RPCs against the index exposed it.
--
-- FIRST FIX, WRONG (20260810133024): made monthly read `rent_period_ar` so the branches were
-- symmetric. That would have put an RNPL listing INTO the monthly bucket, which the owner's
-- permanent rule forbids: "RNPL/annual-instalment offers must never become genuine monthly rentals."
--
-- WHAT SETTLED IT. aqar publishes this ad as price 6,500 with rent_period enum 2, AND an RNPL
-- instalment of 580/month. 6,500 × 1.07 ÷ 12 = 579.6 ≈ 580 — aqar derives the instalment from the
-- ANNUAL figure. Were 6,500 a monthly rent, the instalment on 78,000/yr would be ~6,955, not 580.
-- So 6,500 is the ANNUAL rent and «شهري» on that page describes the PAYMENT SCHEDULE: the textbook
-- annual-paid-monthly case. The trigger and sync_payment_monthly were right all along.
--
-- SECOND FIX, OVER-CORRECTED (20260810133702): the annual branch was widened to
-- `coalesce(s.payment_monthly,false)=false`, which also swept in 4 rows whose period is simply
-- UNKNOWN — asserting "annual" about listings no source ever described. Tightened below.
--
-- FINAL SEMANTICS (owner-confirmed 2026-08-10) — total and mutually exclusive:
--   rent_period_ar = 'سنوي'                -> ANNUAL
--   rent_period_ar = 'شهري' and RNPL       -> ANNUAL   (annual contract paid monthly)
--   rent_period_ar = 'شهري' and not RNPL   -> MONTHLY  (genuine monthly)
--   rent_period_ar is NULL                 -> NEITHER  (honestly unknown)
--   ANNUAL ∩ MONTHLY                       = 0
do $mig$
declare
  fn text; src text; n int;
  cur_m  text := 'p_rent_period = ''شهري'' and s.rent_period_ar = ''شهري''';
  repl_m text := 'p_rent_period = ''شهري'' and s.payment_monthly = true';
  cur_a  text := 'p_rent_period = ''سنوي'' and s.rent_period_ar = ''سنوي''';
  repl_a text := 'p_rent_period = ''سنوي'' and (s.rent_period_ar = ''سنوي'' or (s.rent_period_ar = ''شهري'' and coalesce(s.rent_now_pay_later, false)))';
begin
  foreach fn in array array['location_search_candidates_ar','apartment_guided_counts_ar',
                            'property_age_option_counts_ar']
  loop
    select pg_get_functiondef(p.oid) into src from pg_proc p
      join pg_namespace ns on ns.oid=p.pronamespace
     where ns.nspname='public' and p.proname=fn;
    if src is null then raise exception 'function % not found', fn; end if;

    -- Idempotent: already-final bodies are left alone.
    if position(repl_m in src) > 0 and position(repl_a in src) > 0 then
      continue;
    end if;

    n := (length(src)-length(replace(src,cur_m,'')))/length(cur_m);
    if n = 1 then src := replace(src, cur_m, repl_m); end if;

    n := (length(src)-length(replace(src,cur_a,'')))/length(cur_a);
    if n = 1 then src := replace(src, cur_a, repl_a); end if;

    execute src;
  end loop;
end
$mig$;

-- sync_payment_monthly matches the trigger (enforce_price_size_sanity) and the RPC bucket exactly,
-- so writer, trigger and reader can never disagree about what "monthly" means.
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
        and s.rent_period_ar = 'شهري'
        and not coalesce(s.rent_now_pay_later, false)   -- RNPL = an ANNUAL contract paid in
                                                        -- instalments; never Monthly, any platform.
      , false) as pm
    from search_listings_ar s
  )
  update search_listings_ar s set payment_monthly = want.pm
  from want
  where want.source_table = s.source_table and want.listing_id = s.listing_id
    and s.payment_monthly is distinct from want.pm;
  get diagnostics n = row_count;
  return n;
end $function$;

do $verify$
declare fn text; src text;
begin
  foreach fn in array array['location_search_candidates_ar','apartment_guided_counts_ar',
                            'property_age_option_counts_ar']
  loop
    select pg_get_functiondef(p.oid) into src from pg_proc p
      join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname=fn;
    if position('p_rent_period = ''شهري'' and s.payment_monthly = true' in src) = 0 then
      raise exception '% lost the RNPL-aware monthly branch', fn;
    end if;
    if position('s.rent_period_ar = ''شهري'' and coalesce(s.rent_now_pay_later, false)' in src) = 0 then
      raise exception '% annual branch does not absorb RNPL-annual rows', fn;
    end if;
    if position('coalesce(s.payment_monthly, false) = false' in src) > 0 then
      raise exception '% still pulls unknown-period rows into the annual bucket', fn;
    end if;
  end loop;
end
$verify$;
