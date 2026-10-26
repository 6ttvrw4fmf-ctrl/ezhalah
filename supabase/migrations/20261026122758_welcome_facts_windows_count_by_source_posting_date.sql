-- EVERY TIME WINDOW IN THE WELCOME FACTS COUNTS BY THE SITE'S OWN POSTING DATE, NOT BY WHEN OUR SCRAPERS FIRST SAW
-- THE AD (owner 2026-10-26: «yesterday a listing can be kept yesterday or before 1 year but we just took it … make
-- sure it's accurate», then the «آخر 7 أيام» line, then «all of them»).
--
-- Measured before this change (Aqar residential, first seen 2026-10-25): 1,320 rows; 611 posted that day per the site,
-- 655 posted earlier that week, 51 older than a week — «أمس» said roughly double the truth, and every «آخر 7 أيام» /
-- week-over-week / «آخر 30 يوم» fact read the same first-seen time. Every listing table carries the site's own
-- `date_added` (305 tables); a survey of every row scraped in the last 3 days found only ISO timestamps (UTC «Z»,
-- «+03:00», or zone-less = Saudi time), YYYY-MM-DD and DD/MM/YYYY, none unparsable, and none equal to the scrape
-- time (no table writes the scrape time as the posting date).
--
-- HOW: the builder's working table w_b carries `first_seen_at`, and every windowed fact reads it — the «أمس» count,
-- city_new_districts, hot_district, town_week, week_* (welcome_city_top_district), wow_* (welcome_wow) and month_*
-- (welcome_month). For every ad first seen in the last 61 days (the widest window is 60), that value becomes the
-- site's own posting time; no readable date → '-infinity', so the ad is in NO window (SOURCE IS TRUTH: unknown is never
-- «new»). Older ads cannot have been posted inside any window. The checker (audit_welcome_insights) applies the same
-- rule to its own copy. Counts are therefore lower bounds and the count sentences now say «ما لا يقل عن» / "at least";
-- the week-over-week lines already compare only steadily-read sites, which now means sites that publish dates.

-- 1. The source's own posting moment, from the formats the sites really use. NULL when it cannot be read exactly.
create or replace function public.source_posted_at(p_raw text)
returns timestamptz
language plpgsql
stable
set search_path to 'public'
as $$
declare r text := btrim(coalesce(p_raw, ''));
begin
  if r ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$' then return r::timestamptz; end if;
  if r ~ '^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$' then return replace(r, 'T', ' ')::timestamp at time zone 'Asia/Riyadh'; end if;
  if r ~ '^\d{4}-\d{2}-\d{2}$' then return r::date::timestamp at time zone 'Asia/Riyadh'; end if;
  if r ~ '^\d{1,2}/\d{1,2}/\d{4}$' then return to_date(r, 'DD/MM/YYYY')::timestamp at time zone 'Asia/Riyadh'; end if;
  return null;
exception when others then
  return null;  -- an impossible date (31/02/2026) is unreadable, never a guess
end $$;
comment on function public.source_posted_at(text) is
  'The listing site''s own posting moment from date_added (ISO with or without zone = Saudi time, YYYY-MM-DD, DD/MM/YYYY). NULL = unknown, never counted as new (owner 2026-10-26).';
revoke all on function public.source_posted_at(text) from public, anon, authenticated;

