-- TWO DEFECTS IN mon_detect_unresolvable_alert_kinds() AS FIRST SHIPPED (same session, 2026-08-21).
--
-- 1. THE PREDICATE COULD BE SATISFIED BY A COMMENT. It counted a function as a resolver for a kind
--    if the function's definition contained BOTH the literal 'mon_resolve_key' anywhere AND the kind
--    name anywhere. Prose qualifies. Proof: the detector exempted ITSELF, purely because its own
--    explanatory text contains the phrase "mon_resolve_key". A barrier that a comment can satisfy is
--    not a barrier. Measured across all 24 open kinds, loose and strict agreed everywhere EXCEPT that
--    self-exemption — so the tightening costs no real coverage and removes the one false pass.
--
-- 2. THE ANTI-RATCHET DETECTOR WAS ITSELF A RATCHET. It never called mon_resolve_key, so once a kind
--    was flagged the finding stayed open even after someone gave that kind a proper resolver — the
--    exact failure mode it exists to report. It now clears its own alert the moment the kind becomes
--    resolvable, which also makes it strictly self-consistent: its body now contains a real
--    mon_resolve_key('unresolvable_alert_kind', ...) call, so it passes its own strict test for the
--    right reason instead of by accident.

create or replace function public.mon_detect_unresolvable_alert_kinds()
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n int := 0;
  r record;
begin
  -- STRICT: the function must actually CALL mon_resolve_key with this kind as the first argument.
  -- Mentioning both strings in a comment no longer counts.
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
               || 'function actually calls mon_resolve_key with this kind, and it is not registered '
               || 'in ops_alert_kind_external_resolver. A stale alert and a live one are therefore '
               || 'indistinguishable without hand adjudication, and the open-alert total stops '
               || 'meaning anything.',
        'fix', 'Give the kind a detector that RE-CHECKS its condition and calls mon_resolve_key when '
               || 'clean. If the resolver genuinely lives outside the database, register it in '
               || 'ops_alert_kind_external_resolver with evidence naming the exact workflow or '
               || 'script. Do NOT hand-resolve the open alerts to clear this, and do NOT delete this '
               || 'detector: an alert kind that cannot be cleared is a ratchet.'));
  end loop;

  -- AND CLEAR OUR OWN FINDINGS once a kind becomes resolvable — otherwise this detector is the very
  -- ratchet it reports. This is the real call that makes the strict test above true for our own kind.
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
            and pg_get_functiondef(p.oid) ~ ('mon_resolve_key\s*\(\s*''' || r.kind || '''')
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

-- Prove, in this migration, that the detector now passes its OWN strict test for a real reason.
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'mon_detect_unresolvable_alert_kinds'
       and pg_get_functiondef(p.oid) ~ 'mon_resolve_key\s*\(\s*''unresolvable_alert_kind'''
  ) then
    raise exception 'the detector still cannot clear its own findings — it would be a ratchet';
  end if;
end $$;
