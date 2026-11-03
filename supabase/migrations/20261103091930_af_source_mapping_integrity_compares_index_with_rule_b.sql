-- 🔬 2026-11-03 (alert 12359): mon_detect_af_source_mapping_integrity compared the search index with the BOX layer
-- (listing_rich_attrs), but since Rule B (owner 2026-10-25, ADVANCED_FILTER_SOURCE_TRUTH.md) the index serves
-- af_rule_b(box, text): a box «false» plus the seller's sentence naming it serves TRUE. Measured: sanadak 14385922,
-- box «خدمات العقار» = «صرف صحي,هاتف,مياه» (no كهرباء -> false), the ad says «كهرب مستقل», the reader stored
-- electricity true, the index serves true = af_rule_b(false, true). Correct by law; the arm read it as a lost value.
-- The index arms (d, e) now compare with the value the index writers serve (the same af_rule_b / af_rule_b_num the
-- two writers call); the source -> box arms (a, b, c) are unchanged. Replay before apply: arm d 1 -> 0 on sanadak
-- electricity; every other mapping 0 -> 0.
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
  v_bad jsonb := '[]'::jsonb; v_has_scraped bool; v_served text;
begin
  for m in select * from public.ops_af_source_mapping order by source_table, af_field loop
    -- the registry names a table/column; both are validated against the catalog before use
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name=m.source_table and column_name='additional_info') then
      continue;
    end if;
    v_has_scraped := exists (select 1 from information_schema.columns
                              where table_schema='public' and table_name=m.source_table and column_name='scraped_at');
    -- RULE B (2026-11-03): what the index writers serve for this column, built exactly as they build it.
    v_served := case
      when m.af_field = any (public.text_facts_af_columns()) then format('public.af_rule_b(c.%1$I, tf.%1$I)', m.af_field)
      when m.af_field = any (public.text_facts_af_num_columns()) then format('public.af_rule_b_num(c.%1$I, tf.%1$I)', m.af_field)
      else format('c.%I', m.af_field) end;

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
        count(*) filter (where s.quiet and x.%I is distinct from (%s)),
        count(*) filter (where s.quiet and s.src is not null and x.%I is null and (%s) is not null
                           and x.first_seen_at > now() - interval '48 hours')
      from s
      join public.listing_rich_attrs c on c.source_table = %L and c.listing_id = s.id
      join public.search_listings_ar  x on x.source_table = %L and x.listing_id = s.id
      left join public.listing_text_facts_af tf on tf.source_table = %L and tf.listing_id = s.id
    $f$,
      m.derivation,
      case when v_has_scraped then $q$coalesce(r.scraped_at, 'epoch'::timestamptz) < now() - interval '90 minutes'$q$
           else 'true' end,
      m.source_table,
      m.af_field, m.af_field, m.af_field, m.af_field, m.af_field, v_served, m.af_field, v_served,
      m.source_table, m.source_table, m.source_table)
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
         || 'or the search index (the index is compared with af_rule_b(box, text), the value Rule B serves). '
         || 'The listing stays searchable and simply becomes unreachable by that '
         || 'AF predicate -- nothing errors, which is exactly how 1,114 Sanadak listings lost their '
         || 'water/electricity/sewage for as long as they did.',
      'adjudicate','Read the offenders list: the arm names the layer that dropped it. Fix the LAYER, '
         || 'never the rows, and never satisfy this by writing a value the source did not publish. '
         || 'Tri-state is strict: source YES -> true, source NO -> false, source absent -> NULL. '
         || 'If the source itself changed shape, re-probe live and update ops_af_source_mapping.'));
  return n;
end $function$;
