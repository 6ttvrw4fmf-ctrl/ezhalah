-- Tightens the previous migration, which over-corrected.
--
-- To stop RNPL-annual rows being unreachable, the annual branch was widened to
--     s.rent_period_ar = 'سنوي' or coalesce(s.payment_monthly,false) = false
-- but `payment_monthly` is also false for a row whose period is simply UNKNOWN, so 4 rows with NO
-- stated period were pulled into the ANNUAL bucket. That breaks the owner's rule that an unknown
-- source period stays unknown — we would be asserting "annual" about listings whose period no source
-- ever published.
--
-- Correct form: the annual bucket absorbs a row only when the source STATED a period and RNPL
-- reclassifies it (annual contract paid in monthly instalments). Rows with a NULL period match
-- neither bucket, which is the honest outcome.
--
-- Resulting partition over rentals — total and mutually exclusive:
--   rent_period_ar = 'سنوي'                     -> ANNUAL
--   rent_period_ar = 'شهري' and RNPL            -> ANNUAL   (annual paid monthly)
--   rent_period_ar = 'شهري' and not RNPL        -> MONTHLY  (genuine monthly)
--   rent_period_ar is NULL                      -> NEITHER  (honestly unknown)
do $mig$
declare
  fn text; src text; n int;
  cur  text := 'p_rent_period = ''سنوي'' and (s.rent_period_ar = ''سنوي'' or coalesce(s.payment_monthly, false) = false)';
  repl text := 'p_rent_period = ''سنوي'' and (s.rent_period_ar = ''سنوي'' or (s.rent_period_ar = ''شهري'' and coalesce(s.rent_now_pay_later, false)))';
begin
  foreach fn in array array['location_search_candidates_ar','apartment_guided_counts_ar',
                            'property_age_option_counts_ar']
  loop
    select pg_get_functiondef(p.oid) into src from pg_proc p
      join pg_namespace ns on ns.oid=p.pronamespace
     where ns.nspname='public' and p.proname=fn;
    if src is null then raise exception 'function % not found', fn; end if;
    n := (length(src)-length(replace(src,cur,'')))/length(cur);
    if n <> 1 then raise exception 'expected 1 annual branch in %, found %', fn, n; end if;
    execute replace(src, cur, repl);
  end loop;
end
$mig$;

do $verify$
declare fn text; src text;
begin
  foreach fn in array array['location_search_candidates_ar','apartment_guided_counts_ar',
                            'property_age_option_counts_ar']
  loop
    select pg_get_functiondef(p.oid) into src from pg_proc p
      join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public' and p.proname=fn;
    if position('coalesce(s.payment_monthly, false) = false' in src) > 0 then
      raise exception '% still pulls unknown-period rows into the annual bucket', fn;
    end if;
    if position('s.rent_period_ar = ''شهري'' and coalesce(s.rent_now_pay_later, false)' in src) = 0 then
      raise exception '% annual branch no longer absorbs RNPL-annual rows', fn;
    end if;
  end loop;
end
$verify$;