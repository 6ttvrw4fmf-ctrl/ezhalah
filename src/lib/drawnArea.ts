// A drawn boundary must enclose a REAL area (2026-11-12, found live): a straight drag on the map has ≥ 3 points but
// no inside, and was accepted as a boundary that then showed «0 إعلان داخل الحدود» over all of Saudi Arabia. The
// area is measured in screen pixels (shoelace formula), so the rule reads the same at every zoom.
export const MIN_DRAWN_AREA_PX = 900; // about a 30 × 30 px square — the smallest loop a finger draws on purpose

export function drawnAreaPx(points: { x: number; y: number }[]): number {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

export function isRealDrawnArea(points: { x: number; y: number }[]): boolean {
  return points.length >= 3 && drawnAreaPx(points) >= MIN_DRAWN_AREA_PX;
}
