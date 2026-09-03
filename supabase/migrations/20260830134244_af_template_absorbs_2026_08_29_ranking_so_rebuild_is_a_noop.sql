-- af_rpc_templates did not know about the 2026-08-29 ranking work, which made
-- rebuild_af_filter_rpcs() an OUTAGE TRIGGER rather than a repair.
--
-- BACKGROUND. Three migrations on 2026-08-29 (172402 ranking+p_rotation_seed, 172433 the emergency
-- overload drop, 172838 the fold into the diversity partition ORDER BY) redefined
-- public.location_search_candidates_ar DIRECTLY instead of going through af_rpc_templates +
-- rebuild_af_filter_rpcs(). None of them touched the template or the build state, so:
--   · alert af_parity_hand_edit (P1) has been open since 2026-08-29 17:43
--     (live aac854f1f448 vs built f4336f1d8058);
--   · the template still described the PRE-2026-08-29, 41-argument function. Because
--     rebuild_af_filter_rpcs() DROPS EVERY OVERLOAD FIRST and re-creates from the template, running
--     it would have reverted the owner's PERMANENT controlled-rotation rule (2026-08-29, tier 4) AND
--     dropped p_rotation_seed from the signature. PostgREST resolves named-parameter RPC calls by
--     EXACT parameter-name match and every live caller now sends p_rotation_seed, so every search
--     would have returned "function not found" — the mirror image of the PGRST203 incident that
--     172433 was written to end.
--
-- THE REPAIR, and why it is provably semantics-preserving. The new template is the CURRENT LIVE
-- definition with the single occurrence of af_eligibility_clause() swapped back out for the
-- __AF_ELIGIBILITY_WHERE__ placeholder — the same "templates from live defs" construction
-- 20260811130146 used to seed this table in the first place. Verified before applying: the clause
-- occurs EXACTLY ONCE in the live definition, the old template carried EXACTLY ONE placeholder, and
-- replace(new_template, placeholder, clause) equals pg_get_functiondef() BYTE FOR BYTE
-- (md5 aac854f1f4483863b142cb6cda9c1ae5 both sides). So the rebuild below re-creates a function
-- identical to the one production is already running: zero behaviour change, by construction.
--
-- FAIL-CLOSED. Every precondition is asserted, and after the rebuild the md5 of ALL FOUR AF RPCs
-- must equal what it was before. Any deviation raises, and because DDL is transactional in Postgres
-- the whole thing — template update and rebuild alike — rolls back with production untouched. This
-- migration can therefore only either fully succeed as a no-op or change nothing at all.
set local lock_timeout = '5s';
set local statement_timeout = '120s';

do $do$
declare
  live_def text; clause text; new_tpl text; n int;
  pre_md5 jsonb; post_md5 jsonb; k text;
begin
  -- ── preconditions ────────────────────────────────────────────────────────────────────────────
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'location_search_candidates_ar' and p.prokind = 'f';
  if n <> 1 then
    raise exception 'expected exactly 1 overload of location_search_candidates_ar, found %', n;
  end if;

  select pg_get_functiondef(p.oid) into strict live_def
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'location_search_candidates_ar' and p.prokind = 'f';

  clause := public.af_eligibility_clause();

  -- the clause must appear exactly once, or a blind replace would corrupt the template
  n := (length(live_def) - length(replace(live_def, clause, ''))) / length(clause);
  if n <> 1 then
    raise exception 'af_eligibility_clause() occurs % times in the live definition (expected 1)', n;
  end if;

  -- the placeholder must not already be present in live text
  if position('__AF_ELIGIBILITY_WHERE__' in live_def) <> 0 then
    raise exception 'live definition already contains the placeholder token';
  end if;

  new_tpl := replace(live_def, clause, '__AF_ELIGIBILITY_WHERE__');

  -- the round trip must be EXACT — this is the whole safety argument
  if replace(new_tpl, '__AF_ELIGIBILITY_WHERE__', clause) is distinct from live_def then
    raise exception 'round trip is not byte-exact — refusing to touch the template';
  end if;

  -- and the new template must actually carry the 2026-08-29 behaviour we are rescuing
  if new_tpl not like '%p_rotation_seed%' then raise exception 'new template lost p_rotation_seed'; end if;
  if new_tpl not like '%has_photo%'       then raise exception 'new template lost the photo-preference ranking'; end if;
  if new_tpl not like 'CREATE OR REPLACE FUNCTION%' then raise exception 'new template is not executable DDL'; end if;

  -- ── snapshot every AF RPC definition BEFORE the rebuild ──────────────────────────────────────
  select jsonb_object_agg(p.proname, md5(pg_get_functiondef(p.oid))) into pre_md5
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prokind = 'f'
     and p.proname in (select fn_name from public.af_rpc_templates);

  -- ── the actual change ────────────────────────────────────────────────────────────────────────
  update public.af_rpc_templates
     set template = new_tpl
   where fn_name = 'location_search_candidates_ar';
  if not found then raise exception 'no af_rpc_templates row for location_search_candidates_ar'; end if;

  perform public.rebuild_af_filter_rpcs();

  -- ── the rebuild must have been a NO-OP on all four surfaces ──────────────────────────────────
  select jsonb_object_agg(p.proname, md5(pg_get_functiondef(p.oid))) into post_md5
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prokind = 'f'
     and p.proname in (select fn_name from public.af_rpc_templates);

  if pre_md5 is distinct from post_md5 then
    for k in select jsonb_object_keys(pre_md5) loop
      if pre_md5 -> k is distinct from post_md5 -> k then
        raise warning 'CHANGED %: % -> %', k, pre_md5 ->> k, post_md5 ->> k;
      end if;
    end loop;
    raise exception 'rebuild changed at least one AF RPC definition — rolling back, production untouched';
  end if;

  -- build state must now agree with live, which is what closes af_parity_hand_edit
  if exists (
    select 1 from public.af_rpc_build_state bs
     where bs.def_md5 is distinct from (
       select md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
        where ns.nspname = 'public' and p.proname = bs.fn_name and p.prokind = 'f')
  ) then
    raise exception 'build state still disagrees with live after rebuild';
  end if;

  raise notice 'AF template repair OK — all four RPCs byte-identical, build state now matches live';
end
$do$;