-- 2. The builder: recent ads' first_seen_at becomes the site's own posting time. Needle edits on the live body.
do $mig$
declare src text; out text;
begin
  src := pg_get_functiondef('public.build_welcome_insights()'::regprocedure);
  out := src;
  if position(E'  v_total int;\n' in out) = 0 then raise exception 'builder: declare needle missing'; end if;
  out := replace(out, E'  v_total int;\n', E'  v_total int;\n  v_tbl text;\n');

  if position(E'and s.region_ar is not null;\n  -- the same property on several sites' in out) = 0 then raise exception 'builder: w_b needle missing'; end if;
  out := replace(out, E'and s.region_ar is not null;\n  -- the same property on several sites',
E'and s.region_ar is not null;
  -- EVERY window counts by the SITE''s own posting date (owner 2026-10-26). For an ad first seen in the last 61 days,
  -- first_seen_at becomes that date; no readable date → ''-infinity'' (in no window). Older ads are left as they are.
  create temp table w_posted (source_table text, listing_id bigint, posted_at timestamptz) on commit drop;
  for v_tbl in select distinct source_table from w_b where first_seen_at >= now() - interval ''61 days'' loop
    begin
      execute format(''insert into w_posted select %L, t.id, public.source_posted_at(t.date_added) from public.%I t where t.scraped_at >= $1'', v_tbl, v_tbl)
        using now() - interval ''62 days'';
    exception when undefined_table or undefined_column then null;  -- a table without its own date adds nothing
    end;
  end loop;
  create index on w_posted (source_table, listing_id);
  update w_b b set first_seen_at = coalesce((select p.posted_at from w_posted p
                                              where p.source_table = b.source_table and p.listing_id = b.listing_id
                                                and p.posted_at <= now() limit 1), ''-infinity''::timestamptz)
   where b.first_seen_at >= now() - interval ''61 days'';
  -- the same property on several sites');
  execute out;
end $mig$;

-- 3. The checker: its own a_b reads the same source dates for every window it recounts.
do $mig$
declare src text; out text; p text;
begin
  src := pg_get_functiondef('public.audit_welcome_insights()'::regprocedure);
  out := src;
  if position('t0 timestamptz; wk timestamptz; y0 timestamptz; y1 timestamptz; gate boolean;' in out) = 0 then raise exception 'audit: declare needle missing'; end if;
  out := replace(out, 't0 timestamptz; wk timestamptz; y0 timestamptz; y1 timestamptz; gate boolean;',
                      't0 timestamptz; wk timestamptz; y0 timestamptz; y1 timestamptz; gate boolean; v_tbl text;');
  -- the source dates, gathered before a_b is built
  if position(E'create temp table a_b on commit drop as\n' in out) = 0 then raise exception 'audit: a_b create needle missing'; end if;
  out := replace(out, E'create temp table a_b on commit drop as\n',
E'-- every window = the SITE''s own posting date (owner 2026-10-26); unknown → in no window
  create temp table a_posted (source_table text, listing_id bigint, posted_at timestamptz) on commit drop;
  for v_tbl in select distinct s.source_table from public.search_listings_ar s where s.first_seen_at >= t0 - interval ''61 days'' loop
    begin
      execute format(''insert into a_posted select %L, t.id, public.source_posted_at(t.date_added) from public.%I t where t.scraped_at >= $1'', v_tbl, v_tbl)
        using t0 - interval ''62 days'';
    exception when undefined_table or undefined_column then null;
    end;
  end loop;
  create index on a_posted (source_table, listing_id);
  delete from a_posted where posted_at is null or posted_at > t0;
  create temp table a_b on commit drop as\n');
  if position(E'      join (select platform, min(first_seen_at) first_ever from public.search_listings_ar group by 1) f on f.platform = s.platform\n' in out) = 0
    then raise exception 'audit: join needle missing'; end if;
  out := replace(out, E'      join (select platform, min(first_seen_at) first_ever from public.search_listings_ar group by 1) f on f.platform = s.platform\n',
E'      join (select platform, min(first_seen_at) first_ever from public.search_listings_ar group by 1) f on f.platform = s.platform\n      left join a_posted ap on ap.source_table = s.source_table and ap.listing_id = s.listing_id\n');
  -- P = the moment each window is judged on: the posting date for an ad first seen in the last 61 days, else first seen
  p := '(case when s.first_seen_at >= t0 - interval ''61 days'' then coalesce(ap.posted_at, ''-infinity''::timestamptz) else s.first_seen_at end)';
  if position(' and s.first_seen_at >= wk, false) is_new,' in out) = 0 then raise exception 'audit: is_new needle missing'; end if;
  out := replace(out, ' and s.first_seen_at >= wk, false) is_new,', ' and ' || p || ' >= wk, false) is_new,');
  if position(' and s.first_seen_at >= wk - interval ''7 days'' and s.first_seen_at < wk, false) is_lw,' in out) = 0 then raise exception 'audit: is_lw needle missing'; end if;
  out := replace(out, ' and s.first_seen_at >= wk - interval ''7 days'' and s.first_seen_at < wk, false) is_lw,',
                      ' and ' || p || ' >= wk - interval ''7 days'' and ' || p || ' < wk, false) is_lw,');
  if position(' and s.first_seen_at >= y0 and s.first_seen_at < y1, false) is_yday,' in out) = 0 then raise exception 'audit: is_yday needle missing'; end if;
  out := replace(out, ' and s.first_seen_at >= y0 and s.first_seen_at < y1, false) is_yday,',
                      ' and ' || p || ' >= y0 and ' || p || ' < y1, false) is_yday,');
  if position(' and s.first_seen_at >= t0 - interval ''30 days'', false) is_m1,' in out) = 0 then raise exception 'audit: is_m1 needle missing'; end if;
  out := replace(out, ' and s.first_seen_at >= t0 - interval ''30 days'', false) is_m1,',
                      ' and ' || p || ' >= t0 - interval ''30 days'', false) is_m1,');
  if position(' and s.first_seen_at >= t0 - interval ''60 days'' and s.first_seen_at < t0 - interval ''30 days'', false) is_m0,' in out) = 0 then raise exception 'audit: is_m0 needle missing'; end if;
  out := replace(out, ' and s.first_seen_at >= t0 - interval ''60 days'' and s.first_seen_at < t0 - interval ''30 days'', false) is_m0,',
                      ' and ' || p || ' >= t0 - interval ''60 days'' and ' || p || ' < t0 - interval ''30 days'', false) is_m0,');
  execute out;
end $mig$;

-- 4. The count sentences say what the number now is: posted in the window, and at least that many.
update public.welcome_template set
  ar = '{g} {n}، تدري إنه نُشر أمس ما لا يقل عن {a} إعلان جديد في المملكة، منها {b} في {city}؟ اكتشفها مع إزهله.',
  en = '{g} {n}, did you know at least {a} new listings were posted across the Kingdom yesterday, {b} of them in {city}? Discover them with Ezhalah.'
 where id = 23 and kind = 'yesterday';
update public.welcome_template set
  ar = '{g} {n}، تدري إن {city} نُشرت فيها إعلانات جديدة خلال آخر 7 أيام في {a} من أحيائها على الأقل؟ اكتشفها مع إزهله.',
  en = '{g} {n}, did you know new listings were posted in at least {a} of {city}''s districts in the last 7 days? Discover them with Ezhalah.'
 where id = 3 and kind = 'city_new_districts';
update public.welcome_template set
  ar = '{g} {n}، تدري إن {district} ب{city} نُشر فيه خلال آخر 7 أيام ما لا يقل عن {a} من الإعلانات الجديدة، أي {b}% من إعلاناته على الأقل؟ اكتشفه مع إزهله.',
  en = '{g} {n}, did you know at least {a} new listings were posted in {district}, {city} in the last 7 days, at least {b}% of all its listings? Discover it with Ezhalah.'
 where id = 22 and kind = 'hot_district';
update public.welcome_template set
  ar = '{g} {n}، تدري إن {district} نُشر فيه خلال آخر 7 أيام ما لا يقل عن {a} من الإعلانات الجديدة؟ اكتشفها مع إزهله.',
  en = '{g} {n}, did you know at least {a} new listings were posted in {district} in the last 7 days? Discover them with Ezhalah.'
 where id = 28 and kind = 'hot_district';
update public.welcome_template set
  ar = '{g} {n}، تدري إن {city} نُشر فيها خلال آخر 7 أيام ما لا يقل عن {a} من إعلانات الأراضي الجديدة للبيع، وأكثر حي فيه منها {district}؟ اكتشفها مع إزهله.',
  en = '{g} {n}, did you know at least {a} new land-for-sale listings were posted in {city} in the last 7 days, with the most in {district}? Discover them with Ezhalah.'
 where id = 33 and kind = 'week_land';
update public.welcome_template set
  ar = '{g} {n}، تدري إن {city} نُشر فيها خلال آخر 7 أيام ما لا يقل عن {a} من إعلانات الشقق الجديدة للبيع، وأكثر حي فيه منها {district}؟ اكتشفها مع إزهله.',
  en = '{g} {n}, did you know at least {a} new apartment-for-sale listings were posted in {city} in the last 7 days, with the most in {district}? Discover them with Ezhalah.'
 where id = 42 and kind = 'week_apt_sale';
update public.welcome_template set
  ar = '{g} {n}، تدري إن {city} نُشر فيها خلال آخر 7 أيام ما لا يقل عن {a} من إعلانات العمائر الجديدة للبيع، وأكثر حي فيه منها {district}؟ اكتشفها مع إزهله.',
  en = '{g} {n}, did you know at least {a} new building-for-sale listings were posted in {city} in the last 7 days, with the most in {district}? Discover them with Ezhalah.'
 where id = 48 and kind = 'week_bld_sale';
