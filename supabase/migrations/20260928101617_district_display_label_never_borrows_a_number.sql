-- A DISTRICT'S DISPLAY LABEL MUST NOT BORROW ANOTHER LISTING'S NUMBER (New Listings Engineer, 2026-09-28).
--
-- Owner rule 2026-09-14 (recorded in the migration that made norm_district_tok() fold trailing
-- numbers): «in our district catalog, make sure there are no numbers ... in their property card, if
-- they kept a number, we include that number.»
--
-- What production did instead, measured 2026-09-28. refresh_loc_display_district_canon() picks the
-- MOST COMMON raw label per (city, token) as that token's one display label. Since 2026-09-14 the
-- token folds trailing numbers, so «الرحاب 1», «الرحاب 2» and «الرحاب» share one token — and the most
-- common numbered spelling won. loc_display_district_ar() then stamps that label on EVERY listing of
-- the group, and wasalt cards (raw neighborhood is English, so remote.ts falls back to this label)
-- showed a number the source never published:
--   جازان «الرحاب 2»   on 96 listings wasalt publishes as «الرحاب 1»
--   جازان «المحمدية 2» on 28 «المحمدية 1» and 14 «المحمدية 3»
--   جازان «القدس 1»    on «القدس 3»;  «الأندلس 3» on «الأندلس 2»;  «حي ج15» on «حي ج9»
--   الطائف «حي ج7»      on aqarmonthly's «حي ج» (155 rows share the token)
-- 55 display labels carried a digit. The existing `fold` CTE was meant to strip it, but it requires
-- bare_tok <> tok, which is never true now that the token itself drops the number — dead since
-- 2026-09-14.
--
-- The fix is one needle: the chosen label passes through loc_district_label_unnumbered(), which
-- drops a trailing number ONLY when the result still folds to the same token (so it is provably the
-- same place), and only when a letter precedes the number (so «(حي رقم (7», «33ج», «1029 مخطط رقم»
-- and plot codes like «(474/19)» are left exactly as they are). Matching is untouched: the token is
-- unchanged by construction, so no search answer can move. Nothing is written by hand; the :08 cron
-- refresh rewrites the labels and the :22 sync carries them to search.
--
-- Undo: restore the refresh body below with `b.label` in place of the new call, and drop the arm.

create or replace function public.loc_district_label_unnumbered(p_label text, p_tok text)
returns text
language sql
stable
as $function$
  select case
    when p_label ~ '[ء-ي][[:space:]]*[0-9٠-٩]+[[:space:]]*$'
     and norm_district_tok(btrim(regexp_replace(p_label, '[[:space:]]*[0-9٠-٩]+[[:space:]]*$', ''))) = p_tok
    then btrim(regexp_replace(p_label, '[[:space:]]*[0-9٠-٩]+[[:space:]]*$', ''))
    else p_label
  end
$function$;

CREATE OR REPLACE FUNCTION public.refresh_loc_display_district_canon()
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
declare v_n bigint;
begin
  with src as (
    select s.city_id, norm_district_tok(s.district_ar) tok, s.district_ar label, count(*) n
      from public.search_listings_ar s
     where s.production_ready and s.district_ar is not null and s.city_id is not null
     group by 1,2,3),
  best as (
    select distinct on (city_id, tok) city_id, tok, label
      from src
     order by city_id, tok, n desc, (label like 'حي %') desc, length(label) desc, label
  ),
  numbered as (
    select b.city_id, b.tok, b.label,
           norm_district_tok(btrim(regexp_replace(b.label, '[[:space:]]*[0-9٠-٩]+[[:space:]]*$', ''))) as bare_tok
      from best b
     where b.label ~ '[0-9٠-٩][[:space:]]*$'
  ),
  fold as (
    -- OFFICIAL-CATALOG PARENT ONLY. There is deliberately no "another live district" fallback:
    -- that is exactly what merged جازان's real numbered neighbourhoods on the first attempt.
    select nb.city_id, nb.tok,
           (select d.district_ar from public.loc_catalog_district d
             where d.city_id = nb.city_id and d.district_norm = nb.bare_tok limit 1) as parent_display
      from numbered nb
     where nb.bare_tok is not null and length(nb.bare_tok) >= 2 and nb.bare_tok <> nb.tok
  ),
  merged as (
    select b.city_id, b.tok,
           coalesce(o.display_ar, f.parent_display, d.district_ar,
                    public.loc_district_label_unnumbered(b.label, b.tok)) as display_ar,
           (o.display_ar is null and f.parent_display is null and d.district_ar is not null) as from_catalog,
           (o.display_ar is not null or f.parent_display is not null) as is_fold
      from best b
      left join public.loc_catalog_district d
        on d.city_id = b.city_id and d.district_norm = b.tok
      left join fold f
        on f.city_id = b.city_id and f.tok = b.tok and f.parent_display is not null
      left join public.loc_district_number_override o
        on o.city_id = b.city_id and o.district_norm = b.tok
  )
  insert into public.loc_display_district_canon (city_id, district_norm, display_ar, from_catalog, refreshed_at)
  select city_id, tok, display_ar, from_catalog, now() from merged
  where is_fold or norm_district_tok(display_ar) = tok
  on conflict (city_id, district_norm) do update
    set display_ar = excluded.display_ar,
        from_catalog = excluded.from_catalog,
        refreshed_at = excluded.refreshed_at;
  get diagnostics v_n = row_count;
  return v_n;
end $function$;

-- The watch: an arm on the detector that already guards this table (it is in the sweep roster).
CREATE OR REPLACE FUNCTION public.mon_detect_district_canon_stale()
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  v_last    timestamptz;
  v_missing bigint;
  v_rows    bigint;
  v_numbered bigint;
  v_sample  jsonb;
  n int := 0;
begin
  select max(refreshed_at), count(*) into v_last, v_rows from public.loc_display_district_canon;

  -- ARM 2 (2026-09-28): a display label that still carries a number the token folds away. Such a
  -- label is stamped on every listing of the group, so a card shows a number its source never
  -- published (جازان «الرحاب 2» on wasalt's «الرحاب 1»). Independent of freshness, checked first.
  select count(*), coalesce(jsonb_agg(jsonb_build_object('city_id', k.city_id, 'label', k.display_ar))
                     filter (where k.rn <= 10), '[]'::jsonb)
    into v_numbered, v_sample
    from (select k.*, row_number() over (order by k.city_id, k.district_norm) rn
            from public.loc_display_district_canon k
           where public.loc_district_label_unnumbered(k.display_ar, k.district_norm) is distinct from k.display_ar
             and not exists (select 1 from public.loc_district_number_override o
                              where o.city_id = k.city_id and o.district_norm = k.district_norm)) k;
  if v_numbered > 0 then
    n := n + public.mon_raise('P2','district_display_borrows_number','search_index','district_display_borrows_number',
      jsonb_build_object('rows', v_numbered, 'sample', v_sample,
        'why','A district display label carries a trailing number that norm_district_tok() folds away, so '
              'every listing in that group is labelled with ONE listing''s number. Cards that fall back to '
              'this label (wasalt, English raw neighborhood) show a number the source never published.',
        'fix','refresh_loc_display_district_canon() must pass its chosen label through '
              'loc_district_label_unnumbered(); the :08 refresh then rewrites these rows.'));
  else
    perform public.mon_resolve_key('district_display_borrows_number','district_display_borrows_number');
  end if;

  select count(*) into v_missing
    from (select distinct s.city_id, norm_district_tok(s.district_ar) as tok
            from public.search_listings_ar s
           where s.production_ready and s.district_ar is not null and s.city_id is not null) i
    left join public.loc_display_district_canon k
      on k.city_id = i.city_id and k.district_norm = i.tok
   where k.city_id is null;

  -- The refresh runs hourly at :08; three hours is two missed runs, never a timing artefact.
  if v_last is not null and v_last > now() - interval '3 hours' then
    perform public.mon_resolve_key('district_canon_stale','district_canon_stale');
    return n;
  end if;

  n := n + public.mon_raise('P2','district_canon_stale','search_index','district_canon_stale',
    jsonb_build_object(
      'canon_rows', v_rows,
      'last_refreshed_at', v_last,
      'index_pairs_with_no_canon_row', v_missing,
      'why','loc_display_district_canon has not been refreshed for over three hours, so the ONE '
            'canonical rendering per (city, district) that SEARCH_MATCH_QA_ENGINEER.md 42.1 '
            'promises is only guaranteed for districts that existed at the last refresh. Every '
            'district that arrives afterwards falls back to whatever raw label its source '
            'published, and the first time two sources spell one district differently a single '
            'result list renders one place two ways. It has no user-visible symptom until then, '
            'which is exactly why it needs its own watch.',
      'fix','pg_cron job refresh-district-display-canon (:08 hourly) runs '
            'refresh_loc_display_district_canon(). Check that the job still exists and is active, '
            'then run the function once by hand; the :14 sync writes the corrected labels. The '
            'refresh is token-preserving by construction and cannot move any search answer.'));
  return n;
end $function$;

-- CHECK BLOCK: executes the installed objects. Both directions, plus the mutation (the pre-fix
-- choice `b.label`) that must be caught.
do $check$
declare
  r record;
begin
  for r in select * from (values
      ('الرحاب 2',        'رحاب',   'الرحاب'),
      ('المحمدية 1',      'محمديه', 'المحمدية'),
      ('حي ج7',           'ج',      'حي ج'),
      ('حي القادسيه 1',   'قادسيه', 'حي القادسيه'),
      ('الرحاب',          'رحاب',   'الرحاب'),        -- no number: untouched
      ('(حي رقم (7',      '(حي رقم (', '(حي رقم (7'),  -- code shape, no letter before digit: untouched
      ('33ج',             'ج',      '33ج'),           -- leading number: untouched
      ('الورود (1100/4)', 'ورود (1100/4)', 'الورود (1100/4)')  -- plot code: untouched
    ) v(label, tok, want)
  loop
    if public.loc_district_label_unnumbered(r.label, r.tok) is distinct from r.want then
      raise exception 'loc_district_label_unnumbered(%, %) = %, want %',
        r.label, r.tok, public.loc_district_label_unnumbered(r.label, r.tok), r.want;
    end if;
  end loop;
  -- the token really is unchanged for every rewrite (no search answer can move)
  if norm_district_tok('الرحاب 2') is distinct from norm_district_tok('الرحاب')
     or norm_district_tok('حي ج7') is distinct from norm_district_tok('حي ج') then
    raise exception 'token not preserved: the rewrite could move a search answer';
  end if;
  -- mutation: the pre-fix choice keeps the borrowed number, so the arm's predicate must see it
  if public.loc_district_label_unnumbered('الرحاب 2', 'رحاب') = 'الرحاب 2' then
    raise exception 'mutation not caught';
  end if;
  if position('loc_district_label_unnumbered(b.label, b.tok)' in
       pg_get_functiondef('public.refresh_loc_display_district_canon()'::regprocedure)) = 0 then
    raise exception 'refresh does not route its label through loc_district_label_unnumbered()';
  end if;
  if position('district_display_borrows_number' in
       pg_get_functiondef('public.mon_detect_district_canon_stale()'::regprocedure)) = 0 then
    raise exception 'detector arm missing';
  end if;
end $check$;
