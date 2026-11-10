// The number a card shows on one Advanced Filter option, read out of the count RPC row the APP reads for it.
//
// Age rungs come from `property_age_option_counts_ar` (cnt_new, cnt_1_2, … cnt_10p; a cumulative rung «حتى 5 سنوات»
// is the SUM of `col` and `plus`, owner 2026-10-05); every other option comes from `apartment_guided_counts_ar`.
// 🔬 2026-11-10: the COMBINED(Buy∪Rent) and Rent-BOTH(كلاهما) sweeps of verify-af-full-surface-differential.ts read
// the age rungs out of the GUIDED row, which has no age columns, so every age chip there was Number(undefined) = NaN
// (48 NaN chips in job 129595811625) and a true zero rung (Duplex «10+» @region:1) failed «a zero option must be zero
// everywhere» — the alert 11763 run went red on the measuring tool, not the product.

export type ChipOpt = { col: string | null; plus?: string[]; countRpc: 'guided' | 'age' | null };

export const chipOf = (row: Record<string, unknown>, opt: ChipOpt): number =>
  [opt.col, ...(opt.plus ?? [])].reduce((sum, c) => sum + Number(row[c as string]), 0);

/** The chip for `opt` from the row its own count RPC returned; null when that RPC returned no row. */
export function cohortChip(opt: ChipOpt, guided: Record<string, unknown> | null, age: Record<string, unknown> | null): number | null {
  const counts = opt.countRpc === 'age' ? age : guided;
  return counts && opt.col ? chipOf(counts, opt) : null;
}
