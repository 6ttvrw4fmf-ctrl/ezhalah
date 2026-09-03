-- PERMANENT DETECTOR — an open-ended age bucket must never be stored as a precise age (2026-09-03).
--
-- THE DEFECT THIS EXISTS FOR, found by probing muktamel during the 5-platform activation:
--   muktamel.com listing 32221 renders «عمر العقار +10 سنة» — an OPEN-ENDED bucket meaning "10 or
--   more" — and the ingest stores it as a precise 11. 43 active rows carry that fabricated 11
--   against only 4 genuine 10s. An AF query for age = 11 then falsely matches listings whose
--   advertiser never said 11, and age >= 10 disagrees with the advertisement.
--
-- THE SIGNATURE is distinctive and cheap to test: a spike at exactly N+1 that dwarfs N. A source
-- that genuinely has 11-year-old buildings has roughly as many 10s. So this flags a TRUSTED age
-- source where the count at 11 is >= 5x the count at 10 and the spike is material (>= 20 rows).
--   muktamel: 43 vs 4 = 10.8x -> fires the moment anyone marks it trusted.
--   sanadak:  161 vs 60 = 2.7x, and its 11s were live-probed as literal published integers
--             (RSC buildingAge = 11), so it stays silent.
--
-- IT ONLY LOOKS AT TRUSTED SOURCES ON PURPOSE. An untrusted source contributes nothing to
-- listing_age_resolved, so its raw column cannot mislead the Advanced Filter. This detector's job is
-- to stop a bucket artifact from being ADMITTED, and to fire the instant trusted=true is flipped on
-- a source that still carries one.
create or replace function public.mon_detect_age_open_bucket_stored_as_precise()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r      record;
  raised integer := 0;
  n10    bigint;
  n11    bigint;
begin
  for r in
    select source_table from public.age_source_registry
    where trusted is true and strategy = 'canonical_column'
    order by source_table
  loop
    begin
      execute format(
        'select count(*) filter (where property_age = 10), count(*) filter (where property_age = 11) '
        || 'from public.%I where active', r.source_table) into n10, n11;
    exception when undefined_table or undefined_column then
      continue;   -- table retired or reshaped; other detectors own that
    end;

    if n11 >= 20 and n11 >= 5 * greatest(n10, 1) then
      raised := raised + public.mon_raise(
        'P2',
        'age_open_bucket_stored_as_precise',
        split_part(r.source_table, '_', 1),
        'age_open_bucket_stored_as_precise:' || r.source_table,
        jsonb_build_object(
          'source_table', r.source_table,
          'age_11', n11,
          'age_10', n10,
          'ratio', round(n11::numeric / greatest(n10, 1), 1),
          'why', 'signature of an open-ended "+10" bucket stored as a precise 11 — publishes an age '
                 || 'the advertiser never stated',
          'fix', 'probe a listing on the source; if it renders «+10»/«10+», map the bucket to NULL '
                 || '(or a documented min-bound) in the scraper rather than to a concrete number'));
    else
      perform public.mon_resolve_key('age_open_bucket_stored_as_precise',
                                     'age_open_bucket_stored_as_precise:' || r.source_table);
    end if;
  end loop;

  return raised;
end
$fn$;

comment on function public.mon_detect_age_open_bucket_stored_as_precise() is
  'Flags a TRUSTED canonical_column age source whose distribution carries the open-bucket artifact '
  '(a large spike at 11 with almost no 10s) — the muktamel «+10 سنة» -> 11 defect found 2026-09-03. '
  'Silent for sources whose 11s were verified as literal published integers (sanadak).';

revoke all on function public.mon_detect_age_open_bucket_stored_as_precise() from public;
grant execute on function public.mon_detect_age_open_bucket_stored_as_precise() to service_role;

select public.mon_detect_age_open_bucket_stored_as_precise() as raised_on_current_trusted_set;
