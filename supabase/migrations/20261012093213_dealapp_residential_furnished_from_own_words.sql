-- dealapp residential carries «furnished» (🔬 AF engineer, 2026-10-12, backlog 386).
-- dealapp publishes NO structured furnished field (its JSON-LD additionalProperty holds only propertyType /
-- facing / streetWidth / propertyAge / utilities / licenseNumber, source-reread 37290037560), so the ad's own
-- words are the only statement and prose is lawful with its four outcomes (ADVANCED_FILTER_SOURCE_TRUTH §2):
-- «مفروشة» / «مؤثثة» / "furnished" → yes · «غير مفروشة» / «بدون تأثيث» → a stated no · silence or lines that
-- disagree → NULL. The table had no furnished column and listing_extra_attrs_v0 read «NULL::boolean AS
-- furnished» for this branch, so the 1,258 active ads whose text says furnished never answered the
-- Advanced Filter's furnished question.
-- Values: the shared reader scrapers.common.normalize.amenities_from_lines (the one dealapp.run.af_answers
-- uses, with today's «وغير» negator fix) read all 22,594 active stored descriptions on 2026-10-12: 1,257 yes,
-- 62 stated no. The backfill below is a SQL statement of that reading that is a strict SUBSET of it,
-- proven in the same session over all 22,594 rows: 1,223 yes and 59 no, ZERO rows where it disagrees with
-- the reader (the reader's 34 + 3 others it cannot express stay NULL until the next crawl, which writes
-- them through af_answers). Postgres computed the same id sets (md5 checked in a rolled-back dry run).
-- Written only where the column is NULL, so nothing a crawl already set is overwritten.
alter table public.dealapp_residential_listings add column if not exists furnished boolean;

do $m$
declare
  v text := pg_get_viewdef('public.listing_extra_attrs_v0'::regclass);
  o text := $q$SELECT 'dealapp_residential_listings'::text AS source_table,
    a.id AS listing_id,
    NULL::boolean AS furnished,$q$;
  n text := $q$SELECT 'dealapp_residential_listings'::text AS source_table,
    a.id AS listing_id,
    a.furnished AS furnished,$q$;
  hits int;
begin
  hits := (length(v) - length(replace(v, o, ''))) / length(o);
  if hits <> 1 then raise exception 'dealapp residential anchor matched % times (want 1)', hits; end if;
  execute 'create or replace view public.listing_extra_attrs_v0 as ' || replace(v, o, n);
end $m$;

do $b$
declare ny int; nn int;
begin
  update public.dealapp_residential_listings d set furnished = true
   where d.active and d.furnished is null and d.description is not null
     and d.description ~* '(مفروش|مؤثث|furnished)'
       and d.description !~* '(غير|بدون|لا يوجد|لايوجد|unfurnished|non|not|no).{0,16}(مفروش|مؤثث|furnished)'
       and d.description !~* '(قريب|مقابل|بجوار|بجانب|أمام|امام|near|close to|next to|opposite).{0,26}(مفروش|مؤثث|furnished)'
       and d.description !~* '(مفروش|مؤثث|furnished).{0,18}(مؤسس|مهيأ|مهيا|تأسيس|تاسيس|prepared|roughed)'
       and d.description !~* '(مؤسس|مهيأ|مهيا|تأسيس|تاسيس|prepared|roughed).{0,16}(مفروش|مؤثث|furnished)';
  get diagnostics ny = row_count;
  update public.dealapp_residential_listings d set furnished = false
   where d.active and d.furnished is null and d.description is not null
     and d.description ~* '(غير|بدون) ?(مفروش|مؤثث|furnished)'
       and regexp_replace(d.description, '(غير|بدون) ?(مفروش|مؤثث|furnished)', '', 'gi') !~* '(مفروش|مؤثث|furnished)';
  get diagnostics nn = row_count;
  raise notice 'dealapp furnished backfill: % yes, % stated no', ny, nn;
  if ny = 0 or ny > 2000 or nn > 200 then raise exception 'backfill out of the reviewed range: % yes, % no', ny, nn; end if;
end $b$;

-- Check (executes the view): every active dealapp residential row's raw furnished equals the view's.
do $c$
declare bad int; seen int;
begin
  select count(*) filter (where v.furnished is distinct from r.furnished), count(*)
    into bad, seen
    from (select id, furnished from public.dealapp_residential_listings where active and furnished is not null) r
    join public.listing_extra_attrs_v0 v on v.source_table = 'dealapp_residential_listings' and v.listing_id = r.id;
  if seen = 0 then raise exception 'view check: no dealapp furnished row was read'; end if;
  if bad > 0 then raise exception 'view check: % of % dealapp rows disagree with the raw table', bad, seen; end if;
end $c$;