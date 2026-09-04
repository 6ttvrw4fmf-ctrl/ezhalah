-- CLOSE THE property_age GAP in ops_af_option_truth_sweep.
--
-- The age chips were the ONE family the sweep could not see, because their counts come from a
-- different RPC — property_age_option_counts_ar, not apartment_guided_counts_ar — so the option loop
-- had no cnt_* column to read and skipped them entirely. The sweep still reported zero defects,
-- which is exactly the vacuous pass this whole exercise exists to prevent. The repo-side barrier had
-- to declare it as a known gap; this closes it instead.
--
-- Age is the same contract as every other option: the number on the chip must equal the filter the
-- search runs, and every returned row must really be that age. 'new' maps to p_is_new_construction
-- (property_age = 0 server-side), the four buckets to p_age_min/p_age_max.
do $mig$
declare
  v_def text; v_new text;
  v_needle constant text := '    for o in';
  v_age_block constant text :=
    '    -- ── PROPERTY AGE ─────────────────────────────────────────────────────────────────────' || E'\n' ||
    '    -- Counted by property_age_option_counts_ar, NOT by the guided-counts RPC above, so it needs' || E'\n' ||
    '    -- its own pass. Same three-way proof: chip = applied = returned, plus the row-level read.' || E'\n' ||
    '    execute format(''select to_jsonb(a) from property_age_option_counts_ar(%s) a'', v_base) into v_age;' || E'\n' ||
    '    if v_age is not null then' || E'\n' ||
    '      for o in' || E'\n' ||
    '        select * from (values' || E'\n' ||
    '          (''property_age:new'',''cnt_new'',''p_is_new_construction:=true'',''s.property_age = 0''),' || E'\n' ||
    '          (''property_age:1_2'',''cnt_1_2'',''p_age_min:=1, p_age_max:=2'',''s.property_age between 1 and 2''),' || E'\n' ||
    '          (''property_age:3_5'',''cnt_3_5'',''p_age_min:=3, p_age_max:=5'',''s.property_age between 3 and 5''),' || E'\n' ||
    '          (''property_age:6_9'',''cnt_6_9'',''p_age_min:=6, p_age_max:=9'',''s.property_age between 6 and 9''),' || E'\n' ||
    '          (''property_age:10p'',''cnt_10p'',''p_age_min:=10'',''s.property_age >= 10'')' || E'\n' ||
    '        ) as t(label, col, af_param, row_pred)' || E'\n' ||
    '      loop' || E'\n' ||
    '        v_chip := (v_age ->> o.col)::bigint;' || E'\n' ||
    '        continue when v_chip is null;' || E'\n' ||
    '        execute format(''select af_eligible_count(%s, %s)'', v_base, o.af_param) into v_applied;' || E'\n' ||
    '        v_ret := null; v_viol := null;' || E'\n' ||
    '        if p_check_rows then' || E'\n' ||
    '          execute format(' || E'\n' ||
    '            ''select count(distinct r.listing_id), count(*) filter (where not (%s)) ''' || E'\n' ||
    '            ''from location_search_candidates_ar(%s, %s, p_limit:=%s, p_per_platform:=%s) r ''' || E'\n' ||
    '            ''join search_listings_ar s on s.listing_id = r.listing_id'',' || E'\n' ||
    '            o.row_pred, v_base, o.af_param, p_row_limit, p_row_limit)' || E'\n' ||
    '            into v_ret, v_viol;' || E'\n' ||
    '        end if;' || E'\n' ||
    '        if v_chip is distinct from v_applied' || E'\n' ||
    '           or coalesce(v_viol, 0) <> 0' || E'\n' ||
    '           or (p_check_rows and v_ret < least(v_chip, p_row_limit)) then' || E'\n' ||
    '          cohort := c.type_ar || ''''|'''' || c.deal_ar || ''''|'''' || coalesce(c.rent_period_ar, ''''-'''');' || E'\n' ||
    '          opt := o.label; chip := v_chip; applied := v_applied; returned := v_ret; viol := v_viol;' || E'\n' ||
    '          return next;' || E'\n' ||
    '        end if;' || E'\n' ||
    '      end loop;' || E'\n' ||
    '    end if;' || E'\n\n';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'ops_af_option_truth_sweep';
  if v_def is null then raise exception 'ops_af_option_truth_sweep not found'; end if;
  if position('property_age:new' in v_def) > 0 then return; end if;              -- already applied
  if position(v_needle in v_def) = 0 then raise exception 'anchor not found — refusing to guess'; end if;

  -- Declare the extra variable, then insert the age pass ahead of the guided-counts option loop.
  v_new := replace(v_def,
    'v_base text; v_chip bigint; v_applied bigint; v_ret bigint; v_viol bigint; v_counts jsonb;',
    'v_base text; v_chip bigint; v_applied bigint; v_ret bigint; v_viol bigint; v_counts jsonb; v_age jsonb;');
  if v_new = v_def then raise exception 'declare block anchor not found'; end if;
  v_new := replace(v_new, v_needle, v_age_block || v_needle);
  if length(v_new) <= length(v_def) then raise exception 'edit did not grow the body'; end if;
  execute v_new;
end
$mig$;
