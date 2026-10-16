// Round 4 · A — THE FOUR GUEST DOORS THROUGH THE REAL SERVER (Next's whole request path, not a function call).
//
// Round 3 handed bodies straight to each route's POST() in memory. This sends real HTTP to the production
// build on :4406 — methods, content types, sizes, encodings and headers the in-memory test could never
// produce — and reads what a phone would read back. Every request here is one the door REFUSES before it
// writes anything: a restaurant id that names nothing (a dead uuid), a broken body, or a dish quantity the
// door turns away. Nothing is written to any restaurant.
import { check } from "./h4.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./h4.mjs";

export const BASE = process.env.T4_BASE || "http://localhost:4406";
const DEAD = "00000000-0000-4000-8000-00000000dead";
const DOORS = ["place-order", "call-waiter", "leave", "limit-hit"];
const STACK = /\bat (?:Object\.|async |new |Module\.)|node_modules|\/Users\/|webpack-internal|TypeError:|ReferenceError:|SyntaxError: Unexpected|\.tsx?:\d+/;
async function hit(door, { method = "POST", body, type = "application/json", headers = {}, raw = false } = {}) {
  const t0 = Date.now();
  const h = { ...(type ? { "content-type": type } : {}), "x-forwarded-for": "10.44.0.4", ...headers };
  const r = await fetch(`${BASE}/api/guest/${door}`, { method, headers: h, body: method === "GET" || method === "HEAD" ? undefined : raw ? body : JSON.stringify(body) });
  const text = method === "HEAD" ? "" : await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, text, json, ms: Date.now() - t0, ct: r.headers.get("content-type") || "" };
}
const refusing = (door) => door === "place-order" ? { mode: "public", restaurantId: DEAD, table: "5", items: [{ id: "r4-x", qty: 1 }] }
  : door === "call-waiter" ? { mode: "public", restaurantId: DEAD, table: "5", reason: "Water" }
  : door === "leave" ? { token: "r4-not-a-token", restaurantId: DEAD } : { fn: "lfh_place_order_public", rid: DEAD };
const fine = (r) => r.status < 500 && !STACK.test(r.text);

