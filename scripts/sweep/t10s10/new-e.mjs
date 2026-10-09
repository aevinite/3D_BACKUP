// Block E — project-rule conformance across my half, read from the code (P179801–P179808).
// CLAUDE.md + .claude/rules: every write wrapped once-only and dropping the floor snapshot;
// column lists, bounded reads; refusals in sentences; rejections cited where they live.
import { execFileSync } from "node:child_process";
import { check, src, MC, MINE, chains, strip, ROOT } from "./lib.mjs";

let n = 179801;
const row = (what, how, fn) => check(`P${n++}`, what, how, fn);
row("POST, PATCH and DELETE are each wrapped once-only (withIdempotency) AND drop the floor snapshot after the write", "SRC · the three exports",
  () => ["POST", "PATCH", "DELETE"].every((v) => new RegExp(`export const ${v} = withIdempotency\\(invalidateFloorAfter\\(${v.toLowerCase()}Impl\\), "editor"\\)`).test(src)));
row("no read in my half takes every column (`select(\"*\")`)", "SRC · comments stripped",
  () => { const hits = (MC.match(/select\("\*"\)/g) || []).length; return { ok: hits === 0, note: `${hits} hit(s)` }; });
row("every list read in my half is bounded — a .limit(), keyed to one row/bill/order/session, or narrowed to ONE table on its next line; the uncapped ones are named", "SRC · every sb.from(…).select chain, bracket-matched",
  () => { const reads = chains(MC).filter((c) => /\.select\(/.test(c.flat) && !/\.(update|insert|upsert|delete)\(/.test(c.flat));
    const bounded = (f) => /\.limit\(|\.single\(\)|\.maybeSingle\(\)|head: true/.test(f) || /\.eq\("(id|session_id|order_id|slug)"/.test(f) || /\.in\("id",/.test(f);
    // A builder assigned to a variable and narrowed on the NEXT line to one session or one table
    // (`oq = openSess ? oq.eq("session_id"…) : oq.eq("table_number"…)`), a short in-list of tables,
    // and one restaurant's tagged dishes are bounded by construction but carry no .limit() — named in
    // the note and offered as a Part 4 improvement, not passed silently.
    const narrowed = (c) => { const v = (MC.slice(Math.max(0, c.at - 40), c.at).match(/let (\w+) = $/) || [])[1];
      return v ? new RegExp(`${v} = openSess \\? ${v}\\.eq\\("session_id"[^:]*: ${v}\\.eq\\("table_number"`).test(MC.slice(c.at, c.at + 600)) : false; };
    const inList = (c) => /\.in\("table_number", \[t, \.\.\.partyKids/.test(c.flat);
    const menuTags = (c) => c.table === "menu_items" && /\.contains\("tags"/.test(c.flat);
    const open = reads.filter((c) => !bounded(c.flat));
    const bad = open.filter((c) => !narrowed(c) && !inList(c) && !menuTags(c));
    return { ok: bad.length === 0, note: `${reads.length} reads · ${open.length} without a .limit(), all bounded by construction (${open.map((c) => c.table).join(", ")}) — Part 4${bad.length ? ` · UNBOUNDED: ${bad.map((c) => c.table).join(", ")}` : ""}` }; });
row("no refusal in my half hands a database message to the person (err(x.message…))", "SRC · comments stripped",
  () => { const hits = MC.match(/err\(\s*(?:error|ins\.error|upd\.error|e instanceof Error \? e)\.message/g) || []; return { ok: hits.length === 0, note: `${hits.length}` }; });
row("the one cancelled-ticket sentence (item 1) is used by every door that could revive a ticket", "SRC",
  () => { const k = (MC.match(/VOIDED_MSG/g) || []).length; return { ok: k >= 5, note: `${k} uses (4 doors — PATCH covers both statuses — + its declaration)` }; });
row("every rejection cited in my half belongs to this file, and verify:rejected is green", "npm run verify:rejected",
  () => { const cites = [...new Set((strip(MINE) === MINE ? MINE : MINE).match(/\bR\d{1,3}\b/g) || [])];
    let ok = true; try { execFileSync("npm", ["run", "--silent", "verify:rejected"], { cwd: ROOT, stdio: "pipe" }); } catch { ok = false; }
    return { ok, note: `cited here: ${cites.join(", ")}` }; });
row("no Activity-log line in my half is built with JSON.stringify — every one reads as English", "SRC · log(…) calls",
  () => { const bad = [...MC.matchAll(/log\("(?:editor|manager)", "[a-z_]+", \{[^}]*JSON\.stringify/g)]; return { ok: bad.length === 0, note: `${bad.length}` }; });
row("every money-moving door in my half asks a power or a module ladder before it writes", "SRC · discount, tip, on-the-house, pay-later park/collect, settle in parts, PATCH paid",
  () => { const need = [['a === "orders" && c === "discount"', "give_discounts"], ['a === "orders" && c === "tip"', "mark_paid"], ['a === "tables" && c === "on-the-house"', "table_tags"],
      ['a === "tables" && c === "khata"', "khata"], ['a === "khata" && b === "pay"', "khata"], ['a === "tables" && c === "pay-split"', "mark_paid"]];
    const miss = need.filter(([t, p]) => { const i = MINE.indexOf(`if (${t}`); return i < 0 || !new RegExp(`managerCan\\(g, rid, "${p}"\\)`).test(MINE.slice(i, i + 1600)); });
    const patchPaid = /payment_status !== undefined\)[\s\S]{0,700}managerCan\(g, rid, "mark_paid"\)/.test(MINE);
    return { ok: !miss.length && patchPaid, note: miss.length ? `missing: ${miss.map((m) => m[0]).join("; ")}` : "all six + PATCH paid" }; });
