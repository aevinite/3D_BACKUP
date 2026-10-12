// Bank G · app/api/owner/printing/route.ts — the owner's printing card. Read, then DRIVEN as the two
// diag owners (one restaurant · two restaurants), each signed in once. Nothing is printed: French
// House has no paper routed to a computer, so every Test is answered with its honest refusal.
import { chk, skip, assert, eq, src, codeOnly } from "./lib.mjs";
import { sb as service, BASE, cookieFor } from "./env.mjs";

const F = "app/api/owner/printing/route.ts";
const R = "read today's code (comments stripped)";
const D = `driven on ${BASE} as a signed-in diag owner`;
const code = codeOnly(src(F));
const db = await service();

await chk("P184363", F, "both handlers run the owner gate first and return its answer untouched", R, () => {
  for (const v of ["export async function GET", "export async function POST"]) { const b = code.slice(code.indexOf(v)); assert(/^[^]*?const g = await ownerScopeOr503\(req\);\s*if \(g\.resp\) return g\.resp;/.test(b.slice(0, 200)), v); }
});
await chk("P184364", F, "GET answers for a restaurant in the caller's scope — a rid that is not theirs is never used", R, () => assert(/let target = rid && isRestaurantId\(rid\) && \(scope\.all \|\| ids\.includes\(rid\)\) \? rid : ""/.test(code)));
await chk("P184365", F, "…and it SAYS which restaurant it answered for (restaurantId), so a list can never borrow it", R, () => assert(/restaurantId: target/.test(code)));
await chk("P184366", F, "POST refuses a named restaurant that is not in scope, instead of printing at the first one (item 3)", R, () => {
  const post = code.slice(code.indexOf("export async function POST")); assert(/const target = rid\s*\?\s*\(isRestaurantId\(rid\) && \(scope\.all \|\| ids\.includes\(rid\)\) \? rid : ""\)\s*:\s*ids\[0\];/.test(post));
});
await chk("P184367", F, "POST changes nothing but a queued sample: no route, no switch, no settings write", R, () => {
  const post = code.slice(code.indexOf("export async function POST")); assert(!/\.update\(|\.upsert\(|\.delete\(|writeRoutes|syncKotSwitch/.test(post));
});
await chk("P184368", F, "a sample is only queued where printing is ALLOWED, a computer owns that paper, and the queue is running", R, () => {
  const post = code.slice(code.indexOf("export async function POST"));
  const at = (s) => post.indexOf(s); assert(at("auto_print_kot_allowed !== true") < at("queueJob(") && at("own.owned") < at("queueJob(") && at("runO.on") < at("queueJob("));
});
await chk("P184369", F, "…and every sample the owner prints is written to the activity log, with who pressed it", R, () => assert(/logAction\(ownerLogPanel\(scope\), "print_test"/.test(code) && /actor: ownerActorName\(scope\)/.test(code)));
await chk("P184370", F, "the computers it lists carry only name, state and printers — never a token, fingerprint or device id", R, () => {
  const blk = code.slice(code.indexOf("computers: agents.map"), code.indexOf("routes: PRINT_KINDS")); assert(!/token|fingerprint|owner_device|owner_user|id:/.test(blk), blk);
});
await chk("P184371", F, "every list read has a ceiling (the estate read is capped at 12 restaurants)", R, () => {
  const sel = [...code.matchAll(/\.from\("settings"\)[^;]*?;/gs)].map((m) => m[0]); assert(sel.length >= 3 && sel.every((s) => /\.limit\(|\.maybeSingle\(/.test(s)), sel.join(" | "));
});
await chk("P184372", F, "a failed switches read is a 503 'try again', never a confident 'printing is off'", R, () => assert(/if \(sq\.error\) \{[\s\S]{0,400}?status: 503/.test(code)));
await chk("P184373", F, "an unknown kind of paper is refused with a sentence, before anything is read", R, () => {
  const post = code.slice(code.indexOf("export async function POST")); assert(post.indexOf("isRoutableKind(kind)") < post.indexOf('from("settings")'));
});

const up = await fetch(BASE + "/print-setup.html").then((r) => r.ok).catch(() => false);
if (!up) { for (let n = 374; n <= 392; n++) skip(`P184${n}`, F, "driven row", D, `needs the app on ${BASE}`); }
else {
  const one = await cookieFor("owner"), two = await cookieFor("ownerMulti");
  const get = (ck, q = "") => fetch(`${BASE}/api/owner/printing${q}`, { headers: { cookie: ck } }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => null) }));
  const post = (ck, body) => fetch(`${BASE}/api/owner/printing`, { method: "POST", headers: { cookie: ck, "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => null) }));
  const g1 = await get(one);
  // Which restaurants each diag owner may see, read the way lib/panelAccess does (restaurant_owners,
  // mig 097) — the comparison these rows need, looked up rather than assumed.
  const ownedBy = async (username) => {
    const u = (await db.from("staff_users").select("id").eq("username", username).maybeSingle()).data;
    const links = (await db.from("restaurant_owners").select("restaurant_id").eq("user_id", u.id).limit(200)).data || [];
    return links.map((x) => ({ id: x.restaurant_id }));
  };
  const mine = async (ck) => ownedBy(ck === one ? "diago1" : "diagmulti");
  await chk("P184374", F, "the one-restaurant owner gets an answer, not an error", D, () => { eq(g1.status, 200); assert(typeof g1.j.allowed === "boolean", JSON.stringify(g1.j).slice(0, 200)); });
  await chk("P184375", F, "…when printing is allowed it names the restaurant it answered for", D, () => { if (!g1.j.allowed) return "printing is not allowed for this owner's restaurant — the short answer is correct"; assert(/^[0-9a-f-]{36}$/.test(g1.j.restaurantId)); });
  await chk("P184376", F, "…every computer row carries only name / connected / secondsAgo / printers", D, () => {
    for (const c of g1.j.computers || []) eq(Object.keys(c).sort(), ["connected", "name", "printers", "secondsAgo"]);
    return `${(g1.j.computers || []).length} computer(s) listed`;
  });
  await chk("P184377", F, "…no token, hash, fingerprint or device id anywhere in the answer", D, () => { const s = JSON.stringify(g1.j); assert(!/token|lfhp_|fingerprint|owner_device|token_hash/.test(s)); });
  await chk("P184378", F, "…every printer has a state word the screen knows (unknown when an old helper said nothing)", D, () => {
    const words = Object.keys(g1.j.printerStates || {}); for (const c of g1.j.computers || []) for (const p of c.printers) assert(words.includes(p.state), p.state);
  });
  await chk("P184379", F, "…the live rows are the same three-line shape the admin board uses", D, () => {
    for (const r of g1.j.live || []) for (const k of ["kind", "label", "ok", "via", "state", "words", "canTest"]) assert(k in r, k);
    return (g1.j.live || []).map((r) => `${r.kind}:${r.state}`).join(" · ");
  });
  await chk("P184380", F, "…no live row says LIVE for a paper that is not on a computer", D, () => { for (const r of g1.j.live || []) if (r.state === "LIVE") eq(r.via, "computer"); });
  await chk("P184381", F, "…every restaurant in perRestaurant is one this owner may see", D, async () => {
    const ids = Object.keys(g1.j.perRestaurant || {}); const r = await mine(one); const allowed = new Set(((r && (r.restaurants || r)) || []).map((x) => x.id));
    if (!allowed.size) return `owner restaurant list unavailable to compare; ${ids.length} key(s)`; assert(ids.every((i) => allowed.has(i)), ids.join(","));
  });
  await chk("P184382", F, "…and the restaurant it answered for is one of them", D, async () => {
    if (!g1.j.allowed) return "not allowed — nothing named"; const r = await mine(one); const allowed = new Set(((r && (r.restaurants || r)) || []).map((x) => x.id));
    if (!allowed.size) return "owner restaurant list unavailable to compare"; assert(allowed.has(g1.j.restaurantId));
  });
  await chk("P184383", F, "the two-restaurant owner gets an answer too", D, async () => { const g = await get(two); eq(g.status, 200); });
  await chk("P184384", F, "…asking with ?rid= for EACH of their own restaurants answers for exactly that one", D, async () => {
    const r = await mine(two); const ids = ((r && (r.restaurants || r)) || []).map((x) => x.id).slice(0, 4); if (!ids.length) return "owner restaurant list unavailable";
    for (const id of ids) { const g = await get(two, `?rid=${id}`); if (g.j.allowed) eq(g.j.restaurantId, id); } return `${ids.length} restaurant(s) asked`;
  });
  await chk("P184385", F, "…a rid that is not a restaurant id at all falls back to their default, never a crash", D, async () => { const g = await get(two, "?rid=not-a-uuid"); eq(g.status, 200); });
  await chk("P184386", F, "a Test for a kind of paper that does not exist is a 400 with a sentence", D, async () => { const p = await post(one, { sample: "menu" }); eq([p.status, p.j.error], [400, "There is no such kind of paper."]); });
  await chk("P184387", F, "a Test with no kind at all is the same 400", D, async () => { eq((await post(one, {})).status, 400); });
  await chk("P184388", F, "a Test of a paper no computer owns is refused, saying what to do — and nothing is queued", D, async () => {
    const before = (await db.from("print_jobs").select("id", { count: "exact", head: true }).eq("requested_by", "sample · owner")).count;
    const p = await post(one, { sample: "bill", rid: g1.j.restaurantId }); if (!g1.j.allowed) { eq(p.status, 403); return "printing not allowed: 403"; }
    const bill = (g1.j.live || []).find((r) => r.kind === "bill"); if (bill?.via === "computer") return "SKIPPED the assertion: a computer owns bills here, so a Test would really print";
    eq(p.status, 409); assert(/choose a printer for it first/.test(p.j.error), p.j.error);
    eq((await db.from("print_jobs").select("id", { count: "exact", head: true }).eq("requested_by", "sample · owner")).count, before);
  });
  await chk("P184389", F, "…the kitchen-slip Test gives the same honest refusal", D, async () => {
    const k = (g1.j.live || []).find((r) => r.kind === "kot"); if (!g1.j.allowed || k?.via === "computer") return "not applicable on today's data";
    eq((await post(one, { sample: "kot", rid: g1.j.restaurantId })).status, 409);
  });
  await chk("P184390", F, "…a Test that names no restaurant goes to the owner's default and is answered the same way", D, async () => {
    if (!g1.j.allowed) return "not allowed"; const b = (g1.j.live || []).find((r) => r.kind === "bill"); if (b?.via === "computer") return "not applicable on today's data";
    assert([403, 409].includes((await post(one, { sample: "bill" })).status));
  });
  await chk("P184391", F, "a broken JSON body is answered with a 400 sentence, never a 500", D, async () => {
    const r = await fetch(`${BASE}/api/owner/printing`, { method: "POST", headers: { cookie: one, "content-type": "application/json" }, body: "{oops" }); eq(r.status, 400);
  });
  await chk("P184392", F, "the GET is cheap enough for a 15-second card: one answer under 3 seconds on a warm dev server", D, async () => {
    const t = Date.now(); await get(one); const ms = Date.now() - t; assert(ms < 3000, `${ms}ms`); return `${ms} ms`;
  });
}
