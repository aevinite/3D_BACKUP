// Section O (round 2) — EVERY RESTAURANT, not just French House. Ten fixed slots (the ten oldest live
// restaurants), so an id never moves when one more is created; an empty slot answers ⏭. Reads only —
// Aangan and every other restaurant are only READ here.
const SLOTS = 10;
const READS = [
  ["Access & permissions", (r) => `/api/admin/restaurants/access-tree?restaurant_id=${r}`],
  ["branding", (r) => `/api/admin/restaurants/branding?restaurant_id=${r}`],
  ["platform settings", (r) => `/api/admin/restaurants/settings?restaurant_id=${r}`],
  ["Repair", (r) => `/api/admin/repair?restaurant_id=${r}`],
];
export default function section(c) {
  let list = null;
  const slot = async (i) => (list ||= (await c.sq("restaurants?select=id,name&deleted_at=is.null&order=created_at.asc,id.asc&limit=" + SLOTS)).json || [])[i];
  c.sec("O · every restaurant's admin screens open, not only French House's");
  for (let i = 0; i < SLOTS; i++) for (const [label, url] of READS)
    c.phase(`restaurant #${i + 1} (oldest first) — its ${label} read answers 200 without an error`, "GET it signed in for that restaurant's id",
      async () => {
        const r0 = await slot(i); if (!r0) return `skip:there are fewer than ${i + 1} live restaurants today`;
        const r = await c.req(url(r0.id));
        return r.status === 200 && r.json && !r.json.error || `${r0.name}: ${r.status} ${(r.json?.error || r.text).slice(0, 70)}`;
      });
  c.phase("the restaurant report counts each restaurant's own staff only (slot by slot against the database)", "report?range=7d staffTotal vs a head count of that restaurant's active staff_users",
    async () => {
      const bad = [];
      for (let i = 0; i < SLOTS; i++) {
        const r0 = await slot(i); if (!r0) break;
        const rep = await c.req(`/api/admin/restaurants/report?restaurant_id=${r0.id}&range=7d`);
        const box = Object.values(rep.json || {}).find((v) => v && typeof v === "object" && "staffTotal" in v);
        if (!box) { bad.push(`${r0.name}: no staff total`); continue; }
        const shown = box.staffTotal;
        const db = await c.count("staff_users", `restaurant_id=eq.${r0.id}&active=eq.true`);
        if (shown !== db) bad.push(`${r0.name}: shows ${shown}, database ${db}`);
      }
      return bad.length === 0 || bad.slice(0, 3).join(" | ");
    });
}
