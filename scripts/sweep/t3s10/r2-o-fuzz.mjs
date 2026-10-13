// Round 2 · Block O — the order-status rules and the saved-order money, FUZZED: thousands of random
// inputs, and the rules that must hold for every one of them (not a handful of hand-picked cases).
import { check, fresh, SRC } from "./lib.mjs";
import { phone } from "./phone.mjs";

let seed = 20261012; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const ST = ["received", "preparing", "served", "cancelled"];
const NOW = 1_800_000_000_000;
function randomList() {
  return Array.from({ length: Math.floor(rnd() * 8) }, (_, i) => ({ id: "o" + i, status: ST[Math.floor(rnd() * 4)], placedAt: NOW - Math.floor(rnd() * 5 * 3_600_000), dismissed: rnd() < 0.15, stripHidden: rnd() < 0.3, tableNumber: "4", total: 1, itemCount: 1 }));
}
async function M() { const P = await phone(); try { return fresh("lib/orderStatus.ts", "client"); } finally { P.restore(); } }
const HOW = "STUB — real lib/orderStatus.ts, 3,000 random order lists";
const F = "lib/orderStatus.ts";
const prop = (id, what, rule) => check(id, F, what, HOW, async () => {
  const S = await M(); let bad = 0, ex = "";
  for (let k = 0; k < 3000; k++) { const l = randomList(); const out = S.liveActiveOrders(l, NOW); if (!rule(l, out, S)) { bad++; if (!ex) ex = JSON.stringify(l.map((o) => [o.status[0], o.dismissed ? "d" : "", Math.round((NOW - o.placedAt) / 60000)])); } }
  return { ok: bad === 0, note: bad ? `${bad} lists broke it, e.g. ${ex.slice(0, 120)}` : "3000 lists" };
});
prop("P172880", "fuzz — the live list only ever holds orders that were in the list it was given", (l, out) => out.every((o) => l.includes(o)));
prop("P172881", "fuzz — no dismissed order and no order older than three hours ever shows", (l, out) => out.every((o) => !o.dismissed && NOW - o.placedAt <= 3 * 3_600_000));
prop("P172882", "fuzz — every order that should show, does (nothing dropped by the sort)", (l, out) => out.length === l.filter((o) => !o.dismissed && NOW - o.placedAt <= 3 * 3_600_000).length);
prop("P172883", "fuzz — every unfinished order sits above every finished one", (l, out, S) => { const i = out.findIndex((o) => S.isFinalStatus(o.status)); return i < 0 || out.slice(i).every((o) => S.isFinalStatus(o.status)); });
prop("P172884", "fuzz — within each group, newest first", (l, out, S) => out.every((o, i) => i === 0 || S.isFinalStatus(out[i - 1].status) !== S.isFinalStatus(o.status) || out[i - 1].placedAt >= o.placedAt));
prop("P172885", "fuzz — sorting twice changes nothing (the order a diner reads is stable)", (l, out, S) => JSON.stringify(S.liveActiveOrders(out, NOW)) === JSON.stringify(out));
prop("P172886", "fuzz — the red dot lights exactly when a hidden order is still cooking", (l, out, S) => S.hasHiddenLiveOrder(l, NOW) === out.some((o) => o.stripHidden && !S.isFinalStatus(o.status)));
// ── the saved-order total, every currency, through the formatter the chip now names ─────────────
const fmt = () => fresh("lib/format.ts", "client");
let n = 172887;
for (const code of ["INR", "USD", "EUR", "AED", "SAR", "QAR"]) {
  check(`P${n++}`, "components/GuestOutboxChip.tsx", `item 2 — fuzz: the chip's formatter prints the bill's figure for 20,000 random totals in ${code}`, "STUB — real lib/format.ts; the formatter read off GuestOutboxChip.tsx", () => {
    const F = fmt(); const cur = F.CURRENCIES.find((c) => c.code === code);
    const name = (SRC.chip.match(/o\.track\?\.total \? ` · \$\{([a-zA-Z]+)\(/) || [])[1];
    let off = 0; for (let k = 0; k < 20000; k++) { const t = Math.round(rnd() * 5_000_000) / 100; const chip = F[name](t, cur); const bill = F.formatAmount(F.toMinor(t * cur.rate, cur), cur); if (chip !== bill) off++; }
    return { ok: name === "formatMoney" && off === 0, note: `${name} · ${off} differ` };
  });
}
// n = 172893
check("P172893", "lib/guestOutbox.ts", "every refusal code survives the trip a live order's error makes (\"Order failed: <code> (<dish>)\" → refusalOf → the same code and dish)", "STUB — real refusalOf over every code reasonMsg words", async () => {
  const P = await phone(); try {
    const codes = [...new Set([...SRC.outbox.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]))];
    const bad = codes.filter((c) => { const r = P.M.refusalOf(new Error(`Order failed: ${c} (Paneer Tikka)`)); return r.reason !== c || r.dish !== "Paneer Tikka"; });
    return { ok: bad.length === 0, note: `${codes.length} codes · broken: ${bad.join(",") || "none"}` };
  } finally { P.restore(); }
});
check("P172894", "lib/guestOutbox.ts", "fuzz — reasonMsg never throws and never returns empty for 2,000 random codes, dishes and kinds", "STUB — real reasonMsg", async () => {
  const P = await phone(); try {
    let bad = 0; const words = ["sold_out", "x", "", "unknown_item", "rate_limited", "∑", "<b>", "null"]; const kinds = ["order", "call", "leave", undefined];
    for (let k = 0; k < 2000; k++) { try { const s = P.M.reasonMsg(words[Math.floor(rnd() * words.length)], { dish: rnd() < 0.5 ? "Tea" : undefined, queued: rnd() < 0.5, kind: kinds[Math.floor(rnd() * 4)] }); if (!s || typeof s !== "string") bad++; } catch { bad++; } }
    return { ok: bad === 0, note: `${bad} bad` };
  } finally { P.restore(); }
});
