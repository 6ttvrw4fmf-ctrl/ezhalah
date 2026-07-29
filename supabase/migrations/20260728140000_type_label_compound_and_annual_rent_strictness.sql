-- 2026-07-28 daily audit — two independent, adversarially-verified defects.
--
-- ── FIX 1 · aqargate «مجمع» lost to a broken Arabic→English→Arabic round-trip ────────────────────
-- The source publishes a real property type; scrapers/aqargate/run.py:55 translates it to the English
-- token 'Compound' before storing; type_label_ar had no row to translate it BACK; so the Latin-guard
-- arm of sync_search_listings_ar ('when v.property_type ~ ''[A-Za-z]'' then ''غير معروف''') replaced a
-- source-published value with the unknown sentinel. That is a fidelity loss in Ezhalah's own favour —
-- we discarded what the source said. Live proof (2026-07-28):
--   curl https://aqargate.com/wp-json/wp/v2/properties/56369 → property_type_text: ["مجمع"]
--   search_listings_ar(aqargate_commercial? no — residential, listing_id 2116473).type_ar = 'غير معروف'
--
-- This adds NO new vocabulary: 'مجمع' is already canonical — known_type_ar has it, propertyTypes.ts:136
-- maps it to 'Residential Building', and 8 sanadak rows already render it today. Regenerating the seeds
-- changed ONLY type_label_ar (39 → 40 rows); known_type_ar.generated.sql and
-- known_property_types.generated.sql are byte-identical, which is the proof that no filter/taxonomy
-- surface moves and detect_novel_property_types stays quiet.
--
-- WHY THE SEED IS RE-APPLIED WHOLE: sql/type_label_ar.generated.sql is a generated truncate-and-replace
-- artifact (scripts/taxonomy/gen.ts:145-158, "Full authoritative re-sync"). A bare INSERT here would be
-- silently wiped by the next `npm run verify:emit-sql` + apply, and would leave live diverged from the
-- committed snapshot with the offline build gate unable to see it.

create table if not exists public.type_label_ar (en text primary key, ar text not null);
truncate public.type_label_ar;
insert into public.type_label_ar (en, ar) values
  ('Agriculture Plot', 'أرض زراعية'),
  ('Apartment', 'شقة'),
  ('Bank', 'بنك'),
  ('Building', 'عمارة'),
  ('Camp', 'مخيم'),
  ('Chalet', 'شاليه'),
  ('Cinema', 'سينما'),
  ('Commercial Building', 'مبنى تجاري'),
  ('Commercial Land', 'أرض تجارية'),
  ('Compound', 'مجمع'),
  ('Duplex', 'دوبلكس'),
  ('Factory', 'مصنع'),
  ('Farm', 'مزرعة'),
  ('Floor', 'دور'),
  ('Gas Station', 'محطة وقود'),
  ('Hall', 'صالة'),
  ('Health Center', 'مركز صحي'),
  ('Hotel', 'فندق'),
  ('House', 'بيت'),
  ('Industrial Land', 'أرض صناعية'),
  ('Kiosk', 'كشك'),
  ('Land', 'أرض'),
  ('Office', 'مكتب'),
  ('Palace', 'فيلا'),
  ('Parking', 'مواقف'),
  ('Residential Building', 'عمارة سكنية'),
  ('Residential Land', 'أرض سكنية'),
  ('Rest House', 'استراحة'),
  ('Room', 'غرفة'),
  ('School', 'مدرسة'),
  ('Shop', 'محل'),
  ('Showroom', 'معرض'),
  ('Specialized Facilities', 'منشآت متخصصة'),
  ('Staff Housing', 'سكن عمال'),
  ('Station', 'محطة'),
  ('Studio', 'استوديو'),
  ('Telecom Tower', 'برج اتصالات'),
  ('Villa', 'فيلا'),
  ('Warehouse', 'مستودع'),
  ('Workshop', 'ورشة');

