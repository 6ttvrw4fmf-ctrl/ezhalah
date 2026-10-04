import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius } from '@/theme/tokens';
import { useI18n, LOCATION_UNRESOLVED_AR, TYPE_UNRESOLVED_AR, ATTRIBUTE_UNRESOLVED_AR } from '@/i18n';
import { listingPrice } from '@/lib/listingDisplay';
import { arabicOrPlaceholder, arabicOrPlaceholderForFreeText, hideArabicProseInEnglish, translateTrailingPeriodWord } from '@/lib/arabicText';
import { translitPlace } from '@/lib/translitPlace';
import { DIRECTION_LABEL } from '@/lib/afEvidence';
import type { Listing } from '@/data/listings';

// A site that refuses to be framed (Aqar sends X-Frame-Options: SAMEORIGIN) still opens in a tab of
// the same pane — showing Ezhalah's own copy of the ad, exactly as the site published it, plus one
// button to the real ad for calling / messaging. Nothing is computed: a field the source left silent
// is simply not shown (never «0», never «no»).
export default function ListingPreview({ listing: l, url }: { listing: Listing; url: string }) {
  const { t, locale, isRTL } = useI18n();
  const photos = (l.photos?.length ? l.photos : [l.photo]).filter(Boolean);
  const [main, setMain] = useState(0);
  const open = () => { if (Platform.OS === 'web' && url) window.open(url, '_blank', 'noopener,noreferrer'); };
  const facts: [string, string][] = [];
  if (l.area > 0) facts.push([t('Area'), `${l.area} ${t('m²')}`]);
  if (l.beds > 0) facts.push([t('Listing bedrooms'), String(l.beds)]);
  if ((l.bathrooms ?? 0) > 0) facts.push([t('Bathrooms'), String(l.bathrooms)]);
  const sourceText = (v: string) => arabicOrPlaceholderForFreeText(translateTrailingPeriodWord(t(v), locale), locale, ATTRIBUTE_UNRESOLVED_AR);
  // Raw platform fields can be numbers despite the Listing string type (like ResultCard's attributes).
  const age = String(l.property_age ?? '').trim();
  if (age) facts.push([t('Age'), age === '0' ? t('New construction') : sourceText(age)]);
  const facing = String(l.direction ?? '').trim();
  if (facing) facts.push([t('Facing'), sourceText(DIRECTION_LABEL[facing] ?? facing)]);
  const period = String(l.rentPeriod ?? '').trim();
  if (period) facts.push([t('Rent period'), sourceText(({ annual: 'Yearly', monthly: 'Monthly' } as Record<string, string>)[period] ?? period)]);
  const place = (raw: string) => locale === 'en' && raw ? translitPlace(raw) : raw;
  const city = place(arabicOrPlaceholder(t(l.city), locale, LOCATION_UNRESOLVED_AR));
  const location = (place(arabicOrPlaceholder(t(l.district), locale, LOCATION_UNRESOLVED_AR)) || city || LOCATION_UNRESOLVED_AR)
    + (l.district ? `, ${city || LOCATION_UNRESOLVED_AR}` : '');
  const typeLabel = arabicOrPlaceholder(/[ء-ي]/.test(l.type || '') ? l.type : t(l.cleanType ?? l.type), locale, TYPE_UNRESOLVED_AR);
  const title = hideArabicProseInEnglish((() => { const v = (l.title ?? '').trim(); return v && /[ء-ي]/.test(v) ? '\u200f' + v : null; })(), locale) || typeLabel;
  const desc = hideArabicProseInEnglish((() => { const d = (l.description ?? '').trim(); return d && /[ء-ي]/.test(d) ? '\u200f' + d : null; })(), locale);
  // The app's own type, same as the chat around it (the Tajawal face was retired 2026-10-04 — owner:
  // «the text format is weird, not like how it was»).
  const face = {};
  const tx = { ...face, textAlign: (isRTL ? 'right' : 'left') as 'right' | 'left', writingDirection: (isRTL ? 'rtl' : 'ltr') as 'rtl' | 'ltr' };

  return (
    <ScrollView testID="listing-preview" style={s.root} contentContainerStyle={s.content}>
      <View style={s.photoMain}>
        {photos[main] ? <Image source={{ uri: photos[main] }} style={s.fill} contentFit="cover" priority="high" loading="eager" accessibilityLabel={t('Photo {n} of {total}', { n: main + 1, total: photos.length })} /> : (
          <View style={[s.fill, s.noPhoto]}><Ionicons name="image-outline" size={36} color={colors.muted} /></View>
        )}
        {photos.length > 1 && (
          <View style={s.counter}><Text style={[s.counterTx, face]}>{main + 1} / {photos.length}</Text></View>
        )}
      </View>
      {photos.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.thumbs}>
          {photos.map((p, i) => (
            <Pressable key={p + i} testID="listing-preview-thumb" accessibilityRole="button" accessibilityLabel={t('Photo {n} of {total}', { n: i + 1, total: photos.length })} accessibilityState={{ selected: i === main }} onPress={() => setMain(i)} style={[s.thumb, i === main && s.thumbOn]}>
              <Image source={{ uri: p }} style={s.fill} contentFit="cover" priority="low" loading="lazy" />
            </Pressable>
          ))}
        </ScrollView>
      )}

      <Text style={[s.price, tx]}>{listingPrice(l, locale)}</Text>
      <Text style={[s.title, tx]}>{title}</Text>
      <Text style={[s.loc, tx]}>
        <Ionicons name="location-outline" size={14} color={colors.muted} /> {location}
      </Text>

      {facts.length > 0 && (
        <View style={s.facts}>
          {facts.map(([k, v]) => (
            <View key={k} style={s.fact}>
              <Text style={[s.factK, face]}>{k}</Text>
              <Text style={[s.factV, face]}>{v}</Text>
            </View>
          ))}
        </View>
      )}

      <Pressable testID="listing-preview-contact" onPress={open} accessibilityRole="link" style={({ hovered }: any) => [s.cta, hovered && s.ctaHover]}>
        <Ionicons name="open-outline" size={18} color={colors.onFill} />
        <Text style={[s.ctaTx, face]}>{t('Open the ad on Aqar to contact')}</Text>
      </Pressable>

      {desc ? (
        <View style={s.section}>
          <Text style={[s.h, tx]}>{t('Description')}</Text>
          <Text style={[s.desc, tx]}>{desc}</Text>
        </View>
      ) : null}

      <Text style={[s.note, tx]}>{t('Details as published on Aqar.')}</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.paper },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  fill: { width: '100%', height: '100%' },
  photoMain: { width: '100%', aspectRatio: 16 / 10, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.chipFill },
  noPhoto: { alignItems: 'center', justifyContent: 'center' },
  counter: { position: 'absolute', bottom: 10, left: 10, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  counterTx: { color: '#fff', fontSize: 13 },
  thumbs: { gap: 8 },
  thumb: { width: 72, height: 52, borderRadius: 10, overflow: 'hidden', borderWidth: 2, borderColor: 'transparent' },
  thumbOn: { borderColor: colors.primary },
  price: { fontSize: 22, fontWeight: '700', color: colors.primary, marginTop: 4 },
  title: { fontSize: 17, fontWeight: '600', color: colors.ink },
  loc: { fontSize: 14, color: colors.muted },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  fact: { backgroundColor: colors.chipFill, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, minWidth: 92, alignItems: 'center' },
  factK: { fontSize: 12, color: colors.muted },
  factV: { fontSize: 15, fontWeight: '600', color: colors.ink, marginTop: 2 },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.primary, borderRadius: radius.pill, paddingVertical: 13, marginTop: 6 },
  ctaHover: { backgroundColor: colors.dark },
  ctaTx: { color: colors.onFill, fontSize: 16, fontWeight: '600' },
  section: { marginTop: 8, gap: 6 },
  h: { fontSize: 16, fontWeight: '600', color: colors.ink },
  desc: { fontSize: 15, lineHeight: 24, color: colors.body },
  note: { fontSize: 12, color: colors.muted, marginTop: 10 },
});