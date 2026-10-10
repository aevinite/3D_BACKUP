// scripts/sweep/t13s10/rerun-grid.mjs — RE-RUNS sweep #8 T10's endpoint grid on today's code.
//
// T10.md rows P63701–P64070 ask the SAME questions of every branch of the waiter tablet's POST
// dispatcher ("tablet route · <branch>: <property>"). The script that generated them lived in a
// worktree that is gone, so the questions are re-asked here FROM THE ROWS THEMSELVES: each row is
// parsed for its branch and its property, the branch is cut out of today's route by its own `if`, and
// the property is evaluated on that text. A row whose property this file does not know is reported
// ❌ "unknown property" rather than skipped, so nothing passes by not being looked at.
import { rd, strip, branch, chains, POSTBLK, GETBLK, HELPERS, getEndpoint, SRC } from "./lib.mjs";

const T10 = rd(".claude/sweep/LEDGER/T10.md");
const rows = [...T10.matchAll(/^\| (P6[34]\d{3}) \| tablet route · ([^|]+?)\s*\|/gm)].map((m) => ({ id: m[1], text: m[2].trim() }));

const testFor = (name) => {
  if (name === "print/send") return 'if (a === "print" && b === "send")';
  if (name === "order/open") return 'if ((a === "order" || (a === "sessions" && b === "open"))';
  if (name === "issue") return 'if (a === "issue")';
  if (name === "order") return 'if (a === "order" && path.length === 1)';
  if (name === "parcel") return 'if (a === "parcel" && path.length === 1)';
  if (name === "banquet/place") return 'if (a === "banquet" && b === "place")';
  if (name === "sessions/open") return 'if (a === "sessions" && b === "open")';
  const m = name.match(/^([a-z-]+)\/:(?:id|t)\/([a-z-]+)$/);
  return m ? `if (a === "${m[1]}" && c === "${m[2]}")` : null;
};
/** The branch's code, comments stripped, or null when the branch is no longer in the file. */
const codeOf = (name) => { const t = testFor(name); if (!t) return null; const raw = branch(t); return raw ? strip(raw) : null; };

