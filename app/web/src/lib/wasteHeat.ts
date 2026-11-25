/** A data center's waste heat from its installed capacity, utilization and the share of the heat used. Pure. */

/** A server's power when idle, share of its full power: "about half its full power when doing virtually no work"
 * (Barroso & Hölzle 2007, The Case for Energy-Proportional Computing, IEEE Computer 40(12)). */
export const IDLE_SHARE = 0.5;

/** The share of its capacity a data center draws, and gives as heat, at its utilization: linear from its idle power to
 * full power (Fan, Weber & Barroso 2007, Power Provisioning for a Warehouse-sized Computer, ISCA: power is close to
 * linear in CPU utilization). 50 % idle: 70 % of the power at 40 % utilization, 85 % at 70 %. */
export const powerShare = (p: { utilization?: number | null; idle_share?: number | null }) => {
  const idle = p.idle_share ?? IDLE_SHARE;
  return idle + (1 - idle) * (p.utilization ?? 1);
};

/** The data center's waste heat used on average, kW: its installed capacity times the share it draws, times the share
 * of that heat used (a site saved without them: full load, all of it). */
export const wasteKw = (
  p: { power_kw: number; utilization?: number | null; idle_share?: number | null; heat_used_share?: number | null } | null | undefined,
) => (p ? p.power_kw * powerShare(p) * (p.heat_used_share ?? 1) : 0);
