-- ONE INSTALMENTS CHIP: THE SITE'S BOX OR THE AD'S MONTHLY / SPLIT-PAYMENT WORDS (owner 2026-11-12).
--
-- THE OWNER'S WORDS, shown the «💳» card with its two chips «يقبل التقسيط» (token rnpl, column rent_now_pay_later = the
-- site's own «إيجار بالتقسيط» box) and «دفعات / دفع شهري» (token split_payments, a text fact read from the ad's words):
-- «Yeah merge ok just merge note like how it says they do split payment through either one of the provider or maybe
-- another … we cannot guarantee». So the card carries ONE chip, «تقسيط أو دفعات شهرية», and a listing qualifies when
-- EITHER fact is true.
--
-- WHAT WAS WRONG BESIDES THE TWO CHIPS. The clause treated the two tokens as independent ANDed arms, so a user who
-- picked both chips got listings carrying BOTH facts (Riyadh yearly apartments: 5,375, not the 24,828 that carry
-- either), while the card evidence (src/lib/afEvidence.ts) read them as either. The merge removes that split too.
--
-- THE CHANGE (one definition, the rail):
--   1. af_eligibility_clause(): the 'rnpl' / 'rent_now_pay_later' token arm becomes
--      `or s.rent_now_pay_later or s.split_payments`. The 'split_payments' token arm is unchanged (chat-typed «دفعات»
--      still means the ad's words only). The rent-period arms that read rent_now_pay_later are a different rule and
--      are NOT touched.
--   2. apartment_guided_counts_ar template: cnt_rnpl counts the same union; cnt_rnpl_unknown = rows that do not qualify
--      and whose instalment box is unknown (rent_now_pay_later is null and split_payments is not true). A row whose ad
--      says «دفعات» is matched, so it is no longer «did not mention».
--   3. rebuild_af_filter_rpcs() regenerates the seven surfaces.
--   4. The two static chip oracles (af_option_truth_table, ops_af_option_truth_sweep) learn the union predicate.
--      ops_af_cohort_predicate_sql carries no rnpl line, so it needs nothing.
-- sql/mirrors/af_eligibility_clause.sql is refreshed from pg_get_functiondef in the same change.
set local lock_timeout = '3s';

create temp table _rnpl_probe (city text, e_rnpl bigint, e_split bigint, e_both bigint, cnt_rnpl_before bigint,
                               unk_before bigint, total_before bigint);
insert into _rnpl_probe (city) values ('الرياض'), ('جدة');
update _rnpl_probe p set
  e_rnpl  = public.af_eligible_count(p_deal := 'إيجار', p_rent_period := 'سنوي', p_cities := array[p.city], p_types := array['شقة'], p_category := 'Residential', p_amenities := array['rnpl']),
  e_split = public.af_eligible_count(p_deal := 'إيجار', p_rent_period := 'سنوي', p_cities := array[p.city], p_types := array['شقة'], p_category := 'Residential', p_amenities := array['split_payments']),
  -- before this change the two tokens ANDed, so this is |rnpl ∩ split|
  e_both  = public.af_eligible_count(p_deal := 'إيجار', p_rent_period := 'سنوي', p_cities := array[p.city], p_types := array['شقة'], p_category := 'Residential', p_amenities := array['rnpl','split_payments']);
update _rnpl_probe p set cnt_rnpl_before = g.cnt_rnpl, unk_before = g.cnt_rnpl_unknown, total_before = g.cnt_total_base
  from (select c.city, x.* from _rnpl_probe c, lateral public.apartment_guided_counts_ar(
          p_deal := 'إيجار', p_rent_period := 'سنوي', p_cities := array[c.city], p_types := array['شقة'], p_category := 'Residential') x) g
 where g.city = p.city;

do $patch$
declare
  c text := public.af_eligibility_clause();
  old_a constant text := $x$'rent_now_pay_later' = any(p_amenities)) or s.rent_now_pay_later)))$x$;
  new_a constant text := $x$'rent_now_pay_later' = any(p_amenities)) or s.rent_now_pay_later or s.split_payments)))$x$;
  tpl text;
  old_c constant text := $x$count(*) filter (where rent_now_pay_later)              as cnt_rnpl,$x$;
  new_c constant text := $x$count(*) filter (where rent_now_pay_later or split_payments) as cnt_rnpl,$x$;
  old_u constant text := $x$count(*) filter (where rent_now_pay_later is null)      as cnt_rnpl_unknown,$x$;
  new_u constant text := $x$count(*) filter (where rent_now_pay_later is null and split_payments is not true) as cnt_rnpl_unknown,$x$;
  old_t constant text := $x$'cnt_rnpl','p_amenities:=array[''rnpl'']','s.rent_now_pay_later is true'$x$;
  new_t constant text := $x$'cnt_rnpl','p_amenities:=array[''rnpl'']','(s.rent_now_pay_later is true or s.split_payments is true)'$x$;
  fn text; def text; k int;
