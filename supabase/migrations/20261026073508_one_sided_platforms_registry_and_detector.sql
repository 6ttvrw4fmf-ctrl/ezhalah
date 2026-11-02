-- 🆕 New Listings 2026-10-26 — backlog #865 PART 2 (owner 2026-10-25: «it must be everything, must match, we
-- need to check»). Sakani sat rent-only for a month although its source sells >2,000 units, and nothing noticed:
-- no check compared a site's deal sides with anything. This makes a one-sided site loud unless someone has
-- PROVEN the source itself has no other side.
--   1. ops_platform_one_sided: the sites that are one-sided ON PURPOSE, each with the proof URL.
--   2. ops_platform_side_daily: one row per site per day (served sale / rent counts), so a halving is visible.
--   3. mon_one_sided_platforms() decides (executable without raising); mon_detect_one_sided_platforms() raises
--      P2 «one_sided_platform» per unlisted one-sided site and P2 «platform_side_halved» when a site's sale or
--      rent count falls by more than half in a day. Daily cron at 04:47 UTC (after the 04:41 district alarm).

create table if not exists public.ops_platform_one_sided (
  platform   text primary key,
  side       text not null check (side in ('sale_only', 'rent_only')),
  proof_url  text not null check (proof_url ~ '^https?://'),
  why        text not null check (length(btrim(why)) >= 10),
  decided_at timestamptz not null default now()
);
comment on table public.ops_platform_one_sided is
  'Sites that are one-sided ON PURPOSE (the source itself lists only sale or only rent), each with a proof URL. Any other one-sided site raises P2 one_sided_platform daily (backlog #865, 2026-10-26).';

create table if not exists public.ops_platform_side_daily (
  day      date not null,
  platform text not null,
  sale     integer not null,
  rent     integer not null,
  primary key (day, platform)
);

alter table public.ops_platform_one_sided enable row level security;
alter table public.ops_platform_side_daily enable row level security;
revoke all on public.ops_platform_one_sided, public.ops_platform_side_daily from anon, authenticated;

create or replace function public.mon_one_sided_platforms()
returns table(platform text, side text, sale bigint, rent bigint)
language sql stable security definer set search_path to 'public'
as $function$
  with c as (
    select s.platform,
           count(*) filter (where s.deal_ar = 'بيع')   as sale,
           count(*) filter (where s.deal_ar = 'إيجار') as rent
      from public.search_listings_ar s
     where s.production_ready
     group by 1)
  select c.platform, case when c.sale = 0 then 'rent_only' else 'sale_only' end, c.sale, c.rent
    from c
   where (c.sale = 0) <> (c.rent = 0)
     and not exists (select 1 from public.ops_platform_one_sided o
                      where o.platform = c.platform
                        and o.side = case when c.sale = 0 then 'rent_only' else 'sale_only' end)
$function$;

create or replace function public.mon_detect_one_sided_platforms()
returns integer
language plpgsql security definer set search_path to 'public'
as $function$
declare r int := 0; x record; y record;
begin
  insert into public.ops_platform_side_daily (day, platform, sale, rent)
  select current_date, s.platform,
         count(*) filter (where s.deal_ar = 'بيع'), count(*) filter (where s.deal_ar = 'إيجار')
    from public.search_listings_ar s where s.production_ready group by 2
  on conflict (day, platform) do update set sale = excluded.sale, rent = excluded.rent;

  -- (a) one-sided and not proven on purpose
  for x in select * from public.mon_one_sided_platforms() loop
    r := r + public.mon_raise('P2', 'one_sided_platform', x.platform, 'one_sided_platform:' || x.platform,
      jsonb_build_object('side', x.side, 'sale', x.sale, 'rent', x.rent,
        'why', 'This site serves only one deal side. Open the source like a visitor: if it also lists the other side, the scraper is missing it (Sakani was rent-only for a month while it sold >2,000 units). If the source truly has one side, record it in ops_platform_one_sided with the proof URL.'));
  end loop;
  update public.alert_event a set resolved_at = now()
   where a.kind = 'one_sided_platform' and a.resolved_at is null
     and not exists (select 1 from public.mon_one_sided_platforms() m where m.platform = a.platform);

  -- (b) a side halved since the previous snapshot (only sides that had at least 20 listings)
  for y in
    select t.platform, p.sale p_sale, t.sale t_sale, p.rent p_rent, t.rent t_rent
      from public.ops_platform_side_daily t
      join lateral (select * from public.ops_platform_side_daily q
                     where q.platform = t.platform and q.day < t.day order by q.day desc limit 1) p on true
     where t.day = current_date
       and ((p.sale >= 20 and t.sale * 2 < p.sale) or (p.rent >= 20 and t.rent * 2 < p.rent))
  loop
    r := r + public.mon_raise('P2', 'platform_side_halved', y.platform, 'platform_side_halved:' || y.platform,
      jsonb_build_object('sale_before', y.p_sale, 'sale_now', y.t_sale, 'rent_before', y.p_rent, 'rent_now', y.t_rent,
        'why', 'A deal side of this site lost more than half its served listings in a day: a crawl or a deal mapping broke, or the side is being dropped.'));
  end loop;
  update public.alert_event a set resolved_at = now()
   where a.kind = 'platform_side_halved' and a.resolved_at is null
     and a.created_at < now() - interval '20 hours'
     and not exists (
       select 1 from public.ops_platform_side_daily t
         join lateral (select * from public.ops_platform_side_daily q
                        where q.platform = t.platform and q.day < t.day order by q.day desc limit 1) p on true
        where t.day = current_date and t.platform = a.platform
          and ((p.sale >= 20 and t.sale * 2 < p.sale) or (p.rent >= 20 and t.rent * 2 < p.rent)));
  return r;
