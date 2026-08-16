-- CONTROL PLANE: register the الفلل والبيوت family (owner 2026-08-16 villa mandate). Six rows —
-- فيلا (33.6k, 99.84% of the family) plus بيت (51) and تاون هاوس (3) which ride the same clean-type
-- search; قصر maps to zero live rows (not registered). Monthly stays FROZEN — no شهري row.
-- Fresh-band profiling drove the questions; three aqar segments are acknowledged source-side
-- BEFORE registration (same proven form-composition class as 2026-08-15): AC absent from بيع villa
-- forms, and مدخل خاص absent from villa forms on BOTH deals (the villa form carries مدخل سيارة
-- instead — same 2,012 fresh rows parse age 100% / car_entrance 84% / kitchen 82% while
-- private_entrance is 0/2,012). Freeze-guard floor raised 18 -> 24 in the same transaction.
do $do$
declare readiness int; rich int; parity_n int; n int; snap jsonb; def text; occ int;
begin
  insert into public.ops_amenity_capture_verified (source_table, field, deal_ar, rent_period_key, type_ar, note) values
   ('aqar_residential_listings','air_conditioner','بيع','*','فيلا',
    '2026-08-16 villa build: fresh 0/1,378 vs all-time 29% — same aqar بيع-form AC removal already evidenced for شقة/دور; villa RENT AC is 74% fresh on the same code path.'),
   ('aqar_residential_listings','private_entrance','إيجار','سنوي','فيلا',
    '2026-08-16 villa build: fresh 0/631 vs all-time 22% — aqar villa forms carry مدخل سيارة (84% fresh on the same rows), not مدخل خاص; apartments/floors stay 82-84% fresh, so parser is exonerated.'),
   ('aqar_residential_listings','private_entrance','بيع','*','فيلا',
    '2026-08-16 villa build: fresh 0/1,378 vs all-time 29% — same villa form-vocabulary fact as the rent segment; age 100%/kitchen 82% parse on the same rows.');

  insert into public.af_cohort_registry(deal_ar, rent_period_ar, type_ar, enabled, note) values
    ('إيجار','سنوي','فيلا',      true, 'Certified 2026-08-16 — Villa/Rent-Annual (n≈5,935; rnpl ask-first 66% yes, car_entrance+sanitation gems).'),
    ('بيع',  null,  'فيلا',      true, 'Certified 2026-08-16 — Villa/Buy (n≈27,400; car_entrance near-perfect split; AC deliberately absent - source dropped it).'),
    ('إيجار','سنوي','بيت',       true, 'Family rider 2026-08-16 — searchable, no questions of its own (n=7).'),
    ('بيع',  null,  'بيت',       true, 'Family rider 2026-08-16 — searchable, no questions of its own (n=44).'),
    ('إيجار','سنوي','تاون هاوس', true, 'Family rider 2026-08-16 — searchable, no questions of its own (n=0).'),
    ('بيع',  null,  'تاون هاوس', true, 'Family rider 2026-08-16 — searchable, no questions of its own (n=3).');

  select count(*) into n from public.af_cohort_registry where enabled;
  if n <> 24 then raise exception 'ABORT: expected 24 enabled rows, got %', n; end if;

  -- raise the freeze-guard floor 18 -> 24 (live-def needle-edit)
  select pg_get_functiondef(p.oid) into def from pg_proc p
   where p.proname='mon_check_filter_parity_legacy' and p.pronamespace='public'::regnamespace;
  occ := (length(def) - length(replace(def, '< 18', ''))) / length('< 18');
  if occ <> 1 then raise exception 'ABORT: floor needle occurs %', occ; end if;
  def := replace(def, '< 18', '< 24');
  occ := (length(def) - length(replace(def, '''floor'', 18', ''))) / length('''floor'', 18');
  if occ <> 1 then raise exception 'ABORT: floor-detail needle occurs %', occ; end if;
  def := replace(def, '''floor'', 18', '''floor'', 24');
  execute def;

  -- widened registry must be barrier-clean in this transaction
  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into snap from public.mon_rich_attrs_drift_state d;
  select public.mon_af_new_listing_readiness() into readiness;
  select public.mon_rich_attrs_barrier() into rich;
  delete from public.mon_rich_attrs_drift_state;
  insert into public.mon_rich_attrs_drift_state
    select (jsonb_populate_record(null::public.mon_rich_attrs_drift_state, e.j)).*
    from jsonb_array_elements(snap) e(j);
  select count(*) into parity_n from public.mon_filter_parity_barrier();
  if readiness <> 0 or rich <> 0 or parity_n <> 0 then
    raise exception 'ABORT: barriers not clean (readiness=% rich=% parity=%)', readiness, rich, parity_n;
  end if;
  if public.mon_check_filter_parity_legacy() <> 0 then
    raise exception 'ABORT: parity wrapper dirty after floor raise';
  end if;
  raise notice 'SUCCESS: villa family registered (24 enabled); 3 evidenced waivers; floor 24; all barriers clean';
end $do$;