-- ── FIX 1b · recompute the already-indexed rows the dictionary just unblocked ────────────────────
-- The sync is incremental and type_ar is NOT in its change-detection column list, so the only thing
-- that would re-select this row is aqargate's crawl continuing to bump last_updated. That holds today
-- but silently stops the moment the platform stalls or gets IP-blocked (exactly what happened to
-- jazwtn), leaving the sentinel frozen forever. The 20260716 FIX 2b backfill cannot help either: its
-- predicate is `s.type_ar ~ '[A-Za-z]'`, and after that migration ran this row holds the ARABIC
-- sentinel, so it no longer matches. Recompute through the identical live expression, scoped to rows
-- that STAND TO GAIN a real label — a row whose source genuinely publishes no type keeps the sentinel.
-- Idempotent: re-running changes nothing once the labels resolve.
update public.search_listings_ar s
set type_ar = sub.new_type_ar
from (
  select v.source_table, v.listing_id,
         canon_type_ar(normalize(case
                                   when t.ar is not null then t.ar
                                   when v.property_type is null or btrim(v.property_type) = '' then 'غير معروف'
                                   when v.property_type ~ '[A-Za-z]' then 'غير معروف'
                                   else v.property_type
                                 end, NFC)) as new_type_ar
  from public.listing_native_location_v2 v
  left join public.type_label_ar t on t.en = v.property_type
) sub
where s.source_table = sub.source_table
  and s.listing_id = sub.listing_id
  and s.type_ar = 'غير معروف'
  and sub.new_type_ar <> 'غير معروف';

-- ── FIX 2 · annual-rent phantom count: the RPC infers a period the source never published ────────
-- The app and the RPC disagree on what "annual" means, and only the app implements the owner's rule.
--   src/data/remote.ts:894-895 (owner rule, already written): "ANNUAL: strict rent_period='annual'
--     only — a null rent_period on a mixed platform is NOT annual and must appear in NEITHER monthly
--     nor annual (never guess)."  remote.ts:899 → .eq('rent_period','annual')
--   RPC annual branch (live body): (p_rent_period = 'سنوي' and s.payment_monthly = false)
-- "not monthly ⇒ annual" sweeps in every rent row whose source published NO period (277 rows) plus 8
-- whose source says monthly = 285 phantoms. They are counted in the «لقينا N إعلان» headline and consume
-- paging slots, then the card fetch drops them and they never render — the last Load-More page comes
-- back short. Worst city الخبر: 94 of 3,342 counted (2.8%).
--
-- Gate on the source-published period instead. NO LISTING DATA IS TOUCHED — filter predicate only; the
-- NULL-period rows keep their exact source values and still appear under a no-period Rent search, they
-- are simply no longer CLAIMED to be annual. The inverse "fix" (relaxing the client to accept NULL as
-- annual) is explicitly forbidden — it would infer a period the source never published.
--
-- Correctness of the swap, proven both directions before shipping:
--   search_listings_ar: (سنوي,false)=45,936 · (شهري,true)=28,231 · (NULL,false)=277 · (شهري,false)=8
--   independent raw-table count of rent_period='annual' = 45,936 — exact match, so no genuine annual
--   listing is lost. Annual counts drop by exactly 285 nationwide; monthly / Buy / bothDeals / the
--   no-period Rent path are untouched.
--
-- Body rebuilt from pg_get_functiondef of the LIVE function per the full-body-replace hazard, with the
-- identical 35-arg signature so no second overload is created.
do $rpcfix$
declare
  v_src text;
  v_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'location_search_candidates_ar'
    and pg_get_function_identity_arguments(p.oid) like '%p_category%';

  if v_src is null then
    raise exception 'location_search_candidates_ar not found — aborting rather than guessing a body';
  end if;

  -- Needle-edit the ONE annual branch. Fail closed if the needle is absent or ambiguous.
  if (length(v_src) - length(replace(v_src, '(p_rent_period = ''سنوي'' and s.payment_monthly = false)', '')))
     / length('(p_rent_period = ''سنوي'' and s.payment_monthly = false)') <> 1 then
    raise exception 'annual-branch needle not found exactly once — live body drifted, aborting';
  end if;

  v_new := replace(
    v_src,
    '(p_rent_period = ''سنوي'' and s.payment_monthly = false)',
    '(p_rent_period = ''سنوي'' and s.rent_period_ar = ''سنوي'')'
  );

  execute v_new;
end
$rpcfix$;

notify pgrst, 'reload schema';
