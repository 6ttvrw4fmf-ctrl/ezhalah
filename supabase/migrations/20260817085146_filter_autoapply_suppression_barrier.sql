-- Barrier for the bug CLASS: "a filter default the user never chose silently suppresses inventory
-- the app's own count surface promises."
--
-- Found live 2026-08-14 and again 2026-08-17 by the Search & Matching QA routine, both times BY HAND:
-- picking نوع=غرفة in the Normal Filter auto-applies «1 غرفة نوم» (owner rule 2026-07-06 — a room is a
-- single room). The results RPC then sends p_beds_exact=[1], and because the bedrooms predicate is
-- strict (unknown is excluded), الرياض/إيجار/سنوي/غرفة returns 1 row while the app's own
-- top_cities_by_deal_ar panel — which takes no bedrooms argument — promises 1,172 on the SAME screen.
-- 1,171 of those 1,172 rows simply have no source-published bedroom count.
--
-- WHAT THIS MIGRATION DOES AND DOES NOT DO
-- It does NOT change search semantics. Whether a type-derived bedrooms default should exclude rows whose
-- bedroom count is merely unrecorded is a product decision reserved to the owner (AGENTS.md RED list;
-- SEARCH_MATCH_QA_ENGINEER.md §18 "two valid product behaviours"), and it is already routed as the open
-- alert filter_default_suppresses_inventory:room. This migration only makes the class MACHINE-DETECTED,
-- so it is never rediscovered by hand again (§19/§26) and so the alert self-heals the moment the owner's
-- chosen behaviour lands.
--
-- ROSTER WIRING: this migration wires the new detector into mon_run_all_detectors() with the guarded
-- pg_get_functiondef NEEDLE-EDIT (splice one name before the mon_detect_orphaned_detectors anchor),
-- NOT a hand-pasted full body — a needle-edit cannot drop an entry it never read. See
-- scripts/verify-detector-roster-edits-are-guarded.ts and the 2026-08-10 repair for why this is the
-- only sanctioned way to touch the roster.

create table if not exists public.ops_filter_autoapply_rule (
  rule_key      text primary key,
  type_ar       text        not null,
  forced_field  text        not null check (forced_field in ('bedrooms')),
  forced_op     text        not null check (forced_op   in ('=', '>=')),
  forced_value  integer     not null,
  ui_source     text        not null,   -- where in the client the default is applied
  owner_ref     text,                   -- alert dedup_key this is routed under, when pending a decision
  note          text,
  created_at    timestamptz not null default now()
);

comment on table public.ops_filter_autoapply_rule is
  'MIRROR of the client-side filter defaults the Normal Filter applies on the user''s behalf when a نوع is '
  'picked. Kept in lockstep with src/app/index.tsx by scripts/verify-filter-autoapply-mirror.ts (npm test). '
  'Read by mon_detect_filter_default_suppresses_inventory(). Adding a row here is NOT what makes a default '
  'legal — it is what makes it WATCHED.';

insert into public.ops_filter_autoapply_rule
  (rule_key, type_ar, forced_field, forced_op, forced_value, ui_source, owner_ref, note)
values
  ('room', 'غرفة', 'bedrooms', '=', 1,
   'src/app/index.tsx — nowRoomOnly ? contextBedsList=[''1''] (owner rule 2026-07-06)',
   'filter_default_suppresses_inventory:room',
   'Room = a single room, so bedrooms is locked to 1. The chip is releasable, so nothing is unreachable '
   'by construction — but with the default standing, the strict bedrooms predicate drops every غرفة row '
   'whose source never published a bedroom count.')
on conflict (rule_key) do update
  set type_ar = excluded.type_ar, forced_field = excluded.forced_field,
      forced_op = excluded.forced_op, forced_value = excluded.forced_value,
      ui_source = excluded.ui_source, owner_ref = excluded.owner_ref, note = excluded.note;


-- Measurement, exposed separately so a human (or a test) can read the numbers without raising anything.
create or replace function public.mon_filter_autoapply_suppression()
returns table (rule_key text, type_ar text, deal_ar text, city_ar text,
               promised bigint, delivered bigint, suppressed bigint, kept_pct numeric)
language sql
security definer
set search_path to 'public'
as $$
  -- "promised" = what top_cities_by_deal_ar shows for (deal, type, city): it takes no bedrooms argument,
  -- so it can only ever count WITHOUT the auto-applied default.
  -- "delivered" = what location_search_candidates_ar returns once the client adds that default.
  select r.rule_key, r.type_ar, s.deal_ar, s.city_ar,
         count(*)                                                as promised,
         count(*) filter (where
           r.forced_field = 'bedrooms' and (
             (r.forced_op = '='  and s.bedrooms  = r.forced_value) or
             (r.forced_op = '>=' and s.bedrooms >= r.forced_value)))  as delivered,
         count(*) - count(*) filter (where
           r.forced_field = 'bedrooms' and (
             (r.forced_op = '='  and s.bedrooms  = r.forced_value) or
             (r.forced_op = '>=' and s.bedrooms >= r.forced_value)))  as suppressed,
         round(100.0 * count(*) filter (where
           r.forced_field = 'bedrooms' and (
             (r.forced_op = '='  and s.bedrooms  = r.forced_value) or
             (r.forced_op = '>=' and s.bedrooms >= r.forced_value))) / nullif(count(*), 0), 1) as kept_pct
    from public.ops_filter_autoapply_rule r
    join public.search_listings_ar s
      on s.type_ar = r.type_ar
   where s.production_ready
   group by r.rule_key, r.type_ar, s.deal_ar, s.city_ar
  having count(*) >= 50            -- ignore long-tail cities where a few rows prove nothing
   order by (count(*) - count(*) filter (where
             r.forced_field = 'bedrooms' and (
               (r.forced_op = '='  and s.bedrooms  = r.forced_value) or
               (r.forced_op = '>=' and s.bedrooms >= r.forced_value)))) desc
