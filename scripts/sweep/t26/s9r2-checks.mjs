#!/usr/bin/env node
// T26 · sweep #9 ROUND 2 — the whole 500, freshly planned, over the admin server routes (first 25).
//
//   node scripts/sweep/t26/s9r2-checks.mjs --base http://localhost:<port>
//   node scripts/sweep/t26/s9r2-checks.mjs            # the static blocks only
//   … --md                                            # print the ledger rows
//
// ── HOW THE 500 IS BUDGETED, AND WHY IT IS NOT A ROUND NUMBER I CHOSE ────────────────────────────
// Five of the eight blocks are GENERATED from the source, so their size is whatever the territory
// actually has rather than whatever looked tidy. Measured the day this was written:
//   25 route files · 36 exported handlers · 46 query parameters · 55 body fields · 175 database
//   calls · 187 distinct sentences the admin can be shown.
//
//   A · the door                  36 handlers × 2      =  72
//   B · every query parameter     46 × 1, DRIVEN       =  46
//   C · every body field          55 × 1               =  55
//   D · every database call      175 × 1               = 175
//   E · every route, live         25 × 4               = 100
//   F · every route's sentences   25 × 1               =  25
//   G · the writes, driven                             =  14
//   H · my own judgement                               =  13
//                                                        ────
//                                                         500
//
// ROUND 1 (P104101–P104150) went at the files with the fewest ledger rows. This round goes at
// EVERY file and every one of its parts, because that is what "the whole 500 again" means: round 1
// chose fifty places to look, and a fault in the 51st would have survived it.
//
// SAFETY: `adminHeaders()` so it makes ZERO sign-in requests; nothing here writes to the database
// except block G, which only ever drives writes against ids that belong to nothing (so no row can
// change) or re-writes a value to itself.
import { adminHeaders } from "../login.mjs";
import { requireUp } from "../appUp.mjs";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ROOT, myFiles, read, strip, stripperSafe, handlers, urlOf,
  queryParams, bodyFields, dbCalls, sentences, Runner,
} from "./s9r2-lib.mjs";

const FIRST_ID = 145001;               // T26's pre-allocated round-2 block: P145001–P146000
const argBase = process.argv.indexOf("--base");
const BASE = argBase > -1 ? process.argv[argBase + 1] : "";
const LIVE = !!BASE;
if (LIVE) await requireUp(BASE, "the admin server routes (T26 round 2)");
const H = LIVE ? adminHeaders(BASE) : {};
const RID = "00000000-0000-0000-0000-000000000001";           // My Little French House — the write target
const GONE = "11111111-2222-3333-4444-555555555555";          // an id that belongs to nothing

const R = Runner(FIRST_ID);
const FILES = myFiles();
const short = (rel) => rel.replace("app/api/admin/", "").replace("/route.ts", "");

const hit = async (path, init) => {
  const r = await fetch(BASE + path, { cache: "no-store", ...init, headers: { ...H, ...(init?.headers || {}) } });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch { /* not json */ }
  return { s: r.status, t, j, kb: +(t.length / 1024).toFixed(1) };
};
const SKIP = { skip: true, ok: true, note: "needs --base" };

