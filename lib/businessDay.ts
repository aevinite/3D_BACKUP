// The restaurant's "business day" starts at 05:00 IST (Asia/Kolkata), not at
// midnight — so a late service running past midnight stays on ONE day's KOT/bill
// numbering (owner's call, 2026-06-13). The DB counter (migration 044) keys on
// this same IST business date; this helper gives the UTC instant of the current
// business day's start so the "today's orders" filters in the panels line up
// exactly with that reset. Keep the two in lockstep — if one changes, change both.

const IST_OFFSET_MIN = 5 * 60 + 30; // Asia/Kolkata is UTC+05:30 (no DST)
const ROLLOVER_HOUR = 5;            // a new business day begins at 05:00 IST

// ISO timestamp (UTC) of the start of the business day that `now` falls in.
export function businessDayStartIso(now: Date = new Date()): string {
  // Shift into IST by pretending the UTC fields hold the IST wall clock.
  const ist = new Date(now.getTime() + IST_OFFSET_MIN * 60000);
  const boundary = new Date(ist);
  boundary.setUTCHours(ROLLOVER_HOUR, 0, 0, 0); // today's 05:00 in IST wall-clock
  // Before 05:00 IST we're still in yesterday's business day.
  if (ist.getTime() < boundary.getTime()) boundary.setUTCDate(boundary.getUTCDate() - 1);
  // Convert that IST wall-clock instant back to real UTC.
  return new Date(boundary.getTime() - IST_OFFSET_MIN * 60000).toISOString();
}
