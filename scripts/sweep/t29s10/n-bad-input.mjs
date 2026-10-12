// Section N (round 2) — BAD INPUT ON EVERY WRITE DOOR. Five bodies that are not an object (item 26's
// fault), and three wrongly typed restaurant ids. None names a real row, so nothing can be written;
// every answer must be a 4xx (423 on a covered password door) carrying a sentence — never a crash.
const DOORS = [
  ["POST", "/api/admin/repair"], ["POST", "/api/admin/resolve-error"], ["POST", "/api/admin/restaurants/access-tree"],
  ["POST", "/api/admin/restaurants/branding"], ["POST", "/api/admin/restaurants/credentials"], ["POST", "/api/admin/restaurants/quick-features"],
  ["POST", "/api/admin/restaurants/settings"], ["POST", "/api/admin/restaurants"], ["PATCH", "/api/admin/restaurants"],
  ["POST", "/api/admin/reveal"], ["POST", "/api/admin/reveal/password"], ["POST", "/api/admin/settings"],
  ["POST", "/api/admin/users"], ["PATCH", "/api/admin/users"],
];
const BODIES = [["null", "null"], ["a list", "[]"], ["a bare number", "42"], ["a bare string", "\"hello\""], ["broken JSON", "{oops"]];
// The list carries an id that matches NO restaurant (item 29): on its first run this list held French
// House's own id, and four doors read it as that id and WROTE — the restaurant was switched off, its
// owner cleared, its colour changed (all put back the same minute). A fault that returns must now show
// as a "not found" (it read the list as an id), never as a write.
const NOBODY = "00000000-0000-0000-0000-00000000dead";
const IDS = [["a number", 12345], ["an object", { id: "x" }], ["a list", [NOBODY]]];

export default function section(c) {
  const send = async (m, p, raw) => {
    const id = crypto.randomUUID(); c.idem.push(id);
    const r = await c.req(p, { method: m, body: raw, headers: { "X-LFH-Action-Id": id } });
    return r;
  };
  const okAnswer = (r) => (r.status >= 400 && r.status < 500) && typeof r.json?.error === "string" && r.json.error.length > 3;

  c.sec("N · a body that is not an object is refused in words on every write door (item 26)");
  for (const [m, p] of DOORS) for (const [label, raw] of BODIES)
    c.phase(`${m} ${p.replace("/api/admin/", "")} — a body of ${label} gets a refusal in words, never a crash`, `send ${raw}`,
      async () => { const r = await send(m, p, raw); return okAnswer(r) || `${r.status} ${r.text.slice(0, 60)}`; });

  c.sec("N · a restaurant id of the wrong TYPE is refused, never coerced into a write");
  // The doors that take a restaurant id (Resolve takes an error row id, Reveal and Users take none at the top level).
  const ridDoors = DOORS.filter(([, p]) => !/reveal|resolve-error|\/users$|\/settings$/.test(p) || /restaurants\/settings/.test(p));
  for (const [m, p] of ridDoors) for (const [label, v] of IDS)
    c.phase(`${m} ${p.replace("/api/admin/", "")} — restaurant_id as ${label} is refused`, `send { restaurant_id: ${JSON.stringify(v)} } with that door's usual action`,
      async () => {
        const body = { restaurant_id: v, op: "unstick_table", action: "set_restaurant_active", action_id: v, feature: "banquet", on: true, patch: { grants: { edit_menu: true } }, accent_color: "#112233", user_id: v };
        const r = await send(m, p, JSON.stringify(body));
        // 404 = the route looked the value up as an id — the coercion is back
        return okAnswer(r) && r.status !== 404 || `${r.status} ${r.text.slice(0, 60)}`;
      });
  c.phase("none of the refusals above changed French House's restaurant row or its settings", "count French House's admin change lines of exactly the kinds these doors write, since the run began",
    async () => {
      const n = await c.count("staff_actions", `panel=eq.admin&restaurant_id=eq.${c.FH}&created_at=gte.${c.T0}&action=in.(restaurant_branding,quick_feature,access_change,restaurant_settings,table_qr_regen,user_reset_password,restaurant_set_owner,restaurant_suspend,restaurant_reactivate,repair_unstick_table)`);
      return n === 0 || `${n} change line(s) written`;
    });

  c.sec("N · an id or action is read only when it IS text (item 29) — read, in every file");
  for (const rel of c.FILED) c.phase(`${rel.replace("app/api/admin/", "").replace("/route.ts", "")} — no id or action turned into text with String(…)`,
    "grep String(body.<id|action|op> …) — textOf() is the only reader", () => {
      if (c.isGone(rel)) return c.GONE;
      const hits = c.clean(rel).match(/String\(body\??\.(?:[a-z_]*_id|id|action|op|feature)\b[^)]*\)/g) || [];
      return hits.length === 0 || hits.slice(0, 3).join(" | ");
    });
  c.phase("an owner change that leaves the owner OUT is refused, not read as \"clear the owner\" (item 30)",
    `PATCH restaurants { restaurant_id: ${NOBODY} } with no owner_user_id — a restaurant that does not exist, so nothing can change`,
    async () => {
      const r = await send("PATCH", "/api/admin/restaurants", JSON.stringify({ restaurant_id: NOBODY }));
      return r.status === 400 && /nothing was changed/.test(r.json?.error || "") || `${r.status} ${r.text.slice(0, 70)}`;
    });
}