begin
  -- 1. the builder
  if position(new_a in c) > 0 then
    raise notice 'af_eligibility_clause already carries the merged instalments arm';
  else
    k := (length(c) - length(replace(c, old_a, ''))) / length(old_a);
    if k <> 1 then raise exception 'ABORT: the rnpl anchor occurs % times in af_eligibility_clause, expected 1', k; end if;
    c := replace(c, old_a, new_a);
    execute format('create or replace function public.af_eligibility_clause() returns text language sql immutable as $fn$ select %L::text $fn$', c);
  end if;
  -- 2. the counts template
  select template into tpl from public.af_rpc_templates where fn_name = 'apartment_guided_counts_ar';
  if tpl is null then raise exception 'ABORT: af_rpc_templates has no apartment_guided_counts_ar row'; end if;
  if position(new_c in tpl) = 0 then
    k := (length(tpl) - length(replace(tpl, old_c, ''))) / length(old_c);
    if k <> 1 then raise exception 'ABORT: cnt_rnpl anchor occurs % times in the guided-counts template, expected 1', k; end if;
    tpl := replace(tpl, old_c, new_c);
  end if;
  if position(new_u in tpl) = 0 then
    k := (length(tpl) - length(replace(tpl, old_u, ''))) / length(old_u);
    if k <> 1 then raise exception 'ABORT: cnt_rnpl_unknown anchor occurs % times in the guided-counts template, expected 1', k; end if;
    tpl := replace(tpl, old_u, new_u);
  end if;
  update public.af_rpc_templates set template = tpl where fn_name = 'apartment_guided_counts_ar';
  -- 4. the two static chip oracles
  foreach fn in array array['af_option_truth_table', 'ops_af_option_truth_sweep'] loop
    def := pg_get_functiondef(format('public.%I', fn)::regproc);
    if position(new_t in def) = 0 then
      k := (length(def) - length(replace(def, old_t, ''))) / length(old_t);
      if k <> 1 then raise exception 'ABORT: % rnpl oracle row occurs % times, expected 1', fn, k; end if;
      execute replace(def, old_t, new_t);
    end if;
  end loop;
end $patch$;

-- 3. Regenerate the seven surfaces from the patched builder + template (updates af_rpc_build_state).
select o_fn_name, left(o_def_md5, 12) as built from public.rebuild_af_filter_rpcs();

-- PROOF at apply.
do $proof$
declare
  fn text; d text; n int; r record; g record; e_after bigint; e_and bigint; e_split bigint;
  new_a constant text := $x$'rent_now_pay_later' = any(p_amenities)) or s.rent_now_pay_later or s.split_payments)))$x$;
  old_a constant text := $x$'rent_now_pay_later' = any(p_amenities)) or s.rent_now_pay_later)))$x$;
