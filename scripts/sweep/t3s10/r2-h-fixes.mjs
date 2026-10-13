// Round 2 · Block H — this round's fixes, EXERCISED in memory (the live half is block N).
import { check, fresh, nextServer, SRC, rd, strip } from "./lib.mjs";
import { G } from "./stubs/state.mjs";

const HOW = "STUB — the real file in memory against the stand-in database";
const FH = "00000000-0000-0000-0000-000000000001", AA = "6c6fadb6-da23-4ab3-9f90-d164773f60b3";
const T = "lib/guestTokenRestaurant.ts";
const seat = () => { G.TABLES.session_members.push({ token: "tok", session_id: "s1" }); G.TABLES.sessions.push({ id: "s1", restaurant_id: AA }); };
async function post(rel, body) {
  const route = fresh(rel); const { NextRequest } = nextServer();
  const r = await route.POST(new NextRequest("http://localhost/api/guest/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), {});
  return { status: r.status, json: await r.json().catch(() => null) };
}
const W = (fn) => async () => { G.reset(); return fn(); };
// ── item 7: the one shared helper ──────────────────────────────────────────────────────────────
// NB: the helper is bundled on its own, as a route would bundle it (same stand-in database).
check("P172551", T, "item 7 — a known table code answers ITS restaurant", HOW, W(async () => { seat(); return (await fresh(T).restaurantOfToken("tok")) === AA; }));
check("P172552", T, "item 7 — an unknown table code answers nothing (\"\"), never a guess", HOW, W(async () => (await fresh(T).restaurantOfToken("nope")) === ""));
check("P172553", T, "item 7 — no code at all answers nothing WITHOUT asking the database", HOW, W(async () => { const r = await fresh(T).restaurantOfToken(undefined); return r === "" && G.READS.length === 0; }));
check("P172554", T, "item 7 — a database that throws answers nothing, never an exception", HOW, W(async () => { seat(); G.THROW_FROM = "session_members"; return (await fresh(T).restaurantOfToken("tok")) === ""; }));
check("P172555", T, "item 7 — a stored restaurant that is not a real id is not handed on", HOW, W(async () => { G.TABLES.session_members.push({ token: "tok", session_id: "s1" }); G.TABLES.sessions.push({ id: "s1", restaurant_id: "french-house" }); return (await fresh(T).restaurantOfToken("tok")) === ""; }));
check("P172556", T, "item 7 — exactly two reads, each one row, each naming its one column", HOW, W(async () => { seat(); await fresh(T).restaurantOfToken("tok"); return G.READS.length === 2 && G.READS.every((r) => r.limit === 1 && /^(session_id|restaurant_id)$/.test(r.cols)); }));
check("P172557", "app/api/guest/leave/route.ts", "item 7 — a saved leave with NO restaurant drops the RIGHT restaurant's floor snapshot (asked from its token)", HOW, W(async () => { seat(); G.RPC.lfh_leave_session = { ok: true }; await post("app/api/guest/leave/route.ts", { token: "tok" }); return { ok: G.FLOOR.join() === AA, note: G.FLOOR.join() || "none" }; }));
check("P172558", "app/api/guest/leave/route.ts", "item 7 — an 'already gone' leave asks the database NOTHING extra and drops nothing", HOW, W(async () => { seat(); G.RPC.lfh_leave_session = { ok: true, already_gone: true }; await post("app/api/guest/leave/route.ts", { token: "tok" }); return G.FLOOR.length === 0 && G.READS.length === 0; }));
check("P172559", "app/api/guest/leave/route.ts", "item 7 — a leave that carries its restaurant makes no extra read", HOW, W(async () => { seat(); G.RPC.lfh_leave_session = { ok: true }; await post("app/api/guest/leave/route.ts", { token: "tok", restaurantId: FH }); return G.FLOOR.join() === FH && G.READS.length === 0; }));
check("P172560", "app/api/guest/call-waiter/route.ts", "item 7 — the seated call still finds its restaurant from the token through the shared helper", HOW, W(async () => { seat(); G.RPC.lfh_call_waiter = { ok: true }; await post("app/api/guest/call-waiter/route.ts", { mode: "session", token: "tok" }); return G.FLOOR.join() === AA; }));
check("P172561", "app/api/guest/place-order/route.ts", "item 7 — the seated order still finds its restaurant from the token through the shared helper", HOW, W(async () => { seat(); G.RPC.lfh_place_order = { ok: true, order_id: "o1" }; await post("app/api/guest/place-order/route.ts", { mode: "session", token: "tok", items: [{ id: "a", qty: 1 }] }); return G.FLOOR.join() === AA; }));
check("P172562", "app/api/guest/place-order/route.ts", "item 7 — no private copy of the helper is left in any guest door", "SRC — the three doors", () =>
  ["place-order", "call-waiter", "leave"].every((d) => !/async function ridFromToken|session_members/.test(strip(rd(`app/api/guest/${d}/route.ts`)))));
// ── item 14 / 20 / 22 spot checks beside the matrix ────────────────────────────────────────────
check("P172563", "app/api/guest/place-order/route.ts", "item 14 — a 200-line order of GOOD items is still walked and placed (the check is not a size wall)", HOW, W(async () => { G.RPC.lfh_place_order_public = { ok: true, order_id: "o1" }; const r = await post("app/api/guest/place-order/route.ts", { mode: "public", restaurantId: FH, table: "4", items: Array.from({ length: 200 }, (_, i) => ({ id: "d" + i, qty: 1 })) }); return r.status === 200; }));
check("P172564", "app/api/guest/place-order/route.ts", "item 14 — 201 BAD items answer order_too_big (the size ceiling runs first, before anything is walked)", HOW, W(async () => { const r = await post("app/api/guest/place-order/route.ts", { mode: "public", restaurantId: FH, table: "4", items: Array.from({ length: 201 }, () => 5) }); return r.json?.reason === "order_too_big"; }));
check("P172565", "lib/guestOutbox.ts", "item 14 — the phone words bad_body for a saved order, a call and a leave", "STUB — reasonMsg", async () => {
  const { phone } = await import("./phone.mjs"); const P = await phone(); try {
    const w = ["order", "call", "leave"].map((k) => P.M.reasonMsg("bad_body", { queued: true, kind: k }));
    return { ok: w.every((s) => s && !/bad_body/.test(s)), note: w.join(" · ") };
  } finally { P.restore(); }
});
// ── item 12 / 13 / 16 / 18 / 21 by reading (their live half is block N) ─────────────────────────
check("P172566", "components/CartPanel.tsx", "item 12 — the bill's line loop carries no unused leftover", "SRC", () => !/const c = conflicts\(item\.id\)/.test(SRC.cart));
check("P172567", "components/CartPanel.tsx", "item 13 — the title lookup keeps the FIRST dish of a shared name, as .find() did", "SRC", () => /if \(!t\.has\(m\.title\)\) t\.set\(m\.title, m\)/.test(SRC.cart));
check("P172568", "components/CartPanel.tsx", "item 13 — both lookups are rebuilt only when the menu itself changes", "SRC", () => (SRC.cart.match(/useMemo\([^\n]*\[menuItems\]\);/g) || []).length === 2);
check("P172569", "components/CartPanel.tsx", "item 11 — a busy database is asked again only on the next nudge or backstop, never sooner", "SRC", () => !/delete dishAsked\.current/.test(SRC.cart) && /never sooner/.test(SRC.cart));
check("P172570", "components/CartPanel.tsx", "item 11 — the dish reads stop entirely when the Live-status cards are hidden", "SRC", () => /if \(!cardsShown\) \{ dishAsked\.current = \{\}; return; \}/.test(SRC.cart) && /if \(!cardsShown\) return;/.test(SRC.cart));
check("P172571", "components/StarRating.tsx", "item 16 — an outside value still settles the stars (first render, a reset)", "SRC", () => /if \(value === visualRatingRef\.current\) return;/.test(SRC.stars) && /settle\(li, shouldBeHappy\)/.test(SRC.stars));
check("P172572", "components/MiniCart.tsx", "item 18 — the pill's clamp is byte-identical to the bill's normalize()", "SRC — components/MiniCart.tsx vs components/CartPanel.tsx", () =>
  SRC.mini.includes("Math.min(99, Math.max(1, Math.floor(typeof q === \"number\" && q > 0 ? q : 1)))") && SRC.cart.includes("Math.min(99, Math.max(1, Math.floor(typeof it.qty === \"number\" && it.qty > 0 ? it.qty : 1)))"));
check("P172573", "components/ChefPopup.tsx", "item 21 — the honest fallback is an ERROR toast, and it does not close the popup", "SRC", () => {
  const b = SRC.chef.slice(SRC.chef.indexOf("ANYTHING ELSE IS NOT"), SRC.chef.indexOf("} catch (err)"));
  return /variant: "error"/.test(b) && !/lfh:close-all/.test(b);
});
check("P172574", "components/ChefPopup.tsx", "item 17 — a busy-saved call promises automatic sending only when the phone really stored it", "SRC", () => /subtitle: q\.persisted \? `\$\{reason\} · it goes through by itself` : `\$\{reason\} · keep this page open`/.test(SRC.chef));
check("P172575", "components/ChefPopup.tsx", "item 17 — saving it on a busy restaurant uses the SAME queue as no signal (one queue, one id rule)", "SRC", () => (SRC.chef.match(/enqueueGuestCall\(\{ mode: "public", table: check\.value, restaurantId, reason \}\)/g) || []).length === 2);
check("P172576", "components/OrderConfirmModal.tsx", "item 6 — the 99 notice is the bill's and the dish card's sentence, byte for byte", "SRC — three files", () => {
  const s = 'message: "Maximum 99 per dish"'; return SRC.confirm.includes(s) && SRC.cart.includes(s) && rd("components/FoodCard.tsx").includes('"Maximum 99 per dish"');
});
check("P172577", "components/OrderConfirmModal.tsx", "item 6 — a plain add (no cap) still says 'added', and an edit still says 'updated'", "SRC", () => /\} else if \(editSig\) \{/.test(SRC.confirm) && /\$\{item\.title\} updated/.test(SRC.confirm) && /\$\{qty\} × \$\{item\.title\} added/.test(SRC.confirm));
check("P172578", "lib/guestOutbox.ts", "item 19 — a session call and a QR call never collapse into each other either", "STUB", async () => {
  const { phone, lists } = await import("./phone.mjs"); const P = await phone({ online: false }); try {
    await P.M.enqueueGuestCall({ mode: "public", table: "4", restaurantId: FH, reason: "Water" });
    await P.M.enqueueGuestCall({ mode: "session", token: "tok", restaurantId: FH, reason: "Water" });
    return lists(P).count === 2;
  } finally { P.restore(); }
});
