import { useEffect } from 'react';
import { Linking, Platform, StyleSheet, Text, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius } from '@/theme/tokens';
import { ALL_LISTINGS } from '@/data/listings';
import { platform } from '@/data/platforms';
import { useApp } from '@/store';
import { useI18n } from '@/i18n';

// Full-screen mock of the source platform's listing page. Every tap routes a qualified visitor
// out to the partner — Ezhalah never intermediates. (PRD §5.5, §1) Production: a real WebView to
// the partner URL; the native chrome (Done bar) stays.
export default function Browser() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { t } = useI18n();
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
  const sourceUrl = listing.source_url;
  // For real listings we render an in-app iframe of the partner page so the user never
  // leaves Ezhalah. Native (iOS/Android) doesn't have an HTML iframe — we hand off to the
  // system browser there via Linking. (user request: open inside our app, not Safari.)
  const inAppIframe = !!sourceUrl && Platform.OS === 'web';

  // Pretty URL pill (kept for native fallback only — the web iframe view drops the URL bar
  // entirely so the user sees a clean modal of the partner page).
  const displayUrl = sourceUrl ? sourceUrl.replace(/^https?:\/\//, '').slice(0, 80) : plat.domain;

  // WEB: the listing opens as a CARD floating over the app — dim backdrop, rounded modal,
  // small floating close button at top-right. The app's UI stays visible behind it. The
  // modal itself is wide enough that Aqar serves its desktop layout (no phone zoom). (user
  // request: keep the app background visible; no URL bar; not zoomed-in.)
  if (inAppIframe) {
    return (
      <>
        {/* Dimmed backdrop over the app — tapping it closes the modal. */}
        {(() => {
          const D: any = 'div';
          return (
            <D
              onClick={() => router.back()}
              style={{ position: 'fixed', inset: 0, background: 'rgba(8,18,12,0.55)', zIndex: 9998 }}
            />
          );
        })()}
        {/* Centered modal card */}
        {(() => {
          const Card: any = 'div';
          const Frame: any = 'iframe';
          return (
            <Card
              style={{
                position: 'fixed',
                top: '4%', left: '4%', right: '4%', bottom: '4%',
                background: '#fff', borderRadius: 18, overflow: 'hidden',
                boxShadow: '0 18px 50px rgba(8,18,12,0.35)',
                zIndex: 9999, display: 'flex', flexDirection: 'column',
              }}
            >
              {/* Floating close button — sits OVER the iframe content in the corner. */}
              <Pressable
                onPress={() => router.back()}
                style={({ hovered }: any) => ({
                  position: 'absolute' as any, top: 12, right: 12, zIndex: 10,
                  width: 32, height: 32, borderRadius: 16,
                  alignItems: 'center', justifyContent: 'center',
                  backgroundColor: hovered ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.92)',
                  borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
                })}
              >
                <Ionicons name="close" size={18} color={colors.ink} />
              </Pressable>
              <Frame
                src={sourceUrl}
                style={{ flex: 1, width: '100%', height: '100%', border: 0, background: '#fff' }}
              />
            </Card>
          );
        })()}
      </>
    );
  }

  // Native fallback (iOS/Android, no HTML iframe): tap-to-open hand-off card.
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <View style={[s.urlBar, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => router.back()}><Text style={s.done}>{t('Done')}</Text></Pressable>
        <View style={s.urlPill}>
          <Ionicons name="lock-closed" size={10} color={colors.body} />
          <Text style={s.domain} numberOfLines={1}>{displayUrl}</Text>
        </View>
        {sourceUrl ? (
          <Pressable onPress={() => Linking.openURL(sourceUrl)} hitSlop={8}>
            <Ionicons name="open-outline" size={18} color={colors.muted} />
          </Pressable>
        ) : (
          <Ionicons name="reload" size={16} color={colors.muted} />
        )}
      </View>
      {sourceUrl ? (
        <View style={[s.center, { paddingHorizontal: 24 }]}>
          <Ionicons name="open-outline" size={36} color={colors.primary} style={{ marginBottom: 10 }} />
          <Text style={s.title}>{t('Open this listing')}</Text>
          <Text style={[s.desc, { textAlign: 'center', marginTop: 6 }]} numberOfLines={3}>{displayUrl}</Text>
          <Pressable onPress={() => Linking.openURL(sourceUrl)} style={[s.action, { backgroundColor: colors.primary, marginTop: 16 }]}>
            <Ionicons name="arrow-forward" size={16} color="#fff" />
            <Text style={s.actionText}>{t('Open listing')}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={[s.center, { paddingHorizontal: 24 }]}>
          <Text>{t('Listing not found.')}</Text>
        </View>
      )}
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
