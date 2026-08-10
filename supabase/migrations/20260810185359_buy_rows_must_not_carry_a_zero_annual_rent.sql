-- "NOT APPLICABLE" IS NOT ZERO (Filter audit, 2026-08-10).
--
-- Six aqar rows carry transaction_type='Buy' with a real price_total (220,000 … 3,000,000) AND
-- price_annual = 0. A Buy listing has no annual rent at all, so 0 is not a value the source
-- published — it is our placeholder for "not applicable", which is the unknown→number fabrication
-- the owner's permanent rule forbids. The honest state is NULL.
--
-- DELIBERATELY NOT TOUCHED: ramzalqasim RQ226/RQ252/RQ253 carry price_total = 0, which IS
-- source-published and was verified as such (migration
-- 20260810111326_zero_price_ramzalqasim_is_source_verified_published). A zero the source really
-- prints stays visible and searchable — see feedback_no-hiding-source-published-prices-rule. This
-- migration only removes a zero in a column the deal type makes inapplicable.
update public.search_listings_ar
   set price_annual = null
 where deal_ar = 'بيع' and price_annual = 0;

update public.aqar_residential_listings
   set price_annual = null
 where transaction_type = 'Buy' and price_annual = 0;

-- Prevent recurrence at the layer every write passes through. The trigger already normalises
-- payment_monthly; this adds the matching cross-field rule so a Buy row can never again acquire a
-- zero annual rent, on any platform.
do $mig$
declare
  src    text;
  needle text := E'  elsif NEW.rent_period_ar = \'سنوي\' then\n    NEW.payment_monthly := false;\n  end if;\n  return NEW;';
  repl   text := E'  elsif NEW.rent_period_ar = \'سنوي\' then\n    NEW.payment_monthly := false;\n  end if;\n'
                 || E'  -- "not applicable" is NULL, never 0. A Buy listing has no annual rent and a Rent\n'
                 || E'  -- listing has no sale total; a 0 in the inapplicable column is a placeholder we\n'
                 || E'  -- invented, not a figure any source published. (2026-08-10 Filter audit.)\n'
                 || E'  -- A source-published 0 in the APPLICABLE column is left untouched and stays\n'
                 || E'  -- searchable — see feedback_no-hiding-source-published-prices-rule.\n'
                 || E'  if NEW.deal_ar = \'بيع\'   and NEW.price_annual = 0 then NEW.price_annual := null; end if;\n'
                 || E'  if NEW.deal_ar = \'إيجار\' and NEW.price_total  = 0 then NEW.price_total  := null; end if;\n'
                 || E'  return NEW;';
  n int;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'enforce_price_size_sanity';

  if src is null then raise exception 'enforce_price_size_sanity not found'; end if;

  n := (length(src) - length(replace(src, needle, ''))) / length(needle);
  if n <> 1 then
    raise exception 'expected exactly 1 anchor in enforce_price_size_sanity, found %', n;
  end if;

  execute replace(src, needle, repl);
end
$mig$;

do $verify$
declare src text; leftover int;
begin
  select pg_get_functiondef(p.oid) into src
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname='public' and p.proname='enforce_price_size_sanity';
  if position('NEW.deal_ar = ''بيع''   and NEW.price_annual = 0' in src) = 0 then
    raise exception 'the Buy/zero-annual rule did not land in the trigger';
  end if;

  select count(*) into leftover from public.search_listings_ar
   where (deal_ar='بيع' and price_annual = 0) or (deal_ar='إيجار' and price_total = 0);
  if leftover <> 0 then
    raise exception '% rows still carry a zero in the inapplicable price column', leftover;
  end if;

  -- The source-published zeros must survive untouched.
  if (select count(*) from public.search_listings_ar
       where platform='ramzalqasim' and price_total = 0) <> 3 then
    raise exception 'the 3 source-published ramzalqasim zero prices were altered — they must not be';
  end if;
end
$verify$;