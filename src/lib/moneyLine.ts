// A LINE THAT CARRIES MONEY IS NEVER CUT (owner 2026-11-10: «make sure never ever get this mistake ever. Ever again»).
// On a laptop with an ad open beside the results the card's price «ر.س 2,700,000» was drawn as «…00,000»: the price
// line was a one-line Text (numberOfLines={1}), so when the column got narrow the browser cut it and put «…» in place
// of digits. A cut price is a WRONG price on the screen. The rule: a Text that prints a price, a monthly line, a
// discount's old price, a per-metre rate or the «≈» working NEVER takes numberOfLines — it wraps onto a second line.
// Every such Text spreads MONEY_LINE, which marks it `data-money` on the web, and the browser robot
// scripts/verify-web-laptop-nothing-cut-or-covered.mjs measures every marked line on the built app (laptop with and
// without the ad beside, and a phone), with the longest prices we can serve written in.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const MONEY_LINE: any = { dataSet: { money: '1' } };
