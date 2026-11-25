/**
 * The district network's supply temperature per step. A fixed one, or a heating curve: networks run
 * hotter when it is cold (more demand, the houses' radiators need it) and slide down to a summer level that still
 * makes hot water. Linear between the design outdoor temperature (the winter supply at and below it) and the heating
 * limit (the summer supply at and above it), as in a weather-compensated controller (DIN EN 12828 heating curve,
 * straight-line approximation).
 */
export interface SupplyCurve {
  winter: number; // °C supply at the design outdoor temperature and below
  summer: number; // °C supply at the heating limit and above
  tDesign: number; // °C outdoor, design (e.g. -12 in Frankfurt, DIN EN 12831)
  tLimit: number; // °C outdoor, heating limit
}

export const DESIGN_OUTDOOR = -12;
export const HEATING_LIMIT = 15;

/** The curve of a network designed for `supply`/`ret` °C when nobody set another: the design supply in winter, 15 K
 * lower in summer but at least 10 K above the return (hot water still made), never above the winter's. Heat
 * Matching's heating curve starts from it; the Site map's quick analysis and heat network run on it. */
export const defaultCurve = (supply: number, ret: number): SupplyCurve => ({
  winter: supply,
  summer: Math.min(supply, Math.max(ret + 10, supply - 15)),
  tDesign: DESIGN_OUTDOOR,
  tLimit: HEATING_LIMIT,
});

/** The supply at one outdoor temperature on the curve. */
export function supplyAt(tOut: number, c: SupplyCurve): number {
  const span = c.tLimit - c.tDesign;
  const f = span > 0 ? Math.min(1, Math.max(0, (tOut - c.tDesign) / span)) : 0;
  return c.winter + (c.summer - c.winter) * f;
}

/** The supply per step: the curve's on the outdoor temperature, or `fixed` everywhere when there is no curve. */
export function supplySeries(outT: number[], n: number, fixed: number, curve: SupplyCurve | null): number[] {
  return Array.from({ length: n }, (_, i) => (curve && Number.isFinite(outT[i]) ? supplyAt(outT[i], curve) : fixed));
}
