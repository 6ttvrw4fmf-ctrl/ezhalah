-- THE ORACLE STOPPED MIRRORING THE FUNCTION IT CLAIMS TO MIRROR — routine #7.
--
-- mon_detect_search_index_diverges_from_sync_source() predicts what sync_search_listings_ar() would
-- write into search_listings_ar.rent_period_ar, and raises P1 on any row where the served index
-- disagrees. Its own header says the expression "MIRRORS sync_search_listings_ar, including the
-- owner's 2026-08-18 annual fallback". It no longer does. The owner retired that fallback
-- (migration unknown_rent_period_stays_unknown_never_defaults_to_annual): an unknown rent period now
-- STAYS UNKNOWN. The live sync writes
--
--   case v.rent_period when 'monthly' then 'شهري' when 'annual' then 'سنوي'
--        else case when v.platform in ('gathern','aqarmonthly') then 'شهري' else null::text end end
--
-- while this detector still predicted «سنوي» for the same rows. sync_search_listings_ar was updated;
-- its oracle was not.
--
-- WHAT THAT COST, measured 2026-09-12. Alert 1352 (P1, dedup_key
-- search_index_diverges_from_sync_source) has been OPEN since 2026-09-03 17:59 — nine days, filed to
-- a GitHub issue — naming 1,000+ rows across 15 platforms as divergent. Every one of them is
-- correct: index NULL, sync would write NULL, they agree. The detector was reporting the retired
-- fallback as damage.
--
-- The second consequence is the dangerous one, and it is the reason this is a fix rather than a
-- tidy-up. mon_raise() returns 0 for a dedup key that is already open. So while this false alert
-- stands, a GENUINE divergence — a raw-layer repair whose index leg was written without refreshing
-- active_listing_ids_v2, which is precisely what this detector exists to catch — raises nothing,
-- dispatches nothing, and leaves the roster count at 0. The detector has been unable to report its
-- own class for nine days while reading green on every sweep. That is the nine-dark-detectors shape
-- AGENTS.md records, arriving through a stale oracle instead of a stale roster.
--
-- THIS DOES NOT LOOSEN THE DETECTOR. The predicate is unchanged in strength: it still flags every
-- row where the index disagrees with what the sync would write. It is corrected to compare against
-- what the sync ACTUALLY writes today, which is what makes it able to fire at all. Widening a
-- threshold would have been the forbidden move; this narrows nothing and restores everything.
--
-- BUILT BY NEEDLE-EDIT FROM THE LIVE BODY, never from a copy. A concurrent session re-creating this
-- function from a stale body would silently drop whatever landed in between, so the body is read out
-- of pg_get_functiondef() at apply time and each replacement is ASSERTED to have changed something.
--
-- AND IT NOW CHECKS ITS OWN MIRROR. A new limb reads sync_search_listings_ar()'s live definition and
-- raises search_index_oracle_stale (P1) if the expression this oracle copies is no longer in it. The
-- failure mode that produced this incident was silent for nine days precisely because nothing
-- compared the two copies; now the detector compares them itself, every sweep, and says so in the
-- honest direction — "my oracle is stale", not "a thousand rows are broken".
do $mig$
declare
  v_def        text;
  v_new        text;
  v_sync_expr  constant text :=
    'else case when v.platform in (''gathern'',''aqarmonthly'') then ''شهري'' else null::text end';
  v_limb       text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname = 'mon_detect_search_index_diverges_from_sync_source';
  if v_def is null then
    raise exception 'mon_detect_search_index_diverges_from_sync_source() does not exist';
  end if;

  -- 1. The oracle, in both places it appears (the WHERE predicate and the sample's
  --    sync_would_write field). Asserted: this must change exactly two occurrences.
  if (length(v_def) - length(replace(v_def, 'else ''سنوي'' end', ''))) / length('else ''سنوي'' end') <> 2 then
    raise exception 'expected 2 occurrences of the retired annual fallback, found %',
      (length(v_def) - length(replace(v_def, 'else ''سنوي'' end', ''))) / length('else ''سنوي'' end');
  end if;
  v_new := replace(v_def, 'else ''سنوي'' end', 'else null::text end');

  -- 2. The NOTE that documents the retired fallback as correct behaviour. Left stale it would tell
  --    the next reader the opposite of what the code now does.
  v_new := replace(v_new,
    'NOTE: a NULL source period ',
    'NOTE (corrected 2026-09-12): a NULL source period no longer maps to «سنوي» at all — the owner '
    || 'retired that fallback (unknown_rent_period_stays_unknown_never_defaults_to_annual) and the '
    || 'sync now leaves it NULL except on gathern/aqarmonthly. The superseded text read: a NULL source period ');

  -- 3. The self-mirror limb, anchored on the function's single trailing `return n;`.
  v_limb :=
    E'\n  -- SELF-MIRROR (2026-09-12). The expression above is a COPY of one inside\n'
 || E'  -- sync_search_listings_ar(), and this detector is only meaningful while the two agree. They\n'
 || E'  -- silently stopped agreeing for nine days when the owner retired the annual fallback, and the\n'
 || E'  -- detector spent that time reporting 1,000+ correct rows as damage while being unable to raise\n'
 || E'  -- a real divergence (its dedup key was already open, so mon_raise returned 0). So it now reads\n'
 || E'  -- the live sync and says the honest thing when the copy goes stale.\n'
 || E'  if position(' || quote_literal(v_sync_expr) || E'\n'
 || E'        in coalesce((select pg_get_functiondef(p.oid) from pg_proc p\n'
 || E'                      where p.pronamespace = ''public''::regnamespace\n'
 || E'                        and p.proname = ''sync_search_listings_ar''), '''')) = 0 then\n'
 || E'    n := n + public.mon_raise(''P1'', ''search_index_oracle_stale'', ''search_index'',\n'
 || E'      ''search_index_oracle_stale'',\n'
 || E'      jsonb_build_object(\n'
 || E'        ''expected_expression'', ' || quote_literal(v_sync_expr) || E',\n'
 || E'        ''why'', ''mon_detect_search_index_diverges_from_sync_source() predicts what ''\n'
 || E'               ''sync_search_listings_ar() would write for rent_period_ar by COPYING that ''\n'
 || E'               ''function''''s own case expression. The copy is no longer present in the live ''\n'
 || E'               ''sync, so this detector is now predicting behaviour production does not have. ''\n'
 || E'               ''Until it is re-mirrored, every verdict it gives about rent-period divergence ''\n'
 || E'               ''is unreliable in BOTH directions: it can report correct rows as damage, and ''\n'
 || E'               ''while that false alert sits open its dedup key makes a genuine divergence ''\n'
 || E'               ''unraisable.'',\n'
 || E'        ''action'', ''Read sync_search_listings_ar() and needle-edit this detector''''s oracle ''\n'
 || E'               ''to match it exactly. Do NOT silence this by deleting the check or by ''\n'
 || E'               ''widening the divergence predicate.''));\n'
 || E'  else\n'
 || E'    perform public.mon_resolve_key(''search_index_oracle_stale'', ''search_index_oracle_stale'');\n'
 || E'  end if;\n';

  if position(E'\n  return n;\nend $function$' in v_new) = 0 then
    raise exception 'could not anchor the self-mirror limb on the trailing return';
  end if;
  v_new := replace(v_new, E'\n  return n;\nend $function$', v_limb || E'\n  return n;\nend $function$');

  execute v_new;
end $mig$;

-- Prove it, in the same migration, against production as it stands right now.
do $verify$
declare v_raised int; v_open int; v_oracle_open int;
begin
  v_raised := public.mon_detect_search_index_diverges_from_sync_source();

  select count(*) into v_open from public.alert_event
   where resolved_at is null and kind = 'search_index_diverges_from_sync_source';
  select count(*) into v_oracle_open from public.alert_event
   where resolved_at is null and kind = 'search_index_oracle_stale';

  -- The 1,000+ "divergent" rows were the retired fallback. With the oracle corrected they agree, so
  -- the detector must take its resolve path and alert 1352 must close. If it does not, the rows are
  -- genuinely divergent and this migration has fixed the wrong thing.
  if v_open <> 0 then
    raise exception 'alert search_index_diverges_from_sync_source still open after the re-mirror '
      '(% open, detector raised %) — the divergence is real, not the oracle', v_open, v_raised;
  end if;

  -- The self-mirror limb must be able to tell the truth about the sync it just read.
  if v_oracle_open <> 0 then
    raise exception 'the self-mirror limb reports its own oracle stale immediately after being '
      'written from the live sync — the anchor expression is wrong';
  end if;
end $verify$;