begin
  -- every generated surface carries the merged arm and not the old one
  for fn in select t.fn_name from public.af_rpc_templates t loop
    select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = fn;
    if d is null then raise exception 'PROOF: % missing after rebuild', fn; end if;
    if position(new_a in d) = 0 then raise exception 'PROOF: % does not carry the merged instalments arm', fn; end if;
    if position(old_a in d) > 0 then raise exception 'PROOF: % still carries the rnpl-only arm', fn; end if;
  end loop;
  if (select count(*) from public.af_option_truth_table() t where t.label = 'rnpl'
       and t.row_pred = '(s.rent_now_pay_later is true or s.split_payments is true)') <> 1 then
    raise exception 'PROOF: af_option_truth_table rnpl row did not take the union predicate';
  end if;
  if exists (select 1 from public.af_option_vocab_drift()) then raise exception 'PROOF: af_option_vocab_drift is not empty'; end if;
  n := public.mon_af_predicate_parity();
  if n <> 0 then raise exception 'PROOF: mon_af_predicate_parity() = % after the rebuild', n; end if;
  if exists (select 1 from public.af_rebuild_would_revert()) then raise exception 'PROOF: af_rebuild_would_revert is not empty'; end if;
  for r in select * from _rnpl_probe loop
    select x.cnt_rnpl, x.cnt_rnpl_unknown, x.cnt_total_base, x.cnt_split_payments into g
      from public.apartment_guided_counts_ar(p_deal := 'إيجار', p_rent_period := 'سنوي', p_cities := array[r.city],
             p_types := array['شقة'], p_category := 'Residential') x;
    e_after := public.af_eligible_count(p_deal := 'إيجار', p_rent_period := 'سنوي', p_cities := array[r.city], p_types := array['شقة'], p_category := 'Residential', p_amenities := array['rnpl']);
    e_and   := public.af_eligible_count(p_deal := 'إيجار', p_rent_period := 'سنوي', p_cities := array[r.city], p_types := array['شقة'], p_category := 'Residential', p_amenities := array['rnpl','split_payments']);
    e_split := public.af_eligible_count(p_deal := 'إيجار', p_rent_period := 'سنوي', p_cities := array[r.city], p_types := array['شقة'], p_category := 'Residential', p_amenities := array['split_payments']);
    -- the base scope did not move
    if g.cnt_total_base <> r.total_before then raise exception 'PROOF: % base moved % -> %', r.city, r.total_before, g.cnt_total_base; end if;
    -- the chip = |rnpl ∪ split|, computed by inclusion–exclusion from the PRE-change surfaces
    if g.cnt_rnpl <> r.e_rnpl + r.e_split - r.e_both then
      raise exception 'PROOF: % cnt_rnpl % <> |rnpl|% + |split|% - |both|% = %', r.city, g.cnt_rnpl, r.e_rnpl, r.e_split, r.e_both, r.e_rnpl + r.e_split - r.e_both;
    end if;
    -- chip = results referee, and the split_payments token alone is unchanged
    if e_after <> g.cnt_rnpl then raise exception 'PROOF: % chip % <> af_eligible_count(rnpl) %', r.city, g.cnt_rnpl, e_after; end if;
    if e_split <> r.e_split or g.cnt_split_payments <> r.e_split then raise exception 'PROOF: % split_payments moved % -> % / %', r.city, r.e_split, e_split, g.cnt_split_payments; end if;
    -- picking both tokens now = the union ∩ split = split
    if e_and <> r.e_split then raise exception 'PROOF: % rnpl+split % <> split %', r.city, e_and, r.e_split; end if;
    -- unknown never grows (rows matched through split leave it), and never overlaps the chip
    if g.cnt_rnpl_unknown > r.unk_before or g.cnt_rnpl_unknown + g.cnt_rnpl > g.cnt_total_base then
      raise exception 'PROOF: % unknown % (before %) chip % total %', r.city, g.cnt_rnpl_unknown, r.unk_before, g.cnt_rnpl, g.cnt_total_base;
    end if;
    raise notice 'PROOF % yearly apartments: cnt_rnpl % -> %, cnt_rnpl_unknown % -> %, total %',
      r.city, r.cnt_rnpl_before, g.cnt_rnpl, r.unk_before, g.cnt_rnpl_unknown, g.cnt_total_base;
  end loop;
end $proof$;

drop table _rnpl_probe;