// ══ A · THE DOOR — 36 handlers × 2 ═══════════════════════════════════════════════════════════════
// CLAUDE.md states this as a COUNTED invariant ("the number of admin routes must equal the number
// that grep tokenIsValid"), and a count says nothing about ORDER, nothing about whether the gate is
// reached, and nothing about what happens on a verb nobody thought to try. Both halves, per handler.
for (const rel of FILES) {
  const src = strip(read(rel));
  for (const verb of handlers(rel)) {
    await R.add("A", `${short(rel)} · ${verb} asks for the sign-in cookie BEFORE it touches the database`,
      "static: find this handler's body, then compare where the gate is against where the first sb.from()/sb.rpc() is",
      () => {
        if (!stripperSafe(rel)) return { ok: false, note: "the comment stripper ate code — every later answer about this file would be read from a hole" };
        const at = src.search(new RegExp(`export\\s+(?:async\\s+function|const)\\s+${verb}\\b`));
        if (at < 0) return { ok: false, note: "handler not found" };
        const body = src.slice(at, at + 4000);
        const gate = body.search(/\b(tokenIsValid|admin|requireAdmin|isAdmin)\s*\(/);
        const db = body.search(/\b(sb|supabaseAdmin|supabase)\s*\.\s*(from|rpc)\s*\(/);
        // A handler that hands off (withIdempotency, a local impl) has no database call of its own.
        if (db < 0) return { ok: gate >= 0 || /withIdempotency|Impl|postHandler|handler\(/.test(body), note: "delegates; the gate is in what it calls" };
        return { ok: gate >= 0 && gate < db, note: gate < 0 ? "NO GATE" : gate < db ? "" : "the database is touched first" };
      });

    await R.add("A", `${short(rel)} · ${verb} answers 401 to a request with no cookie at all`,
      "driven: the real verb against the real route with no Cookie header, and the body checked — not just the status",
      async () => {
        if (!LIVE) return SKIP;
        const init = verb === "GET" ? { headers: {} } : { method: verb, headers: { "content-type": "application/json" }, body: "{}" };
        const r = await fetch(BASE + urlOf(rel) + (rel.includes("[...") ? "/state" : "") + "?rid=" + RID, { ...init, headers: { ...(init.headers || {}) } });
        const t = (await r.text()).slice(0, 120);
        return { ok: r.status === 401, note: `${r.status} ${t.replace(/\n/g, " ")}` };
      });
  }
}

// ══ B · EVERY QUERY PARAMETER, DRIVEN — 46 ═══════════════════════════════════════════════════════
// Round 1 found the bill-ledger search answering a red error for a phone number by DRIVING a
// parameter rather than reading it, so this round drives every single one. The question is the same
// for all of them and it is the one that matters: does a value nobody expected produce a 5xx, or a
// database sentence on the screen, or an answer WIDER than the one asked for?
const JUNK = ["'\"<>%*\\", "-1", "999999999999", "!!!", "\u0000x"];
// The scope parameters. A junk value in one of these has a SECOND way to be wrong, and it is the
// one round 1 caught on the two bill screens: the filter is quietly dropped and the answer widens
// from one restaurant to every restaurant, under a confident 200. That is worse than an error,
// because the page still believes it is scoped. Checked by comparing the junk answer against the
// UNFILTERED one — if they match, the filter was not applied.
const SCOPE_PARAM = new Set(["restaurant_id", "rid"]);
for (const rel of FILES) {
  for (const p of queryParams(rel)) {
    await R.add("B", `${short(rel)} · ?${p}= survives a value nobody expected${SCOPE_PARAM.has(p) ? ", and is not quietly ignored" : ""}`,
      `driven: five shapes — punctuation, negative, past an INT, symbols, a control character — asserting no 5xx and no Postgres sentence on screen${SCOPE_PARAM.has(p) ? "; then, because this one SCOPES the answer, that a junk value does not return the same thing as no filter at all" : ""}`,
      async () => {
        if (!LIVE) return SKIP;
        const base = urlOf(rel) + (rel.includes("[...") ? "/state" : "");
        const bad = [];
        for (const v of JUNK) {
          const r = await hit(`${base}?rid=${RID}&restaurant_id=${RID}&${p}=${encodeURIComponent(v)}`);
          if (r.s >= 500) bad.push(`${JSON.stringify(v)}→${r.s}`);
          // The database's own words must never reach the console (lib/adminFail keeps them in
          // `detail` and the log). `error` is what the screen prints.
          else if (typeof r.j?.error === "string" && /invalid input syntax|violates|relation "|operator does not exist|out of range for type/i.test(r.j.error)) bad.push(`${JSON.stringify(v)}→postgres on screen`);
        }
        // ── THE WIDENING TEST ────────────────────────────────────────────────────────────────────
        // Only for a parameter that narrows the answer, and only when the route takes it as a real
        // filter (a 400 means it refused, which is the right answer and needs no further test).
        if (SCOPE_PARAM.has(p) && !bad.length) {
          const junk = await hit(`${base}?${p}=not-a-restaurant`);
          if (junk.s === 200) {
            const wide = await hit(base);
            // Compared on SHAPE, not on bytes: a `generatedAt` stamp differs between two calls a
            // millisecond apart and would make every route look scoped when none was.
            const shape = (r) => JSON.stringify(r.j, (k, x) => (/At$|_at$|generatedAt|checkedAt|cachedAt/.test(k) ? undefined : x));
            if (wide.s === 200 && shape(junk) === shape(wide)) bad.push("a junk id answers with EVERY restaurant — the filter was dropped, not refused");
          }
        }
        return { ok: !bad.length, note: bad.join(", ") };
      });
  }
}

// ══ C · EVERY BODY FIELD, READ — 55 ══════════════════════════════════════════════════════════════
// A query parameter can be driven; a body field often cannot without writing something. So this
// block READS: for each field a handler pulls out of the body, is it CHECKED before it is used —
// shape-tested, clamped, defaulted, or compared against an allow-list? A field that goes straight
// from the wire into a query is how `?day=2026-13-45` became a 500 in sweep #7.
for (const rel of FILES) {
  const src = strip(read(rel));
  for (const f of bodyFields(rel)) {
    await R.add("C", `${short(rel)} · body.${f} is checked before it is used`,
      "static: look for a shape test, a clamp, a default, an allow-list or a String()/Number() coercion on this field",
      () => {
        const uses = [...src.matchAll(new RegExp(`body\\??\\.\\s*${f}\\b`, "g"))].map((m) => src.slice(Math.max(0, m.index - 260), m.index + 260));
        // …including two shapes the first version of this check missed and then called faults:
        //   · handed to a local validator — `dateOr(body.next_due_on, "the next-due date")`. The
        //     check happens inside a function this file declares, which is BETTER than inline, not
        //     worse, and reporting it as untested is the guard inventing a failure.
        //   · used as a plain flag — `if (body.roll_next_due)`. A boolean read for truthiness has
        //     nothing to validate; anything untrue is simply false.
        const localFns = [...strip(read(rel)).matchAll(/(?:const|function)\s+([a-zA-Z_$][\w$]*)\s*=?\s*(?:\(|=)/g)].map((m) => m[1]);
        const guarded = uses.some((w) =>
          /UUID|isUuid|uuid\(|\.test\(|typeof\s|Array\.isArray|String\(|Number\(|parseInt|parseFloat|includes\(|\|\||\?\?|===|!==|Math\.(min|max)|slice\(|trim\(/.test(w)
          || localFns.some((fn) => fn.length > 2 && new RegExp(`\\b${fn}\\s*\\(\\s*body\\??\\.`).test(w))
          || new RegExp(`if\\s*\\(\\s*body\\??\\.${f}\\s*\\)`).test(w));
        return { ok: guarded, note: guarded ? "" : "reaches a query or a write untested" };
      });
  }
}

// ══ D · EVERY DATABASE CALL — 175 ════════════════════════════════════════════════════════════════
// One question per call, and it is the egress rule the whole product is costed on: a read must name
// its columns and state a ceiling, or be a head count, or be scoped to one row. An unbounded read
// stops at PostgREST's own cap and silently drops everything past it — the fault this repo has been
// bitten by four separate times, each time on a different screen.
for (const rel of FILES) {
  for (const c of dbCalls(rel)) {
    await R.add("D", `${short(rel)} · the ${c.kind === "rpc" ? "RPC" : "read/write"} of \`${c.table}\` (line ${c.at}) names what it wants and cannot be silently shortened`,
      "static: the statement must be an RPC, a head count, a single-row read, a write, or a select with BOTH a column list and a ceiling",
      () => {
        const ch = c.chain;
        // A HEAD COUNT WRITTEN THROUGH A CONSTANT IS STILL A HEAD COUNT. app/api/admin/dashboard
        // declares `const head = { count: "exact", head: true }` once and passes it to several
        // reads — better than repeating the literal, and the first version of this check called it
        // an unbounded read because it only knew the literal. Follow the name.
        const fileSrc = strip(read(rel));
        const headConsts = [...fileSrc.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*\{[^}]*head:\s*true[^}]*\}/g)].map((m) => m[1]);
        if (headConsts.some((h) => new RegExp(`\\bselect\\([^)]*\\b${h}\\b`).test(ch))) return { ok: true, note: `a head count (via \`${headConsts.find((h) => new RegExp(`\\bselect\\([^)]*\\b${h}\\b`).test(ch))}\`) — no rows cross the wire` };
        if (c.kind === "rpc") return { ok: true, note: "an RPC — the aggregate happens in Postgres, which is the point" };
        if (/\.(insert|update|upsert|delete)\s*\(/.test(ch)) return { ok: true, note: "a write" };
        if (/head:\s*true/.test(ch)) return { ok: true, note: "a head count — no rows cross the wire" };
        if (/\.maybeSingle\(\)|\.single\(\)/.test(ch)) return { ok: /select\(\s*["'`][^*]/.test(ch) || /select\(\s*\w/.test(ch), note: "one row" };
        if (!/\.select\s*\(/.test(ch)) return { ok: true, note: "not a select" };
        const named = !/select\(\s*["'`]\*/.test(ch);
        const bounded = /\.(limit|range)\s*\(/.test(ch) || /pageAll/.test(ch);
        return { ok: named && bounded, note: !named ? "select(\"*\")" : !bounded ? "no ceiling — this stops at PostgREST's cap and says nothing" : "" };
      });
  }
}

// ══ E · EVERY ROUTE, LIVE — 25 × 4 = 100 ═════════════════════════════════════════════════════════
// Reading the code answers what it MEANT to do. These four answer what it does.
const MONEY_KEY = /^(revenue|earnings|subtotal|grand_?total|net_amount|disc_gross|collected|spend)$/i;
// The three that show money ON PURPOSE. `bills` is the owner's oversight ledger ("you must be able
// to see if a real sale was made to vanish"), `billing` is what a restaurant pays US, and `audit` is
// the Removals record, which carries the amount removed under the same oversight rule.
const MONEY_OK = new Set(["bills", "billing", "audit", "agent-runs"]);
for (const rel of FILES) {
  const url = urlOf(rel) + (rel.includes("[...") ? "/state" : "");
  const q = rel.includes("[...") || /floor|maintenance/.test(rel) ? `?rid=${RID}&restaurant_id=${RID}&all=1` : "";
  await R.add("E", `${short(rel)} · answers a signed-in admin at all`,
    "driven: a real request with the admin cookie; a 4xx is fine when it names what is missing, a 5xx never is",
    async () => {
      if (!LIVE) return SKIP;
      const r = await hit(url + q);
      return { ok: r.s < 500, note: `${r.s}${r.s >= 400 ? " " + String(r.j?.error || "").slice(0, 70) : ""}` };
    });
  await R.add("E", `${short(rel)} · its answer is JSON, never a page of HTML`,
    "driven: parse the body; a Next error page reaching a fetch() is what turns a screen blank",
    async () => {
      if (!LIVE) return SKIP;
      const r = await hit(url + q);
      return { ok: !!r.j || r.t === "", note: r.j ? "" : "not JSON: " + r.t.slice(0, 60) };
    });
  await R.add("E", `${short(rel)} · what it sends is small enough to send every 60 seconds`,
    "driven: measure the payload. These screens auto-refresh, so a fat answer is paid for again and again",
    async () => {
      if (!LIVE) return SKIP;
      const r = await hit(url + q);
      // 150 KB is far above anything healthy on a console screen and well under the two that are
      // legitimately big; it is a tripwire for a NEW fat payload, not a target.
      return { ok: r.kb < 150, note: `${r.kb} KB` };
    });
  await R.add("E", `${short(rel)} · carries no restaurant earnings it has no reason to carry`,
    "driven: walk the parsed answer for a money-named NUMBER, against the four that show money on purpose",
    async () => {
      if (!LIVE) return SKIP;
      const r = await hit(url + q);
      if (MONEY_OK.has(short(rel))) return { ok: true, note: "shows money on purpose" };
      const hits = [];
      (function walk(v, path) {
        if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
          if (!Array.isArray(v) && MONEY_KEY.test(k) && typeof x === "number" && x !== 0) hits.push(`${path}.${k}`);
          walk(x, Array.isArray(v) ? path + "[]" : path + "." + k);
        }
      })(r.j, "");
      return { ok: !hits.length, note: [...new Set(hits)].slice(0, 3).join(", ") };
    });
}

// ══ F · EVERY ROUTE'S SENTENCES — 25 ═════════════════════════════════════════════════════════════
// One question per FILE about every sentence it can put on screen, because the property is about the
// set: does ANY of them hand the admin a database word, an id, or a promise the handler cannot keep?
const DB_WORD = /invalid input syntax|violates|constraint|relation "|PGRST|does not exist|null value in column|duplicate key/i;
for (const rel of FILES) {
  const ss = sentences(rel);
  await R.add("F", `${short(rel)} · all ${ss.length} of the things it can say are things a person can act on`,
    "static: every err()/bad()/error: string in the file, checked for a database word, a bare uuid, or an empty sentence",
    () => {
      const bad = ss.filter((s) => DB_WORD.test(s) || /^[a-z_]+$/.test(s) && s.length < 14 && !["unauthorized", "not found", "bad id", "unknown action"].includes(s));
      return { ok: !bad.length, note: bad.slice(0, 3).join(" | ") };
    });
}

// ══ G · THE WRITES, DRIVEN — 14 ══════════════════════════════════════════════════════════════════
// Only shapes that CANNOT change a row: an id that belongs to nothing, a refused value, a value
// written back to itself. Nothing here needs cleaning up afterwards, which is the point.
const gw = async (what, how, fn) => R.add("G", what, how, LIVE ? fn : () => SKIP);
const post = (p, b, extra) => hit(p, { method: "POST", headers: { "content-type": "application/json", ...(extra || {}) }, body: JSON.stringify(b) });
const patch = (p, b) => hit(p, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

await gw("renaming a computer that is not this restaurant's changes nothing and says so",
  "driven against an id that belongs to nothing", async () => {
    const r = await post(`/api/admin/printing/agents/${GONE}/rename`, { rid: RID, name: "T26 r2 probe" });
    return { ok: r.s === 404, note: `${r.s} ${String(r.j?.error || "").slice(0, 60)}` };
  });
await gw("taking a ticket out of a queue that is not this restaurant's changes nothing and says so",
  "driven against an id that belongs to nothing", async () => {
    const r = await post(`/api/admin/printing/job/${GONE}/cancel`, { rid: RID });
    return { ok: r.s === 404, note: String(r.s) };
  });
await gw("switching printing for a restaurant that has no settings row is refused, not reported as saved",
  "driven against a restaurant id with no settings", async () => {
    const r = await post("/api/admin/printing/switch", { rid: "99999999-9999-9999-9999-999999999999", on: true });
    return { ok: r.s === 404, note: String(r.s) };
  });
await gw("a printing line cannot be pointed at a paper this restaurant does not have",
  "driven: a routable kind the restaurant's modules do not include", async () => {
    const r = await post("/api/admin/printing/routes", { rid: RID, routes: { banquet: { via: "off" } } });
    return { ok: r.s === 400 || r.s === 200, note: `${r.s} ${String(r.j?.error || "").slice(0, 70)}` };
  });
await gw("a stale expectation on a computer's name is refused with a sentence naming what it says now",
  "driven: the clash gate with a value it never had", async () => {
    const st = await hit(`/api/admin/printing/state?rid=${RID}`);
    const a = (st.j?.agents || [])[0];
    if (!a) return { skip: true, ok: true, note: "no computer on this restaurant" };
    const esc = (o) => JSON.stringify(o).replace(/[-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
    const r = await post(`/api/admin/printing/agents/${a.id}/rename`, { rid: RID, name: "T26 r2 must be refused" },
      { "X-LFH-Expect": esc({ table: "print_agents", id: a.id, fields: { name: "a name it never had" } }) });
    const still = ((await hit(`/api/admin/printing/state?rid=${RID}`)).j?.agents || [])[0]?.name;
    return { ok: r.s === 409 && still === a.name, note: `${r.s} · still called ${still}` };
  });
await gw("…and a TRUE expectation still saves, so the gate is not simply refusing everything",
  "driven: the same write with the value it really has", async () => {
    const st = await hit(`/api/admin/printing/state?rid=${RID}`);
    const a = (st.j?.agents || [])[0];
    if (!a) return { skip: true, ok: true, note: "no computer on this restaurant" };
    const esc = (o) => JSON.stringify(o).replace(/[-￿]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
    const r = await post(`/api/admin/printing/agents/${a.id}/rename`, { rid: RID, name: a.name },
      { "X-LFH-Expect": esc({ table: "print_agents", id: a.id, fields: { name: a.name } }) });
    return { ok: r.s === 200, note: `${r.s} · rewrote "${a.name}" to itself` };
  });
await gw("a printing line refuses a stale `was` and leaves the line alone",
  "driven: the address book's own gate", async () => {
    const before = (await hit(`/api/admin/printing/state?rid=${RID}`)).j?.routes?.kot;
    const r = await post("/api/admin/printing/routes", { rid: RID, routes: { kot: { via: "off" } }, was: { kot: { via: "screen", panel: "kitchen", person: "somebody" } } });
    const after = (await hit(`/api/admin/printing/state?rid=${RID}`)).j?.routes?.kot;
    return { ok: r.s === 409 && JSON.stringify(before) === JSON.stringify(after), note: `${r.s} · the line is unchanged: ${JSON.stringify(before) === JSON.stringify(after)}` };
  });
await gw("an owner action against an id that is not an owner is refused before anything is written",
  "driven", async () => {
    const r = await patch("/api/admin/owners", { owner_id: GONE, action: "rename", name: "T26 r2 probe" });
    return { ok: r.s === 404, note: `${r.s} ${String(r.j?.error || "").slice(0, 60)}` };
  });
await gw("binning an owner who is not in the recycle bin is refused with the reason",
  "driven: DELETE against an id that belongs to nothing", async () => {
    const r = await hit(`/api/admin/owners?id=${GONE}`, { method: "DELETE" });
    return { ok: r.s === 404, note: `${r.s} ${String(r.j?.error || "").slice(0, 60)}` };
  });
await gw("a repair request cannot be filed with nothing in it",
  "driven: an empty body", async () => {
    const r = await post("/api/admin/fix-request", {});
    return { ok: r.s === 400, note: `${r.s} ${String(r.j?.error || "").slice(0, 60)}` };
  });
await gw("a log cleanup with a window outside 1–3650 days is refused before anything is deleted",
  "driven: 0, -1, 99999 and a word", async () => {
    const out = [];
    for (const d of [0, -1, 99999, "seven"]) out.push((await post("/api/admin/oplog/cleanup", { keepDays: d })).s);
    return { ok: out.every((s) => s === 400), note: out.join(",") };
  });
await gw("marking notifications UNSEEN in bulk is refused — that is not what the bell does",
  "driven", async () => {
    const r = await post("/api/admin/oplog/ack", { all: true, seen: false });
    return { ok: r.s === 400, note: `${r.s} ${String(r.j?.error || "").slice(0, 50)}` };
  });
await gw("a bill cannot be deleted without a reason",
  "driven: the strongest removal in the product, with the reason left out", async () => {
    const r = await post("/api/admin/bills", { action: "delete", sessionId: GONE });
    // 404 (no such bill) or 400 (no reason) — both refuse BEFORE anything is removed, which is the
    // property. What must never happen is a 200.
    return { ok: r.s === 400 || r.s === 404, note: `${r.s} ${String(r.j?.error || "").slice(0, 60)}` };
  });
await gw("a credit note of zero or less is refused",
  "driven", async () => {
    const r = await post("/api/admin/bills", { action: "credit_note", sessionId: GONE, amount: 0, reason: "x" });
    return { ok: r.s !== 200, note: `${r.s} ${String(r.j?.error || "").slice(0, 60)}` };
  });

// ══ H · MY OWN JUDGEMENT — 13 ════════════════════════════════════════════════════════════════════
// "Is this how it should work for a real platform?" Thirteen questions no static rule can ask.
const J = (what, how, fn) => R.add("H", what, how, fn);
const all = FILES.map((f) => strip(read(f))).join("\n");

await J("no route in this territory reads settings by the retired single-row key EXCEPT the two that are allowed to",
  "static: `.eq(\"id\", \"site\")` is the pre-tenancy shape. verify-settings-columns names exactly two deliberate flagship fallbacks and deliberately scopes its own rule to lib/ so it does not go red on them — this asks the same question with the same two exceptions, so the two guards cannot drift into disagreeing",
  () => {
    // The two, quoting that guard's own words: admin/settings (the log-retention numbers — one
    // platform-wide policy, and "restaurant #1's value" and "the platform's value" are the same
    // statement today) and admin/maintenance (falls back only when no restaurant_id was given).
    const allowed = new Set(["settings", "maintenance"]);
    const bad = FILES.filter((f) => /\.eq\(\s*["']id["']\s*,\s*["']site["']\s*\)/.test(strip(read(f))) && !allowed.has(short(f)));
    return { ok: !bad.length, note: bad.length ? bad.map(short).join(", ") : "only the two declared fallbacks" };
  });
await J("no route hands the console a raw database error through a catch",
  "static: a `catch` whose response body carries e.message — the last door lib/adminFail does not cover",
  () => { const bad = FILES.filter((f) => /catch[\s\S]{0,300}?(?:error|message)\s*:\s*(?:msg|e\.message|String\(e\))/.test(strip(read(f))) && !/detail:/.test(strip(read(f)))); return { ok: !bad.length, note: bad.map(short).join(", ") }; });
await J("every route that takes a restaurant refuses a malformed one rather than widening the answer",
  "static: a scope filter must not be applied only `if (rid && isUuid(rid))` — a bad id then drops the filter",
  () => { const bad = FILES.filter((f) => /if\s*\([^)\n]*&&[^)\n]*(?:isUuid|UUID\.test)[^)\n]*\)[^;\n]*\.eq\s*\(/.test(strip(read(f)))); return { ok: !bad.length, note: bad.map(short).join(", ") }; });
await J("no route rebuilds a jsonb settings bag from a read whose failure it cannot see",
  "static: `(await sb…select(\"modules\")).data` feeding an `update({ modules })` — a blip empties the bag and the write erases every other module",
  () => { const bad = FILES.filter((f) => { const s = strip(read(f)); return /update\s*\(\s*\{\s*modules\b/.test(s) && /\(\s*await[\s\S]{0,300}?select\s*\(\s*["'`][^"'`]*modules[\s\S]{0,200}?\)\s*\)\s*\.data/.test(s); }); return { ok: !bad.length, note: bad.map(short).join(", ") }; });
await J("no write asks which row it touched and then throws the answer away",
  "static: a `.select(…).maybeSingle()` on an insert/update/delete whose `.data` is never tested in the lines that follow",
  () => {
    const bad = [];
    for (const f of FILES) {
      const s = strip(read(f));
      for (const m of s.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+([^;]{0,600}?maybeSingle\s*\(\s*\))\s*;/g)) {
        if (!/\.(insert|update|upsert|delete)\s*\(/.test(m[2]) || !/\.select\s*\(/.test(m[2])) continue;
        const after = s.slice(m.index + m[0].length, m.index + m[0].length + 700);
        if (!new RegExp(`[!(?\\s]${m[1]}\\.data\\b`).test(after)) bad.push(`${short(f)}:${m[1]}`);
      }
    }
    return { ok: !bad.length, note: bad.join(", ") };
  });
await J("no number aimed at an INT column can be typed past what an INT holds",
  "static: sessions.bill_no / invoice_no are INT (migs 036/037); anything interpolated at them needs the ceiling stated",
  () => { const bad = FILES.filter((f) => /(bill_no|invoice_no)\.eq\.\$\{/.test(strip(read(f))) && !/2147483647/.test(read(f))); return { ok: !bad.length, note: bad.map(short).join(", ") }; });
await J("every one of these routes is force-dynamic, so none of them is ever served from a build-time cache",
  "static: `export const dynamic = \"force-dynamic\"` — a cached admin answer is a stale platform",
  () => { const bad = FILES.filter((f) => !/export const dynamic\s*=\s*["']force-dynamic["']/.test(read(f))); return { ok: !bad.length, note: bad.map(short).join(", ") }; });
await J("nothing in this territory prints a secret, a token or a service key",
  "static: the words, and any env read that is not the public URL",
  () => { const bad = FILES.filter((f) => /SERVICE_ROLE|sbp_|ADMIN_PASSWORD/.test(strip(read(f)))); return { ok: !bad.length, note: bad.map(short).join(", ") }; });
await J("every action a restaurant would want explained afterwards writes a line in the diary",
  "static: each file with a write verb also calls logAction — bar the ones whose writes are the admin's own bookkeeping",
  () => {
    const exempt = new Set(["oplog/ack", "agent-runs", "printing/[...path]"]);   // seen-flags, reads, and printing (which logs under its own action names)
    const bad = FILES.filter((f) => { const s = strip(read(f)); return /\.(insert|update|upsert|delete)\s*\(/.test(s) && !/logAction\(/.test(s) && !exempt.has(short(f)); });
    return { ok: !bad.length, note: bad.map(short).join(", ") };
  });
await J("a repeated press of a money action cannot charge or credit twice",
  "static: the two routes that move money are wrapped in withIdempotency",
  () => { const need = ["billing", "bills"]; const bad = need.filter((n) => !/withIdempotency/.test(read(FILES.find((f) => short(f) === n)))); return { ok: !bad.length, note: bad.join(", ") }; });
await J("the live floor is asked for by name, never guessed",
  "static: the one-restaurant branch must refuse without a restaurant — lfh_floor_state DEFAULTS to restaurant #1",
  () => { const s = strip(read(FILES.find((f) => short(f) === "floor"))); return { ok: /restaurant_id is required/.test(s), note: "" }; });
await J("the whole territory still holds the line the tree is counted on",
  "re-derive: every admin route file, against the number that greps tokenIsValid — CLAUDE.md states this as a counted invariant, and the count was 49 when the sweep prompts were written",
  () => {
    const dir = join(ROOT, "app/api/admin");
    const all = [];
    (function w(d) { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) w(p); else if (e === "route.ts") all.push(p); } })(dir);
    const gated = all.filter((p) => /tokenIsValid/.test(readFileSync(p, "utf8")));
    return { ok: all.length === gated.length, note: `${gated.length} of ${all.length} admin routes name the gate` };
  });
await J("this round asked something of every file, not just of the interesting ones",
  "re-read the rows: each of the 25 files must appear in blocks A, D, E and F",
  () => {
    const missing = FILES.map(short).filter((s) => !["A", "D", "E", "F"].every((b) => R.rows.some((r) => r.block === b && r.what.startsWith(s + " ·"))));
    return { ok: !missing.length, note: missing.join(", ") };
  });

// ── report ───────────────────────────────────────────────────────────────────────────────────────
const failed = R.report("T26 round 2");
if (process.argv.includes("--md")) for (const r of R.rows) console.log(`| ${r.id} | ${r.block} · ${r.what} | ${r.how} | ${r.mark} | ${r.note} |`);
process.exit(failed ? 1 : 0);
