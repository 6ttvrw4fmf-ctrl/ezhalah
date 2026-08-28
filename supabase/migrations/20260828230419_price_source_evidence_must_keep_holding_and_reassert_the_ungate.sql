-- THE COMPANION GUARD for 20260828225740_ungate_the_archive_proven_extreme_price_rows.sql.
--
-- scripts/verify-repair-migrations-are-guarded.ts caught that migration on PR #1198 and was RIGHT:
-- it executes an UPDATE against a listing table and shipped nothing that watches the claim. Its
-- rule -- "a one-shot repair is a CLAIM about an invariant, and an unwatched claim decays" -- is
-- exactly right here, so this ships the detector rather than a waiver on the barrier.
--
-- WHAT CAN ACTUALLY DECAY. An ops_price_source_verified row says "we checked: our stored price IS
-- the source's own published figure". That claim is true at the instant it is written and can go
-- stale on its own afterwards: the source re-prices the listing, the next enrich updates
-- price_total, and the OLD evidence row keeps vouching for a number nobody ever verified -- while
-- exempting it from the price/size gate, so a genuinely wrong extreme price stays visible to users.
-- That is the precise failure mode the evidence mechanism could otherwise hide, and nothing watched
-- it before now.
--
-- IT DISCRIMINATES RATHER THAN SILENCING (SS23a / the 2026-08-13 rule). Only rows whose proof can be
-- RE-DERIVED from a stored source payload are judged. Rows registered on evidence this function
-- cannot recompute -- a live HTTP probe, captured page text, a platform-specific field -- are left
-- alone and counted separately instead of being assumed good OR assumed bad. Measured at install:
-- 77 registered, 58 machine-checkable, 58 still holding, 0 stale, 19 not re-checkable here.
--
-- Self-clearing via mon_resolve_key on its own dedup key, so it can go GREEN as well as red and
-- cannot ratchet (mon_detect_unresolvable_alert_kinds stays green for this kind).

create or replace function public.mon_detect_price_source_evidence_stale()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_stale bigint; v_checked bigint; v_opaque bigint; v_sample jsonb;
  n int := 0;
begin
  with checkable as (
    select o.source_table, o.listing_id,
      case
        when o.source_table = 'wasalt_residential_listings' then
          (select case
             when w.price_total is not null
                  and nullif(w.ar_data->'propertyInfo'->>'salePrice','') is not null
               then (w.price_total = (w.ar_data->'propertyInfo'->>'salePrice')::numeric)
             when w.price_annual is not null
                  and nullif(w.ar_data->'propertyInfo'->>'expectedRent','') is not null
               then (w.price_annual = (w.ar_data->'propertyInfo'->>'expectedRent')::numeric)
           end
           from public.wasalt_residential_listings w where w.id = o.listing_id)
        when o.source_table = 'dealapp_residential_listings' then
          (select case
             when d.price_total is not null
                  and d.source_capture->'price_evidence'->>'origin' = 'structured'
                  and nullif(d.source_capture->'price_evidence'->>'raw','') is not null
               then (d.price_total = (d.source_capture->'price_evidence'->>'raw')::numeric)
           end
           from public.dealapp_residential_listings d where d.id = o.listing_id)
        when o.source_table = 'aqarmonthly_residential_listings' then
          (select case
             when a.price_annual is not null
                  and nullif(a.source_capture->'price_evidence'->>'raw','') is not null
               then (abs(a.price_annual
                         - (a.source_capture->'price_evidence'->>'raw')::numeric * 12) <= 1)
           end
           from public.aqarmonthly_residential_listings a where a.id = o.listing_id)
      end as still_holds
    from public.ops_price_source_verified o
  )
  select count(*) filter (where still_holds is false),
         count(*) filter (where still_holds is not null),
         count(*) filter (where still_holds is null),
         coalesce(jsonb_agg(jsonb_build_object('source_table', source_table, 'listing_id', listing_id))
                    filter (where still_holds is false), '[]'::jsonb)
    into v_stale, v_checked, v_opaque, v_sample
    from checkable;

  if v_stale > 0 then
    n := n + public.mon_raise('P2', 'price_source_evidence_stale', 'search_index',
      'price_source_evidence_stale',
      jsonb_build_object(
        'stale', v_stale, 'machine_checkable', v_checked, 'not_recheckable', v_opaque,
        'sample', v_sample,
        'why', 'An ops_price_source_verified row asserts that our stored price IS the source''s own '
               'published figure. For these rows that is no longer true: the stored price has moved '
               'away from the archived source value it was verified against. The evidence row is '
               'still exempting them from the price/size gate, so a figure nobody verified is being '
               'served to users at a magnitude the gate would otherwise withhold.',
        'action', 'Do NOT delete the evidence row reflexively and do NOT reprice. Re-derive from the '
               'CURRENT source payload: if stored still equals what the source publishes, refresh '
               'the evidence text; if the source now publishes something different, the stored value '
               'is stale capture, not a repair target -- fix the enrich path. Only if the source '
               'never published it is the original registration wrong, and then the evidence row '
               'must go rather than the price being edited.',
        'scope', 'Rows whose proof cannot be recomputed from a stored payload (live-probe or '
               'page-text evidence) are counted in not_recheckable and deliberately NOT judged '
               'either way.'));
  else
    perform public.mon_resolve_key('price_source_evidence_stale', 'price_source_evidence_stale');
  end if;

  return n;
