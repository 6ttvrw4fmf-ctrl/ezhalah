-- A guest's blurred line shows only the parts a signed-in user would see (owner 2026-11-12, blurred numbers for guests):
-- the server now tells a guest yes/no per part (has_new / has_gone / has_median) — still never a number — so the blur
-- never promises «⚡ اختفى» before the 30-day removal log exists, nor a price where none is shown.
create or replace function public.map_view_facts_ar(
  p_s double precision, p_w double precision, p_n double precision, p_e double precision,
  p_deals text[] default null, p_poly jsonb default null, p_category text default null, p_types text[] default null,
  p_beds integer[] default null, p_area_min integer default null, p_area_max integer default null,
  p_price_min numeric default null, p_price_max numeric default null, p_furnished boolean default null,
  p_tables text[] default null, p_tables2 text[] default null, p_types2 text[] default null, p_macro text default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'extensions'
as $function$
declare v jsonb;
begin
  if not coalesce((select ff.enabled from public.ops_feature_flags ff where ff.name = 'map_view_facts'), false) then
    return null;
  end if;
  v := public.map_view_facts_core(p_s, p_w, p_n, p_e, p_deals, p_poly, p_category, p_types, p_beds, p_area_min, p_area_max,
                                  p_price_min, p_price_max, p_furnished, p_tables, p_tables2, p_types2, p_macro);
  if auth.uid() is null then
    return jsonb_build_object('locked', true, 'any', v -> 'any',
      'has_new', coalesce((v ->> 'new30')::bigint, 0) > 0,
      'has_gone', coalesce((v ->> 'gone30')::bigint, 0) > 0,
      'has_median', (v ->> 'median') is not null);
  end if;
  return v;
end;
$function$;
revoke all on function public.map_view_facts_ar(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text) from public;
grant execute on function public.map_view_facts_ar(double precision, double precision, double precision, double precision, text[], jsonb, text, text[], integer[], integer, integer, numeric, numeric, boolean, text[], text[], text[], text) to anon, authenticated;
