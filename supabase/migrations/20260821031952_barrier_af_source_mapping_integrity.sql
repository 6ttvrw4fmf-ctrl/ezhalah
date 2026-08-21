-- Senior Production Engineer run #33 (2026-08-21), owner-directed.
--
-- THE INVARIANT THIS ENFORCES: if a supported platform publishes a structured AF field for a
-- listing, and that field is mapped for that platform, the value must reach the canonical AF layer
-- (listing_rich_attrs) and the search index (search_listings_ar) EXACTLY -- same value, same
-- tri-state, no NULL introduced, no UNKNOWN turned into false.
--
-- WHY THE EXISTING BARRIERS DID NOT CATCH SANADAK. mon_rich_attrs_barrier arm B asserts a cohort
-- platform HAS a listing_rich_attrs branch; Sanadak had one. It just emitted NULL literals for the
-- utility trio while the values sat in additional_info. "A branch exists" and "the branch carries
-- the values" are different claims, and only the first was ever checked. This detector checks the
-- second, per registered mapping, from the source payload forward.
--
-- ARMS (each measured on live production before wiring; all read 0):
--   A source has a value  -> canonical NULL            (the Sanadak defect: parser/mapping drop)
--   B source and canonical both set but DIFFER          (true/false corruption)
--   C source is UNKNOWN   -> canonical has a value      (fabrication: UNKNOWN converted to a value)
--   D canonical set       -> index NULL or different    (index drops or corrupts the canonical value)
--   E FRESH listings (first_seen_at < 48h): source has a value -> index must have it
--
-- Arms D and E are lag-guarded: sync_all_rich_attrs runs hourly at :14, so a row whose raw record
-- was written in the last 90 minutes has not had its turn yet and is excluded. A row quiet longer
-- than that which still disagrees is a real defect. (Run #32's lesson: an oracle that compares an
-- hourly snapshot against a continuously-written table with no staleness guard raises false P1s,
-- and a false P1 sitting open swallows the real one via mon_raise's dedup.)
--
-- The registry restates each derivation INDEPENDENTLY of the pipeline helper on purpose -- see
-- ops_af_source_mapping's comment. An oracle sharing its subject's predicate cannot audit it.

create or replace function public.mon_detect_af_source_mapping_integrity()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; m record;
  a_loss bigint; b_corrupt bigint; c_fabricated bigint; d_index bigint; e_fresh bigint;
  t_a bigint := 0; t_b bigint := 0; t_c bigint := 0; t_d bigint := 0; t_e bigint := 0;
  v_bad jsonb := '[]'::jsonb; v_has_scraped bool;
begin
  for m in select * from public.ops_af_source_mapping order by source_table, af_field loop
    -- the registry names a table/column; both are validated against the catalog before use
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name=m.source_table and column_name='additional_info') then
      continue;
    end if;
    v_has_scraped := exists (select 1 from information_schema.columns
                              where table_schema='public' and table_name=m.source_table and column_name='scraped_at');

    execute format($f$
      with s as (
        select r.id, (%s) as src,
               %s as quiet
          from public.%I r
         where r.active
      )
      select
        count(*) filter (where s.src is not null and c.%I is null),
        count(*) filter (where s.src is not null and c.%I is not null and c.%I is distinct from s.src),
        count(*) filter (where s.src is null and c.%I is not null),
        count(*) filter (where s.quiet and c.%I is distinct from x.%I),
        count(*) filter (where s.quiet and s.src is not null and x.%I is null
                           and x.first_seen_at > now() - interval '48 hours')
      from s
      join public.listing_rich_attrs c on c.source_table = %L and c.listing_id = s.id
      join public.search_listings_ar  x on x.source_table = %L and x.listing_id = s.id
    $f$,
      m.derivation,
      case when v_has_scraped then $q$coalesce(r.scraped_at, 'epoch'::timestamptz) < now() - interval '90 minutes'$q$
           else 'true' end,
      m.source_table,
      m.af_field, m.af_field, m.af_field, m.af_field, m.af_field, m.af_field, m.af_field,
      m.source_table, m.source_table)
    into a_loss, b_corrupt, c_fabricated, d_index, e_fresh;

    t_a := t_a + a_loss; t_b := t_b + b_corrupt; t_c := t_c + c_fabricated;
    t_d := t_d + d_index; t_e := t_e + e_fresh;

    if a_loss + b_corrupt + c_fabricated + d_index + e_fresh > 0 then
      v_bad := v_bad || jsonb_build_object(
        'source_table', m.source_table, 'af_field', m.af_field,
        'source_value_lost_before_canonical', a_loss,
        'value_corrupted', b_corrupt,
        'unknown_turned_into_a_value', c_fabricated,
        'canonical_not_in_index', d_index,
        'fresh_listing_never_became_searchable', e_fresh);
    end if;
  end loop;

  if t_a + t_b + t_c + t_d + t_e = 0 then
    perform public.mon_resolve_key('af_source_mapping_integrity','af_source_mapping_integrity');
    return 0;
  end if;

  n := public.mon_raise(
    case when t_b > 0 or t_c > 0 or t_a > 0 then 'P1' else 'P2' end,
    'af_source_mapping_integrity','all','af_source_mapping_integrity',
    jsonb_build_object(
      'source_value_lost_before_canonical', t_a,
      'value_corrupted', t_b,
      'unknown_turned_into_a_value', t_c,
      'canonical_not_in_index', t_d,
      'fresh_listing_never_became_searchable', t_e,
      'offenders', v_bad,
      'why','A platform publishes a structured Advanced Filter field, the mapping for it is REGISTERED '
         || 'in ops_af_source_mapping, and the value is not arriving intact at the canonical AF layer '
         || 'or the search index. The listing stays searchable and simply becomes unreachable by that '
         || 'AF predicate -- nothing errors, which is exactly how 1,114 Sanadak listings lost their '
         || 'water/electricity/sewage for as long as they did.',
      'adjudicate','Read the offenders list: the arm names the layer that dropped it. Fix the LAYER, '
         || 'never the rows, and never satisfy this by writing a value the source did not publish. '
         || 'Tri-state is strict: source YES -> true, source NO -> false, source absent -> NULL. '
         || 'If the source itself changed shape, re-probe live and update ops_af_source_mapping.'));
  return n;
end $function$;

comment on function public.mon_detect_af_source_mapping_integrity() is
  'P1. Registry-driven end-to-end AF parity: source payload -> listing_rich_attrs -> search_listings_ar, '
  'including a fresh-listing (48h) arm and an UNKNOWN->value fabrication arm. Senior run #33.';

do $$
declare v_def text; v_new text; v_anchor text; n_anchor int; n_before int; n_after int;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname='mon_run_all_detectors';
  if position('mon_detect_af_source_mapping_integrity' in v_def) > 0 then raise notice 'already wired'; return; end if;
  v_anchor := '    ''mon_detect_discarded_location_resolution'',
';
  n_anchor := (length(v_def)-length(replace(v_def,v_anchor,'')))/length(v_anchor);
  if n_anchor <> 1 then raise exception 'REFUSED: roster anchor not found exactly once (found %)', n_anchor; end if;
  n_before := (length(v_def)-length(replace(v_def,'''mon_detect_','')))/length('''mon_detect_');
  v_new := replace(v_def, v_anchor, v_anchor || '    ''mon_detect_af_source_mapping_integrity'',
');
  n_after := (length(v_new)-length(replace(v_new,'''mon_detect_','')))/length('''mon_detect_');
  if n_after <> n_before + 1 then raise exception 'REFUSED: roster count moved % -> % (expected +1)', n_before, n_after; end if;
  execute v_new;
end $$;
