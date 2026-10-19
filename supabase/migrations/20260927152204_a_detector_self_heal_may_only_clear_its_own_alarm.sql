-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- A DETECTOR'S SELF-HEAL MAY ONLY CLEAR ITS OWN ALARM
-- routine-8 (regression hunter), 2026-09-27. Object 2: a repair that reached three of four siblings.
--
-- mon_resolve(kind, platform) closes EVERY open alert with that kind and platform, whatever its
-- dedup_key. mon_resolve_key(kind, dedup_key) closes exactly one. When two detectors share a
-- (kind, platform) pair, a detector that self-heals with the broad form silences the OTHER one's
-- open alert every time its own condition happens to be false — and it does so on the clean run,
-- which is the run nobody reads.
--
-- THE SEAM. Neither detector is wrong alone. `mon_detect_orphan_detector_is_blind` raises and clears
-- its own alarm correctly; `mon_detect_alert_subject_fk_is_blind` raises its own correctly. Testing
-- either in isolation passes. The defect exists only when both are open at once, and only one of the
-- two is looking.
--
-- MEASURED ON PRODUCTION, 2026-09-27, over every mon_detect_* body in pg_proc:
--   `blind_guard`      raised by FOUR detectors. THREE resolve BY KEY —
--                      mon_detect_unreachable_listing_table_is_blind even carries a comment saying
--                      to use the key form and why. So the rule was already known and already
--                      written down. mon_detect_orphan_detector_is_blind kept the broad form, and it
--                      shares ('blind_guard','all') with mon_detect_alert_subject_fk_is_blind.
--   `monitor_integrity` raised by two detectors; the broad resolver was
--                      mon_detect_canon_direction_contract, landed by THIS routine forty minutes
--                      earlier in 20260927144840 — so this migration repairs its author's own
--                      instance of the class it is fixing.
--
-- LATENT, NOT REALISED: `select * from alert_event where kind='blind_guard'` is EMPTY all-time, so no
-- blind_guard alarm has ever been silenced by this. That is why it is a P2 and not an incident report
-- about lost coverage. It is still worth closing: the alarm it would silence is the one that says a
-- barrier has gone blind, and «two are open at once» is exactly when that matters.
--
-- WHY THE PREDICATE STRIPS COMMENTS, measured: the first version of mon_broad_self_heals() below
-- flagged mon_detect_unreachable_listing_table_is_blind, which resolves BY KEY and is entirely
-- correct — it matched the word «mon_resolve('blind_guard', ...)» inside that detector's own comment
-- WARNING against the broad form. A barrier that flags the file documenting the rule is the kind that
-- gets switched off in a week, so the predicate reads code, not prose. Cutting each line at its first
-- «--» loses nothing real: everything after «--» is comment by definition, and a call written BEFORE
-- a trailing comment on the same line is still seen (asserted in the self-test).
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1. this routine's own two detectors, from 20260927144840 ──────────────────────────────────────
create or replace function public.mon_detect_facade_lost_to_vocabulary()
 returns integer language plpgsql security definer set search_path to 'public'
as $fn$
declare n int := 0; losses jsonb; rows_lost bigint;
begin
  select coalesce(jsonb_agg(jsonb_build_object('table', tbl, 'raw', raw, 'active', n_active)
                            order by n_active desc), '[]'::jsonb),
         coalesce(sum(n_active), 0)
    into losses, rows_lost
    from public.mon_facade_vocabulary_losses();

  if rows_lost > 0 then
    n := public.mon_raise('P2', 'cross_surface_scraper_af', 'fleet', 'facade_lost_to_vocabulary',
      jsonb_build_object('active_rows_lost', rows_lost, 'values', losses,
        'means', 'these listings state ONE compass facade at source and canon_direction_ar() reads '
              || 'none of it, so «الواجهة» cannot reach them and their cards show no facade. The '
              || 'scraper is faithful and the Advanced Filter is honest — the gap is between them.',
        'fix', 'extend fold_direction_variants_ar / canon_direction_en_extended_ar for the spelling, '
            || 'never the one platform; then refresh listing_extra_attrs_mv and sync_search_listings_ar'));
  else
    perform public.mon_resolve_key('cross_surface_scraper_af', 'facade_lost_to_vocabulary');
  end if;
  return n;
end
$fn$;

create or replace function public.mon_detect_canon_direction_contract()
 returns integer language plpgsql security definer set search_path to 'public'
as $fn$
declare v text; n int := 0;
begin
  v := public.canon_direction_selftest();
  if v <> 'PASS' then
    n := public.mon_raise('P2', 'monitor_integrity', 'fleet', 'canon_direction_contract_broken',
      jsonb_build_object('selftest', v,
        'means', 'canon_direction_ar() no longer answers the facade vocabulary contract, or the '
              || 'loss predicate can no longer catch an unreadable bearing. Either way facades are '
              || 'being discarded or lost silently again (routine-8, 2026-09-27).'));
  else
    perform public.mon_resolve_key('monitor_integrity', 'canon_direction_contract_broken');
  end if;
  return n;
end
$fn$;

