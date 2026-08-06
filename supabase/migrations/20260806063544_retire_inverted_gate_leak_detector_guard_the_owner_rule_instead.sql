-- mon_detect_search_gate_leak() now fires precisely when production is CORRECT.
--
-- It asserts: "deal=بيع with 0<price_total<1000 must not be searchable" (the interim gate
-- 20260803112311). On 2026-08-05 00:40 migration 20260805004030 RETIRED that gate, on the owner's
-- PERMANENT rule: "whatever is in the websites they put anything we scrape match display" — a
-- source-published price stays searchable at ANY magnitude, token prices explicitly included.
-- Ten minutes later the detector raised its first false P1, and it has raised one every day since
-- (2026-08-05 00:50 leaked=211, 2026-08-06 00:20 leaked=223). Those 223 listings being searchable
-- IS the owner-mandated behaviour.
--
-- The real hazard is not the noise. The alert ships `root_cause` and `contract` strings that read
-- as an instruction to restore the fold the owner deliberately removed — and PR#289 already proved
-- (run #5) that a later change rebuilding from a stale base silently undoes an earlier fix here.
-- So the detector is not merely deleted: its polarity is inverted into a regression guard for the
-- rule that replaced it, keeping run #5's structural insight that a gate must never be certified
-- by its own flag — the cohort is checked through the production RPC the frontend and AI agent call.
--
-- Detect-only, as before. No search semantics change.

create or replace function public.mon_detect_buy_token_price_suppression()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0;
  fold_present boolean;
  ready_rows int;
  suppressed int;
  reachable int;
begin
  -- (a) Has the retired fold been reintroduced into the sync? (the silent-revert class)
  select position(
    '(v.production_ready and not (lower(v.transaction_type)=''buy'' and v.price_total is not null and v.price_total > 0 and v.price_total < 1000))'
    in pg_get_functiondef(p.oid)) > 0
    into fold_present
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'sync_search_listings_ar';

  if coalesce(fold_present, false) then
    n := n + public.mon_raise('P1', 'buy_token_price_suppression', 'all',
      'buy_token_price_fold_reintroduced:' || current_date,
      jsonb_build_object(
        'why', 'The Buy token-price production_ready fold retired by 20260805004030 is present in sync_search_listings_ar again.',
        'owner_rule', 'PERMANENT (2026-08-03): a source-published price stays searchable at ANY magnitude, token prices included.',
        'action', 'Remove the fold from BOTH sites (INSERT projection and the s3.production_ready change-detection clause); do not re-add it.'));
  end if;

  -- (b) Are resolved-location token-price rows being withheld from search anyway?
  select count(*) filter (where production_ready),
         count(*) filter (where not production_ready and region_id is not null and city_id is not null)
    into ready_rows, suppressed
    from search_listings_ar
   where deal_ar = 'بيع' and price_total between 1 and 999;

  if suppressed > 0 then
    n := n + public.mon_raise('P1', 'buy_token_price_suppression', 'all',
      'buy_token_price_rows_suppressed:' || current_date,
      jsonb_build_object('suppressed_with_resolved_location', suppressed,
        'why', 'Buy token-price rows whose location resolves are not production_ready — something is withholding them from search again.'));
  end if;

  -- (c) User truth: ask the production RPC, never the flag. The cohort must actually come back.
  select coalesce(max(total_count), 0) into reachable
    from public.location_search_candidates_ar(p_deal := 'بيع', p_price_max := 999, p_limit := 1);

  if ready_rows > 0 and reachable = 0 then
    n := n + public.mon_raise('P1', 'buy_token_price_suppression', 'all',
      'buy_token_price_unreachable:' || current_date,
      jsonb_build_object('production_ready_rows', ready_rows, 'rpc_reachable', reachable,
        'why', 'The RPC returns none of the token-price cohort although rows are flagged production_ready — the gate moved into the search path.'));
  end if;

  if n = 0 then
    perform public.mon_resolve('buy_token_price_suppression', 'all');
  end if;
  return n;
end $function$;

-- Swap the name inside mon_run_all_detectors with a GUARDED needle-edit. Rebuilding that function
-- from a remembered body is what dropped a detector on 2026-08-03 (migration 20260803194308).
do $mig$
declare
  src text;
  old_name  constant text := '''mon_detect_search_gate_leak''';
  new_name  constant text := '''mon_detect_buy_token_price_suppression''';
  orphan    constant text := '''mon_detect_price_source_mismatch''';
  anchor    constant text := '''mon_detect_orphaned_detectors''';
begin
  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname='mon_run_all_detectors';
  if src is null then raise exception 'mon_run_all_detectors not found'; end if;
  if position(old_name in src) = 0 then raise exception 'mon_detect_search_gate_leak not present in the detector list'; end if;
  if position(anchor in src) = 0 then raise exception 'anchor detector not present'; end if;
  src := replace(src, old_name, new_name);

  -- Same edit closes the orphaned-detector P2 (raised 2026-08-04 19:50): price_source_mismatch has
  -- never been reachable from the runner or a cron job, so the wasalt ppm-as-total revert repaired
  -- in this same run went unwatched for 36h after its own detector last spoke.
  if position(orphan in src) = 0 then
    src := replace(src, anchor, orphan || E',\n    ' || anchor);
  end if;
  execute src;

  select pg_get_functiondef(p.oid) into src from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
   where ns.nspname='public' and p.proname='mon_run_all_detectors';
  if position(new_name in src) = 0 then raise exception 'new detector did not land'; end if;
  if position(orphan in src) = 0 then raise exception 'price_source_mismatch did not land'; end if;
  if position(old_name in src) > 0 then raise exception 'retired detector still referenced'; end if;
end $mig$;

drop function if exists public.mon_detect_search_gate_leak();

-- Close the false P1s the retired contract left standing on the dashboard.
update public.alert_event
   set resolved_at = now()
 where kind = 'search_gate_leak' and resolved_at is null;
