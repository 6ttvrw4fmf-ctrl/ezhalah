-- MONTHLY ADVANCED FILTER, stage 1: make Gathern's native signals SEARCHABLE.
--
-- Gathern is 91.9% of Monthly inventory (29,528 of 32,144) and is the only platform in Ezhalah that
-- publishes a property rating. It is a short-stay platform, so its page carries schema.org
-- structured data:
--     "aggregateRating":{"@type":"AggregateRating","ratingValue":9.9,"reviewCount":68,
--                        "bestRating":10,"worstRating":1}
-- SOURCE-VERIFIED 2026-08-16 by fetching https://gathern.co/view/173898/unit/242921 live: the page's
-- values matched our stored additional_info byte-for-byte, and the 1–10 scale is declared BY THE
-- SOURCE (bestRating/worstRating). It hangs off @type: VacationRental with the unit's own name, so
-- it is a PROPERTY/UNIT rating — not a host rating, not a paid-placement score. (Contrast wasalt
-- packageScore, which is paid placement and must NEVER be mapped to stars — see project memory.)
--
-- Three columns, following the sync_payment_monthly precedent exactly: one focused, idempotent
-- updater rather than a 52-branch edit of the 95KB listing_rich_attrs view (which several concurrent
-- sessions also touch — a full-body replace there is the documented revert hazard). The FILTER
-- architecture stays one system: these columns feed the same af_eligibility_clause / RPC family /
-- cohort registry as every other field.
--
-- SOURCE-TRUTH RULES BAKED IN HERE, not in the UI:
--   1. «لا يوجد تقييم» ⇒ rating AND reviews_count are NULL. Gathern is explicitly declining to
--      publish a rating for that unit; 446 Monthly rows carry a stale numeric alongside that label,
--      and honouring the number would be fabricating a rating the source withholds. UNKNOWN wins.
--   2. Out-of-scale or non-numeric ⇒ NULL. Never coerce, never clamp.
--   3. Non-Gathern rows are never touched: they stay NULL = UNKNOWN, never "low rated".
--   4. The sync is idempotent and two-directional — if a rating disappears at source, the column
--      goes back to NULL on the next run. It can only ever write what the source currently says.

alter table public.search_listings_ar
  add column if not exists rating numeric(4,1),
  add column if not exists reviews_count integer,
  add column if not exists unit_subtype_ar text;

comment on column public.search_listings_ar.rating is
  'Gathern property/unit rating on the SOURCE-DECLARED 1-10 scale (schema.org AggregateRating '
  'ratingValue, bestRating 10 / worstRating 1). NULL = UNKNOWN and must never be read as low-rated. '
  'Forced NULL when the source label is «لا يوجد تقييم». Gathern-only: no other platform publishes one.';
comment on column public.search_listings_ar.reviews_count is
  'Gathern reviewCount accompanying rating. NULL whenever rating is NULL, so the pair is never split.';
comment on column public.search_listings_ar.unit_subtype_ar is
  'Gathern unit_type_ar (استديو / شقق مخدومة / شقة / غرفة / فيلا) — a MONTHLY-ONLY sub-classification. '
  'The canonical taxonomy column type_ar is untouched: Gathern studios and serviced apartments stay '
  'type_ar=شقة so no existing cohort, count or barrier shifts.';

create index if not exists idx_search_rating_monthly
  on public.search_listings_ar (rating)
  where rating is not null and payment_monthly;

create or replace function public.sync_gathern_native_attrs()
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n int;
begin
  with want as (
    select s.source_table, s.listing_id,
      -- Rule 1 + 2. The label gate is checked FIRST and wins over any stored number.
      case
        when btrim(coalesce(g.additional_info->>'rate_text','')) = 'لا يوجد تقييم' then null
        when g.additional_info->>'rating' ~ '^[0-9]+(\.[0-9]+)?$'
         and (g.additional_info->>'rating')::numeric >= 1
         and (g.additional_info->>'rating')::numeric <= 10
          then round((g.additional_info->>'rating')::numeric, 1)
        else null
      end as want_rating,
      case
        when btrim(coalesce(g.additional_info->>'rate_text','')) = 'لا يوجد تقييم' then null
        when g.additional_info->>'rating' ~ '^[0-9]+(\.[0-9]+)?$'
         and (g.additional_info->>'rating')::numeric between 1 and 10
         and g.additional_info->>'reviews_count' ~ '^[0-9]+$'
          then (g.additional_info->>'reviews_count')::int
        else null
      end as want_reviews,
      nullif(btrim(coalesce(g.additional_info->>'unit_type_ar','')), '') as want_subtype
    from search_listings_ar s
    join gathern_residential_listings g
      on s.source_table = 'gathern_residential_listings' and s.listing_id = g.id
  )
  update search_listings_ar s
     set rating = want.want_rating,
         reviews_count = want.want_reviews,
         unit_subtype_ar = want.want_subtype
  from want
  where want.source_table = s.source_table and want.listing_id = s.listing_id
    and (s.rating is distinct from want.want_rating
      or s.reviews_count is distinct from want.want_reviews
      or s.unit_subtype_ar is distinct from want.want_subtype);
  get diagnostics n = row_count;
  return n;
end $$;

comment on function public.sync_gathern_native_attrs() is
  'Mirrors Gathern rating / reviews_count / unit_type_ar into search_listings_ar. Idempotent and '
  'two-directional: a rating withdrawn at source returns to NULL on the next run. Never touches a '
  'non-Gathern row.';

select public.sync_gathern_native_attrs() as rows_synced;