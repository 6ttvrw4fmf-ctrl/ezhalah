-- mon_detect_unresolvable_alert_kinds() scanned only functions named `mon\_%`. Three kinds have
-- perfectly good resolvers that live OUTSIDE that namespace, so the detector reported them as
-- unclearable ratchets when they were nothing of the sort:
--
--   stale_coverage_gate      → mark_stale_listings_inactive (inline alert_event update)
--   stale_listings_detected  → mark_stale_listings_inactive (inline alert_event update)
--   price_gate_withheld      → location_pipeline_monitor    (inline alert_event update)
--
-- Each already matches this detector's OWN third shape (update alert_event / resolved_at = now() /
-- kind = '<kind>'); only the proname filter hid them. A monitor that fires on correct data is
-- itself a defect, so widen the scan to every public function instead of muting anything.
--
-- Also removes the structural risk in the original: the scan half and the clear half each spelled
-- the three shapes out separately and relied on a comment to stay identical. They are now computed
-- ONCE into v_resolvable and both halves read that array, so they cannot drift apart.
--
-- The five genuine ratchets (duplicate_card_surface_routed, region_label_in_city_field,
-- run_field_range, scraper_failure_step_change, stale_breaker_escape) still have no resolver
-- anywhere and stay correctly open. This narrows what the detector reports; it never widens it.
create or replace function public.mon_detect_unresolvable_alert_kinds()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_n int := 0;
  v_resolvable text[];
  r record;
begin
  -- ONE evaluation of "which kinds can be cleared", used by both halves below.
  -- STRICT: a function must actually CALL a resolver with this kind as a literal, or clear the
  -- kind inline with a real update. Mentioning the strings in a comment still does not count.
  with fns as (
    select pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prokind = 'f'
  ),
  cands as (
    select distinct kind from public.alert_event
     where resolved_at is null and kind <> 'unresolvable_alert_kind'
    union
    select detail->>'kind' from public.alert_event
     where resolved_at is null and kind = 'unresolvable_alert_kind'
       and detail->>'kind' is not null
  )
  select coalesce(array_agg(c.kind), '{}')
    into v_resolvable
    from cands c
   where c.kind is not null
     and (exists (
            select 1 from fns f
             where f.def ~ ('mon_resolve_key\s*\(\s*''' || c.kind || '''')
                or f.def ~ ('mon_resolve\s*\(\s*''' || c.kind || '''')
                or (f.def ~* 'update\s+(public\.)?alert_event'
                    and f.def ~ 'resolved_at\s*=\s*now\(\)'
                    and f.def ~ ('kind\s*=\s*''' || c.kind || ''''))
          )
       or exists (
            select 1 from public.ops_alert_kind_external_resolver x where x.kind = c.kind
          ));

  -- 1. Report any kind with open alerts that nothing can clear.
  for r in
    select k.kind,
           (select count(*) from public.alert_event a
             where a.resolved_at is null and a.kind = k.kind) as open_count,
           (select min(a.created_at) from public.alert_event a
             where a.resolved_at is null and a.kind = k.kind) as oldest_open
      from (select distinct kind from public.alert_event
             where resolved_at is null and kind <> 'unresolvable_alert_kind') k
     where not (k.kind = any (v_resolvable))
  loop
    v_n := v_n + public.mon_raise('P2', 'unresolvable_alert_kind', null,
      'unresolvable_alert_kind:' || r.kind,
      jsonb_build_object(
        'kind', r.kind,
        'open_count', r.open_count,
        'oldest_open', r.oldest_open,
        'why', 'This alert kind has open alerts but nothing can ever clear them: no public function '
               || 'calls mon_resolve_key or mon_resolve with this kind, none clears it with an '
               || 'inline alert_event update, and it is not registered in '
               || 'ops_alert_kind_external_resolver. A stale alert and a live one are therefore '
               || 'indistinguishable without hand adjudication, and the open-alert total stops '
               || 'meaning anything.',
        'fix', 'Give the kind a detector that RE-CHECKS its condition and clears it when clean. If '
               || 'the resolver genuinely lives outside the database, register it in '
               || 'ops_alert_kind_external_resolver with evidence naming the exact workflow or '
               || 'script. Do NOT hand-resolve the open alerts to clear this, and do NOT delete this '
               || 'detector: an alert kind that cannot be cleared is a ratchet.'));
  end loop;

  -- 2. Clear our OWN findings once a kind becomes resolvable — otherwise this detector is the very
  -- ratchet it reports. Reads the SAME v_resolvable computed above, so the halves cannot disagree.
  for r in
    select a.detail->>'kind' as kind
      from public.alert_event a
     where a.resolved_at is null
       and a.kind = 'unresolvable_alert_kind'
       and a.detail->>'kind' is not null
  loop
    if r.kind = any (v_resolvable)
       or not exists (select 1 from public.alert_event b
                       where b.resolved_at is null and b.kind = r.kind)
    then
      perform public.mon_resolve_key('unresolvable_alert_kind', 'unresolvable_alert_kind:' || r.kind);
    end if;
  end loop;

  return v_n;
end
$function$;
