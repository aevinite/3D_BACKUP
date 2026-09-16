// BLOCK G · app/api/owner/settings/route.ts — 35 phases, P160836–P160870.
// 345 lines, 23 ledger rows, 4 driven. It holds the owner's own account, the feature switches the
// admin has handed them, and the one place an owner changes their own password.
import { FH, PP, GHOST, GET, POST, PATCH, sb, owns, undo, block, of_, code, read } from "./harness.mjs";
const S = of_("app/api/owner/settings/route.ts");
export const G = block(160836, "G · the owner's own Settings page");
const { row } = G;
const fx = {};

row(S("it answers the owner's name, their sections, their restaurants and the printing rows"), "GET as diago1", async (c) => {
  const r = await GET(c.O, "/api/owner/settings");
  if (r.status !== 200) return `${r.status} ${r.j?.error}`;
  fx.page = r.j;
  return !!(r.j.name && r.j.sections && Array.isArray(r.j.restaurants) && Array.isArray(r.j.printing) && "printingOk" in r.j)
    || `keys=${Object.keys(r.j).join(",")}`;
});
row(S("…and the name is a PERSON, never a uuid and never blank"), "read name", async (c) => {
  const r = await GET(c.O, "/api/owner/settings");
  return !!(typeof r.j.name === "string" && r.j.name.length > 0 && !/^[0-9a-f]{8}-[0-9a-f]{4}-/.test(r.j.name)) || `name=${JSON.stringify(r.j.name)}`;
});
row(S("…and it says whether this caller is us, so the page can tint what the admin has withheld"), "read isAdmin at both callers", async (c) => {
  const o = await GET(c.O, "/api/owner/settings");
  const a = await GET(c.A, `/api/owner/settings?scope=${FH}`);
  return !!(o.j.isAdmin === false && a.j.isAdmin === true) || `owner=${o.j.isAdmin} admin=${a.j.isAdmin}`;
});
row(S("…and whether this caller may change a password at all"), "read canChangePassword at both callers", async (c) => {
  const o = await GET(c.O, "/api/owner/settings");
  const a = await GET(c.A, `/api/owner/settings?scope=${FH}`);
  return !!(o.j.canChangePassword === true && a.j.canChangePassword === false)
    || `owner=${o.j.canChangePassword} admin=${a.j.canChangePassword} — the admin act-as has no password row here`;
});
row(S("every section the page can hide is answered as a real true/false"), "read sections", async (c) => {
  const r = await GET(c.O, "/api/owner/settings");
  const bad = Object.entries(r.j.sections || {}).filter(([, v]) => typeof v !== "boolean");
  return bad.length === 0 || `${bad.length} section(s) answered as something other than true/false`;
});
row(S("the ADMIN's own view has every section on — admin is top power"), "read sections as the admin all-view", async (c) => {
  const r = await GET(c.A, "/api/owner/settings?scope=all");
  const off = Object.entries(r.j.sections || {}).filter(([, v]) => v !== true);
  return off.length === 0 || `${off.length} section(s) off in the admin's own view`;
});
row(S("…and the admin's own view lists every restaurant, not an empty page"), "GET ?scope=all as the admin", async (c) => {
  const r = await GET(c.A, "/api/owner/settings?scope=all");
  return !!(r.status === 200 && (r.j.restaurants || []).length > 2) || `${r.status} n=${r.j?.restaurants?.length}`;
});
row(S("a one-restaurant owner's page lists exactly theirs"), "read restaurants as diago1", async (c) => {
  const r = await GET(c.O, "/api/owner/settings");
  const ids = (r.j.restaurants || []).map((x) => x.id);
  return !!(ids.length >= 1 && ids.every((x) => x === FH)) || JSON.stringify(ids);
});
row(S("a two-restaurant owner's page lists both"), "read restaurants as diagmulti", async (c) => {
  const r = await GET(c.M, "/api/owner/settings");
  const ids = new Set((r.j.restaurants || []).map((x) => x.id));
  return !!(ids.has(FH) && ids.has(PP)) || JSON.stringify([...ids]);
});
row(S("…and every restaurant on it has a name, never a dash"), "read restaurants[].name", async (c) => {
  const r = await GET(c.M, "/api/owner/settings");
  const bad = (r.j.restaurants || []).filter((x) => !x.name || x.name === "—");
  return bad.length === 0 || `${bad.length} nameless restaurant(s)`;
});
row(S("a kitchen login sees no settings page"), "GET as diagkitchen", async (c) => {
  const r = await GET(c.K, "/api/owner/settings");
  return !!(r.status >= 400 && !/"sections"/.test(r.txt)) || `${r.status} ${r.txt.slice(0, 90)}`;
});
row(S("nobody at all sees no settings page"), "GET with no cookie", async (c) => {
  const r = await GET(c.N, "/api/owner/settings");
  return r.status === 401 || `${r.status}`;
});
row(S("only the switches the admin actually HANDED OVER appear as toggles"), "read modules[] against the settings columns", async (c) => {
  const r = await GET(c.O, "/api/owner/settings");
  const mods = r.j.modules || [];
  if (!mods.length) return true;
  const q = await sb.from("settings").select("*").eq("restaurant_id", FH).maybeSingle();
  const d = q.data || {};
  for (const m of mods) {
    if (m.restaurant_id !== FH) continue;
    if (d[`${m.key}_allowed`] !== true) return `${m.key} is offered but ${m.key}_allowed is ${d[`${m.key}_allowed`]}`;
    if (d[`${m.key}_owner_control`] !== true) return `${m.key} is offered but the admin has not handed over its switch`;
  }
  return true;
});
row(S("…and each one says which restaurant it belongs to, and what it is called"), "read modules[]", async (c) => {
  const r = await GET(c.O, "/api/owner/settings");
  const bad = (r.j.modules || []).filter((m) => !m.restaurant_id || !m.key || !m.label || typeof m.enabled !== "boolean");
  return bad.length === 0 || `${bad.length} malformed module row(s)`;
});
row(S("flipping a handed-over switch really changes it, and it is restored"), "PATCH the switch to its opposite and back", async (c) => {
  const r0 = await GET(c.O, "/api/owner/settings");
  const m = (r0.j.modules || []).find((x) => x.restaurant_id === FH);
  if (!m) return "SKIP: no switch has been handed to this owner";
  fx.mod = m;
  const before = m.enabled;
  undo(async () => {
    await PATCH(c.O, "/api/owner/settings", { restaurant_id: FH, key: m.key, enabled: before });
    const back = (await GET(c.O, "/api/owner/settings")).j.modules?.find((x) => x.key === m.key && x.restaurant_id === FH);
    if (back && back.enabled !== before) throw new Error(`${m.key} is ${back.enabled}, not the ${before} it started as`);
  }, `French House's ${m.key} switch`);
  const r = await PATCH(c.O, "/api/owner/settings", { restaurant_id: FH, key: m.key, enabled: !before });
  const now = (await GET(c.O, "/api/owner/settings")).j.modules?.find((x) => x.key === m.key && x.restaurant_id === FH);
  return !!(r.status === 200 && now && now.enabled === !before) || `${r.status} ${before} → ${now?.enabled}`;
});
row(S("…and it records WHO flipped it, by name"), "read the log row that flip wrote", async (c) => {
  if (!fx.mod) return "SKIP: no switch to flip";
  const before = new Date().toISOString();
  await PATCH(c.O, "/api/owner/settings", { restaurant_id: FH, key: fx.mod.key, enabled: fx.mod.enabled });
  let a = null;
  for (let i = 0; i < 8 && !a; i++) {
    const q = await sb.from("staff_actions").select("id, panel, actor, actor_id, detail").eq("action", "module_toggle").gte("created_at", before).limit(1);
    a = (q.data || [])[0] || null; if (!a) await new Promise((x) => setTimeout(x, 350));
  }
  if (a) owns("staff_actions", a.id);
  if (!a) return "the switch flipped and the Activity log says nothing";
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(String(a.actor || ""));
  return !!(a.panel === "owner" && a.actor && !isUuid) || `panel=${a.panel} actor=${a.actor}`;
});
row(S("…and that line carries the person's id too, so their own Activity tab can find it"), "read actor_id", async (c) => {
  const q = await sb.from("staff_actions").select("actor_id, actor").eq("action", "module_toggle")
    .gte("created_at", new Date(Date.now() - 10 * 60_000).toISOString()).eq("panel", "owner").limit(3);
  const rows = q.data || [];
  if (!rows.length) return "SKIP: no owner module_toggle rows from this run";
  return rows.every((x) => !!x.actor_id) || `${rows.filter((x) => !x.actor_id).length} row(s) with no actor_id`;
});
row(S("a switch the admin has NOT handed over cannot be flipped"), "PATCH a module that is not in the list", async (c) => {
  const r0 = await GET(c.O, "/api/owner/settings");
  const offered = new Set((r0.j.modules || []).map((x) => x.key));
  // The candidate must be a REAL module key, or the route rightly answers 400 "not a module" and this
  // check would be asserting the wrong refusal. MODULE_DEFS is derived from lib/accessModel, so the
  // honest way to pick one is to read it — and which modules are offered changes as other terminals
  // flip switches, which is how this first failed: it picked a name that is not a module at all.
  const defs = code(read("lib/accessModel.ts"));
  const real = [...defs.matchAll(/(\w+)_allowed/g)].map((m) => m[1]);
  const notOffered = [...new Set(real)].find((k) => !offered.has(k));
  if (!notOffered) return "SKIP: every module this restaurant has is already handed over";
  const r = await PATCH(c.O, "/api/owner/settings", { restaurant_id: FH, key: notOffered, enabled: true });
  // 403 for a module the admin has not handed over; 400 if the key is not a laddered module at all.
  // Both are correct refusals and neither flips anything — what would be wrong is a 200.
  if (r.status === 200) return `it flipped ${notOffered}, which the admin has not handed over`;
  return !!(r.status === 403 || r.status === 400) || `${r.status} ${r.j?.error}`;
});
row(S("…nor a key that is not a module at all"), "PATCH {key:'make_me_admin'}", async (c) => {
  const r = await PATCH(c.O, "/api/owner/settings", { restaurant_id: FH, key: "make_me_admin", enabled: true });
  return r.status === 400 || `${r.status} ${r.j?.error}`;
});
row(S("…nor on a restaurant that is not yours"), "PATCH on Pizza Palace as diago1", async (c) => {
  const r = await PATCH(c.O, "/api/owner/settings", { restaurant_id: PP, key: "table_tags", enabled: false });
  return !!(r.status === 403 && /isn't yours/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…nor on one that does not exist"), "PATCH with a well-formed id nothing owns", async (c) => {
  const r = await PATCH(c.O, "/api/owner/settings", { restaurant_id: GHOST, key: "table_tags", enabled: false });
  return r.status >= 400 || `${r.status}`;
});
row(S("`enabled` must be a real boolean"), "PATCH with the string 'true' and with 1", async (c) => {
  for (const v of ["true", 1, null]) {
    const r = await PATCH(c.O, "/api/owner/settings", { restaurant_id: FH, key: "table_tags", enabled: v });
    if (r.status !== 400) return `enabled=${JSON.stringify(v)} answered ${r.status}`;
  }
  return true;
});
row(S("a PATCH with nothing in it is refused, naming what it needs"), "PATCH {}", async (c) => {
  const r = await PATCH(c.O, "/api/owner/settings", {});
  return !!(r.status === 400 && /required/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("the printing rows appear only for a restaurant that HAS printing on — nothing hints at a withheld feature"), "read printing[] against the switches", async (c) => {
  const r = await GET(c.O, "/api/owner/settings");
  for (const p of (r.j.printing || [])) {
    const q = await sb.from("settings").select("auto_print_kot, auto_print_kot_allowed").eq("restaurant_id", p.restaurant_id).maybeSingle();
    if (q.data?.auto_print_kot !== true || q.data?.auto_print_kot_allowed !== true) return `a printing row for a restaurant whose switches are ${JSON.stringify(q.data)}`;
  }
  return true;
});
row(S("…and each row says where the paper comes out, in words, not a stored code"), "read printing[].target", async (c) => {
  const r = await GET(c.O, "/api/owner/settings");
  const bad = (r.j.printing || []).filter((p) => !["kitchen", "counter"].includes(p.target));
  return bad.length === 0 || `it answered ${JSON.stringify(bad.map((b) => b.target))}`;
});
row(S("…and says whether the screen that took the job has gone quiet"), "read printing[].stale", async (c) => {
  const r = await GET(c.O, "/api/owner/settings");
  const bad = (r.j.printing || []).filter((p) => typeof p.stale !== "boolean");
  return bad.length === 0 || `${bad.length} row(s) with no stale flag`;
});
row(S("…and `printingOk` tells a shortened list apart from printing being off"), "read printingOk on a healthy page", async (c) => {
  const r = await GET(c.O, "/api/owner/settings");
  return r.j.printingOk === true || `printingOk=${r.j.printingOk} on a healthy read`;
});
row(S("changing a password needs the current one, and a wrong one is refused"), "POST with a wrong current", async (c) => {
  const r = await POST(c.O, "/api/owner/settings", { current: "definitely-not-it", next: "t28r2-temp-pw" });
  return !!((r.status === 403 && /current password is wrong/i.test(r.j?.error || "")) || r.status === 429)
    || `${r.status} ${r.j?.error}`;
});
row(S("…and a new one shorter than six characters is refused before anything is checked"), "POST {next:'12345'}", async (c) => {
  const r = await POST(c.O, "/api/owner/settings", { current: "x", next: "12345" });
  return !!(r.status === 400 && /6 characters/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…and one identical to the current is refused"), "POST with next === current", async (c) => {
  const r = await POST(c.O, "/api/owner/settings", { current: "same-thing-xyz", next: "same-thing-xyz" });
  return !!(r.status === 400 && /different/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…and the ADMIN cannot change an owner's password from here"), "POST as the admin", async (c) => {
  const r = await POST(c.A, `/api/owner/settings?scope=${FH}`, { current: "x", next: "yyyyyy" });
  return !!(r.status === 403 && /signed-in owner/i.test(r.j?.error || "")) || `${r.status} ${r.j?.error}`;
});
row(S("…nor can a kitchen login"), "POST as diagkitchen", async (c) => {
  const r = await POST(c.K, "/api/owner/settings", { current: "x", next: "yyyyyy" });
  return r.status === 403 || `${r.status}`;
});
row(S("…and the attempt is walled, so the box cannot be used to guess the current password"), "read: rateAllowed is asked before the check", async () => {
  const src = code(read("app/api/owner/settings/route.ts"));
  const post = src.slice(src.indexOf("export async function POST"));
  const iWall = post.indexOf("rateAllowed(");
  const iCheck = post.indexOf("verifySecret(");
  return !!(iWall > -1 && iCheck > iWall) || `the wall is at ${iWall} and the check at ${iCheck} — the wall must come first`;
});
row(S("the page never hands the owner a database sentence, at any caller"), "scan four callers' bodies", async (c) => {
  for (const [n, ctx, u] of [["owner", c.O, "/api/owner/settings"], ["multi", c.M, "/api/owner/settings"],
    ["admin all", c.A, "/api/owner/settings?scope=all"], ["admin pinned", c.A, `/api/owner/settings?scope=${FH}`]]) {
    const r = await GET(ctx, u);
    if (/PGRST|invalid input syntax|relation "|\[object Object\]/i.test(r.txt)) return `${n}: ${r.txt.slice(0, 110)}`;
  }
  return true;
});
row(S("is this how a real restaurant needs it? a switch the owner turns off stays off when they come back"), "flip, re-read on a fresh page load, restore", async (c) => {
  const r0 = await GET(c.O, "/api/owner/settings");
  const m = (r0.j.modules || []).find((x) => x.restaurant_id === FH);
  if (!m) return "SKIP: no switch handed over";
  const before = m.enabled;
  undo(async () => { await PATCH(c.O, "/api/owner/settings", { restaurant_id: FH, key: m.key, enabled: before }); }, `${m.key} (second flip)`);
  await PATCH(c.O, "/api/owner/settings", { restaurant_id: FH, key: m.key, enabled: !before });
  const again = await GET(c.O, "/api/owner/settings");
  const now = (again.j.modules || []).find((x) => x.key === m.key && x.restaurant_id === FH);
  await PATCH(c.O, "/api/owner/settings", { restaurant_id: FH, key: m.key, enabled: before });
  return !!(now && now.enabled === !before) || `it came back as ${now?.enabled}, not ${!before}`;
});
