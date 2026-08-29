// ChatGPT-style feedback row — thumbs up / down (mutually exclusive; highlighted when active) +
// share + read-aloud. POSITION (owner 2026-07-09): rendered ONCE per results response, directly
// BELOW the «عرضت لك أول N إعلانات. تبي أعرض لك المزيد…» message — NOT under each property card (it
// originally shipped per-card; owner moved it). The «شكراً على ملاحظتك» confirmation is NOT rendered
// here — it fires the `onFeedback` callback and the HOST shows a ChatGPT-style toast at the top of
// the chat (owner 2026-07-09: toast above the conversation, not next to the buttons). Feedback is
// stored LOCALLY only (lib/listingFeedback, keyed by the results-message id → rates the RESPONSE,
// not one listing). UI-only: no search/cards/ranking.
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Ionicons from '@expo/vector-icons/Ionicons';
import { colors } from '@/theme/tokens';
import { useI18n } from '@/i18n';
import { getListingFeedback, setListingFeedback, type FeedbackRating } from '@/lib/listingFeedback';
import { speakReadAloud, stopReadAloud, subscribeReadAloud, type ReadAloudSegment } from '@/lib/readAloud';

export default function FeedbackRow({
  feedbackKey, shareUrl, onFeedback, readAloudSegments,
}: {
  feedbackKey: string;
  shareUrl?: string;
  onFeedback?: () => void; // fired when a rating is SET (not cleared) — host shows the thanks toast
  // The structured script (إزهله -> pause -> summary -> pause -> cards, owner 2026-08-19) this
  // response's 🔊 button reads. Omit/empty to hide the button entirely rather than render one that
  // speaks nothing — the CALLER decides the script (src/lib/readAloudScript.ts for results
  // messages), this component only ever plays whatever it's given.
  readAloudSegments?: ReadAloudSegment[];
}) {
  const { t, isRTL } = useI18n();
  const [rating, setRating] = useState<FeedbackRating | null>(() => getListingFeedback(feedbackKey));
  const [copied, setCopied] = useState(false);
  // Free, on-device TTS only (owner P0, 2026-08-18) — see src/lib/readAloud.ts. `speaking` mirrors
  // the ONE shared "who is talking right now" id, so tapping a DIFFERENT response's 🔊 flips this
  // row back to idle automatically (single-speaker, no local queue to get out of sync).
  const [speaking, setSpeaking] = useState(false);
  const speakingRef = useRef(false); // mirrors `speaking` for the unmount-only cleanup below
  // Shown briefly when speakReadAloud() refuses to speak — genuinely no Arabic voice on this
  // device/browser (root-cause fix, 2026-08-22: never hand Arabic text to a non-Arabic voice; this
  // is the graceful Arabic message the owner asked for instead). Auto-hides, same pattern as `copied`
  // below.
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => subscribeReadAloud((id) => {
    const mine = id === feedbackKey;
    speakingRef.current = mine;
    setSpeaking(mine);
  }), [feedbackKey]);
  // Stop mid-speech ONLY if the row itself unmounts (e.g. the user navigates away) — never leaves a
  // dangling utterance playing over a screen that no longer shows what's being read. Mount/unmount
  // only ([] deps); speakingRef (not state) is what the cleanup reads, so a normal speaking->idle
  // transition on this same row never calls stop() redundantly.
  useEffect(() => () => { if (speakingRef.current) stopReadAloud(); }, []);
  const onReadAloud = () => {
    if (speaking) { stopReadAloud(); return; }
    if (!readAloudSegments?.length) return;
    const started = speakReadAloud(feedbackKey, readAloudSegments);
    if (!started) {
      setUnavailable(true);
      setTimeout(() => setUnavailable(false), 3200);
    }
  };

  // Only one of up/down active; clicking the active one clears it (ChatGPT feel). The thanks toast
  // fires only when a rating is SET (not when cleared). Side effects run OUTSIDE any state updater
  // (never during render) to avoid React's "cannot update a component while rendering" warning.
  const vote = (r: FeedbackRating) => {
    const next: FeedbackRating | null = rating === r ? null : r;
    setRating(next);
    setListingFeedback(feedbackKey, next);
    if (next) onFeedback?.();
  };

  // Normal share/copy flow: OS share sheet where available, else copy the link (the share icon
  // briefly becomes a check). Never throws to the user (cancel = no-op).
  const onShare = async () => {
    const url = shareUrl || 'https://ezhalah-app.vercel.app';
    try {
      if (Platform.OS === 'web') {
        const nav: any = typeof navigator !== 'undefined' ? navigator : null;
        if (nav?.share) { await nav.share({ url }); return; }
        await Clipboard.setStringAsync(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      } else {
        await Share.share({ message: url, url });
      }
    } catch { /* user cancelled or share unavailable — no-op */ }
  };

  return (
    <View style={[fb.container, { alignItems: isRTL ? 'flex-end' : 'flex-start' }]}>
      <View style={[fb.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        <FbButton icon={rating === 'up' ? 'thumbs-up' : 'thumbs-up-outline'} active={rating === 'up'} onPress={() => vote('up')} label={t('Helpful')} />
        <FbButton icon={rating === 'down' ? 'thumbs-down' : 'thumbs-down-outline'} active={rating === 'down'} onPress={() => vote('down')} label={t('Not helpful')} />
        <FbButton icon={copied ? 'checkmark' : 'share-outline'} active={copied} onPress={onShare} label={t('Share')} />
        {readAloudSegments?.length ? (
          <FbButton
            icon={speaking ? 'stop-circle' : 'volume-high-outline'}
            active={speaking}
            onPress={onReadAloud}
            label={speaking ? t('Stop reading') : t('Read aloud')}
          />
        ) : null}
      </View>
      {unavailable ? <Text style={fb.unavailable}>{t('Listening isn\'t available on this device')}</Text> : null}
    </View>
  );
}

function FbButton({ icon, active, onPress, label }: { icon: any; active: boolean; onPress: () => void; label: string }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ hovered, pressed }: any) => [fb.btn, (hovered || pressed) && fb.btnHover, active && fb.btnActive]}
    >
      <Ionicons name={icon} size={16} color={active ? colors.primary : colors.muted} />
    </Pressable>
  );
}

const fb = StyleSheet.create({
  // Thin row below the more-results message.
  container: { width: '100%', paddingHorizontal: 4, paddingTop: 6 },
  row: { alignItems: 'center', gap: 2 },
  // Small icon button (~30px target). Active = light green wash + accent icon (set inline).
  btn: { padding: 7, borderRadius: 9, ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}) },
  btnHover: { backgroundColor: colors.surface2 },
  btnActive: { backgroundColor: colors.tint },
  // Graceful "no Arabic voice on this device" note (root-cause fix, 2026-08-22) — never a wrong-
  // language voice instead, per owner requirement.
  unavailable: { fontSize: 12, color: colors.muted, marginTop: 2 },
});
