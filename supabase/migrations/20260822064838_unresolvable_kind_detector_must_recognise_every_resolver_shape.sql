-- The ratchet detector was itself calling working resolvers "ratchets" (senior run #35, 2026-08-22).
--
-- mon_detect_unresolvable_alert_kinds() (2026-08-21) reports an alert kind that "can never be
-- cleared". Its test is a literal `mon_resolve_key('<kind>'` call, deliberately strict so that
-- merely MENTIONING the two strings in a comment does not count. That strictness is right. The bug
-- is that mon_resolve_key is not the only resolver in this database:
--
--   mon_resolve('<kind>', platform)   — same job, older two-arg helper. Used by 4 open kinds.
--   update public.alert_event set resolved_at = now() where kind = '<kind>' ...
--                                    — a detector clearing its own findings inline. Used by 2 more.
--
-- Six of the fourteen kinds it was flagging clear perfectly well, and two of them were PROVEN to
-- clear during this very run: field_integrity (dealapp phone-band alert, resolved 06:41 after the
-- price was source-verified) and price_eq_area_or_ppm (resolved 06:35 after the aqar retraction) —
-- both were on the "can never be cleared" list at the moment they cleared.
--
-- WHY THIS MATTERS MORE THAN THE COUNT. Today's daily-engineer run escalated "15 alert kinds have no
-- resolver path — architecture-scale work" to the senior routine. The real number is 8. A barrier
-- that over-reports sends the next engineer to build resolvers that already exist, and — worse —
-- teaches everyone to discount the ratchet signal, which is exactly the signal that must stay
-- trustworthy.
--
-- THE FIX: recognise all three call shapes, in BOTH halves of the function (the reporting scan and
-- the self-clearing loop), so they can never disagree about what "resolvable" means. Nothing is
-- loosened about the comment trap: mon_resolve() must be a real call with the kind as a literal
-- first argument, and the inline-update shape must carry an actual
-- `update ... alert_event ... set resolved_at = now()` alongside a literal `kind = '<kind>'`.
-- mon_resolve() itself cannot match any kind, because its own body says `kind = p_kind` — a
-- parameter, not a literal — so it can never masquerade as a universal resolver.
--
-- Still genuinely unresolvable after this change, and correctly still reported (8):
--   duplicate_card_surface_routed, price_gate_withheld, region_label_in_city_field, run_field_range,
--   scraper_failure_step_change, stale_breaker_escape, stale_coverage_gate, stale_listings_detected
-- (PR #860 is already building the resolver for the last two — this run does not duplicate it.)

create or replace function public.mon_detect_unresolvable_alert_kinds()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_n int := 0;
  r record;
begin
  -- STRICT: the function must actually CALL a resolver with this kind as a literal, or clear the
  -- kind inline with a real update. Mentioning the strings in a comment still does not count.
  for r in
    with open_kinds as (
      select distinct kind from public.alert_event
       where resolved_at is null and kind <> 'unresolvable_alert_kind'
    ),
    fns as (
      select pg_get_functiondef(p.oid) as def
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'mon\_%'
    )
    select k.kind,
           (select count(*) from public.alert_event a
             where a.resolved_at is null and a.kind = k.kind) as open_count,
           (select min(a.created_at) from public.alert_event a
             where a.resolved_at is null and a.kind = k.kind) as oldest_open
      from open_kinds k
     where not exists (
             select 1 from fns f
              where f.def ~ ('mon_resolve_key\s*\(\s*''' || k.kind || '''')
                 or f.def ~ ('mon_resolve\s*\(\s*''' || k.kind || '''')
                 or (f.def ~* 'update\s+(public\.)?alert_event'
                     and f.def ~ 'resolved_at\s*=\s*now\(\)'
                     and f.def ~ ('kind\s*=\s*''' || k.kind || ''''))
           )
       and not exists (
             select 1 from public.ops_alert_kind_external_resolver x
              where x.kind = k.kind
           )
  loop
    v_n := v_n + public.mon_raise('P2', 'unresolvable_alert_kind', null,
      'unresolvable_alert_kind:' || r.kind,
      jsonb_build_object(
        'kind', r.kind,
        'open_count', r.open_count,
        'oldest_open', r.oldest_open,
        'why', 'This alert kind has open alerts but nothing can ever clear them: no public.mon_* '
               || 'function calls mon_resolve_key or mon_resolve with this kind, none clears it with '
               || 'an inline alert_event update, and it is not registered in '
               || 'ops_alert_kind_external_resolver. A stale alert and a live one are therefore '
               || 'indistinguishable without hand adjudication, and the open-alert total stops '
               || 'meaning anything.',
        'fix', 'Give the kind a detector that RE-CHECKS its condition and clears it when clean. If '
               || 'the resolver genuinely lives outside the database, register it in '
               || 'ops_alert_kind_external_resolver with evidence naming the exact workflow or '
               || 'script. Do NOT hand-resolve the open alerts to clear this, and do NOT delete this '
               || 'detector: an alert kind that cannot be cleared is a ratchet.'));
  end loop;

  -- AND CLEAR OUR OWN FINDINGS once a kind becomes resolvable — otherwise this detector is the very
  -- ratchet it reports. Uses the SAME three shapes as the scan above; if these two halves ever
  -- disagreed, the detector would raise findings it could not clear.
  for r in
    select a.detail->>'kind' as kind
      from public.alert_event a
     where a.resolved_at is null
       and a.kind = 'unresolvable_alert_kind'
       and a.detail->>'kind' is not null
  loop
    if exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname like 'mon\_%'
            and (pg_get_functiondef(p.oid) ~ ('mon_resolve_key\s*\(\s*''' || r.kind || '''')
              or pg_get_functiondef(p.oid) ~ ('mon_resolve\s*\(\s*''' || r.kind || '''')
              or (pg_get_functiondef(p.oid) ~* 'update\s+(public\.)?alert_event'
                  and pg_get_functiondef(p.oid) ~ 'resolved_at\s*=\s*now\(\)'
                  and pg_get_functiondef(p.oid) ~ ('kind\s*=\s*''' || r.kind || '''')))
       )
       or exists (select 1 from public.ops_alert_kind_external_resolver x where x.kind = r.kind)
       or not exists (select 1 from public.alert_event b
                       where b.resolved_at is null and b.kind = r.kind)
    then
      perform public.mon_resolve_key('unresolvable_alert_kind', 'unresolvable_alert_kind:' || r.kind);
    end if;
  end loop;

  return v_n;
end
$function$;

-- MUTATION PROOF, both directions, against live data — a barrier that only ever says "fine" is not
-- a barrier. Uses the exact predicate the function uses.
do $$
declare
  v_resolvable text[] := array['price_eq_area_or_ppm','field_integrity','price_source_mismatch',
                               'summary_only_capture','quarantine_growth',
                               'price_source_mismatch_stale_evidence'];
  v_not_resolvable text[] := array['run_field_range','scraper_failure_step_change',
                                   'region_label_in_city_field','price_gate_withheld'];
  k text;
  hit boolean;
begin
  foreach k in array v_resolvable loop
    select exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname like 'mon\_%'
         and (pg_get_functiondef(p.oid) ~ ('mon_resolve_key\s*\(\s*''' || k || '''')
           or pg_get_functiondef(p.oid) ~ ('mon_resolve\s*\(\s*''' || k || '''')
           or (pg_get_functiondef(p.oid) ~* 'update\s+(public\.)?alert_event'
               and pg_get_functiondef(p.oid) ~ 'resolved_at\s*=\s*now\(\)'
               and pg_get_functiondef(p.oid) ~ ('kind\s*=\s*''' || k || '''')))) into hit;
    if not hit then
      raise exception 'kind % has a working resolver but the widened predicate still misses it', k;
    end if;
  end loop;

  foreach k in array v_not_resolvable loop
    select exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname='public' and p.proname like 'mon\_%'
         and (pg_get_functiondef(p.oid) ~ ('mon_resolve_key\s*\(\s*''' || k || '''')
           or pg_get_functiondef(p.oid) ~ ('mon_resolve\s*\(\s*''' || k || '''')
           or (pg_get_functiondef(p.oid) ~* 'update\s+(public\.)?alert_event'
               and pg_get_functiondef(p.oid) ~ 'resolved_at\s*=\s*now\(\)'
               and pg_get_functiondef(p.oid) ~ ('kind\s*=\s*''' || k || '''')))) into hit;
    if hit then
      raise exception 'kind % has NO resolver but the widened predicate now waves it through — '
                      'the barrier has been loosened into uselessness', k;
    end if;
  end loop;
end $$;