$$;


create or replace function public.mon_detect_filter_default_suppresses_inventory()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; r record; live text[] := '{}';
begin
  for r in
    select m.rule_key,
           max(m.type_ar)                       as type_ar,
           sum(m.promised)                      as promised,
           sum(m.delivered)                     as delivered,
           count(*)                             as cities,
           count(*) filter (where m.kept_pct < 25) as bad_cities,
           jsonb_agg(jsonb_build_object('deal', m.deal_ar, 'city', m.city_ar,
                                        'promised', m.promised, 'delivered', m.delivered,
                                        'kept_pct', m.kept_pct)
                     order by m.suppressed desc)
             filter (where m.kept_pct < 25)     as worst
      from public.mon_filter_autoapply_suppression() m
     group by m.rule_key
    having count(*) filter (where m.kept_pct < 25) > 0
  loop
    live := live || ('filter_default_suppresses_inventory:' || r.rule_key);
    n := n + public.mon_raise(
      'P2', 'filter_default_suppresses_inventory', 'all',
      'filter_default_suppresses_inventory:' || r.rule_key,
      jsonb_build_object(
        'rule_key', r.rule_key,
        'type_ar', r.type_ar,
        'cities_measured', r.cities,
        'cities_below_25pct_kept', r.bad_cities,
        'promised_total', r.promised,
        'delivered_total', r.delivered,
        'worst', (select jsonb_agg(w) from (select w from jsonb_array_elements(r.worst) w limit 8) t),
        'why', 'The Normal Filter applies this default on the user''s behalf when the نوع is picked, but '
            || 'the count surface (top_cities_by_deal_ar) takes no such argument — so the app promises a '
            || 'number on the same screen that its own search will not deliver.',
        'rule', (select jsonb_build_object('field', forced_field, 'op', forced_op, 'value', forced_value,
                                           'ui_source', ui_source, 'owner_ref', owner_ref)
                   from public.ops_filter_autoapply_rule where rule_key = r.rule_key),
        'decision_needed', 'Should a filter default the user never chose exclude rows whose value is '
                        || 'merely unrecorded? Either answer is legitimate — this is an owner call '
                        || '(AGENTS.md RED list: new search/product semantics), NOT an autonomous fix.'));
  end loop;

  -- Self-heals: once the owner''s chosen behaviour lands (default relaxed, or the count surface taught
  -- the same default), the rule stops qualifying and its alert resolves without anyone touching it.
  perform public.mon_resolve_stale_keys('filter_default_suppresses_inventory', live);
  return n;
end $function$;

comment on function public.mon_detect_filter_default_suppresses_inventory() is
  'Barrier (Search & Matching QA, 2026-08-17): catches any client-side filter default that suppresses '
  'inventory the app''s own count surface promises. Generalises the hand-found غرفة/bedrooms=1 case to '
  'every rule in ops_filter_autoapply_rule, every deal and every city.';


-- Roster wiring via the guarded NEEDLE-EDIT (never a hand-pasted full body): read the LIVE
-- mon_run_all_detectors() body, assert the mon_detect_orphaned_detectors anchor exists, splice the
-- new name in just before it only if absent, and re-execute. A needle-edit cannot drop an entry it
-- never read (scripts/verify-detector-roster-edits-are-guarded.ts).
do $$
declare
  v_def text; v_before text;
  fn constant text := 'mon_detect_filter_default_suppresses_inventory';
  anchor constant text := '    ''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  if v_def is null then raise exception 'mon_run_all_detectors is missing'; end if;
  v_before := v_def;
  if position(anchor in v_def) = 0 then
    raise exception 'roster anchor missing — refusing to guess at the array shape';
  end if;
  if position('''' || fn || '''' in v_def) = 0 then
    v_def := replace(v_def, anchor, '    ''' || fn || ''',' || E'\n' || anchor);
  end if;
  if v_def <> v_before then execute v_def; end if;
end $$;

-- Prove it in the same transaction: the new detector is reachable and pre-existing entries survived.
do $$
declare
  v_def text; fn text; missing text[] := '{}';
  want text[] := array[
    'mon_detect_filter_default_suppresses_inventory',
    -- CONTROLS: entries that existed before this migration and must not have been lost.
    'mon_detect_orphaned_detectors', 'mon_detect_silent_scraper_death',
    'mon_detect_summary_only_capture', 'mon_detect_price_source_mismatch'
  ];
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'mon_run_all_detectors';
  foreach fn in array want loop
    if position('''' || fn || '''' in v_def) = 0 then missing := missing || fn; end if;
  end loop;
  if cardinality(missing) > 0 then
    raise exception 'roster wiring incomplete: %', array_to_string(missing, ', ');
  end if;
  if position('open_alerts' in v_def) = 0 then
    raise exception 'roster return can no longer report standing alerts';
  end if;
end $$;
