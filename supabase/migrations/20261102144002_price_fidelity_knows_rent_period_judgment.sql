-- 🔧 2026-11-02: price_fidelity() learns the owner's 2026-10-31 rent-period judgment, so a judged ×12 is not «drift».
-- enforce_rent_period_judgment() (trigger on search_listings_ar, migration 20261031205445) serves a silent-period rent
-- figure under 7,000 as سنوي at ×12 and marks it rent_period_judged. price_fidelity() compared that served figure with
-- rent_price_annual_ar(platform, NULL period, raw) = the raw figure, and called 927 rows on 15 platforms «PROVEN stuck»
-- (abaad 13214877: source 2,900 with no period, served 34,800 judged — exactly the rule). 15 price_drift alerts
-- (6 P1) sat in the repair queue since 10-31 23:47 on correct rows. A judged row whose served annual is the source
-- figure ×12 is the rule at work, not a sync that failed to write; every other mismatch is still counted.
-- Edited in place (replace on the live text; raises when the expected text is missing) so nothing is retyped.
do $$
declare src text; new_src text; needle text; repl text; cnt int;
begin
  select pg_get_functiondef('public.price_fidelity'::regproc) into src;
  needle := $n$    where s.price_total  is distinct from x.src_total
       or s.price_annual is distinct from x.src_annual$n$;
  repl := $r$    where s.price_total  is distinct from x.src_total
       or (s.price_annual is distinct from x.src_annual
           -- owner 2026-10-31: a judged silent period serves the per-month figure ×12 (enforce_rent_period_judgment);
           -- that is the rule at work, not drift (🔧 2026-11-02)
           and not (s.rent_period_judged and s.price_annual = x.src_annual * 12))$r$;
  cnt := (length(src) - length(replace(src, needle, ''))) / length(needle);
  if cnt <> 1 then
    raise exception 'price_fidelity: expected the mismatch predicate exactly once, found %', cnt;
  end if;
  new_src := replace(src, needle, repl);
  if new_src = src then raise exception 'price_fidelity: nothing changed'; end if;
  execute new_src;
end $$;