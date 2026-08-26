-- AF cohort certification, 2026-08-23 (owner order: audit the six uncertified types individually
-- against real source data and certify only what is genuinely supported).
--
-- Duplex/Buy and Factory ×2 earned a cohort. Camp, Chalet, Staff Housing and Service Facilities did
-- NOT — evidence in src/lib/afCohorts.ts and docs/AF_COHORT_LEDGER.md. Nothing here was inferred
-- from a sibling type: every field below was adjudicated against the live source page.
--
--   Duplex/Buy  n=117, 9 platforms, top platform 40.2%, 5 fresh/7d. ONE field survives — bathrooms,
--               76/117 known (65%), four narrowing rungs. Source-adjudicated 6/6 EXACT against
--               hajerhouses' own «دورات المياه» field. Age 12/117, street width 14/117, direction
--               9/117, kitchen 7, parking 6, furnished 1, rnpl 0 — none usable, none padded in.
--   Factory x2  rent n=72 (7 fresh/7d), buy n=34 (2 fresh/7d), aqar-commercial monoculture 94%
--               (flagged, as Shop and IndLand already are). street_width verified 10/10 EXACT
--               against aqar's structured `street_width` payload key, plus one correct UNKNOWN
--               where the source is silent. property_age is source-verified too but deliberately
--               NOT offered: AGE_FILTER_TYPES has no Factory entry and that gate's floor is 150.
--
-- These certifications do NOT open Advanced Filter for any group — every group's ceiling is set by
-- the intersection of its already-certified members. They are registered because they are TRUE, and
-- because a registry row is what puts a cohort under barrier protection.
begin;

insert into public.af_cohort_registry(deal_ar, rent_period_ar, type_ar, enabled, note)
select v.deal_ar, v.rent_period_ar, v.type_ar, true, v.note
from (values
  ('بيع'::text, null::text, 'دوبلكس'::text,
   'Certified 2026-08-23 — Duplex/Buy (n=117, 9 platforms, top 40.2%). bathrooms ONLY (65% known, 4 rungs); source-adjudicated 6/6 exact vs hajer «دورات المياه». Below the 2-question opening floor on its own.'::text),
  ('بيع', null, 'مصنع',
   'Certified 2026-08-23 — Factory/Buy (n=34). street_width ONLY; 10/10 exact vs aqar structured street_width key. property_age source-verified but unofferable (no AGE_FILTER_TYPES entry, gate floor 150).'),
  ('إيجار', 'سنوي', 'مصنع',
   'Certified 2026-08-23 — Factory/Rent-Annual (n=72, 7 fresh/7d). street_width ONLY; same 10/10 source proof. aqar-commercial monoculture 94%, flagged.')
) as v(deal_ar, rent_period_ar, type_ar, note)
where not exists (
  select 1 from public.af_cohort_registry r
  where r.deal_ar = v.deal_ar
    and coalesce(r.rent_period_ar, '') = coalesce(v.rent_period_ar, '')
    and r.type_ar = v.type_ar
);

-- Raise the certified floor with the roster, so the shrink detector still protects every row.
do $$
declare def text; occ int; n int;
begin
  select count(*) into n from public.af_cohort_registry where enabled;
  if n <> 59 then raise exception 'ABORT: expected 59 enabled rows after insert, got %', n; end if;

  select pg_get_functiondef(p.oid) into def from pg_proc p
   where p.proname = 'mon_check_filter_parity_legacy' and p.pronamespace = 'public'::regnamespace;
  if def is null then raise exception 'ABORT: mon_check_filter_parity_legacy not found'; end if;

  occ := (length(def) - length(replace(def, 'floor of 56', ''))) / length('floor of 56');
  if occ <> 1 then raise exception 'ABORT: message needle occurs % times, expected 1', occ; end if;
  def := replace(def, 'floor of 56', 'floor of 59');

  occ := (length(def) - length(replace(def, '< 56', ''))) / length('< 56');
  if occ <> 1 then raise exception 'ABORT: comparison needle occurs % times, expected 1', occ; end if;
  def := replace(def, '< 56', '< 59');

  occ := (length(def) - length(replace(def, '''floor'', 56', ''))) / length('''floor'', 56');
  if occ <> 1 then raise exception 'ABORT: floor-detail needle occurs % times, expected 1', occ; end if;
  def := replace(def, '''floor'', 56', '''floor'', 59');

  execute def;
end $$;

commit;
