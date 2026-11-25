/** The electricity market by the hour (GET /api/market/hourly): SMARD's day-ahead price (DE/LU) and the grid's CO₂. */
import { getJson } from "./http";

/** Every hour of the span asked for, null where the market files have none. */
export interface MarketHours {
  times: number[]; // unix seconds, hour starts (UTC)
  price_eur_mwh: (number | null)[];
  co2_g_kwh: (number | null)[]; // the generation mix's direct emissions
  files: { price: string[]; co2: string[] };
  span: { price: [string, string] | null; co2: [string, string] | null }; // what the files cover, ISO (UTC)
  covered: { price: number; co2: number }; // hours of the span with a value
  hint: string | null; // no SMARD files at all: where to put them (then every hour is null)
}

/** The market's hours from `start` to `end` (unix seconds, end excluded); all null with a `hint` when no SMARD files are there. */
export const fetchMarket = (start: number, end: number) =>
  getJson<MarketHours>(`/api/market/hourly?start=${Math.floor(start)}&end=${Math.ceil(end)}`, "Market data not loaded");
