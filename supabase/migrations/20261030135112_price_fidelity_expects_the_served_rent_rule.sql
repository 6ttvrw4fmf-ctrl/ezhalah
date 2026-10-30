-- price_fidelity() and price_fidelity_advance_probe(): the EXPECTED index price for a rent row is what the
-- sync serves — rent_price_annual_ar(platform, rent_period, price_annual, property_type) — not the raw
-- source figure.
--
-- Measured 2026-10-30 (🔧, backlog 945): price_fidelity_snapshot at 13:47 UTC read confirmed_stuck 9,956
-- (aqar 5,261, wasalt 2,867, dealapp 1,336, muktamel 155, sanadak 77, vmksa 61, therc 57, tuba 53 …) and
-- 23 price_drift alarms (9 P1, 14 P2) had been open since 10-26 22:47. Every sampled row is the cheap-
-- «yearly» ×12 rule (AGENTS.md §20, owner 2026-10-26; served since 20261026075321): abaad 13214870
-- source 3,700 → served 44,400, albdah 19983353 7,000 → 84,000, aqar 292498 1,600 → 19,200 … The sync
-- writes search_listings_ar.price_annual through rent_price_annual_ar() (and mon_detect_cheap_yearly_rent_served
-- guards exactly that), so a detector that expects the raw column cries «the sync had the value and did not
-- write it» on the owner's own rule, and its 23 open keys hide any real drift behind them.
--
-- Fix: in both functions, the expected src_annual goes through the same call the sync uses (three places:
-- the src CTE of each function and the convergence delete of the probe). price_drift_confirmed() is untouched
-- (mon_detect_price_drift_predicate_is_blind still proves it both ways). Probe rows holding the old raw
-- figure read «the source moved» once (pending, never confirmed) and are deleted as converged on the next
-- :47 run, so the 23 keys resolve by the detector's own loop — nothing is resolved by hand.
--
-- Mechanics: the live definitions are edited in place; the migration fails loudly if the expected text count
-- differs, and asserts the new text landed.
do $$
declare d text; fn text; cnt int; expected int;
  before text := 'then null else v.price_annual end';
  after  text := 'then null else public.rent_price_annual_ar(v.platform, v.rent_period, v.price_annual, v.property_type) end';
begin
  foreach fn in array array['price_fidelity', 'price_fidelity_advance_probe'] loop
    if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = fn) <> 1 then
      raise exception '% is missing or overloaded; refusing', fn;
    end if;
    select pg_get_functiondef(p.oid) into d
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;
    cnt := (length(d) - length(replace(d, before, ''))) / length(before);
    expected := case fn when 'price_fidelity' then 1 else 2 end;
    if cnt <> expected then
      raise exception '%: expected % occurrence(s) of the raw src_annual expression, found % — read the live function before re-applying', fn, expected, cnt;
    end if;
    if position('rent_price_annual_ar' in d) > 0 then raise exception '%: already expects the served rule', fn; end if;
    d := replace(d, before, after);
    execute d;
    select pg_get_functiondef(p.oid) into d
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = fn;
    if (length(d) - length(replace(d, after, ''))) / length(after) <> expected then
      raise exception '%: the served-rule expression did not land', fn;
    end if;
  end loop;
end $$;

-- Both directions, on fixed values: the rule applied to a cheap yearly office rent equals the served figure
-- (no drift), and a served figure off the rule is still a mismatch.
do $$
begin
  if public.rent_price_annual_ar('aqar', 'annual', 3700, 'Office') is distinct from 44400
     and exists (select 1 from public.ops_feature_flags k where k.name = 'cheap_yearly_is_monthly' and k.enabled) then
    raise exception 'rent_price_annual_ar(aqar, annual, 3700, Office) should read 44400 while the flag is on';
  end if;
  if public.rent_price_annual_ar('aqar', 'annual', 3700, 'Office') + 1 = public.rent_price_annual_ar('aqar', 'annual', 3700, 'Office') then
    raise exception 'a served figure off the rule must still differ from the rule';
  end if;
end $$;