// ── the properties ────────────────────────────────────────────────────────────────────────────
const P = {
  'every .eq("id", b) query also names the restaurant': (c) => {
    const ch = chains(c).filter((x) => /\.eq\("id",\s*b\)/.test(x.flat));
    const scoped = ch.filter((x) => /\.eq\("restaurant_id",\s*rid\)/.test(x.flat));
    return { ok: scoped.length === ch.length, note: `${scoped.length} of ${ch.length} scoped` };
  },
  "a tenant-less RPC is fronted by a restaurant-scoped read": (c) => {
    const rpcs = [...c.matchAll(/sb\.rpc\("([a-z_]+)",\s*\{([^}]*)\}/g)];
    const bare = rpcs.filter((m) => !/p_rid|p_restaurant_id|p_restaurant\b/.test(m[2]));
    const bad = bare.filter((m) => { const before = c.slice(0, m.index); return !/\.eq\("restaurant_id",\s*rid\)/.test(before) && !/mergeParentTable\(sb,\s*rid/.test(before); });
    return { ok: bad.length === 0, note: `${rpcs.length} rpc(s), ${bare.length} take no restaurant, ${bad.length} unfronted${bad.length ? ": " + bad.map((m) => m[1]).join(", ") : ""}` };
  },
  "a table in the URL is checked as digits before it is used": (c, name) => {
    if (!/^tables\//.test(name)) return { ok: true, note: "no table in the URL" };
    const test = c.search(/\/\^\\d\+\$\/\.test\((?:tRaw|t|tu)\)/);
    const firstUse = c.search(/mergeParentTable\(|\.eq\("table_number",|p_child:|p_table:|\.eq\("parent_table"/);
    return { ok: test >= 0 && (firstUse < 0 || test < firstUse), note: test < 0 ? "no digits test" : "digits checked first" };
  },
  "a merged child is resolved to the table holding the bill": (c, name) => {
    if (!/^tables\//.test(name)) return { ok: true, note: "not a table action" };
    if (/^tables\/:id\/(tag|unmerge)$/.test(name)) return { ok: true, note: "acts on THIS table by design (a mark / the split itself)" };
    return { ok: /mergeParentTable\(sb,\s*rid/.test(c), note: /mergeParentTable/.test(c) ? "mergeParentTable" : "not resolved" };
  },
  "every PIN gate it passes is recorded for the log": (c) => {
    const gates = [...c.matchAll(/(recordPin\()?await (tabletPerm|managerPinGate|closeUnpaidGate)\(/g)];
    const bad = gates.filter((m) => !m[1]);
    return { ok: bad.length === 0, note: `${gates.length} gate(s), ${bad.length} unrecorded` };
  },
  "no refusal is a bare code a waiter cannot read": (c) => {
    const lits = [...c.matchAll(/err\(\s*"([^"]*)"/g), ...c.matchAll(/error:\s*"([^"]*)"/g)].map((m) => m[1]);
    const bare = lits.filter((s) => !/\s/.test(s));
    return { ok: bare.length === 0, note: `${lits.length} literal refusal(s)${bare.length ? ", bare: " + bare.join(", ") : ""}` };
  },
  "a write that matched no row is refused out loud, not answered ok": (c) => {
    const refuses = /if \(!reqRow\) \{[\s\S]{0,400}?return err\(/.test(c) || /if \(!(?:row\[0\]|row|rows\.length|reqRow|item|paid\.length|unpaid\.length|kunpaid\.length|owner)\)?[^\n]{0,40}return err\(|if \(!rows\.length\)\s*\{?\s*return err\(|if \(!(?:paid|unpaid|kunpaid)\.length\) return err\(/.test(c);
    return { ok: refuses, note: refuses ? "a no-row answer is an error" : "no no-row refusal found" };
  },
  "the Audit row carries the WHY the screen collected": (c) => {
    const rr = [...c.matchAll(/recordRemoval\(\{[\s\S]*?\}\);/g)].map((m) => m[0]);
    const why = rr.filter((t) => /reasonFromBody\(body\)/.test(t));
    return { ok: rr.length > 0 && why.length === rr.length, note: `${why.length} of ${rr.length} carry reasonFromBody(body)` };
  },
};
const gatedOn = (key) => (c) => ({ ok: new RegExp(`tabletPerm\\("${key}"`).test(c), note: `tabletPerm("${key}")` });
const ladderFirst = (fn) => (c) => {
  const l = c.indexOf(fn), p = c.search(/tabletPerm\(/);
  return { ok: l >= 0 && p >= 0 && l < p, note: `ladder@${l} perm@${p}` };
};
const writesKind = (kind) => (c, name) => {
  // MOVED DELIBERATELY (item 3, 2026-10-10): the waiter's "Delete order" CANCELS — R27.
  if (name === "orders/:id/delete" && kind === "order_deleted") {
    const now = new RegExp(`kind:\\s*"order_cancelled"`).test(c);
    return { ok: now, note: now ? "RE-STATED — since item 3 (R27) this door cancels and records order_cancelled; no order_deleted row is written by a waiter any more" : "neither order_deleted nor order_cancelled" };
  }
  return { ok: new RegExp(`recordRemoval\\([\\s\\S]{0,500}?kind:\\s*"${kind}"`).test(c), note: `kind "${kind}"` };
};

// ── the rows that are not "branch: property" ─────────────────────────────────────────────────────
const H = strip(HELPERS), G = strip(GETBLK), PO = strip(POSTBLK), ALL = strip(SRC.route);
const pre = PO.slice(0, PO.indexOf('if (a === "print" && b === "send")'));
const FIXED = {
  "POST preamble: the login gate": () => ({ ok: /const g = await gate\(req\); if \(g instanceof NextResponse\) return g;/.test(pre), note: "gate() first" }),
  "POST preamble: the restaurant scope": () => ({ ok: /const rid = panelRestaurantId\(req, g\)/.test(pre) && /if \(!rid\) return err\(/.test(pre), note: "panelRestaurantId + refusal" }),
  "POST preamble: the shared floor snapshot is dropped before the write": () => ({ ok: /if \(rid\) \{ invalidateFloor\(rid\); writeRid\.set\(req, rid\); \}/.test(pre), note: "invalidateFloor + writeRid" }),
  "POST preamble: the acting waiter is bound for the permission checks": () => ({ ok: /const actor = g\.user;/.test(pre), note: "actor = g.user" }),
  "POST preamble: every log row carries this restaurant": () => ({ ok: /\.\.\.fields, restaurant_id: rid \}\)/.test(pre), note: "log() appends restaurant_id last" }),
  "shared gate: an empty id segment is refused before it reaches a uuid query": () => ({ ok: /if \(emptyIdSegment\(b\) \|\| emptyIdSegment\(c\)\) return err\(/.test(pre), note: "emptyIdSegment(b|c)" }),
  "shared gate: a blocked device is refused, against THIS restaurant": () => ({ ok: /if \(await deviceBlocked\(dev, rid\)\) return err\(/.test(pre), note: "deviceBlocked(dev, rid)" }),
  "shared gate: the waiter-section gate is asked once for every table-scoped write": () => ({ ok: /const sectionLimit = await waiterTables\(actor, rid\);[\s\S]{0,200}blockedReason\(sectionLimit, rid, a, b, c, body\)/.test(PO), note: "one blockedReason before the branches" }),
  "shared gate: an offline replay that arrived late is checked against the ground it left": () => ({ ok: /const clash = await replayClash\(req, rid, a, b, c,/.test(PO), note: "replayClash" }),
  "shared gate: a value edit is refused rather than overwriting someone else's": () => ({ ok: /const overwrite = await expectClash\(req, rid\);/.test(PO), note: "expectClash" }),
  "shared gate: a dine-in table this restaurant could not have is refused": () => ({ ok: /offPlanTable\(rid,/.test(PO), note: "offPlanTable" }),
  "GET: the board read refuses a blocked device too, so the screen goes dark": () => ({ ok: /if \(await blockedForRead\(deviceIdFrom\(req\), rid\)\) return BLOCKED_READ\(\);/.test(G), note: "blockedForRead" }),
  "GET: …and that answer is memoised, so a hot path gains no per-request query": () => ({ ok: /const BLOCK_TTL_MS = 30_000;/.test(H) && /hit && Date\.now\(\) - hit\.at < BLOCK_TTL_MS/.test(H), note: "30s memo" }),
  "GET: …and the memo is bounded, so it cannot grow without a ceiling": () => ({ ok: /if \(blockMemo\.size > 500\)/.test(H), note: "500-entry sweep" }),
  "GET: the whole-floor read is SHARED for 1.5s": () => ({ ok: /sharedFloorSummary\(`floor:\$\{rid\}`/.test(G), note: "floor:<rid>" }),
  "GET: a targeted ?table=N refetch is NOT shared": () => ({ ok: /tbl\s*\?\s*await sb\.rpc\("lfh_table_view_summary", \{ p_restaurant_id: rid, p_table: tbl \}\)/.test(G), note: "the ?table= arm calls the RPC directly" }),
  "GET: the merges ride-along is shared under its own key": () => ({ ok: /sharedFloorSummary\(`merges:\$\{rid\}`/.test(G), note: "merges:<rid>" }),
  "GET: a sectioned waiter narrows a COPY, never the shared snapshot": () => ({ ok: /const summary = myTables \? structuredClone\(shared\) : shared;/.test(G), note: "structuredClone for a restricted viewer" }),
  "GET: ?table= must be digits, or a bad param becomes a full refresh and not a 500": () => ({ ok: (G.match(/\/\^\\d\{1,6\}\$\/\.test\(tblRaw\.trim\(\)\)/g) || []).length === 2, note: "both reads" }),
  "GET: the settings row is stripped of the delivery apps' keys": () => ({ ok: /panelSafeSettings\(must\(settings\)\)/.test(G), note: "panelSafeSettings" }),
  "GET: the restaurant's whole permission record is peeled off before the row is sent": () => ({ ok: /filter\(\(\[k\]\) => k !== "access_config"\)/.test(G), note: "access_config filtered" }),
  "GET: ?nomenu=1 skips the big dish list rather than sending an empty one": () => ({ ok: /const dishesP = nomenu\s*\? null/.test(G) && /if \(dishesP\) body\.dishes = /.test(G), note: "key absent on nomenu" }),
  "GET: the whole-floor /state branch is GONE and says where the floor lives": () => ({ ok: /return err\("Ask for one table \(\/state\?table=N\) — the whole floor comes from \/summary\.", 400\);/.test(G), note: "400 with directions" }),
  "GET: an unknown GET is a 404, not a 500": () => ({ ok: /return err\("unknown GET endpoint", 404\);/.test(G), note: "404" }),
  "GET: a caught failure is told apart from a bug by lib/panelFailure": () => ({ ok: /return panelFailure\(e\);/.test(G), note: "panelFailure(e)" }),
  "no read is bounded by nothing at all": () => {
    const ch = chains(ALL).filter((x) => /\.select\(/.test(x.flat) && !/\.(update|insert|upsert|delete)\(/.test(x.flat));
    const own = (x) => /\.limit\(|\.maybeSingle\(|\.single\(|\.eq\("id",|\.in\("id",|\.eq\("session_id",|\.in\("session_id",|\.eq\("order_id",|\.eq\("table_number",|\.in\("table_number",|head:\s*true|\.eq\("phone",/.test(x.flat);
    // A builder finished on the NEXT statement (`q = openSess ? q.eq("session_id", …) : q.eq("table_number", t)`)
    // is bounded by the party there — the detector reads that statement too rather than calling it unbounded.
    const after = (x) => /^\s*;\s*[a-z]+ = openSess \? [a-z]+\.eq\("session_id"/.test(ALL.slice(x.at + x.chain.length, x.at + x.chain.length + 120));
    const unbounded = ch.filter((x) => !own(x) && !after(x));
    return { ok: unbounded.length === 0, note: `${ch.length} reads, ${unbounded.length} unbounded (${ch.filter(after).length} finished by the party on the next statement)${unbounded.length ? ": " + unbounded.map((u) => u.table).join(", ") : ""}` };
  },
  "the heaviest read (the dish list) carries the same ceiling as the menu digest": () => {
    const mi = chains(ALL).filter((x) => x.table === "menu_items" && /\.order\(/.test(x.flat));
    return { ok: mi.length === 2 && mi.every((x) => /\.limit\(2000\)/.test(x.flat)), note: `${mi.length} ordered menu_items reads, both .limit(2000)` };
  },
  "a read bounded only by the party is recorded and NOT given a ceiling that could cut a bill": () => {
    const party = chains(ALL).filter((x) => /\.select\(/.test(x.flat) && /\.eq\("(session_id|order_id|table_number)",/.test(x.flat) && !/\.limit\(|\.maybeSingle|\.single/.test(x.flat));
    return { ok: true, note: `${party.length} party-bounded reads, none capped (a capped bill read would drop money): ${[...new Set(party.map((p) => p.table))].join(", ")}` };
  },
  'a select("*") is only used where the row is small and the columns are read wholesale': () => {
    const star = chains(ALL).filter((x) => /\.select\("\*"\)/.test(x.flat)).map((x) => x.table);
    const allowed = ["settings", "waiter_calls", "requests"];
    return { ok: star.every((t) => allowed.includes(t)), note: `select("*") on: ${[...new Set(star)].join(", ")} (sessions dropped it — item 12 of sweep #8)` };
  },
  "no branch inserts a realtime breadcrumb by hand — the database trigger publishes": () => ({ ok: !/from\("realtime_events"\)|lfh_rt_emit/.test(ALL), note: "no hand-written breadcrumb" }),
  "no branch computes a bill total by hand": () => ({ ok: !/\.total\s*-\s*[a-z]+\.discount\s*\*\s*\(1/.test(ALL), note: "no due = total − discount×(1+rate) arithmetic" }),
  "the tax rate is never typed in this file — it comes from lib/tax": () => ({ ok: !/0\.05\b|\b5 ?%|tax_rate\s*[*:]/.test(ALL.replace(/"[^"\n]*"/g, '""')), note: "no literal rate" }),
  "a discount is clamped to the TAXABLE base, never the tax-inclusive total": () => ({ ok: /const base = Number\(cur\.taxable_base \?\? cur\.subtotal\) \|\| 0;/.test(ALL) && /Math\.min\(Math\.max\(raw, 0\), base\)/.test(ALL), note: "taxable_base ?? subtotal" }),
  "…and the whole-bill discount is clamped the same way": () => ({ ok: /Number\(o\.taxable_base \?\? o\.subtotal\) \|\| 0/.test(ALL) && /Math\.min\(Math\.max\(raw, 0\), maxBase\)/.test(ALL), note: "Σ taxable base" }),
  "the per-role discount cap is enforced on the server": () => ({ ok: /overDiscountCap\(amount, base, cap\)/.test(ALL), note: "overDiscountCap(amount, base, cap)" }),
  "a split settle goes through the ONE shared money path": () => ({ ok: (ALL.match(/settleBillInParts\(sb,/g) || []).length === 2, note: "both doors delegate to settleBillInParts" }),
  "reversing a split reverses the legs rather than deleting them": () => ({ ok: /await reverseSplitLegs\(sb, \{/.test(ALL) && !/from\("session_payments"\)\.delete/.test(ALL), note: "reverseSplitLegs, no delete" }),
  "an order is never hard-deleted — it is soft-deleted and kept": () => {
    const hard = /from\("orders"\)\.delete\(|from\("order_items"\)\.delete\(/.test(ALL), soft = /softDeleteOrders\(/.test(ALL);
    return { ok: !hard && !soft, note: "RE-STATED — since item 3 (R27) a waiter's delete is a CANCEL: no hard delete AND no soft delete in this file" };
  },
  "there is no delete-a-bill door on this panel at all": () => {
    const soft = /softDeleteOrders\(/.test(ALL);
    return { ok: !soft, note: soft ? "orders/:id/delete still soft-deletes" : "TRUE SINCE TODAY — until item 3 orders/:id/delete soft-deleted the ticket (and an emptied bill), which is a delete-a-bill door; it cancels now" };
  },
  "a parcel is stored at subtotal + tax, so the record equals the paper": () => ({ ok: /const parcelSplit = splitBill\(picked, parcelSet, 0\);\s*total = parcelSplit\.total;/.test(ALL), note: "splitBill → total" }),
  "a parcel refuses a dish the kitchen has marked sold out": () => ({ ok: /d\.tags\.includes\("sold-out"\)\) return err\(/.test(ALL), note: "sold-out refused" }),
  "a parcel refuses a dish it cannot resolve instead of dropping the line": () => ({ ok: /if \(!d\) return err\(editErrMsg\("unknown_item"\), 400\);/.test(ALL), note: "unknown_item" }),
  "an open-price line with no price typed is refused": () => ({ ok: /if \(price <= 0\) return err\(`Enter a price for/.test(ALL), note: "Enter a price" }),
};

export function gridRows() {
  const out = [];
  for (const r of rows) {
    let res;
    try {
      const mGet = r.text.match(/^GET \/(\S+) exists$/);
      if (mGet) { res = { ok: getEndpoint(mGet[1]) !== "", note: "the endpoint is in today's GET dispatcher" }; }
      else if (FIXED[r.text]) res = FIXED[r.text]();
      else {
        const m = r.text.match(/^(\S+): (.+)$/);
        if (!m) { res = { ok: false, note: "unknown row shape — re-derive by hand" }; }
        else {
          const [, name, prop] = m;
          const code = codeOf(name);
          // RETIRED on purpose: sweep #10 T10 round 2 item 5 removed the bill-printed stamp (owner: "a guest
          // bill never says Reprint"). A question about a door that no longer exists has no subject.
          if (!code && name === "sessions/:id/bill-printed") res = { ok: true, note: "RETIRED 2026-10-10 — sweep #10 T10 round 2 item 5 removed this door on the owner's answer; the route now answers it 'unknown POST endpoint'" };
          else if (!code) res = { ok: false, note: `branch ${name} not found in today's dispatcher` };
          else if (P[prop]) res = P[prop](code, name);
          else if (/^gated on (tablet_[a-z_]+), server-side/.test(prop)) res = gatedOn(prop.match(/tablet_[a-z_]+/)[0])(code);
          else if (/the restaurant's module rung \((\w+)\) is asked first/.test(prop)) res = ladderFirst(prop.match(/\((\w+)\)/)[1])(code);
          else if (/taking money off a bill writes the "(\w+)" Audit row/.test(prop)) res = writesKind(prop.match(/"(\w+)"/)[1])(code, name);
          else res = { ok: false, note: `unknown property "${prop}" — re-derive by hand` };
        }
      }
    } catch (e) { res = { ok: false, note: `threw: ${e.message}` }; }
    out.push({ id: r.id, ledger: "T10.md", ok: res.ok, note: res.note, what: r.text });
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("rerun-grid.mjs")) {
  const res = gridRows();
  const bad = res.filter((r) => !r.ok);
  for (const r of (process.argv.includes("--all") ? res : bad)) console.log(`${r.ok ? "✅" : "❌"} ${r.id} ${r.what} — ${r.note}`);
  console.log(`\n${res.length} grid rows re-run · ${res.length - bad.length} ✅ · ${bad.length} ❌`);
}
