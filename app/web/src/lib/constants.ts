/** Physical and calendar constants shared by the pages: one named value each, so a formula never writes them out. */

/** Hours of a year of 365 days (a typical year; a leap year's extra day is not counted). */
export const HOURS_PER_YEAR = 8760;

/** Specific heat of liquid water, kJ/(kg·K), at the 30-70 °C of a heat distribution (IAPWS-IF97: 4.180 at 30 °C).
 * The backend's component presets use 4.186 (`core/component_library.py`, water at 20 °C): their own parameter, fitted
 * or set per component; the two are left as they are so no saved result moves. */
export const CP_WATER = 4.18;
