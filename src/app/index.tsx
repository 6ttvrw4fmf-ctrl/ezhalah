import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, radius, space, cardShadow } from '@/theme/tokens';
import { Segmented, OptionBox, PrimaryButton, FieldLabel } from '@/components/ui';
import { CATEGORIES, CATEGORY_TYPES, DEALS, detailFor, type Category } from '@/data/taxonomy';
import { matchLocations, placeField, type Place } from '@/data/locations';
import { grouped, interpretPrice } from '@/data/search';
import { useApp } from '@/store';

const MAX_W = 560; // desktop-web: keep the mobile-first column centered

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { query, setQuery, search } = useApp();
  const [suggestions, setSuggestions] = useState<Place[]>([]);

  const onSearch = () => {
    search();
    router.push('/results');
  };

  const detail = query.type ? detailFor(query.type) : null;
  const sizeForPrice = query.detail ? parseInt((query.detail.match(/\d/g) ?? []).join(''), 10) || undefined : undefined;
  const priceP = interpretPrice(query.priceInput, query.deal, sizeForPrice);
  const priceEcho = priceP && priceP.kind !== 'unrealistic' ? priceP.echo : null;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.paper }}
      contentContainerStyle={[s.scroll, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 28 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={s.col}>
        {/* Header */}
        <View style={s.header}>
          <Pressable style={s.iconBtn} hitSlop={8}>
            <Ionicons name="menu" size={22} color={colors.ink} />
          </Pressable>
          <Text style={s.word}>EZHALAH</Text>
          <View style={{ flex: 1 }} />
          <Pressable style={s.agentMini}>
            <Ionicons name="sparkles" size={16} color={colors.primary} />
            <View>
              <Text style={s.agentMiniT}>Ezhalah AI Agent</Text>
              <Text style={s.agentMiniS}>Ask in your words</Text>
            </View>
          </Pressable>
          <Pressable style={s.iconBtn} hitSlop={8}>
            <Ionicons name="share-outline" size={20} color={colors.dark} />
          </Pressable>
        </View>

        {/* Hero */}
        <View style={s.hero}>
          <Text style={s.heroTitle}>Find your place</Text>
          <Text style={s.heroSub}>One search across every major Saudi property platform.</Text>
        </View>

        {/* Search card */}
        <View style={s.card}>
          <Segmented options={DEALS} value={query.deal} onChange={(v) => setQuery((q) => ({ ...q, deal: v as any }))} />

          {/* Location */}
          <View style={s.field}>
            <Ionicons name="location-outline" size={18} color={colors.muted} />
            <TextInput
              style={s.input}
              placeholder="City or neighborhood"
              placeholderTextColor={colors.muted}
              value={query.location}
              autoCorrect={false}
              onChangeText={(t) => {
                setQuery((q) => ({ ...q, location: t }));
                setSuggestions(matchLocations(t));
              }}
            />
            {query.location.length > 0 && (
              <Pressable onPress={() => { setQuery((q) => ({ ...q, location: '' })); setSuggestions([]); }} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.muted} />
              </Pressable>
            )}
          </View>

          {suggestions.length > 0 && (
            <View style={s.suggBox}>
              {suggestions.map((sg, i) => (
                <Pressable
                  key={sg.city + sg.district}
                  style={[s.suggRow, i < suggestions.length - 1 && s.suggDivider]}
                  onPress={() => { setQuery((q) => ({ ...q, location: placeField(sg) })); setSuggestions([]); }}
                >
                  <Ionicons name="location" size={16} color={colors.primary} />
                  <View>
                    <Text style={s.suggCity}>{sg.city}</Text>
                    <Text style={s.suggDist}>{sg.district}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {/* Category */}
          <View style={{ marginTop: 12 }}>
            <FieldLabel>Category</FieldLabel>
            <View style={s.row}>
              {CATEGORIES.map((cat) => (
                <OptionBox
                  key={cat}
                  label={cat}
                  selected={query.category === cat}
                  onPress={() => setQuery((q) => ({ ...q, category: q.category === cat ? null : cat, type: null, detail: null }))}
                />
              ))}
            </View>
          </View>

          {/* Type (scoped) */}
          {query.category && (
            <View style={{ marginTop: 12 }}>
              <FieldLabel>Property type</FieldLabel>
              <View style={s.wrap}>
                {CATEGORY_TYPES[query.category as Category].map((t) => (
                  <OptionBox
                    key={t}
                    label={t}
                    selected={query.type === t}
                    onPress={() => setQuery((q) => ({ ...q, type: q.type === t ? null : t, detail: null }))}
                    style={s.wrapCell}
                  />
                ))}
              </View>
            </View>
          )}

          {/* Detail */}
          {detail && (
            <View style={{ marginTop: 12 }}>
              <FieldLabel>{detail.label}</FieldLabel>
              <View style={s.wrap}>
                {detail.options.map((opt) => (
                  <OptionBox
                    key={opt}
                    label={opt}
                    selected={query.detail === opt}
                    onPress={() => setQuery((q) => ({ ...q, detail: q.detail === opt ? null : opt }))}
                    style={s.wrapCell}
                  />
                ))}
              </View>
            </View>
          )}

          {/* Price */}
          <View style={[s.field, { marginTop: 12 }]}>
            <Text style={s.sar}>SAR</Text>
            <TextInput
              style={s.input}
              placeholder="Max price"
              placeholderTextColor={colors.muted}
              keyboardType="number-pad"
              value={query.priceInput ? grouped(parseInt(query.priceInput, 10)) : ''}
              onChangeText={(t) => setQuery((q) => ({ ...q, priceInput: (t.match(/\d/g) ?? []).join('') }))}
            />
            {priceEcho && <Text style={s.priceEcho} numberOfLines={1}>{priceEcho}</Text>}
          </View>

          <View style={{ height: 14 }} />
          <PrimaryButton title="Search" onPress={onSearch} />
        </View>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { paddingHorizontal: space.screenSide, alignItems: 'center' },
  col: { width: '100%', maxWidth: MAX_W },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  word: { fontSize: 12, fontWeight: '700', letterSpacing: 2, color: colors.ink },
  agentMini: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.tint, borderColor: colors.tintLine, borderWidth: 1, borderRadius: 14, paddingVertical: 7, paddingLeft: 10, paddingRight: 12 },
  agentMiniT: { fontSize: 11, fontWeight: '700', color: colors.ink },
  agentMiniS: { fontSize: 8, fontWeight: '500', color: colors.accentLeaf },
  hero: { alignItems: 'center', marginTop: 18 },
  heroTitle: { fontSize: 31, fontWeight: '700', color: colors.primary, letterSpacing: -0.5 },
  heroSub: { fontSize: 13.5, fontWeight: '500', color: colors.mutedBlue, textAlign: 'center', marginTop: 5 },
  card: { marginTop: 28, backgroundColor: colors.surface, borderRadius: radius.sheet, borderWidth: 1, borderColor: colors.fieldLine, padding: space.card, ...cardShadow },
  field: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, borderWidth: 1, borderColor: colors.fieldLine, borderRadius: radius.field, paddingHorizontal: 14, marginTop: 12, backgroundColor: colors.surface },
  input: { flex: 1, fontSize: 14, color: colors.ink, ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}) },
  sar: { fontSize: 13.5, fontWeight: '600', color: colors.muted },
  priceEcho: { fontSize: 11, color: colors.accentLeaf, flexShrink: 1, textAlign: 'right' },
  suggBox: { marginTop: 8, borderWidth: 1, borderColor: colors.fieldLine, borderRadius: radius.field, backgroundColor: colors.surface, overflow: 'hidden' },
  suggRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12 },
  suggDivider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  suggCity: { fontSize: 13.5, fontWeight: '600', color: colors.ink },
  suggDist: { fontSize: 11.5, color: colors.muted },
  row: { flexDirection: 'row', gap: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  wrapCell: { flexGrow: 1, flexBasis: '30%', minWidth: 90, flex: 0 },
});
