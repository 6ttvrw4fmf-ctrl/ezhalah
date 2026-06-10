import { useEffect } from 'react';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, platformColor } from '@/theme/tokens';
import { ALL_LISTINGS } from '@/data/listings';
import { platform } from '@/data/platforms';
import { useApp } from '@/store';
import { useI18n, tPrice } from '@/i18n';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Full-screen mock of the source platform's listing page. Every tap routes a qualified visitor
// out to the partner — Ezhalah never intermediates. (PRD §5.5, §1) Production: a real WebView to
// the partner URL; the native chrome (Done bar) stays.
export default function Browser() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t, locale } = useI18n();
  const { trackOpen, findListing } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  // Prefer the live (Supabase-hydrated) catalog; fall back to the bundled seed.
  const listing = findListing(Number(id)) ?? ALL_LISTINGS.find((l) => l.id === Number(id));

  // Log the CPC click-through once per open. (PRD §13)
  useEffect(() => {
    if (listing) trackOpen(listing);
  }, [listing?.id]);

  if (!listing) {
    return (
      <View style={[s.center, { paddingTop: insets.top }]}>
        <Text>{t('Listing not found.')}</Text>
        <Pressable onPress={() => router.back()}><Text style={{ color: colors.primary, marginTop: 8 }}>{t('Done')}</Text></Pressable>
      </View>
    );
  }

  const plat = platform(listing.source);
  const color = platformColor(listing.source);
  const ref = 800000 + (listing.id % 1000 + 1) * 1374 + listing.city.length * 13;
  const path = `/${slug(listing.type)}-for-${listing.deal.toLowerCase()}/${slug(listing.city)}-${slug(listing.district)}/${ref}`;
  const baths = Math.max(1, listing.beds - 1);
  // Verb phrasing differs by language: English keeps the source's "for rent" form; Arabic uses the
  // localized verb that already carries its preposition.
  const verb = locale === 'ar' ? t(listing.deal === 'Rent' ? 'to rent' : 'to buy') : listing.deal.toLowerCase();
  const bedsStr = listing.beds > 0 ? t(' with {n} bedrooms', { n: listing.beds }) : '';
  const roadStr = listing.road ? t(' on {road}', { road: t(listing.road) }) : '';

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      {/* Safari-style chrome */}
      <View style={[s.urlBar, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()}><Text style={s.done}>{t('Done')}</Text></Pressable>
        <View style={s.urlPill}>
          <Ionicons name="lock-closed" size={10} color={colors.body} />
          <Text style={s.domain} numberOfLines={1}>{plat.domain}</Text>
        </View>
        <Ionicons name="reload" size={16} color={colors.muted} />
      </View>
      <Text style={s.path} numberOfLines={1}>{path}</Text>

      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        {/* Partner header */}
        <View style={[s.phead, { backgroundColor: color }]}>
          <Text style={s.brand}>{plat.brand}</Text>
          <View style={{ gap: 3 }}>
            {[0, 1, 2].map((i) => <View key={i} style={s.burger} />)}
          </View>
        </View>

        {/* Hero */}
        <View style={s.heroWrap}>
          <Image source={{ uri: listing.photo }} style={s.hero} contentFit="cover" transition={150} />
          <View style={[s.dealBadge]}>
            <Text style={[s.dealText, { color }]}>{t('For ' + listing.deal)}</Text>
          </View>
          <View style={s.countBadge}><Text style={s.countText}>1 / 12</Text></View>
        </View>

        <View style={{ padding: 16, gap: 12 }}>
          <Text style={[s.price, { color }]}>{tPrice(listing.price)}</Text>
          <Text style={s.title}>{t('{type} for {verb} in {district}', { type: t(listing.type), verb, district: t(listing.district) })}</Text>
          <Text style={s.loc}>{[t(listing.city), t(listing.district), listing.road].filter(Boolean).join(' · ')}</Text>

          <View style={s.specsGrid}>
            <Spec k={t('Area')} v={`${listing.area} ${t('m²')}`} />
            {listing.beds > 0 && <Spec k={t('Beds')} v={String(listing.beds)} />}
            {listing.beds > 0 && <Spec k={t('Baths')} v={String(baths)} />}
            <Spec k={t('Type')} v={t(listing.type)} />
          </View>

          <Text style={s.sec}>{t('Description')}</Text>
          <Text style={s.desc}>
            {t(
              '{type} available for {verb} in {district}, {city}. Spanning {area} m²{beds}, this property offers a prime location{road} with easy access to schools, mosques and main roads. Listed directly on {source}. Contact the advertiser for viewing and full details.',
              { type: t(listing.type), verb, district: t(listing.district), city: t(listing.city), area: listing.area, beds: bedsStr, road: roadStr, source: listing.source },
            )}
          </Text>

          <Text style={s.refLine}>{t('Reference: EZ-{ref} · Listed {listed} · via {source}', { ref, listed: t(listing.listed), source: listing.source })}</Text>

          {/* Third-party + neutrality disclaimer — a compliance control. (PRD §10.1) */}
          <View style={s.disclaimer}>
            <Text style={s.disclaimerText}>
              {t('Listing provided by {source}. Ezhalah does not own or verify this listing — confirm all details directly with the source before any decision.', { source: listing.source })}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Contact actions — route to the partner, no intermediation */}
      <View style={[s.foot, { paddingBottom: insets.bottom + 8 }]}>
        <Pressable style={[s.action, { backgroundColor: color }]}>
          <Ionicons name="call" size={16} color="#fff" />
          <Text style={s.actionText}>{t('Call')}</Text>
        </Pressable>
        <Pressable style={[s.action, { backgroundColor: colors.whatsApp }]}>
          <Ionicons name="logo-whatsapp" size={16} color="#fff" />
          <Text style={s.actionText}>{t('WhatsApp')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Spec({ k, v }: { k: string; v: string }) {
  return (
    <View style={s.spec}>
      <Text style={s.specK}>{k}</Text>
      <Text style={s.specV}>{v}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  urlBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 8 },
  done: { fontSize: 15, fontWeight: '600', color: colors.primary },
  urlPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.segTrack, borderRadius: radius.pill, paddingVertical: 7, paddingHorizontal: 14 },
  domain: { fontSize: 12.5, fontWeight: '500', color: colors.body, flexShrink: 1 },
  path: { fontSize: 10.5, color: colors.muted, paddingHorizontal: 16, paddingBottom: 8 },
  phead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  brand: { fontSize: 16, fontWeight: '700', color: '#fff' },
  burger: { width: 18, height: 2, borderRadius: 1, backgroundColor: '#fff' },
  heroWrap: { height: 220, backgroundColor: colors.tint },
  hero: { width: '100%', height: '100%' },
  dealBadge: { position: 'absolute', left: 12, bottom: 12, backgroundColor: '#fff', borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: 10 },
  dealText: { fontSize: 11, fontWeight: '600' },
  countBadge: { position: 'absolute', right: 12, bottom: 12, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: radius.pill, paddingVertical: 5, paddingHorizontal: 10 },
  countText: { fontSize: 10, fontWeight: '600', color: '#fff' },
  price: { fontSize: 22, fontWeight: '700' },
  title: { fontSize: 16, fontWeight: '600', color: colors.ink },
  loc: { fontSize: 12.5, color: colors.muted },
  specsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  spec: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.tint, borderRadius: 10, padding: 12 },
  specK: { fontSize: 10.5, color: colors.muted },
  specV: { fontSize: 14, fontWeight: '600', color: colors.ink, marginTop: 2 },
  sec: { fontSize: 13, fontWeight: '600', color: colors.ink, marginTop: 4 },
  desc: { fontSize: 13, color: colors.body, lineHeight: 19 },
  refLine: { fontSize: 10.5, color: colors.muted, marginTop: 4 },
  disclaimer: { backgroundColor: colors.amberBg, borderRadius: 10, padding: 10 },
  disclaimerText: { fontSize: 10.5, color: colors.amberInk },
  foot: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line },
  action: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: radius.field, paddingVertical: 14 },
  actionText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
