// Pure, testable coordination between the sidebar saved-chat row's SINGLE click (open) and its
// DOUBLE click (inline rename). It exists as its own module so the PERMANENT rule is provable
// without rendering:
//
//   Single click            → OPEN the chat.
//   Fast double-click        → inline RENAME only; must NEVER navigate / switch to Filter/Agent /
//                              reset the active chat/search.
//   Two SLOW clicks          → two separate opens (the browser's own double-click threshold decides).
//
// THE BUG THIS FIXES: the row already bound a native `dblclick` → beginRename, but the single-click
// `onPress` STILL fired on each click of a double-click and called openHistory() (which navigates).
// The two handlers were uncoordinated. The fix: a single click only ARMS a delayed open; the
// browser's dblclick CANCELS that armed open before it can fire. A cancelled open never navigates.

export const OPEN_DELAY_MS = 250;

export type ArmedOpen = { token: number; cancelled: boolean };

// A click arms an open, tagged with a unique token (the click time). Re-arming (a second click)
// supersedes the previous token.
export function armOpen(token: number): ArmedOpen {
  return { token, cancelled: false };
}

// The dblclick handler calls this to cancel a pending open, so 'open' can never run for a double-click.
export function cancelOpen(a: ArmedOpen | null): ArmedOpen | null {
  return a ? { ...a, cancelled: true } : null;
}

// When token's delay elapses, fire the open ONLY if this armed open is still current (not superseded
// by a later click) and was not cancelled by a double-click.
export function openShouldFire(a: ArmedOpen | null, token: number): boolean {
  return !!a && a.token === token && !a.cancelled;
}

// The inline-editor contract, mirroring the Sidebar's commitRename/cancelRename: Enter and blur SAVE
// the title; Escape CANCELS and saves nothing. (Rename touches the title metadata only — never the
// query, snapshot, id, star, ts, active chat, route, or results.)
export function editorSaves(action: 'enter' | 'blur' | 'escape'): boolean {
  return action !== 'escape';
}
