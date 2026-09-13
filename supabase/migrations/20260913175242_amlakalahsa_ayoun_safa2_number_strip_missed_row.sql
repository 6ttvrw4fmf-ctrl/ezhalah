-- Missed by the previous migration's WHERE city_ar is null clause: this "الصفا 2" row already had
-- city_ar='العيون' set (from an earlier, separate fix), so it fell through both of that migration's
-- "الصفا 2" branches (the city_ar-is-null one, and the already-has-city bare-"الصفا" one). Same
-- owner rule applies regardless of when the city was set: numbered variant matches its bare name in
-- district_ar (match-truth); neighborhood (card text) stays untouched.
update public.amlakalahsa_residential_listings
set district_ar = 'الصفا'
where city_ar = 'العيون' and district_ar = 'الصفا 2';
