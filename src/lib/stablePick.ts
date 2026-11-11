// One message → one line, everywhere (owner 2026-11-09: a reopened or shared chat showed a 🎉 line
// the first time had not — «it shows later when user clicks new chat … this applies to everything»).
//
// The rotating lines (Results-Found, No-Results) are picked when a message is DRAWN, not saved with
// it. The old pick was Math.random() remembered in memory, so it held only until the page closed: a
// refresh, another phone, or the person a chat was shared with rolled a new line over the same
// answer. Picking from the message id instead gives the same line on every device for the life of
// the message, and a NEW chat (new message id) is what brings a fresh line.

/** Index in [0, n) decided only by `key` (FNV-1a). Same key → same index, on every device. */
export function stableIndex(key: string, n: number): number {
  if (n <= 1) return 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % n;
}
