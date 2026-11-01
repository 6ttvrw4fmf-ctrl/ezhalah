/** History replays never show the Filter / AI mode pill, including while switching saved chats.
 *  `openingSaved` covers the gap the router param cannot: the sidebar's open consumes `?replay=0`
 *  at once, and while the saved chat restores (up to SAVED_OPEN_MAX_WAIT_MS) the screen holds no
 *  messages — which, without this, reads as a brand-new chat and paints the pill (owner 2026-10-08). */
export function shouldRenderModeSwitch(modeGone: boolean, replay?: string, openingSaved = false): boolean {
  return !modeGone && replay !== '0' && !openingSaved;
}
