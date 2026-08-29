-- Systems Seam Engineer, 2026-08-29.
-- SEAM: two sibling detectors disagreeing about what "resolvable" means.
--
-- BUG. mon_detect_unresolvable_detector() tells engineers, in its own alert payload, exactly how to
-- make a detector able to close its alerts:
--     "FIX: call mon_resolve_stale_keys(kind, live_keys) on the detector's EVALUATED path"
-- mon_detect_unresolvable_alert_kinds() then decides whether a kind is resolvable by matching, on
-- the function source, only:
--     mon_resolve_key\s*\(\s*'<kind>'   |   mon_resolve\s*\(\s*'<kind>'   |   an inline UPDATE
-- Neither alternative matches mon_resolve_stale_keys(: after "mon_resolve" the regex demands
-- optional whitespace and then "(", and what actually follows is "_stale_keys(".
--
-- So the repo's OWN recommended fix is invisible to the detector that grades it. Follow the advice
-- and the other detector stays red forever.
--
-- This is not one alert. THIRTY public functions resolve their kind through mon_resolve_stale_keys
-- -- it is the standard pattern here -- and the recogniser matched none of them. Of the 9 open
-- unresolvable_alert_kind alerts at the time of this migration, FIVE were false positives whose
-- kind is provably clearable:
--     run_duration_explosion   <- mon_detect_run_duration_explosion
--     silent_partial_success   <- mon_detect_silent_partial_success
--     silent_scraper_death     <- mon_detect_silent_scraper_death
--     legacy_scraper_freshness <- mon_detect_legacy_alert_tables
--     transcript_missing_for_chat <- mon_detect_transcript_integrity (fixed earlier today, 20260829182006)
-- The remaining four (duplicate_card_surface_routed, region_label_in_city_field, run_field_range,
-- stale_breaker_escape) have no resolver anywhere and are TRUE positives; they must stay open.
--
-- Why this matters rather than being cosmetic: this detector's own stated purpose is that
-- "the open-alert total stops meaning anything" once stale and live alerts are indistinguishable.
-- A recogniser that under-counts resolvers manufactures exactly that ambiguity itself.
--
-- This WIDENS a predicate, so state the test plainly rather than waving it through: does
-- mon_resolve_stale_keys actually clear alerts of the kind it is passed? Its whole body is
--     update public.alert_event set resolved_at = now()
--      where kind = p_kind and resolved_at is null and not (dedup_key = any (...))
-- -- it resolves BY KIND, and it demonstrably did so in production today (it closed alert 1087,
-- transcript_missing:h17879680772543666, at 18:20:11 UTC). Recognising it corrects a false negative
-- about reality; it does not lower the bar. A kind with no resolver at all is still flagged, and the
-- mutation proof below is required to show both directions.

do $mig$
declare src text; newsrc text; anchor text; replacement text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_detect_unresolvable_alert_kinds';

  if src is null then
    raise exception 'mon_detect_unresolvable_alert_kinds() not found -- refusing to guess';
  end if;

  if position('mon_resolve_stale_keys' in src) > 0 then
    raise notice 'recogniser already knows mon_resolve_stale_keys -- nothing to do';
    return;
  end if;

  anchor := $anch$or f.def ~ ('mon_resolve\s*\(\s*''' || c.kind || '''')$anch$;

  if position(anchor in src) = 0 then
    raise exception 'resolver-recognition anchor not found in the live function -- refusing to edit blind';
  end if;

  -- Needle edit: one added alternation, nothing removed, nothing loosened.
  replacement := anchor || chr(10)
    || $add$                or f.def ~ ('mon_resolve_stale_keys\s*\(\s*''' || c.kind || '''')$add$;

  newsrc := replace(src, anchor, replacement);
  if newsrc = src then
    raise exception 'needle edit produced no change';
  end if;

  execute newsrc;
end
$mig$;

do $chk$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname='mon_detect_unresolvable_alert_kinds'
       and position('mon_resolve_stale_keys' in pg_get_functiondef(p.oid)) > 0)
  then
    raise exception 'recogniser did NOT gain mon_resolve_stale_keys';
  end if;
end
$chk$;


-- THE BARRIER
-- The bug class is not "mon_resolve_stale_keys was missing from a list". It is that the STRICT
-- recogniser in mon_detect_unresolvable_alert_kinds() is a hand-maintained enumeration of resolver
-- spellings, and nothing noticed when reality grew a spelling it did not know. Adding one more
-- alternation fixes today's instance and leaves the class wide open: the next resolver helper
-- someone writes will be invisible in exactly the same way, and will again manufacture false P2s
-- against the very signal that detector exists to protect.
--
-- So this detector watches the recogniser from the outside, with a deliberately BROADER rule than
-- the one it is grading: for every kind currently reported as unresolvable, does ANY public
-- function call ANY mon_resolve* helper with that kind as a literal? If the broad rule finds a
-- resolver the strict rule missed, the strict rule has fallen behind reality -- and that is the
-- finding, not the alert it produced.
--
-- The asymmetry is the point and must be preserved: the strict rule stays strict (it is what
-- prevents a comment or a coincidence counting as a resolver), and this one is allowed to be loose
-- precisely because it never resolves anything itself -- it only reports a disagreement between two
-- halves that are supposed to agree. Do not "simplify" this by making both use the same predicate:
-- two identical checks cannot disagree, and the disagreement is the entire signal.
CREATE OR REPLACE FUNCTION public.mon_detect_resolver_recognition_gap()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
declare
  n int := 0;
  v_gaps jsonb;
  v_count int;
begin
  with fns as (
    select p.proname, pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
     where n2.nspname = 'public' and p.prokind = 'f'
  ),
  reported as (
    -- every kind the strict recogniser is currently calling unresolvable
    select a.detail->>'kind' as kind
      from public.alert_event a
     where a.resolved_at is null
       and a.kind = 'unresolvable_alert_kind'
       and a.detail->>'kind' is not null
  ),
  gap as (
    select r.kind,
           (select string_agg(f.proname, ', ' order by f.proname) from fns f
             where f.proname <> 'mon_detect_resolver_recognition_gap'
               and f.def ~ ('mon_resolve[a-z_]*\s*\(\s*''' || r.kind || '''')) as resolvers
      from reported r
  )
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'resolved_by', resolvers)
                            order by kind), '[]'::jsonb),
         count(*)
    into v_gaps, v_count
    from gap where resolvers is not null;

  if v_count > 0 then
    n := public.mon_raise('P2', 'resolver_recognition_gap', 'all', 'resolver_recognition_gap',
      jsonb_build_object(
        'count', v_count,
        'gaps', v_gaps,
        'why', 'mon_detect_unresolvable_alert_kinds() is reporting these kinds as impossible to '
            || 'clear, but a public function DOES call a mon_resolve* helper with that exact kind. '
            || 'Its resolvability test is a hand-maintained list of resolver spellings, and reality '
            || 'has grown one the list does not know -- so it is manufacturing false P2s against '
            || 'the open-alert signal it exists to protect. This already happened once: 30 '
            || 'detectors resolve via mon_resolve_stale_keys (the pattern '
            || 'mon_detect_unresolvable_detector''s own payload tells engineers to use) and the '
            || 'recogniser matched none of them, because its regex demanded "(" straight after '
            || '"mon_resolve".',
        'adjudicate', 'Read the named function and confirm the helper really does clear alert_event '
            || 'rows of that kind (mon_resolve_stale_keys, for example, updates resolved_at where '
            || 'kind = p_kind). If it does, add that spelling to the STRICT recogniser as one more '
            || 'alternation. If it does not actually resolve, the function is the bug, not the '
            || 'recogniser.',
        'do_not', 'Do NOT make the strict recogniser use this detector''s broad regex. The strict '
            || 'one is strict on purpose -- it is what stops a mention in a comment, or an '
            || 'unrelated helper, counting as a resolver. Two checks that share a predicate cannot '
            || 'disagree, and the disagreement is the entire signal here. Do NOT hand-resolve the '
            || 'false unresolvable_alert_kind alerts either: fix the recogniser and let it clear '
            || 'its own findings, which it already knows how to do.'));
  else
    perform public.mon_resolve_key('resolver_recognition_gap', 'resolver_recognition_gap');
  end if;

  return n;
end $fn$;


-- ROSTER -- needle edit of the LIVE roster, same migration as the detector.
do $mig2$
declare src text; newsrc text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';

  if src is null then
    raise exception 'mon_run_all_detectors() not found -- refusing to guess a roster';
  end if;

  if position('mon_detect_resolver_recognition_gap' in src) > 0 then
    raise notice 'already on the roster -- nothing to do';
    return;
  end if;

  if (select count(*) from regexp_matches(src, '''mon_detect_unresolvable_alert_kinds''', 'g')) <> 1 then
    raise exception 'anchor mon_detect_unresolvable_alert_kinds not found exactly once in the live roster';
  end if;

  newsrc := replace(src,
    '''mon_detect_unresolvable_alert_kinds''',
    '''mon_detect_unresolvable_alert_kinds'',' || chr(10) || '    ''mon_detect_resolver_recognition_gap''');

  if newsrc = src then
    raise exception 'needle edit produced no change';
  end if;

  execute newsrc;
end
$mig2$;

do $chk2$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public' and p.proname='mon_run_all_detectors';
  if position('mon_detect_resolver_recognition_gap' in src) = 0 then
    raise exception 'mon_detect_resolver_recognition_gap is NOT on the roster after the edit';
  end if;
  -- both detectors added earlier in this session must still be there: a needle edit built from a
  -- stale body would have silently dropped them.
  if position('mon_detect_stuck_open_alert' in src) = 0
     or position('mon_detect_outbound_http_failures' in src) = 0 then
    raise exception 'an earlier detector fell off the roster -- stale-body edit detected';
  end if;
end
$chk2$;
