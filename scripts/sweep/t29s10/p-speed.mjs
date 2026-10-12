// Section P (round 2) — UNOPTIMIZED, measured: every read answers in good time once warm. The dev
// database is a small shared box in Mumbai, so the bar is generous (3 s warm) — a read that misses it
// is doing too much, not unlucky. Each read is asked twice and the SECOND time is measured.
const BAR_MS = 3000;
const READS = (FH) => [
  ["Repair", `/api/admin/repair?restaurant_id=${FH}`], ["Access & permissions", `/api/admin/restaurants/access-tree?restaurant_id=${FH}`],
  ["the bill preview", `/api/admin/restaurants/bill-preview?rid=${FH}&mode=bill`], ["branding", `/api/admin/restaurants/branding?restaurant_id=${FH}`],
  ["new-restaurant defaults", "/api/admin/restaurants/create-defaults"], ["logins & passwords", `/api/admin/restaurants/credentials?restaurant_id=${FH}`],
  ["restaurant health", "/api/admin/restaurants/health"], ["quick features", `/api/admin/restaurants/quick-features?restaurant_id=${FH}`],
  ["the restaurant report (7 days)", `/api/admin/restaurants/report?restaurant_id=${FH}&range=7d`], ["the restaurant list", "/api/admin/restaurants"],
  ["platform settings", `/api/admin/restaurants/settings?restaurant_id=${FH}`], ["the password cover state", "/api/admin/reveal"],
  ["revenue", "/api/admin/revenue"], ["admin settings", "/api/admin/settings"], ["staff online", "/api/admin/staff-online"],
  ["usage", "/api/admin/usage"], ["every user", "/api/admin/users"],
];
export default function section(c) {
  c.sec(`P · every read answers in under ${BAR_MS / 1000} s once warm (measured)`);
  for (const [label, url] of READS(c.FH)) c.phase(`${label} — answers in under ${BAR_MS / 1000} s`, "GET it twice; time the second",
    async () => {
      await c.req(url);
      const t = performance.now(); const r = await c.req(url); const ms = Math.round(performance.now() - t);
      return r.status === 200 && ms < BAR_MS ? { ok: true, note: `${ms} ms` } : `${r.status} in ${ms} ms`;
    });
}
