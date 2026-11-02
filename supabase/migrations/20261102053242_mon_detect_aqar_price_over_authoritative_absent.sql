-- 2026-11-02. Companion of 20261102051729 (aqar_parse never reads a similar-ad price; trg_aqar_parse keeps the
-- scraper's authoritative «no price»). The repair's invariant, watched: an ACTIVE aqar Buy row whose own
-- price_evidence says aqar's payload published NO price (authoritative_absent) must not carry a price_total — the
-- scraper never writes one there, so a figure can only have come from page prose, i.e. another ad's
-- «إعلانات مشابهة» card (32 served cards until today, e.g. 23096982 at 2,040,000). P1, on the
-- mon_run_all_detectors() roster. Also re-registers both functions' mirror digests (sql/mirrors/*, re-derived
-- from production after the edit).
set local lock_timeout = '5s';
create or replace function public.mon_detect_aqar_price_over_authoritative_absent()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; live text[] := '{}'; v_seen bigint; v_bad bigint; v_top jsonb;
begin
  select count(*) into v_seen
    from public.aqar_residential_listings
   where active and transaction_type = 'Buy' and source_capture->'price_evidence'->>'authoritative_absent' = 'true';
  with bad as (
    select 'aqar_residential_listings' t, id, price_total from public.aqar_residential_listings
     where active and transaction_type = 'Buy' and price_total is not null
       and source_capture->'price_evidence'->>'authoritative_absent' = 'true'
    union all
    select 'aqar_commercial_listings', id, price_total from public.aqar_commercial_listings
     where active and transaction_type = 'Buy' and price_total is not null
       and source_capture->'price_evidence'->>'authoritative_absent' = 'true')
  select count(*), (select jsonb_agg(jsonb_build_object('t', b.t, 'id', b.id, 'price_total', b.price_total))
                      from (select * from bad order by id desc limit 10) b)
    into v_bad, v_top from bad;

  if v_seen = 0 then
    live := live || 'aqar_price_over_authoritative_absent:BLIND'::text;
    n := n + public.mon_raise('P2', 'aqar_price_over_authoritative_absent', 'aqar', 'aqar_price_over_authoritative_absent:BLIND',
      jsonb_build_object('blind', true, 'why', 'No active aqar Buy row carries price_evidence.authoritative_absent, so this detector cannot see the class (did the enricher stop writing price_evidence?).'));
  elsif v_bad > 0 then
    live := live || 'aqar_price_over_authoritative_absent:stored'::text;
    n := n + public.mon_raise('P1', 'aqar_price_over_authoritative_absent', 'aqar', 'aqar_price_over_authoritative_absent:stored',
      jsonb_build_object('rows', v_bad, 'sample', v_top,
        'why', 'aqar''s payload published no price for these ads (price_evidence.authoritative_absent), yet a price_total is served. The scraper never writes one there, so it came from page prose — on a closed ad, the first «إعلانات مشابهة» card, i.e. ANOTHER ad''s price.',
        'action', 'Check aqar_parse''s head cut at «إعلانات مشابهة» and trg_aqar_parse''s authoritative_absent guard (20261102051729); clear the rows as that migration did.'));
  end if;
  perform public.mon_resolve_stale_keys('aqar_price_over_authoritative_absent', live);
  return n;
end
$function$;

revoke execute on function public.mon_detect_aqar_price_over_authoritative_absent() from public, anon, authenticated;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_aqar_price_over_authoritative_absent' in src) > 0 then
    raise notice 'mon_detect_aqar_price_over_authoritative_absent already on the roster';
    return;
  end if;
  out_def := replace(src,
    E'    ''mon_detect_ksaaqar_neighborhood_unstated'',',
    E'    ''mon_detect_ksaaqar_neighborhood_unstated'',\n    ''mon_detect_aqar_price_over_authoritative_absent'',');
  if out_def = src then
    raise exception 'roster anchor not found — refusing to guess where the entry belongs';
  end if;
  execute out_def;
end $$;

-- The mirrors in sql/mirrors/ are re-derived from production after 20261102051729's edits.
update public.ops_sql_mirror_expected
   set expected_md5 = md5(pg_get_functiondef('public.aqar_parse(text)'::regprocedure)), recorded_at = now(),
       note = 'Regenerated 2026-11-02 after 20261102051729 (head stops at «إعلانات مشابهة»).'
 where mirror_path = 'sql/mirrors/aqar_parse.sql';
update public.ops_sql_mirror_expected
   set expected_md5 = md5(pg_get_functiondef('public.trg_aqar_parse()'::regprocedure)), recorded_at = now(),
       note = 'Regenerated 2026-11-02 after 20261102051729 (Buy total never over authoritative_absent).'
 where mirror_path = 'sql/mirrors/trg_aqar_parse.sql';

-- PROOF at apply: 0 live after the repair; a planted price on a payload-says-no-price row is caught, then rolled back.
do $$
declare v_hit int;
begin
  if public.mon_detect_aqar_price_over_authoritative_absent() <> 0 then
    raise exception 'PROOF: the detector fires on the repaired table';
  end if;
  begin
    update public.aqar_residential_listings set price_total = 2040000 where id = 23096982;
    perform public.mon_detect_aqar_price_over_authoritative_absent();
    select count(*) into v_hit from public.alert_event
     where dedup_key = 'aqar_price_over_authoritative_absent:stored' and resolved_at is null;
    if v_hit = 0 then raise exception 'PROOF: a planted neighbour price was not caught'; end if;
    raise exception '__aqar_aa_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__aqar_aa_selftest_rollback__' then raise; end if;
  end;
  if position('mon_detect_aqar_price_over_authoritative_absent' in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'PROOF: the detector is not on the roster';
  end if;
  if (select expected_md5 from public.ops_sql_mirror_expected where mirror_path = 'sql/mirrors/aqar_parse.sql') <> '1e56fc64a63888e3aa74a147558108f7'
     or (select expected_md5 from public.ops_sql_mirror_expected where mirror_path = 'sql/mirrors/trg_aqar_parse.sql') <> '875f73fe437078aef9475631feb8bb25' then
    raise exception 'PROOF: mirror digests did not land';
  end if;
end $$;
