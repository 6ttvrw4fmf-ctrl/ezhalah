import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, platformColor } from '@/theme/tokens';
import { ALL_LISTINGS } from '@/data/listings';
import { platform } from '@/data/platforms';

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Full-screen mock of the source platform's listing page. Every tap routes a qualified visitor
// out to the partner — Ezhalah never intermediates. (PRD §5.5, §1) Production: a real WebView to
// the partner URL; the native chrome (Done bar) stays.
export default function Browser() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const listing = ALL_LISTINGS.find((l) => l.id === Number(id));

  if (!listing) {
    return (
      <View style={[s.center, { paddingTop: insets.top }]}>
        <Text>Listing not found.</Text>
        <Pressable onPress={() => router.back()}><Text style={{ color: colors.primary, marginTop: 8 }}>Done</Text></Pressable>
      </View>
    );
  }

  const plat = platform(listing.source);
  const color = platformColor(listing.source);
  const ref = 800000 + (listing.id % 1000 + 1) * 1374 + listing.city.length * 13;
  const path = `/${slug(listing.type)}-for-${listing.deal.toLowerCase()}/${slug(listing.city)}-${slug(listing.district)}/${ref}`;
  const baths = Math.max(1, listing.beds - 1);

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      {/* Safari-style chrome */}
      <View style={[s.urlBar, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()}><Text style={s.done}>Done</Text></Pressable>
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
            <Text style={[s.dealText, { color }]}>For {listing.deal}</Text>
          </View>
          <View style={s.countBadge}><Text style={s.countText}>1 / 12</Text></View>
        </View>

        <View style={{ padding: 16, gap: 12 }}>
          <Text style={[s.price, { color }]}>{listing.price}</Text>
          <Text style={s.title}>{listing.type} for {listing.deal.toLowerCase()} in {listing.district}</Text>
          <Text style={s.loc}>{[listing.city, listing.district, listing.road].filter(Boolean).join(' · ')}</Text>

          <View style={s.specsGrid}>
            <Spec k="Area" v={`${listing.area} m²`} />
            {listing.beds > 0 && <Spec k="Beds" v={String(listing.beds)} />}
            {listing.beds > 0 && <Spec k="Baths" v={String(baths)} />}
            <Spec k="Type" v={listing.type} />
          </View>

          <Text style={s.sec}>Description</Text>
          <Text style={s.desc}>
            {listing.type} available for {listing.deal.toLowerCase()} in {listing.district}, {listing.city}. Spanning {listing.area} m²
            {listing.beds > 0 ? ` with ${listing.beds} bedrooms` : ''}, this property offers a prime location
            {listing.road ? ` on ${listing.road}` : ''} with easy access to schools, mosques and main roads. Listed directly on {listing.source}. Contact the advertiser for viewing and full details.
          </Text>

          <Text style={s.refLine}>Reference: EZ-{ref} · Listed {listing.listed} · via {listing.source}</Text>

          {/* Third-party + neutrality disclaimer — a compliance control. (PRD §10.1) */}
          <View style={s.disclaimer}>
            <Text style={s.disclaimerText}>
              Listing provided by {listing.source}. Ezhalah does not own or verify this listing — confirm all details directly with the source before any decision.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Contact actions — route to the partner, no intermediation */}
      <View style={[s.foot, { paddingBottom: insets.bottom + 8 }]}>
        <Pressable style={[s.action, { backgroundColor: color }]}>
          <Ionicons name="call" size={16} color="#fff" />
          <Text style={s.actionText}>Call</Text>
        </Pressable>
        <Pressable style={[s.action, { backgroundColor: colors.whatsApp }]}>
          <Ionicons name="logo-whatsapp" size={16} color="#fff" />
          <Text style={s.actionText}>WhatsApp</Text>
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