-- ── 2. the sibling that kept the broad form ──────────────────────────────────────────────────────
-- Needle-edited from the LIVE body: this detector is redefined by several migrations and pasting an
-- older body would revert whoever changed it last.
do $patch$
declare
  src     text;
  old_ln  constant text := 'perform public.mon_resolve(''blind_guard'', ''all'');';
  new_ln  constant text := 'perform public.mon_resolve_key(''blind_guard'', ''blind_guard:mon_detect_orphaned_detectors'');';
begin
  src := pg_get_functiondef('public.mon_detect_orphan_detector_is_blind()'::regprocedure);
  if position(new_ln in src) > 0 then
    raise notice 'mon_detect_orphan_detector_is_blind already self-heals by key — nothing to patch';
    return;
  end if;
  if (length(src) - length(replace(src, old_ln, ''))) / length(old_ln) <> 1 then
    raise exception 'the broad self-heal was not found exactly once in the live body — refusing to guess';
  end if;
  if position('''blind_guard:mon_detect_orphaned_detectors''' in src) = 0 then
    raise exception 'the live body does not raise blind_guard:mon_detect_orphaned_detectors — refusing to guess its key';
  end if;
  execute replace(src, old_ln, new_ln);
end
$patch$;

-- ── 3. the class barrier: a shared kind may never be cleared broadly ─────────────────────────────
-- Discovered from pg_proc at run time, and the "shared" test is COMPUTED, never a list: a kind counts
-- as shared the moment a second mon_detect_* raises it. So a detector that self-heals broadly on a
-- kind only it uses today goes red automatically the day someone adds a second raiser — which is the
-- exact moment the hazard becomes real, and the moment nobody would otherwise be looking.
create or replace function public.mon_detector_code_lines(p_src text)
 returns text language sql immutable
as $fn$
  -- each line cut at its first «--»: prose cannot be mistaken for a call, and a call written before a
  -- trailing comment on the same line survives the cut.
  select string_agg(split_part(ln, '--', 1), E'\n')
    from unnest(string_to_array(coalesce(p_src, ''), E'\n')) as ln;
$fn$;

create or replace function public.mon_broad_self_heals()
 returns table(detector text, kind text, raisers int)
 language sql stable security definer set search_path to 'public'
as $fn$
  with d as (
    select p.proname::text as proname,
           public.mon_detector_code_lines(pg_get_functiondef(p.oid)) as src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'mon\_detect%'),
  raises as (
    select proname, lower((regexp_matches(src, 'mon_raise\(\s*''[^'']*''\s*,\s*''([^'']+)''', 'g'))[1]) as kind
      from d),
  resolves as (
    select distinct proname, lower((regexp_matches(src, 'mon_resolve\(\s*''([^'']+)''', 'g'))[1]) as kind
      from d)
  select r.proname, r.kind, cnt.n::int
    from resolves r
    join lateral (select count(distinct x.proname) as n from raises x where x.kind = r.kind) cnt on true
   where cnt.n > 1;
$fn$;

create or replace function public.mon_detect_detector_self_heal_too_broad()
 returns integer language plpgsql security definer set search_path to 'public'
as $fn$
declare n int := 0; offenders jsonb; c int;
begin
  select coalesce(jsonb_agg(jsonb_build_object('detector', detector, 'kind', kind, 'raisers', raisers)
                            order by detector), '[]'::jsonb), count(*)
    into offenders, c
    from public.mon_broad_self_heals();

  if c > 0 then
    n := public.mon_raise('P2', 'monitor_integrity', 'fleet', 'detector_self_heal_too_broad',
      jsonb_build_object('offenders', offenders,
        'means', 'these detectors clear their alarm with the kind-and-platform form, which closes '
              || 'EVERY open alert of that kind — and the kind is raised by more than one detector. '
              || 'On a clean run they silence a sibling alarm, which is the run nobody reads.',
        'fix', 'resolve BY KEY, naming that detector''s own dedup_key'));
  else
    perform public.mon_resolve_key('monitor_integrity', 'detector_self_heal_too_broad');
  end if;
  return n;
end
$fn$;

-- ── 4. the self-test: FIRE on an injected offender, stay silent on a by-key one AND on prose ──────
create or replace function public.mon_self_heal_scope_selftest()
 returns text language plpgsql security definer set search_path to 'public'
