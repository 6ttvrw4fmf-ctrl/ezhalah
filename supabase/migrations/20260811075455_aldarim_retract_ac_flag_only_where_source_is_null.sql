-- Paired retraction for the scrapers/aldarim/run.py `_flag` fix (§21: removing a fabrication from
-- code is only half the job — db._unknown_must_not_overwrite_known() means the already-stored
-- fabricated value survives every future crawl with all tests green).
--
-- DEFECT: `"air_conditioner": bool(L.get("is_ac_installed"))`. bool(None) is False, so a listing
-- aldarim published nothing about recorded a confident "this property does NOT have AC".
-- Surfaced by the field-level safety barrier as aldarim/air_conditioner, 169 false, `true` nowhere.
--
-- THE SCOPE IS THE WHOLE POINT. "false with zero true anywhere on the platform" reads as
-- "the column is entirely manufactured, retract all 169". It is not, and doing that would have
-- destroyed real source data. Measured per row against each row's OWN stored source_capture:
--     is_ac_installed = "0"   -> 123 residential + 34 commercial = 157 rows  (aldarim SAYS no AC)
--     is_ac_installed = null  ->   7 residential +  5 commercial =  12 rows  (aldarim says nothing)
--     is_ac_installed = "1"   ->   0 rows
-- So `true` being absent platform-wide is aldarim's own inventory reality, not a broken parser, and
-- only the 12 null-source rows are ours. ONLY those 12 are retracted, to NULL, never to a value read
-- from prose. The 157 source-published negatives are the CONTROL and are asserted to survive.
--
-- electricity / water_supply / sanitation share the same old bool() pattern and are fixed in code in
-- the same commit, but their keys are non-null on every active row (0 nulls measured), so there is
-- nothing to retract for them. Asserted below rather than assumed.
do $mig$
declare
  v_res int; v_com int; v_ctrl_before int; v_ctrl_after int; v_left int;
  v_other_null int;
begin
  select count(*) into v_ctrl_before from (
    select 1 from public.aldarim_residential_listings
     where active and air_conditioner is false
       and (source_capture->'is_ac_installed')::text in ('"0"','0')
    union all
    select 1 from public.aldarim_commercial_listings
     where active and air_conditioner is false
       and (source_capture->'is_ac_installed')::text in ('"0"','0')) s;
  if v_ctrl_before <> 157 then
    raise exception 'control cohort is % rows, expected 157 — source shape changed, aborting', v_ctrl_before;
  end if;

  -- nothing to retract on the three sibling columns: assert, do not assume
  select count(*) into v_other_null from public.aldarim_residential_listings
   where active and (source_capture->'has_electricity' is null
                  or jsonb_typeof(source_capture->'has_electricity') = 'null'
                  or source_capture->'has_water' is null
                  or jsonb_typeof(source_capture->'has_water') = 'null'
                  or source_capture->'has_sewage' is null
                  or jsonb_typeof(source_capture->'has_sewage') = 'null');
  if v_other_null <> 0 then
    raise exception 'electricity/water/sewage have % null-source rows — they need retracting too', v_other_null;
  end if;

  update public.aldarim_residential_listings
     set air_conditioner = null
   where active and air_conditioner is false
     and (source_capture->'is_ac_installed' is null
       or jsonb_typeof(source_capture->'is_ac_installed') = 'null');
  get diagnostics v_res = row_count;

  update public.aldarim_commercial_listings
     set air_conditioner = null
   where active and air_conditioner is false
     and (source_capture->'is_ac_installed' is null
       or jsonb_typeof(source_capture->'is_ac_installed') = 'null');
  get diagnostics v_com = row_count;

  if v_res <> 7 or v_com <> 5 then
    raise exception 'retracted %/% rows, expected 7/5 — blast radius wrong, aborting', v_res, v_com;
  end if;

  -- CONTROL: every source-published "no" must still be false, not swept to NULL
  select count(*) into v_ctrl_after from (
    select 1 from public.aldarim_residential_listings
     where active and air_conditioner is false
       and (source_capture->'is_ac_installed')::text in ('"0"','0')
    union all
    select 1 from public.aldarim_commercial_listings
     where active and air_conditioner is false
       and (source_capture->'is_ac_installed')::text in ('"0"','0')) s;
  if v_ctrl_after <> 157 then
    raise exception 'CONTROL LOST: source-published negatives went % -> %', v_ctrl_before, v_ctrl_after;
  end if;

  -- and no fabricated negative is left behind
  select count(*) into v_left from (
    select 1 from public.aldarim_residential_listings
     where active and air_conditioner is false
       and (source_capture->'is_ac_installed' is null
         or jsonb_typeof(source_capture->'is_ac_installed') = 'null')
    union all
    select 1 from public.aldarim_commercial_listings
     where active and air_conditioner is false
       and (source_capture->'is_ac_installed' is null
         or jsonb_typeof(source_capture->'is_ac_installed') = 'null')) s;
  if v_left <> 0 then
    raise exception '% fabricated negatives survived the retraction', v_left;
  end if;

  raise notice 'retracted % residential + % commercial aldarim air_conditioner rows to NULL; % source-published negatives preserved',
    v_res, v_com, v_ctrl_after;
end $mig$;
