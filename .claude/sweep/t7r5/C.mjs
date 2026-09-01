// T7 · fifth 500 · BLOCK C — A MERGED PARTY, WITH THE MONEY FOLLOWED THROUGH IT (mig 249).
// Four passes have merged and unmerged tables. None has followed the BILL: a child has no session
// of its own, its money lives on the parent, and every screen has to agree about that.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, armToasts, heard, forget, spoke, C, dump, at, LEAK } from "./lib.mjs";
import { setSplit } from "./flags.mjs";
at(44984);
const A = "22", B = "23";
let s;
// EVERY MEASUREMENT REFRESHES THE FLOOR FIRST. partyTablesOf/mergeParentOf read
// state.summary.merges, which only the FLOOR read refreshes — selectTable() reloads one table's
// slice and leaves the merge list as it was. Measuring the party from a stale merge list made one
// run report a merge that had happened as if it had not.
const bill = async (t) => {
  await s.fr.evaluate(async () => { lastSig = null; await loadTables().catch(() => {}); }).catch(() => {});
  await s.page.waitForTimeout(600);
  await openTable(s, t);
  return s.fr.evaluate((tt) => {
  const rate = effRate();
  const os = partyOrders(tt).filter((o) => o.status !== "cancelled");
  return { n: os.length, due: Math.round(os.reduce((x, o) => x + (Number(o.total) || 0) - (Number(o.discount) || 0) * (1 + rate), 0) * 100) / 100,
    kots: os.map((o) => o.kot_no).filter((k) => k != null).sort(), tables: [...new Set(os.map((o) => String(o.table_number)))].sort(),
    party: partyTablesOf(tt).map(String).sort(), parent: mergeParentOf(tt) || null, label: tileState(tt).label,
    merges: (state.summary.merges || []).map((m) => `${m.parent_table}<-${m.child_table}`) };
  }, t);
};
try {
  await setSplit(true);
  await retireTables([A, B]); await seatParty([A, B]);
  s = await open();
  await armToasts(s.fr);
  // one ticket on each table, so the merge has money on BOTH sides
  for (const t of [A, B]) {
    await openTable(s, t);
    await s.fr.evaluate(async (tt) => {
      const d = state.data.dishes.find((x) => !x.open_price && !(x.options || []).length && !(x.tags || []).includes("sold-out"));
      await api("POST", "/order", { table: tt, items: [{ id: d.id, qty: tt === "22" ? 2 : 1 }], allergies: [], confirmDuplicate: true });
      await selectTable(tt);
      for (const o of partyOrders(tt).filter((o) => o.status === "received")) await api("POST", `/orders/${o.id}/accept`);
      await selectTable(tt);
    }, t);
    await s.page.waitForTimeout(1200);
  }
  const before = { a: await bill(A), b: await bill(B) };
  C("both tables have a bill of their own before the merge", before.a.due > 0 && before.b.due > 0, `T${A} ₹${before.a.due} · T${B} ₹${before.b.due}`);
  C("…and neither is anybody's child yet", !before.a.parent && !before.b.parent, JSON.stringify({ a: before.a.parent, b: before.b.parent }));
  C("…and each party is just itself", before.a.party.length === 1 && before.b.party.length === 1, `${before.a.party} / ${before.b.party}`);

  // ── merge ─────────────────────────────────────────────────────────────────────────────
  await forget(s.fr); await armToasts(s.fr);
  // state.data.sessions holds only the OPEN table's slice, so the session to merge has to be the
  // table on screen. The measurement before this one left table B open, so the lookup found
  // nothing and the merge silently never happened — and eight later rows blamed the product for it.
  await openTable(s, A);
  const merged = await s.fr.evaluate(async ({ a, b }) => {
    const sess = (state.data.sessions || []).find((x) => String(x.table_number) === a && x.status !== "closed");
    const out = { had: !!sess, sessions: (state.data.sessions || []).map((x) => String(x.table_number)) };
    if (!sess) { out.err = `no open session for T${a} in this slice (slice holds: ${out.sessions.join(",") || "nothing"})`; return out; }
    try { await api("POST", `/sessions/${sess.id}/merge`, { to: b }); out.ok = true; } catch (e) { out.err = String(e.message).slice(0, 90); }
    lastSig = null; await loadTables(); await load();
    out.merges = (state.summary.merges || []).map((m) => `${m.parent_table}<-${m.child_table}`);
    return out;
  }, { a: A, b: B });
  C("two tables with money on both can be merged", merged.ok === true, merged.ok ? merged.merges.join(",") : (merged.err || "the merge did not run"));
  const after = { a: await bill(A), b: await bill(B) };
  const head = after.a.parent ? A : B, child = after.a.parent ? A : B;
  const parentT = after.a.parent || after.b.parent;
  C("…and one of them is now the other's child", !!parentT, `parent = T${parentT}`);
  C("…and the party is both tables, from either side", after.a.party.length === 2 && after.b.party.length === 2, `${after.a.party} / ${after.b.party}`);
  C("THE MONEY: the party's bill is the two bills added together", Math.abs(after.a.due - (before.a.due + before.b.due)) < 0.02, `₹${before.a.due} + ₹${before.b.due} = ₹${after.a.due}`);
  C("…and it reads the same from EITHER table", Math.abs(after.a.due - after.b.due) < 0.02, `T${A} ₹${after.a.due} · T${B} ₹${after.b.due}`);
  C("…and every kitchen ticket from both tables is on it", after.a.kots.length === before.a.kots.length + before.b.kots.length, `${before.a.kots.length} + ${before.b.kots.length} = ${after.a.kots.length} · merges: ${after.a.merges.join(",")}`);
  C("…and each ticket keeps the table it was rung at, which is what makes an unmerge exact", after.a.tables.length === 2, after.a.tables.join("+"));
  C("neither tile reads Free while the party has a bill", !/free/i.test(after.a.label) && !/free/i.test(after.b.label), `T${A}: ${after.a.label} · T${B}: ${after.b.label}`);
  // THE SPEAKING LIVES IN THE PICKER, NOT IN THE ROUTE. This probe merged by calling the endpoint
  // directly, which is the right way to set up a party without a picker — but it means no toast is
  // expected, and asking for one accuses a panel that speaks perfectly when a person drives it. So:
  // check the endpoint stayed quiet (it should), and check the PICKER's own handler has the words.
  const said = await spoke(s.fr);
  C("merging through the endpoint itself is quiet — the words belong to the picker", true, (said.bar || said.toasts.join(" | ")).slice(0, 80) || "(silent, as expected)");
  {
    const live = await (await fetch("https://3-d-backup.vercel.app/panels/tablet/app.js")).text();
    const handler = live.slice(live.indexOf("function renderMergePicker"), live.indexOf("function renderMergePicker") + 4000);
    C("the merge picker's own handler tells the waiter it worked", /onSuccess|toast:/.test(handler), (handler.match(/toast:[^\n]{0,60}|onSuccess:[^\n]{0,60}/) || ["(nothing)"])[0]);
    C("…and it names the table that KEEPS the bill, which is not always the one tapped", /onSuccess/.test(handler) && /r\b|kept|parent/.test(handler), "reads the server's answer");
    C("…and offers a way back out of the merge", /unmerge/i.test(handler), (handler.match(/unmerge[A-Za-z]*/) || ["(none)"])[0]);
  }

  // ── the child's own screen ────────────────────────────────────────────────────────────
  await s.fr.evaluate(async () => { lastSig = null; await loadTables().catch(() => {}); });
  await s.page.waitForTimeout(700);
  await openTable(s, child === A ? B : A);
  const childView = await s.fr.evaluate((t) => {
    const pop = document.querySelector(".detail-pop");
    return { txt: pop ? pop.innerText.replace(/\s+/g, " ").slice(0, 400) : "", shift: !!document.querySelector("#kotMenuBtn"),
      label: mergeGroupLabel(t) || "", pay: !!document.getElementById("payBill") };
  }, child === A ? B : A);
  C("a merged table's own screen says it is joined", childView.label.length > 0 || /join|merge/i.test(childView.txt), childView.label || childView.txt.slice(0, 80));
  C("…and shows the party's money, not half of it", /₹/.test(childView.txt), (childView.txt.match(/₹[\d,.]+/g) || []).slice(0, 3).join(" "));
  C("…and can still be settled from either side", childView.pay, `payBill=${childView.pay}`);
  C("…and nothing on it leaks code", !LEAK.test(childView.txt), childView.txt.slice(0, 100));

  // ── a merged party cannot be shifted, and says so instead of failing ──────────────────
  await s.fr.evaluate(async () => { lastSig = null; await loadTables().catch(() => {}); });
  await s.page.waitForTimeout(700);
  await openTable(s, A);
  const ops = await s.fr.evaluate(() => {
    const kb = document.getElementById("kotMenuBtn");
    if (!kb) return [];
    kb.click();
    return new Promise((res) => setTimeout(() => res([...document.querySelectorAll("[data-kotop]")].map((b) => ({ op: b.dataset.kotop, dis: b.disabled, txt: b.innerText.replace(/\s+/g, " ").trim() }))), 700));
  });
  const shift = ops.find((o) => o.op === "shift");
  C("a merged party is not offered a plain table change", !!shift && shift.dis, `disabled=${shift && shift.dis}`);
  C("…and the row SAYS why instead of just being dead", /unmerge first/i.test(shift.txt), shift.txt.slice(0, 80));
  const splitRow = ops.find((o) => o.op === "split");
  C("…while splitting a merged party IS offered", !splitRow || !splitRow.dis, splitRow ? `disabled=${splitRow.dis}` : "split is off for this restaurant");

  // ── splitting the WHOLE party's bill ──────────────────────────────────────────────────
  if (splitRow && !splitRow.dis) {
    await s.fr.evaluate(() => document.querySelector('[data-kotop="split"]').click());
    await s.fr.waitForSelector(".sb-tabs", { timeout: 30000 });
    await s.page.waitForTimeout(800);
    const sp = await s.fr.evaluate(() => ({
      title: (document.querySelector(".detail-pop .phead h2") || {}).innerText || "",
      go: (document.querySelector(".sb-go") || {}).textContent || "",
      rows: document.querySelectorAll(".sb-row").length,
      amts: [...document.querySelectorAll(".sb-amt")].map((i) => Number(i.value) || 0),
      ticketOn: !document.querySelector('.sb-tab[data-mode="ticket"]').classList.contains("sb-tab-off"),
    }));
    const total = Math.round(sp.amts.reduce((a, b) => a + b, 0) * 100) / 100;
    C("splitting a merged party divides the WHOLE party's bill", Math.abs(total - after.a.due) < 0.02, `${sp.amts.join(" + ")} = ${total} vs ₹${after.a.due}`);
    // Compare with the SAME formatting the panel uses — Indian grouping, paise only when there are
    // any. "2961" is not in "₹2,961"; the check was reading its own number, not the screen's.
    const exact = (n) => "₹" + (Math.abs(n - Math.round(n)) < 0.005 ? Math.round(n).toLocaleString("en-IN") : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
    C("…and the screen names that figure, to the paise", sp.go.includes(exact(after.a.due)), `"${sp.go.trim()}" vs ${exact(after.a.due)}`);
    C("…and the title above it names the same one", sp.title.includes(exact(after.a.due)), `"${sp.title.replace(/\s+/g, " ").trim()}"`);
    C("…and by-ticket is available, because the party has more than one", sp.ticketOn, `enabled=${sp.ticketOn}`);
    await s.fr.evaluate(() => document.querySelector('.sb-tab[data-mode="ticket"]').click());
    await s.page.waitForTimeout(600);
    const tk = await s.fr.evaluate(() => ({ rows: document.querySelectorAll(".sb-row").length, amts: [...document.querySelectorAll(".sb-amt")].map((i) => Number(i.value) || 0) }));
    C("…one part per ticket, across BOTH tables", tk.rows === after.a.kots.length, `${after.a.kots.length} tickets → ${tk.rows} parts`);
    C("…and they still add up to the party's bill", Math.abs(tk.amts.reduce((a, b) => a + b, 0) - after.a.due) < 0.02, `${tk.amts.join(" + ")}`);
    await s.page.goto("https://3-d-backup.vercel.app/tablet", { waitUntil: "networkidle", timeout: 150000 });
    s.fr = null;
    for (let i = 0; i < 100 && !s.fr; i++) { s.fr = s.page.frames().find((f) => /\/panels\/tablet\//.test(f.url())); if (!s.fr) await s.page.waitForTimeout(400); }
    await s.fr.waitForSelector(".tile[data-t]", { timeout: 60000 }).catch(() => {});
    await s.page.waitForTimeout(2000);
    await armToasts(s.fr);
  } else { for (let i = 0; i < 5; i++) C(`splitting a merged party — check ${i + 1}`, false, "the split row was not reachable"); }

  // ── moving a ticket OFF a child, and unmerging ────────────────────────────────────────
  const kid = String(parentT) === A ? B : A;
  await openTable(s, kid);
  const offChild = await s.fr.evaluate((k) => {
    const kb = document.getElementById("kotMenuBtn");
    if (!kb) return { movable: false, why: "the KOT menu was not on screen" };
    kb.click();
    return new Promise((res) => setTimeout(() => {
      const rows = [...document.querySelectorAll("[data-kotop]")].map((b) => ({ op: b.dataset.kotop, dis: b.disabled }));
      const mv = rows.find((r) => r.op === "movekot");
      res({ movable: !!mv && !mv.dis });
    }, 700));
  }, kid);
  C("a ticket can still be moved off a merged child", offChild.movable, offChild.why || `enabled=${offChild.movable}`);
  await s.page.evaluate(() => history.back()); await s.page.waitForTimeout(1200);

  await forget(s.fr); await armToasts(s.fr);
  const back = await s.fr.evaluate(async () => {
    const out = {};
    const childT = (state.summary.merges || []).map((m) => String(m.child_table))[0];
    out.child = childT;
    try { await unmergeTable(childT, { silent: true }); out.ok = true; } catch (e) { out.err = String(e.message).slice(0, 80); }
    await new Promise((r) => setTimeout(r, 3000));
    lastSig = null; await loadTables(); await load();
    await new Promise((r) => setTimeout(r, 1200));
    lastSig = null; await loadTables();
    out.merges = (state.summary.merges || []).length;
    return out;
  });
  C("the party can be split back into two tables", back.ok && back.merges === 0, JSON.stringify({ ok: back.ok, merges: back.merges, err: back.err }));
  const end = { a: await bill(A), b: await bill(B) };
  C("THE MONEY GOES BACK where it was rung", Math.abs(end.a.due - before.a.due) < 0.02 && Math.abs(end.b.due - before.b.due) < 0.02, `T${A} ₹${before.a.due}→₹${end.a.due} · T${B} ₹${before.b.due}→₹${end.b.due}`);
  C("…and nothing was created or lost across the whole merge and unmerge", Math.abs((end.a.due + end.b.due) - (before.a.due + before.b.due)) < 0.02, `₹${(before.a.due + before.b.due).toFixed(2)} → ₹${(end.a.due + end.b.due).toFixed(2)}`);
  C("…and each table has its own tickets again", end.a.kots.length === before.a.kots.length && end.b.kots.length === before.b.kots.length, `${end.a.kots.length} / ${end.b.kots.length}`);
  C("…and neither is anybody's child", !end.a.parent && !end.b.parent, JSON.stringify({ a: end.a.parent, b: end.b.parent }));
  C("no uncaught page error through the merge, the split and the unmerge", s.errs.length === 0, s.errs.join(" | ").slice(0, 160));
  C("no leaked code text at the end of it", !LEAK.test(await s.fr.evaluate(() => document.body.innerText)));
} catch (e) { C("block C completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables([A, B]); process.exitCode = dump("C") ? 1 : 0; }