as $fn$
declare v_result text := 'PASS'; v_broad int; v_key int; v_prose int; v_trail int; v_live int;
begin
  begin
    -- three fixtures raising ONE shared kind so the kind is genuinely shared. (a) clears broadly,
    -- (b) clears by key, (c) clears by key and only MENTIONS the broad form in a comment — the
    -- false positive that this predicate was rebuilt to stop.
    execute $q$create function public.mon_detect_selftest_scope_a() returns int language plpgsql as
      $b$begin perform public.mon_raise('P3','selftest_shared_kind','fleet','selftest:a','{}'::jsonb);
               perform public.mon_resolve('selftest_shared_kind','fleet'); return 0; end$b$;$q$;
    execute $q$create function public.mon_detect_selftest_scope_b() returns int language plpgsql as
      $b$begin perform public.mon_raise('P3','selftest_shared_kind','fleet','selftest:b','{}'::jsonb);
               perform public.mon_resolve_key('selftest_shared_kind','selftest:b'); return 0; end$b$;$q$;
    execute $q$create function public.mon_detect_selftest_scope_c() returns int language plpgsql as
      $b$begin perform public.mon_raise('P3','selftest_shared_kind','fleet','selftest:c','{}'::jsonb);
               -- BY KEY, never mon_resolve('selftest_shared_kind', ...) which would clear a sibling
               perform public.mon_resolve_key('selftest_shared_kind','selftest:c'); return 0; end$b$;$q$;
    -- (d) the broad call written BEFORE a trailing comment on the same line must still be caught.
    execute $q$create function public.mon_detect_selftest_scope_d() returns int language plpgsql as
      $b$begin perform public.mon_raise('P3','selftest_shared_kind','fleet','selftest:d','{}'::jsonb);
               perform public.mon_resolve('selftest_shared_kind','fleet'); -- trailing prose
               return 0; end$b$;$q$;

    select count(*) into v_broad from public.mon_broad_self_heals() where detector = 'mon_detect_selftest_scope_a';
    select count(*) into v_key   from public.mon_broad_self_heals() where detector = 'mon_detect_selftest_scope_b';
    select count(*) into v_prose from public.mon_broad_self_heals() where detector = 'mon_detect_selftest_scope_c';
    select count(*) into v_trail from public.mon_broad_self_heals() where detector = 'mon_detect_selftest_scope_d';

    if v_broad <> 1 then
      v_result := format('FAIL: the predicate did not catch a broad self-heal on a shared kind (got %s)', v_broad);
    elsif v_key <> 0 then
      v_result := format('FAIL: it flagged a detector that resolves BY KEY (got %s) — it would cry wolf', v_key);
    elsif v_prose <> 0 then
      v_result := format('FAIL: it flagged a by-key detector because its COMMENT names the broad form '
                      || '(got %s) — reading prose as code is how a barrier gets switched off', v_prose);
    elsif v_trail <> 1 then
      v_result := format('FAIL: it missed a broad self-heal written before a trailing comment (got %s) '
                      || '— stripping comments must not blind the check', v_trail);
    end if;

    raise exception 'selftest rollback';          -- always: the fixtures never survive
  exception when others then
    if sqlerrm <> 'selftest rollback' then
      v_result := 'FAIL: ' || sqlerrm;
    end if;
  end;

  if v_result = 'PASS' then
    select count(*) into v_live from public.mon_broad_self_heals();
    if v_live <> 0 then
      v_result := format('FAIL: %s live detector(s) still clear a shared kind broadly', v_live);
    end if;
  end if;
  return v_result;
end
$fn$;

create or replace function public.mon_detect_self_heal_scope_contract()
 returns integer language plpgsql security definer set search_path to 'public'
as $fn$
declare v text; n int := 0;
begin
  v := public.mon_self_heal_scope_selftest();
  if v <> 'PASS' then
    n := public.mon_raise('P2', 'monitor_integrity', 'fleet', 'self_heal_scope_contract_broken',
      jsonb_build_object('selftest', v,
        'means', 'the guard that stops one detector silencing another alarm can no longer tell a '
              || 'broad self-heal from a by-key one (routine-8, 2026-09-27).'));
  else
    perform public.mon_resolve_key('monitor_integrity', 'self_heal_scope_contract_broken');
  end if;
  return n;
end
$fn$;

-- ── 5. the roster, in this same migration ────────────────────────────────────────────────────────
do $roster$
declare
  src     text;
  anchor  constant text := '    ''mon_detect_facade_lost_to_vocabulary'',';
  added   constant text := '    ''mon_detect_facade_lost_to_vocabulary'',' || E'\n'
    || '    ''mon_detect_detector_self_heal_too_broad'',' || E'\n'
    || '    ''mon_detect_self_heal_scope_contract'',';
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_detector_self_heal_too_broad' in src) > 0 then
    raise notice 'self-heal scope detectors are already on the roster';
    return;
  end if;
  if (length(src) - length(replace(src, anchor, ''))) / length(anchor) <> 1 then
    raise exception 'the roster anchor was not found exactly once in the live body — refusing to guess';
  end if;
  execute replace(src, anchor, added);
end
$roster$;

-- ── 6. it must hold now, not at the next sweep ───────────────────────────────────────────────────
do $prove$
declare v text; c int;
begin
  v := public.mon_self_heal_scope_selftest();
  if v <> 'PASS' then raise exception 'self-heal scope selftest did not pass: %', v; end if;
  select count(*) into c from public.mon_broad_self_heals();
  if c <> 0 then raise exception '% detector(s) still clear a shared alert kind broadly', c; end if;
  if position('mon_detect_detector_self_heal_too_broad'
              in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'the self-heal scope detector is not reachable from mon_run_all_detectors';
  end if;
  if public.canon_direction_selftest() <> 'PASS' then
    raise exception 'the facade vocabulary contract regressed: %', public.canon_direction_selftest();
  end if;
  raise notice 'self-heal scope: 0 broad resolvers on a shared kind, both detectors on the roster, facade contract still PASS';
end
$prove$;
