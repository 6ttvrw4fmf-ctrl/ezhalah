import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, cardShadow } from '@/theme/tokens';
import type { Listing } from '@/data/listings';

// Compact horizontal listing card. Tapping opens the source platform. (PRD §5.5)
export function ResultCard({ listing, onOpen }: { listing: Listing; onOpen: () => void }) {
  const [saved, setSaved] = useState(false);
  const specLine = [listing.deal, listing.type, `${listing.area} m²`, listing.beds > 0 ? `${listing.beds} bd` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable onPress={onOpen} style={s.card}>
      <View style={s.thumbWrap}>
        <Image source={{ uri: listing.photo }} style={s.thumb} contentFit="cover" transition={150} />
        <Pressable onPress={() => setSaved((v) => !v)} style={s.heart} hitSlop={8}>
          <Ionicons name={saved ? 'heart' : 'heart-outline'} size={14} color={saved ? colors.primary : '#fff'} />
        </Pressable>
      </View>
      <View style={s.body}>
        <Text style={s.title} numberOfLines={1}>{listing.city} · {listing.district}</Text>
        <Text style={s.spec} numberOfLines={1}>{specLine}</Text>
        <View style={s.priceRow}>
          <Text style={s.price}>{listing.price}</Text>
          <Text style={s.meta} numberOfLines={1}>{listing.listed} · {listing.source}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.card, borderWidth: 1, borderColor: colors.fieldLine, ...cardShadow },
  thumbWrap: { width: 116, height: 116, margin: 6, borderRadius: radius.card, overflow: 'hidden', backgroundColor: colors.tint },
  thumb: { width: '100%', height: '100%' },
  heart: { position: 'absolute', top: 7, right: 7, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.28)' },
  body: { flex: 1, paddingVertical: 12, paddingRight: 12, paddingLeft: 4, justifyContent: 'center' },
  title: { fontSize: 14, fontWeight: '600', color: colors.ink },
  spec: { fontSize: 11.5, color: colors.muted, marginTop: 4 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 8 },
  price: { fontSize: 14.5, fontWeight: '700', color: colors.primary },
  meta: { fontSize: 10, color: colors.muted, flexShrink: 1, textAlign: 'right' },
});
