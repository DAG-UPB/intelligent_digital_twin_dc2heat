/**
 * A weather of one's own for Heat Matching's weather window (WeatherWindow.tsx): an outdoor temperature generated
 * from three numbers, or read from a file, on the period's hours.
 */

const DAY = 86400;

/**
 * The outdoor temperature at each time (unix seconds): `mean`, the year's swing (± K: coldest in mid January,
 * warmest in mid July) and the day's (± K: coldest at 03:00, warmest at 15:00, local time ignored: UTC).
 */
export function generateWeather(times: number[], mean: number, season: number, day: number): number[] {
  return times.map((t) => {
    const doy = (t / DAY) % 365.2425; // days since 1 January 1970, a year's phase is what counts
    const hour = (t % DAY) / 3600;
    return mean - season * Math.cos((2 * Math.PI * (doy - 15)) / 365.2425) - day * Math.cos((2 * Math.PI * (hour - 3)) / 24);
  });
}

/**
 * The temperatures in a file: the last number on each line (a header or text lines are skipped; a decimal comma
 * is read where ; or tabs separate), one per hour from the period's start; fewer than `n`: repeated, more: cut. Null when it has none.
 */
export function parseWeatherCsv(text: string, n: number): number[] | null {
  const values = text
    .split(/\r?\n/)
    // separated by ; or tabs (a German spreadsheet: the comma is the decimal mark), else by commas or spaces
    .map((line) =>
      line
        .trim()
        .split(/[;\t]/.test(line) ? /[;\t]+/ : /[, ]+/)
        .filter(Boolean)
        .at(-1)
        ?.replace(",", "."),
    )
    .map((x) => (x === undefined ? NaN : Number(x)))
    .filter((x) => Number.isFinite(x));
  if (!values.length || n <= 0) return null;
  return Array.from({ length: n }, (_, i) => values[i % values.length]);
}