end $function$;

revoke all on function public.mon_one_sided_platforms(), public.mon_detect_one_sided_platforms() from public, anon, authenticated;

-- SEEDS
-- Seeded from the 2026-10-26 audit: (a) a hard-coded side the scraper's own docstring proves from the source, or
-- an owner-named expected site; (b) a scraper that reads BOTH sides from each ad. NOT seeded, so they alarm
-- until checked at the source (one backlog item each): sakani, hasaad, suwar, superoffice, mobasher, albukaeri,
-- muajarh, rawasidark, wajaf, wadod.
insert into public.ops_platform_one_sided (platform, side, proof_url, why) values
  ('gathern','rent_only','https://gathern.co','short-stay booking platform (nightly/monthly stays); no sales exist — owner 2026-10-25 #865 expected-legit; scrapers/gathern/run.py:1130'),
  ('aqarmonthly','rent_only','https://sa.aqar.fm','Aqar monthly-rent channel only (sales are the separate aqar platform) — owner #865 expected-legit; scrapers/aqarmonthly/run.py:745'),
  ('rightcompound','rent_only','https://rightcompound.com','compound rental listings — owner #865 expected-legit; scrapers/rightcompound/run.py:491'),
  ('compoundin','rent_only','https://compoundin.com','compound rental listings — owner #865 expected-legit; scrapers/compoundin/run.py:320'),
  ('livingcompound','rent_only','https://livingcompound.com','compound rentals; scraper reads Rent/Buy per unit (scrapers/livingcompound/run.py:165-167) and the source shows rent only — owner #865 expected-legit'),
  ('expattrusted','rent_only','https://expattrusted.com','expat compound rentals — owner #865 expected-legit; scrapers/expattrusted/run.py:253'),
  ('rakez','sale_only','https://rakez.sa','developer selling freehold, «there is no rent anywhere» (scrapers/rakez/run.py:36-37); off-plan excluded by rule'),
  ('sokok','sale_only','https://sokok.sa','land-plot sale platform, «No rents anywhere on the platform» (scrapers/sokok/run.py:4,158-160)'),
  ('sukna','sale_only','https://suknamdn.sa','developer units, purpose «sale» on every unit in the API, no rent field (scrapers/sukna/run.py:70,182)'),
  ('razre','sale_only','https://razre.sa','developer projects, «NO RENT ON THIS SITE» (scrapers/razre/run.py:44)'),
  ('holoul','sale_only','https://app.holoul.io','developer units for sale (scrapers/holoul/run.py:1,121)'),
  ('daraa','sale_only','https://daraa.sa','«the site sells; never rents» (scrapers/daraa/run.py:24)'),
  ('fkralemar','sale_only','https://fkralemar.com','sale-only developer (scrapers/fkralemar/run.py:1)'),
  ('azure','rent_only','https://azure.sa','long-term compound rent only (scrapers/azure/run.py:2)'),
  ('flow','rent_only','https://flow.life','«RENT only» residences (scrapers/flow/run.py:1)'),
  ('wahadat','sale_only','https://wahadat.sa','the scraper reads BOTH sides from each ad (scrapers/wahadat/run.py:289-290 deal from advertisement_purpose), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('amlakalahsa','sale_only','https://amlakalahsa.com','the scraper reads BOTH sides from each ad (scrapers/amlakalahsa/run.py:137 للبيع/للإيجار map; 0 rent in 260+ rows), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('jazwtn','sale_only','https://jazwtn.sa','the scraper reads BOTH sides from each ad (scrapers/jazwtn/run.py:548-549 rent from the title words), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('shatri','sale_only','https://shatrirealestate.com','the scraper reads BOTH sides from each ad (scrapers/shatri/run.py:250 RENT_RE on the title; «No rent status exists» :12), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('m3tmd','sale_only','https://m3tmd.com','the scraper reads BOTH sides from each ad (scrapers/m3tmd/run.py:64 purpose rent/sell; all measured purpose=sell), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('almotmkenah','sale_only','https://almotmkenah.com','the scraper reads BOTH sides from each ad (scrapers/almotmkenah/run.py:262,277 deal from the offer form), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('arsh','sale_only','https://arshglobal.com.sa','the scraper reads BOTH sides from each ad (scrapers/arsh/run.py:121 sale/rent words, owner default Buy when unstated), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('nowaisiry','sale_only','https://alnowaisiry.com','the scraper reads BOTH sides from each ad (scrapers/nowaisiry/run.py:367-368 rent on an explicit word; office is sale-only :21), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('rawaf','sale_only','https://rawaf.ai','the scraper reads BOTH sides from each ad (scrapers/rawaf/run.py:230 contractType RENT/else), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('alrifai','sale_only','https://alrifai.com.sa','the scraper reads BOTH sides from each ad (scrapers/alrifai/run.py:71-72 rent/sale regexes; zero rent words :18), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('aqaralsaudia','sale_only','https://aqaralsaudia.com','the scraper reads BOTH sides from each ad (scrapers/aqaralsaudia/run.py:92,258 deal map from the page), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('jurash','sale_only','https://jurash.sa','the scraper reads BOTH sides from each ad (scrapers/jurash/run.py:308 status إيجار/بيع), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('nawafeth','sale_only','https://nawafethalwatan.com','the scraper reads BOTH sides from each ad (scrapers/nawafeth/run.py:104 one deal word in the title), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('sodasyat','sale_only','https://sodasyat.sa','the scraper reads BOTH sides from each ad (scrapers/sodasyat/run.py:79 «تصنيف الاعلان»; بيع 11/11), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('almuteb','sale_only','https://almuteb.sa','the scraper reads BOTH sides from each ad (scrapers/almuteb/run.py:89 property_status; للإيجار (0)), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('marksa','sale_only','https://mar-ksa.com','the scraper reads BOTH sides from each ad (scrapers/marksa/run.py:241-244 للبيع/للإيجار), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('remaxsa','sale_only','https://remax.sa','the scraper reads BOTH sides from each ad (scrapers/remaxsa/run.py Rent/Buy from the API; 0 Saudi rent listings active :138), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('alta','sale_only','https://alta.com.sa','the scraper reads BOTH sides from each ad (scrapers/alta/run.py:249-250 action taxonomy), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('shmoualshmal','sale_only','https://shmoua-alshmal.com','the scraper reads BOTH sides from each ad (scrapers/shmoualshmal/run.py:392-393 property_status; للإيجار x0), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('fahadalshahri','sale_only','https://fahadalshahri.com','the scraper reads BOTH sides from each ad (scrapers/fahadalshahri/run.py:141-143 store has no rental flow), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('qmra','sale_only','https://qmra.sa','the scraper reads BOTH sides from each ad (scrapers/qmra/run.py:190 «متاح للتأجير» → Rent; 0 today), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('eydah','sale_only','https://eydah.com','the scraper reads BOTH sides from each ad (scrapers/eydah/run.py:128-131 «الغرض» بيع/إيجار), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('thousand','rent_only','https://1000.com.sa','the scraper reads BOTH sides from each ad (scrapers/thousand/run.py:353-356 badges للإيجار/للبيع; all 105 للإيجار), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('satel','rent_only','https://satel.sa','the scraper reads BOTH sides from each ad (scrapers/satel/run.py:330 API type Rent|Buy), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('maktab','rent_only','https://maktab.sa','the scraper reads BOTH sides from each ad (scrapers/maktab/run.py:53 إيجار/بيع map; office-rental marketplace), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('aqaralriyadh','rent_only','https://aqaralriyadh.com','the scraper reads BOTH sides from each ad (scrapers/aqaralriyadh/run.py:77,212 category للإيجار/للبيع), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('october','rent_only','https://october.sa','the scraper reads BOTH sides from each ad (scrapers/october/run.py:79 purpose rent/else (Nuzul API)), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('eightfloor','rent_only','https://8floor.sa','the scraper reads BOTH sides from each ad (scrapers/eightfloor/run.py:87 rent/sell map), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('masar','rent_only','https://masaraqarat.com','the scraper reads BOTH sides from each ad (scrapers/masar/run.py:274 for-sale/for-rent paths), so a listing of the other side would be stored as such; one-sided = the source inventory today'),
  ('manzo','rent_only','https://manzo.com.sa','the scraper reads BOTH sides from each ad (scrapers/manzo/run.py:45 long_term_rent/sale map), so a listing of the other side would be stored as such; one-sided = the source inventory today')
on conflict (platform) do nothing;

select cron.schedule('mon-one-sided-platforms', '47 4 * * *',
  $c$set statement_timeout to '120s'; select public.mon_detect_one_sided_platforms();$c$);

-- Check block: EXECUTE the predicate both ways. sakani (rent-only while its source sells, ⚡ backlog 864) must be
-- flagged; a seeded on-purpose site must not be.
do $$ begin
  if not exists (select 1 from public.mon_one_sided_platforms() where platform = 'sakani') then
    raise exception 'predicate blind: sakani is rent-only and not proven on purpose, but was not flagged';
  end if;
  if exists (select 1 from public.mon_one_sided_platforms() m join public.ops_platform_one_sided o using (platform)) then
    raise exception 'predicate leaks: a site recorded as one-sided on purpose was flagged';
  end if;
end $$;