end $function$;

-- ROSTER, in the SAME migration (AGENTS.md: a detector outside the roster is decoration, and
-- mon_detect_orphaned_detectors fires on any detector nothing reaches). Needle-edit the LIVE
-- definition so a concurrent session's roster additions are preserved.
do $mig$
declare
  v_def    text;
  v_anchor text := E'    ''mon_detect_dealapp_deactivation_on_unreliable_fetch'',\n';
  v_new    text := E'    ''mon_detect_price_source_evidence_stale'',\n';
begin
  select pg_get_functiondef(oid) into v_def
    from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'mon_run_all_detectors';
  if v_def is null then
    raise exception 'mon_run_all_detectors not found -- refusing to guess at the roster';
  end if;

  if position('mon_detect_price_source_evidence_stale' in v_def) > 0 then
    raise notice 'roster already carries the detector -- nothing to do';
    return;
  end if;

  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'roster anchor matched % times, expected exactly 1 -- refusing to edit blindly',
      (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor);
  end if;

  execute replace(v_def, v_anchor, v_anchor || v_new);

  select pg_get_functiondef(oid) into v_def
    from pg_proc
   where pronamespace = 'public'::regnamespace and proname = 'mon_run_all_detectors';
  if position('mon_detect_price_source_evidence_stale' in v_def) = 0 then
    raise exception 'roster edit did not take -- refusing to leave an unreachable detector';
  end if;
end $mig$;

-- Re-assert the un-gate IDEMPOTENTLY, so this file carries the same repair its detector watches
-- (the pattern the guard's own WAIVED note describes for 20260824114314 / 20260824115704).
-- Unchanged semantics: registered + resolver-production_ready + located only.
update public.search_listings_ar s
   set production_ready = true
  from public.listing_native_location_v2 v
 where v.source_table = s.source_table
   and v.listing_id   = s.listing_id
   and v.production_ready
   and not s.production_ready
   and s.region_id is not null
   and s.city_id  is not null
   and exists (select 1 from public.ops_price_source_verified o
                where o.source_table = s.source_table and o.listing_id = s.listing_id);

-- Run the detector now, in the same migration, so the claim is watched from the instant it lands.
select public.mon_detect_price_source_evidence_stale();

comment on function public.mon_detect_price_source_evidence_stale() is
  'Watches ops_price_source_verified for evidence that has gone stale: a registered row whose stored '
  'price no longer equals the archived source value it was verified against. Companion guard for '
  '20260828225740 (the un-gate repair). Judges only rows whose proof can be re-derived from a stored '
  'payload; live-probe/page-text evidence is counted, not assumed. 0 stale of 58 checkable at install.';
