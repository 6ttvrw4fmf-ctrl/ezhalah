-- DETECTOR COMPANION for 20260912010600_district_identity_fold_one_place_one_token.
-- Owner: «add a barrier so we dont get it again». Three limbs, because the repair can rot three ways:
--   A) the FOLD ITSELF regresses (someone re-simplifies norm_district_tok): probed by EXECUTING the
--      real fn on the twin spellings — a lost fold makes limb A fire even though limbs B/C go blind
--      (0 collisions is exactly what a lost fold reports, so the fn probe is the load-bearing limb).
--   B) split identities REAPPEAR: two rows in loc_canonical_district in one city whose display
--      texts fold to one token (hand-inserted rows, a future refresh bug, a new promoted spelling).
--   C) stored norms DRIFT from the live fn (catalog/display-canon rows keyed by a stale token —
--      the silent state this repair just cleaned up after).

create or replace function public.mon_detect_district_identity_split()
 returns integer
 language plpgsql
as $function$
declare
  v_fn_broken boolean;
  v_split int; v_drift int;
  v_sample jsonb;
begin
  -- limb A: execute the REAL fn (a comment is not a code path)
  v_fn_broken :=
       public.norm_district_tok('الصفاء')  is distinct from public.norm_district_tok('حي الصفا')
    or public.norm_district_tok('حي الحمراء') is distinct from public.norm_district_tok('حي الحمرا')
    or public.norm_district_tok('شرائع') is distinct from public.norm_district_tok('شرايع')
    or public.norm_district_tok('الزهراء ١') is distinct from public.norm_district_tok('الزهراء1')
    or public.norm_district_tok('حي الصقًار') is distinct from public.norm_district_tok('حي الصقار')
    -- and it must still DISCRIMINATE: an over-merge is the same emergency as a lost fold
    or public.norm_district_tok('مصيف الاول') is not distinct from public.norm_district_tok('مصيف 1')
    or public.norm_district_tok('حي النرجس') is not distinct from public.norm_district_tok('حي الياسمين');

  -- limb B: split identities in the canonical match-truth table
  select count(*) into v_split from (
    select 1 from public.loc_canonical_district
    group by city_id, public.norm_district_tok(canonical_district_ar)
    having count(*) > 1) z;

  -- limb C: stored tokens no longer equal what the live fn derives
  select
    (select count(*) from public.loc_catalog_district
      where district_norm is distinct from public.norm_district_tok(district_ar))
    + (select count(*) from public.loc_canonical_district
      where district_norm is distinct from public.norm_district_tok(canonical_district_ar))
    + (select count(*) from public.loc_display_district_canon
      where district_norm is distinct from public.norm_district_tok(display_ar))
  into v_drift;

  if not v_fn_broken and v_split = 0 and v_drift = 0 then
    perform public.mon_resolve_key('district_identity_split','district_identity_split');
    return 0;
  end if;

  select jsonb_agg(t) into v_sample from (
    select d.city_id, d.canonical_district_ar, d.district_norm
      from public.loc_canonical_district d
     where exists (select 1 from public.loc_canonical_district d2
                    where d2.city_id = d.city_id
                      and d2.district_norm <> d.district_norm
                      and public.norm_district_tok(d2.canonical_district_ar)
                        = public.norm_district_tok(d.canonical_district_ar))
        or d.district_norm is distinct from public.norm_district_tok(d.canonical_district_ar)
     limit 8) t;

  return public.mon_raise('P1','district_identity_split','all','district_identity_split',
    jsonb_build_object(
      'why','One real district is splitting back into multiple search identities (or the fold fn regressed/over-merged). Owner decision 2026-09-12: one place = one token per city; card keeps source text.',
      'fold_fn_broken',        v_fn_broken,
      'canonical_split_groups', v_split,
      'stored_norm_drift_rows', v_drift,
      'fix','Migration 20260912010600 is the recipe: fix norm_district_tok, REINDEX idx_slar_district_tok, dedup+renorm loc_catalog_district, refresh_loc_canonical_district(), purge+refresh_loc_display_district_canon(), refresh_bridge_en_district(), backfill_location_display_labels().',
      'sample', v_sample));
end $function$;

-- Roster: needle-edit on a unique anchor (never a wholesale rewrite).
do $$
declare src text; def text;
begin
  select pg_get_functiondef(p.oid) into strict src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if src like '%mon_detect_district_identity_split%' then
    return; -- already wired
  end if;
  if src not like '%''mon_detect_remal_native_location_regressed''%' then
    raise exception 'roster anchor mon_detect_remal_native_location_regressed not found - roster shape changed, refusing blind edit';
  end if;
  def := replace(src,
    '''mon_detect_remal_native_location_regressed''',
    '''mon_detect_remal_native_location_regressed'',
    ''mon_detect_district_identity_split''');
  execute def;
end $$;

-- Run-green self-test: the detector must return 0 on the state the repair just produced,
-- and the roster must actually carry it.
do $$
declare v int; src text;
begin
  v := public.mon_detect_district_identity_split();
  if v <> 0 then
    raise exception 'mon_detect_district_identity_split raised % on freshly-repaired state', v;
  end if;
  select pg_get_functiondef(p.oid) into strict src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if src not like '%mon_detect_district_identity_split%' then
    raise exception 'detector exists but is NOT on the roster - it would never run';
  end if;
end $$;