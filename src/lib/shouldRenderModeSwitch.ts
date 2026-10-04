/** History replays never show the Filter / AI mode pill, including while switching saved chats. */
export function shouldRenderModeSwitch(modeGone: boolean, replay?: string): boolean {
  return !modeGone && replay !== '0';
}
