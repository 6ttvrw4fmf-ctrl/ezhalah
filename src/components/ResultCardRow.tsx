import { memo } from 'react';
import { View } from 'react-native';
import type { Listing } from '@/data/listings';
import { CardIn } from '@/components/CardReveal';
import { DeadCardShade } from '@/components/DeadCardShade';
import { ResultCard } from '@/components/ResultCard';
import { GLINT_CELL_PROPS } from '@/lib/scrollCalm';

// TYPING IN A BIG CHAT MUST NOT RE-RENDER ITS CARDS (owner 2026-10-25: «when I type, logged in, in a saved chat it
// sometimes takes time and glitches»). The composer's text lives in the chat screen, so every key press re-renders
// the whole screen — and with a saved 500-card chat that was ~1,500 wrapper components rebuilt per key (a cell, a
// CardIn, a DeadCardShade per card), measured at +30 ms of page CPU per key over an empty chat (5.1×, best of 4).
// A card row now owns its cell + fade + shade + card, and React skips it unless something the card DRAWS changed.
//
// Memoized card: during the reveal cascade the list re-renders every ~55ms — already-revealed cards must skip
// reconciliation or 200+ cards stutter the very animation the cascade exists for (review perf fix 2026-07-09).
// onOpen is deliberately excluded from the comparison: it's re-created each render but behaves identically for the
// same listing.
export const MemoResultCard = memo(ResultCard, (prev, next) =>
  prev.listing === next.listing && prev.rank === next.rank && prev.variant === next.variant
  && prev.row === next.row
  // activeAf is one frozen reference per results turn (afActive memoises on m.result.query), so
  // identity is the right comparison; without this term the card would swallow the prop.
  && prev.activeAf === next.activeAf);

type Motion = { delayMs?: number; stillHeight?: number };
type Props = {
  listing: Listing;
  rank: number;
  row: 'roomy' | 'tight' | undefined;
  activeAf: React.ComponentProps<typeof ResultCard>['activeAf'];
  /** The listing's ad has ended (DeadCardShade). */
  dead: boolean;
  /** CardIn's mount-in; read ONCE at mount (CardIn keeps its first value), so it is not compared. */
  motion: Motion;
  onOpen: () => void;
};

/** One grid cell: `cell` is the box the result grid lays out (width 100%, minWidth 0) and the budget's glint-cell marker. */
export const ResultCardRow = memo(function ResultCardRow({ listing, rank, row, activeAf, dead, motion, onOpen }: Props) {
  return (
    <View {...GLINT_CELL_PROPS} style={{ width: '100%', minWidth: 0 }}>
      <CardIn {...motion}>
        <DeadCardShade dead={dead}>
          <MemoResultCard listing={listing} variant="compact" rank={rank} row={row} activeAf={activeAf} onOpen={onOpen} />
        </DeadCardShade>
      </CardIn>
    </View>
  );
}, (prev, next) =>
  prev.listing === next.listing && prev.rank === next.rank && prev.row === next.row
  && prev.activeAf === next.activeAf && prev.dead === next.dead);
