-- THE WORDS THAT TURN A CHIP ON ARE REVIEWED, AND A WORD PROVED WRONG NEVER COMES BACK (owner 2026-11-03: «whatever user
-- selects must be true and must be written on the other sites … if it's wrong we can go to jail … double check our strong
-- barriers for the advanced filter»).
--
-- Measured 2026-11-03: 26 Advanced Filter detectors were green while the free word reader served «بنت» (a name, «بنت
-- هاوس») as Wi-Fi on ~2,270 ads, «صالة عائلية» (a room) as «for families» on ~18,000, «مغسلة» (a washbasin) as a car
-- wash, «كافية» (enough) as a cafe, and dozens more. Every detector compared COUNTS (chip = index = oracle — all exact);
-- none looked at the WORDS a yes rests on, so a look-alike word was invisible however many ads it reached. This adds the
-- missing barrier, one detector on the mon_run_all_detectors() roster, gated to once a day (it reads every overlay row):
--   af_rejected_evidence_served (P1) — a phrase the audit PROVED wrong for a chip serves any ad again (a regression in
--       scrapers/facts/word_checker.py, or an old reading not yet re-read). Never cleared by trusting the phrase.
--   af_new_evidence_phrase (P2)      — a phrase nobody has reviewed now carries a chip on >= 25 served ads: read the
--       sentences, then mark it trusted or rejected in ops_af_evidence_phrase (and fix the reader if rejected).
-- Seeded AFTER the round-2 re-read: every phrase then serving >= 25 ads was read by the audit (three reviewers, ~180 chips)
-- and is trusted; the rejected rows are the classes the audit proved wrong. Phrases are compared as written (letters
-- folded: أإآ→ا, ة→ه, ى→ي, digits→#), so «بنت» and «نت» stay different phrases.
set local lock_timeout = '5s';

create table if not exists public.ops_af_evidence_phrase (
  fact        text not null,
  phrase      text not null,
  status      text not null check (status in ('trusted', 'rejected')),
  ads_at_review integer,
  reviewed_at timestamptz not null default now(),
  note        text,
  primary key (fact, phrase)
);
alter table public.ops_af_evidence_phrase enable row level security;
revoke all on public.ops_af_evidence_phrase from anon, authenticated;

create or replace function public.af_evidence_phrase_norm(q text)
returns text
language sql
immutable
as $$
  select nullif(btrim(regexp_replace(regexp_replace(regexp_replace(
           translate(lower(coalesce(q, '')), 'أإآٱةى٠١٢٣٤٥٦٧٨٩', 'ااااهي0123456789'),
           '[ًٌٍَُِّْـ]', '', 'g'),
           '[0-9]+', '#', 'g'),
           '\s+', ' ', 'g')), '')
$$;

create or replace function public.mon_detect_af_evidence_phrases()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  n int := 0; live text[] := '{}';
  v_rej jsonb; v_rej_n bigint; v_new jsonb; v_new_n bigint;
begin
  -- SELF-PROOF, every sweep: the normaliser must keep a name apart from the word it resembles, and fold spelling.
  if public.af_evidence_phrase_norm('بنت') = public.af_evidence_phrase_norm('نت')
     or public.af_evidence_phrase_norm('مرتفعة') <> public.af_evidence_phrase_norm('مرتفعه')
     or public.af_evidence_phrase_norm('٣ شقق') <> public.af_evidence_phrase_norm('3 شقق') then
    return public.mon_raise('P1', 'detector_discriminator_broken', 'monitoring',
      'detector_discriminator_broken:af_evidence_phrases',
      jsonb_build_object('detector', 'mon_detect_af_evidence_phrases',
        'why', 'af_evidence_phrase_norm() no longer separates «بنت» from «نت» or folds spelling. Until fixed this detector is unmeasured, not green.'));
  end if;
  if not public.mon_claim_daily_slot('af_evidence_phrases') then return 0; end if;

  with ev as (
    select k.fact, public.af_evidence_phrase_norm(f.facts -> k.fact ->> 'q') phrase, f.source_table, f.listing_id
      from public.listing_text_facts f
      join public.search_listings_ar s using (source_table, listing_id)
      cross join lateral jsonb_object_keys(f.facts) as k(fact)
     where f.stale_at is null and (f.facts -> k.fact ->> 'v') = 'true'),
  agg as (
    select fact, phrase, count(*) ads, min(source_table || ':' || listing_id) example
      from ev where phrase is not null group by 1, 2)
  select count(*) filter (where r.status = 'rejected'),
         jsonb_agg(jsonb_build_object('fact', a.fact, 'phrase', a.phrase, 'ads', a.ads, 'example', a.example)
                   order by a.ads desc) filter (where r.status = 'rejected'),
         count(*) filter (where r.status is null and a.ads >= 25),
         (jsonb_agg(jsonb_build_object('fact', a.fact, 'phrase', a.phrase, 'ads', a.ads, 'example', a.example)
                    order by a.ads desc) filter (where r.status is null and a.ads >= 25))
    into v_rej_n, v_rej, v_new_n, v_new
    from agg a left join public.ops_af_evidence_phrase r on r.fact = a.fact and r.phrase = a.phrase;

  if v_rej_n > 0 then
    live := live || 'af_rejected_evidence_served'::text;
    n := n + public.mon_raise('P1', 'af_rejected_evidence_served', 'all', 'af_rejected_evidence_served',
      jsonb_build_object('phrases', v_rej_n, 'offenders', (select jsonb_agg(x) from (select * from jsonb_array_elements(v_rej) limit 20) z(x)),
        'why', 'A phrase the 2026-11-03 audit PROVED does not mean this feature (e.g. «بنت» for Wi-Fi) is again the only evidence for a chip on served ads. Users who pick that chip get ads that do not have it.',
        'action', 'Find what brought it back in scrapers/facts/word_checker.py (its selftest carries the real sentence) and fix the reader; never mark a rejected phrase trusted to clear this.'));
  end if;
  if v_new_n > 0 then
    live := live || 'af_new_evidence_phrase'::text;
    n := n + public.mon_raise('P2', 'af_new_evidence_phrase', 'all', 'af_new_evidence_phrase',
      jsonb_build_object('phrases', v_new_n, 'offenders', (select jsonb_agg(x) from (select * from jsonb_array_elements(v_new) limit 20) z(x)),
        'why', 'A phrase nobody has reviewed now turns an Advanced Filter chip on for 25+ served ads. A look-alike word («صالة عائلية» for «for families») looks exactly like this.',
        'action', 'Read 5 real sentences around the phrase. If it states the feature, insert (fact, phrase, ''trusted''); if not, insert ''rejected'' AND fix the reader with the sentence as a selftest line.'));
  end if;
  perform public.mon_resolve_stale_keys('af_rejected_evidence_served', case when v_rej_n > 0 then array['af_rejected_evidence_served'] else '{}'::text[] end);
  perform public.mon_resolve_stale_keys('af_new_evidence_phrase', case when v_new_n > 0 then array['af_new_evidence_phrase'] else '{}'::text[] end);
  return n;
end
$function$;
revoke execute on function public.mon_detect_af_evidence_phrases() from public, anon, authenticated;

-- REJECTED: the classes the 2026-11-03 audit proved wrong (each has its real sentence in word_checker.py's selftest).
insert into public.ops_af_evidence_phrase (fact, phrase, status, note)
select v.fact, public.af_evidence_phrase_norm(v.q), 'rejected', v.note
  from (values
    ('wifi','بنت','a name: خديجة بنت خويلد / بنت هاوس'), ('internet','بنت','a name: خديجة بنت خويلد / بنت هاوس'),
    ('crane','ونشتري','و+نشتري'), ('crane','ونشاط','و+نشاط'), ('crane','ونشر','و+نشر'), ('crane','ونشافة','a dryer'),
    ('dunes_view','الرمال','حي الرمال'), ('dunes_view','بالرمال','حي الرمال'),
    ('producing_farm','شغالة','غرفة شغالة = maid'), ('producing_farm','للشغالة','maid'), ('producing_farm','منتجة','area / garden'),
    ('raised_plot','مرتفعة','tall doors / high ceilings'), ('for_youth','للشبابيك','windows'),
    ('approved_plan','معتمد','certified company / soil report'), ('approved_plan','معتمدة','certified'), ('approved_plan','المعتمدة','certified'),
    ('for_families','عائلية','صالة عائلية = a room'), ('for_families','العائلي','a room'), ('for_families','عائلي','a room'),
    ('car_wash','مغسلة','a washbasin'), ('car_wash','ومغسلة','a washbasin'),
    ('restaurant_cafe','كافية','= enough'), ('food_allowed','كافية','= enough'),
    ('restaurant_cafe','مطاعم','nearby'), ('restaurant_cafe','المطاعم','nearby'), ('restaurant_cafe','والمطاعم','nearby'),
    ('food_allowed','مطاعم','nearby'), ('food_allowed','المطاعم','nearby'), ('food_allowed','والمطاعم','nearby'),
    ('floors_allowed','ارتداد','a setback'), ('floors_allowed','وارتداد','a setback'),
    ('glass_front','زجاج','window glass'), ('glass_front','زجاجية','glass balconies'),
    ('insulated_panel','عازل','waterproofing'), ('insulated_panel','معزول','a separated wing'),
    ('license','بلدي','the Balady portal'), ('palms','النخيل','a district / mall'), ('playstation','سوني','key / cinema brand'),
    ('heavy_power','محول','a transformer on the plot'), ('stars_mentioned','نجمة','a company'), ('stars_mentioned','نجوم','a project'),
    ('stars_mentioned','النجوم','تحت النجوم'), ('fruit_trees','تين','غرف تين = غرفتين'), ('fodder_crops','خضار','a vegetable shop'),
    ('animal_pens','شبك','a mesh fence'), ('big_gate','بوابة','any gate / بوابة الأعمال'), ('big_gate','بوابات','any gates'),
    ('earning_income','دخل','فرصة دخل'), ('earning_income','عائد','a sales line'),
    ('cold_storage','المبرد','a street'), ('cold_storage','تبريد','AC'), ('cold_storage','ثلاجات','fridges'),
    ('all_services','مخدومة','a room with a bathroom'), ('car_service','ورشة','any workshop'),
    ('in_mall','مول','a mall named nearby'), ('in_mall','سنتر','a name'), ('staff_housing_inside','سكن عزاب','a bachelors flat')
  ) v(fact, q, note)
on conflict (fact, phrase) do nothing;

-- TRUSTED: every other phrase serving >= 25 ads after the round-2 re-read (the audit read these).
insert into public.ops_af_evidence_phrase (fact, phrase, status, ads_at_review, note)
select a.fact, a.phrase, 'trusted', a.ads, '2026-11-03 audit round 2 (three reviewers, ~180 chips)'
  from (select k.fact, public.af_evidence_phrase_norm(f.facts -> k.fact ->> 'q') phrase, count(*) ads
          from public.listing_text_facts f
          join public.search_listings_ar s using (source_table, listing_id)
          cross join lateral jsonb_object_keys(f.facts) as k(fact)
         where f.stale_at is null and (f.facts -> k.fact ->> 'v') = 'true'
         group by 1, 2 having count(*) >= 25) a
 where a.phrase is not null
on conflict (fact, phrase) do nothing;

do $$
declare src text; out_def text;
begin
  src := pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure);
  if position('mon_detect_af_evidence_phrases' in src) > 0 then return; end if;
  out_def := replace(src,
    E'    ''mon_detect_suspicious_listing_facts'',',
    E'    ''mon_detect_suspicious_listing_facts'',\n    ''mon_detect_af_evidence_phrases'',');
  if out_def = src then raise exception 'roster anchor not found — refusing to guess where the entry belongs'; end if;
  execute out_def;
end $$;

-- PROOF at apply: on the clean data no rejected phrase serves an ad; a planted rejection of a live phrase is caught.
do $$
declare v_hit int; v_fact text; v_phrase text;
begin
  delete from public.ops_detector_last_full_run where detector = 'af_evidence_phrases';
  perform public.mon_detect_af_evidence_phrases();
  select count(*) into v_hit from public.alert_event where dedup_key = 'af_rejected_evidence_served' and resolved_at is null;
  if v_hit > 0 then raise exception 'PROOF: a rejected phrase still serves ads after the re-read — the reader fix is not live'; end if;
  begin
    select fact, phrase into v_fact, v_phrase from public.ops_af_evidence_phrase where status = 'trusted' order by ads_at_review desc limit 1;
    update public.ops_af_evidence_phrase set status = 'rejected' where fact = v_fact and phrase = v_phrase;
    delete from public.ops_detector_last_full_run where detector = 'af_evidence_phrases';
    perform public.mon_detect_af_evidence_phrases();
    select count(*) into v_hit from public.alert_event where dedup_key = 'af_rejected_evidence_served' and resolved_at is null;
    if v_hit = 0 then raise exception 'PROOF: a planted rejected phrase (%, %) was not caught', v_fact, v_phrase; end if;
    raise exception '__evidence_selftest_rollback__';
  exception when raise_exception then
    if sqlerrm <> '__evidence_selftest_rollback__' then raise; end if;
  end;
  if position('mon_detect_af_evidence_phrases' in pg_get_functiondef('public.mon_run_all_detectors()'::regprocedure)) = 0 then
    raise exception 'PROOF: the detector is not on the roster';
  end if;
end $$;