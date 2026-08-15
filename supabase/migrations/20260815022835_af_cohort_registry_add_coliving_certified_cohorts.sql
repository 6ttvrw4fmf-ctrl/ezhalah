-- CONTROL PLANE: register every الشقق والسكن المشترك cohort certified on 2026-08-15 (overnight run).
-- A registry row = live protection: mon_af_new_listing_readiness (checks A/B/C),
-- mon_rich_attrs_barrier, and mon_filter_parity_barrier check 2 all scan the union of enabled rows
-- via af_in_certified_cohort(). type_ar values are the DB's own attested values (each certification
-- agent proved chip == results == referee == direct SQL against s.type_ar IN (these exact strings)).
-- Verdicts: Apartment/Buy PASS n=34,069 · Floor/Rent-Annual PASS n=3,638 · Floor/Buy PASS n=11,867 ·
-- ResBldg/Rent-Annual PASS n=3,202 · ResBldg/Buy PASS n=6,334 (oracle-spec footnote only) ·
-- Room/Rent-Annual PASS n=1,774 · Studio/Rent-Annual PASS n=30. Monthly Rent stays FROZEN by owner
-- order — deliberately NO شهري row anywhere. Annual «مبنى شقق مخدومة/ملحق علوي» were not part of the
-- certified annual battery and are deliberately NOT claimed (ledger notes them as future work).
-- Dry-run 2026-08-15: with all 17 rows inserted, readiness=0, rich=0, parity=0 rows (rolled back).
do $do$
declare readiness int; rich int; parity_n int; n int; snap jsonb;
begin
  insert into public.af_cohort_registry(deal_ar, rent_period_ar, type_ar, enabled, note) values
    ('بيع',  null,   'شقة',                     true, 'Certified 2026-08-15 — Apartment/Buy (n=34,069).'),
    ('بيع',  null,   'مبنى شقق مخدومة',          true, 'Certified 2026-08-15 — Apartment/Buy (n=34,069).'),
    ('بيع',  null,   'ملحق علوي',                true, 'Certified 2026-08-15 — Apartment/Buy (n=34,069).'),
    ('إيجار','سنوي', 'دور',                      true, 'Certified 2026-08-15 — Floor/Rent-Annual (n=3,638; rnpl ask-first).'),
    ('بيع',  null,   'دور',                      true, 'Certified 2026-08-15 — Floor/Buy (n=11,867).'),
    ('إيجار','سنوي', 'عمارة',                    true, 'Certified 2026-08-15 — ResBldg/Rent-Annual (n=3,202; street_width+direction).'),
    ('إيجار','سنوي', 'مجمع سكني',                true, 'Certified 2026-08-15 — ResBldg/Rent-Annual (n=3,202).'),
    ('إيجار','سنوي', 'مجمع',                     true, 'Certified 2026-08-15 — ResBldg/Rent-Annual (n=3,202).'),
    ('إيجار','سنوي', 'برج',                      true, 'Certified 2026-08-15 — ResBldg/Rent-Annual (n=3,202).'),
    ('بيع',  null,   'عمارة',                    true, 'Certified 2026-08-15 — ResBldg/Buy (n=6,334).'),
    ('بيع',  null,   'مجمع سكني',                true, 'Certified 2026-08-15 — ResBldg/Buy (n=6,334).'),
    ('بيع',  null,   'مجمع',                     true, 'Certified 2026-08-15 — ResBldg/Buy (n=6,334).'),
    ('بيع',  null,   'برج',                      true, 'Certified 2026-08-15 — ResBldg/Buy (n=6,334).'),
    ('إيجار','سنوي', 'غرفة',                     true, 'Certified 2026-08-15 — Room/Rent-Annual (n=1,774; kitchen-led).'),
    ('إيجار','سنوي', 'استوديو',                  true, 'Certified 2026-08-15 — Studio/Rent-Annual (n=30, minimal).'),
    ('إيجار','سنوي', 'ستوديو',                   true, 'Certified 2026-08-15 — Studio/Rent-Annual (n=30, minimal).'),
    ('إيجار','سنوي', 'شقَّة صغيرة (استوديو)',     true, 'Certified 2026-08-15 — Studio/Rent-Annual (n=30, minimal).');

  select count(*) into n from public.af_cohort_registry where enabled;
  if n <> 18 then raise exception 'ABORT: expected 18 enabled rows, got %', n; end if;

  -- the widened registry must be barrier-clean IN THIS TRANSACTION or the whole insert aborts
  select coalesce(jsonb_agg(to_jsonb(d)), '[]'::jsonb) into snap from public.mon_rich_attrs_drift_state d;
  select public.mon_af_new_listing_readiness() into readiness;
  select public.mon_rich_attrs_barrier() into rich;
  delete from public.mon_rich_attrs_drift_state;
  insert into public.mon_rich_attrs_drift_state
    select (jsonb_populate_record(null::public.mon_rich_attrs_drift_state, e.j)).*
    from jsonb_array_elements(snap) e(j);
  select count(*) into parity_n from public.mon_filter_parity_barrier();
  if readiness <> 0 or rich <> 0 or parity_n <> 0 then
    raise exception 'ABORT: barriers not clean with widened registry (readiness=% rich=% parity=%)', readiness, rich, parity_n;
  end if;
  raise notice 'SUCCESS: 17 certified cohort rows registered; 18 enabled total; all registry-driven barriers clean';
end $do$;