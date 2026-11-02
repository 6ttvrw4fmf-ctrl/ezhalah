-- 🔬 2026-11-02, alert 12326 not_installed_served_as_yes (backlog 1189). Two ads say the kitchen is NOT installed:
-- akariyoun 12049465 «المطبخ غير راكب (يُترك حسب ذوق المشتري)», therc 10283616 «مطبخ غير راكب». Both store kitchen = yes.
-- Today's shared reader (normalize.prose_amenities) returns kitchen = unknown on both phrases, so the yes is a value an
-- older read left behind, which the None-dropping upsert keeps. The ad states no installed kitchen: kitchen goes back to
-- NULL (unknown), never to a guessed value. Exactly two rows.
update public.akariyoun_residential_listings set kitchen = null where id = 12049465 and kitchen is true;
update public.therc_residential_listings set kitchen = null where id = 10283616 and kitchen is true;
