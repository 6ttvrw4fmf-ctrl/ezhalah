ALTER TABLE public.amlakalahsa_residential_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.amlakalahsa_commercial_listings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read" ON public.amlakalahsa_residential_listings;
DROP POLICY IF EXISTS "public read" ON public.amlakalahsa_commercial_listings;
CREATE POLICY "public read" ON public.amlakalahsa_residential_listings FOR SELECT USING (true);
CREATE POLICY "public read" ON public.amlakalahsa_commercial_listings FOR SELECT USING (true);