check("R4-A01", "A", "every guest door answers a wrong METHOD (GET, PUT, PATCH, DELETE, HEAD, OPTIONS) without a server error or a code trace", async () => {
  const bad = []; let n = 0;
  for (const d of DOORS) for (const m of ["GET", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]) { n++; const r = await hit(d, { method: m, body: {} }); if (!fine(r)) bad.push(`${m} ${d} → ${r.status} ${r.text.slice(0, 60)}`); }
  return { ok: !bad.length, note: bad.slice(0, 3).join(" · ") || `${n} requests, none a server error` };
});
check("R4-A02", "A", "every door answers a body that is not JSON — form data, plain text, XML, multipart, no type at all, UTF-16 — as a bad request, never a server error", async () => {
  const bodies = [["application/x-www-form-urlencoded", "mode=public&table=5"], ["text/plain", "hello"], ["application/xml", "<a/>"], ["multipart/form-data; boundary=x", "--x\r\nContent-Disposition: form-data; name=\"a\"\r\n\r\n1\r\n--x--"], ["", "{}"], ["application/json; charset=utf-16", "ÿþ{\u0000}\u0000"], ["application/json", ""]];
  const bad = []; let n = 0;
  for (const d of DOORS) for (const [type, b] of bodies) { n++; const r = await hit(d, { type, body: b, raw: true }); if (!fine(r) || (d !== "limit-hit" && r.status === 200 && r.json?.ok === true)) bad.push(`${d} ${type || "(none)"} → ${r.status} ${r.text.slice(0, 50)}`); }
  return { ok: !bad.length, note: bad.slice(0, 3).join(" · ") || `${n} non-JSON bodies, each turned away` };
});
check("R4-A03", "A", "a huge body (1 MB, 8 MB) or one nested 100,000 levels deep is turned away in seconds, and the server still answers the next diner", async () => {
  const deep = "[".repeat(100000) + "]".repeat(100000);
  const big1 = JSON.stringify({ mode: "public", restaurantId: DEAD, table: "5", items: Array.from({ length: 9000 }, () => ({ id: "x".repeat(100) })) });
  const big8 = JSON.stringify({ pad: "x".repeat(8 * 1024 * 1024) });
  const bad = []; let worst = 0;
  for (const d of ["place-order", "call-waiter"]) for (const [k, b] of [["1 MB", big1], ["8 MB", big8], ["deep", deep]]) {
    const r = await hit(d, { body: b, raw: true }); worst = Math.max(worst, r.ms);
    if (!fine(r) || r.ms > 10000) bad.push(`${d} ${k} → ${r.status} in ${r.ms} ms`);
  }
  const after = await hit("call-waiter", { body: refusing("call-waiter") });
  if (!fine(after)) bad.push(`the next request got ${after.status}`);
  return { ok: !bad.length, note: bad.join(" · ") || `6 oversized bodies refused, slowest ${worst} ms; the server answered the next one (${after.status})` };
});
check("R4-A04", "A", "odd JSON — a byte-order mark, a key twice, 1e400, a broken surrogate, a NUL, a top-level list — never a server error", async () => {
  const odd = ["﻿" + JSON.stringify(refusing("call-waiter")), `{"mode":"public","mode":"session","restaurantId":"${DEAD}","table":"5"}`, `{"mode":"public","restaurantId":"${DEAD}","table":1e400}`, `{"mode":"public","restaurantId":"${DEAD}","table":"\\ud800"}`, `{"mode":"public","restaurantId":"${DEAD}","table":"5\\u0000"}`, `[1,2,3]`, `"x"`, `null`, `{"__proto__":{"ok":true},"mode":"public"}`];
  const bad = []; let n = 0;
  for (const d of DOORS) for (const b of odd) { n++; const r = await hit(d, { body: b, raw: true }); if (!fine(r)) bad.push(`${d} ${b.slice(0, 30)} → ${r.status} ${r.text.slice(0, 50)}`); }
  return { ok: !bad.length, note: bad.slice(0, 3).join(" · ") || `${n} odd bodies, every one answered` };
});
check("R4-A05", "A", "every answer a door gives is JSON with a reason the phone has words for, and its content type says JSON", async () => {
  const KNOWN = new Set(["bad_body", "invalid_token", "unknown_restaurant", "order_too_big", "allergies_too_long", "off_plan_table", "unknown_table", "call_too_old", "server_busy", "empty", "already_gone", "rate_limited", "clash", "sold_out", "already_sent", "capped", "blocked", "no_table", "unknown_item", "empty_order", "hidden_item", "staff_priced_item", "price_required", "not_found", "session_closed"]);
  const bad = []; let n = 0;
  for (const d of ["place-order", "call-waiter", "leave"]) for (const b of [refusing(d), {}, { mode: "public" }, { mode: "session" }, { mode: "session", token: "" }, { restaurantId: DEAD }]) {
    n++; const r = await hit(d, { body: b });
    if (!/application\/json/.test(r.ct) || !r.json || (r.json.ok !== true && !KNOWN.has(String(r.json.reason)))) bad.push(`${d} ${JSON.stringify(b).slice(0, 40)} → ${r.status} ${r.ct} ${r.text.slice(0, 60)}`);
  }
  return { ok: !bad.length, note: bad.slice(0, 3).join(" · ") || `${n} answers, each JSON with a known reason` };
});
check("R4-A06", "A", "item 44 through the real server: a dish quantity of 1.5, \"2.0\", \"1e3\" or 3,000,000,000 is a bad request (400) — not 'busy' (502), which made the phone keep re-sending it", async () => {
  const bad = [];
  for (const q of [1.5, "2.0", "1e3", 3000000000, "٣", "1,000"]) {
    const r = await hit("place-order", { body: { mode: "public", restaurantId: DEAD, table: "5", items: [{ id: "r4-x", qty: q }] } });
    if (r.status !== 400 || r.json?.reason !== "bad_body") bad.push(`qty ${JSON.stringify(q)} → ${r.status} ${r.json?.reason}`);
  }
  for (const q of [1, 2, "3", 99, null, undefined]) {   // …while every quantity the database can read still reaches it
    const r = await hit("place-order", { body: { mode: "public", restaurantId: DEAD, table: "5", items: [q === undefined ? { id: "r4-x" } : { id: "r4-x", qty: q }] } });
    if (r.json?.reason === "bad_body") bad.push(`qty ${JSON.stringify(q)} was refused`);
  }
  return { ok: !bad.length, note: bad.join(" · ") || "6 unreadable quantities refused as bad requests; 6 readable ones went on to the restaurant check" };
});
check("R4-A07", "A", "item 43 through the real server: a table typed in Arabic, Devanagari, Gujarati or full-width digits reaches the restaurant check as that table — not 'invalid'", async () => {
  const bad = [];
  for (const t of ["٤", "४", "૪", "４", "٤٢"]) {
    const r = await hit("call-waiter", { body: { mode: "public", restaurantId: DEAD, table: t, reason: "Water" } });
    // a dead restaurant: the table was READ (no unknown_table), and the database answered for the restaurant
    if (r.json?.reason === "unknown_table" || r.status >= 500) bad.push(`${t} → ${r.status} ${r.json?.reason}`);
  }
  return { ok: !bad.length, note: bad.join(" · ") || "5 tables in other scripts' digits read as tables" };
});
check("R4-A08", "A", "the same request sent twice with one action id gets the same answer twice (the saved-work queue re-sends with the same id)", async () => {
  const bad = [];
  for (const d of ["place-order", "call-waiter", "leave"]) {
    const id = crypto.randomUUID();
    const a = await hit(d, { body: refusing(d), headers: { "X-LFH-Action-Id": id } }), b = await hit(d, { body: refusing(d), headers: { "X-LFH-Action-Id": id } });
    // a stored completion is echoed with `duplicate: true` (lib/idempotency.ts — the queue reads it); the
    // answer itself must be the same
    const same = (j) => { const { duplicate, ...rest } = j || {}; void duplicate; return JSON.stringify(rest); };
    if (a.status !== b.status || same(a.json) !== same(b.json)) bad.push(`${d}: ${a.status} ${a.text.slice(0, 40)} then ${b.status} ${b.text.slice(0, 40)}`);
  }
  return { ok: !bad.length, note: bad.join(" · ") || "3 doors, each answered the repeat exactly as the first" };
});
check("R4-A09", "A", "a refused request is answered fast: 40 in a row, the slowest under 3 s, none a server error", async () => {
  const times = []; const bad = [];
  for (let i = 0; i < 40; i++) { const d = DOORS[i % 3]; const r = await hit(d, { body: refusing(d) }); times.push(r.ms); if (!fine(r)) bad.push(`${d} ${r.status}`); }
  times.sort((a, b) => a - b);
  return { ok: !bad.length && times.at(-1) < 3000, note: `median ${times[20]} ms, slowest ${times.at(-1)} ms${bad.length ? " · " + bad.join(", ") : ""}` };
});
check("R4-A10", "A", "the three guest menu addresses load (200), and neither the page nor any script it downloads holds a private server key — only the public one", async () => {
  const env = Object.fromEntries(readFileSync(join(ROOT, ".env.local"), "utf8").split("\n").map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"\n]*)"?\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  const PRIVATE = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ACCESS_TOKEN", "ADMIN_PASSWORD", "VERCEL_TOKEN", "CREDENTIAL_VAULT_KEY"].map((k) => [k, env[k]]).filter(([, v]) => v && v.length > 8);
  const qr = await fetch(`${BASE}/r/french-house/menu`).then((r) => r.status);
  const urls = new Set(); const bad = []; const pages = ["/menu", "/r/french-house/menu", "/r/french-house/item/espresso?cat=coffee"];
  for (const p of pages) { const r = await fetch(BASE + p); const h = await r.text(); if (r.status !== 200) bad.push(`${p} → ${r.status}`); for (const [k, v] of PRIVATE) if (h.includes(v)) bad.push(`${p} holds ${k}`); for (const m of h.matchAll(/\/_next\/static\/[^"' )]+\.js/g)) urls.add(m[0]); }
  for (const u of urls) { const t = await fetch(BASE + u).then((r) => r.text()); for (const [k, v] of PRIVATE) if (t.includes(v)) bad.push(`${u.split("/").pop()} holds ${k}`); if (/sbp_[a-f0-9]{20,}/.test(t)) bad.push(`${u.split("/").pop()} holds an access token`); }
  return { ok: !bad.length && qr === 200, note: bad.slice(0, 3).join(" · ") || `${pages.length} pages and ${urls.size} scripts read: no private key in any (checked ${PRIVATE.length} kinds)` };
});
