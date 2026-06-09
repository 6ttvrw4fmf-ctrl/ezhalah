import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors, space } from '@/theme/tokens';
import { ResultCard } from '@/components/ResultCard';
import { useApp } from '@/store';

const MAX_W = 560;

export default function Results() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { result } = useApp();

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <View style={[s.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={() => router.back()} style={s.back} hitSlop={8}>
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </Pressable>
        <Text style={s.word}>EZHALAH</Text>
      </View>

      <ScrollView contentContainerStyle={[s.scroll, { paddingBottom: insets.bottom + 28 }]}>
        <View style={s.col}>
          {result && (
            <>
              <Text style={s.heading}>{result.heading}</Text>

              {result.notes.map((note) => (
                <View key={note} style={s.note}>
                  <Ionicons name="information-circle-outline" size={14} color={colors.amberInk} />
                  <Text style={s.noteText}>{note}</Text>
                </View>
              ))}

              {result.listings.length === 0 ? (
                <Text style={s.empty}>No exact matches — try broadening your search.</Text>
              ) : (
                <View style={{ gap: 12, marginTop: 4 }}>
                  {result.listings.map((l) => (
                    <ResultCard key={l.id} listing={l} onOpen={() => router.push({ pathname: '/browser', params: { id: String(l.id) } })} />
                  ))}
                </View>
              )}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: space.screenSide, paddingBottom: 8 },
  back: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  word: { fontSize: 12, fontWeight: '700', letterSpacing: 2, color: colors.ink },
  scroll: { paddingHorizontal: space.screenSide, alignItems: 'center' },
  col: { width: '100%', maxWidth: MAX_W, gap: 12 },
  heading: { fontSize: 17, fontWeight: '600', color: colors.ink },
  note: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: colors.amberBg, borderRadius: 10, padding: 10 },
  noteText: { flex: 1, fontSize: 12, color: colors.amberInk },
  empty: { fontSize: 14, color: colors.muted, marginTop: 8 },
});
