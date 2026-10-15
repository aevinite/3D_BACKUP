// scripts/sweep/t12r2/g-every-bit.mjs — sweep #10 T12 ROUND 2 · the GENERATED half: every bit of the tablet's
// code, enumerated from the file itself so nothing can be skipped by forgetting it.
//
//   G1 · every top-level function and arrow in app.js — defined in the RUNNING page, and used (no dead code)
//   G2 · every data-* attribute the panel writes or reads — each one written is read (a handler, or the
//        stylesheet), and each one read is written somewhere (no dead button, no handler for nothing)
//   G3 · every sentence the panel toasts — plain words a waiter can act on: never a code, never empty,
//        never "undefined", never the word "error" alone
//
// Ids are handed out in a fixed order from `firstId`, so a run's ids are stable while the file is the
// same; the ledger row names the function / attribute / sentence it is about.
import { read, ok, F_APP, F_HTML, waiterContext, openPanel } from "../t12s10/lib.mjs";

export function inventory() {
  // Comments OUT for the attribute and toast inventories — an obituary that names a removed hook is
  // not the hook (round 2 found exactly that: data-bill-print-btn quoted in the note about its removal).
  const raw = read(F_APP);
  const s = raw.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => /^\s*\/\//.test(l) ? "" : l).join("\n");
  const fns = [...s.matchAll(/^(?:async )?function (\w+)\s*\(/gm)].map((m) => m[1]);
  const arrows = [...s.matchAll(/^const (\w+) = (?:async )?(?:\([^)]*\)|\w+) =>/gm)].map((m) => m[1]);
  const names = [...new Set([...fns, ...arrows])];
  // Written with a value (data-x="…") OR bare (data-printhere>) — both put the attribute on the element.
  const emitted = new Set([...s.matchAll(/<[^<>]*?\sdata-([a-z][a-z0-9-]*)(?=[\s>=])/g)].map((m) => m[1]).concat([...s.matchAll(/data-([a-z][a-z0-9-]*)=/g)].map((m) => m[1])));
  const readSel = new Set([...s.matchAll(/\[data-([a-z][a-z0-9-]*)/g)].map((m) => m[1]));
  const datasetRead = new Set([...s.matchAll(/\.dataset\.([a-zA-Z]+)/g)].map((m) => m[1].replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())));
  const attrs = [...new Set([...emitted, ...readSel])].sort();
  const toasts = [...new Set([...s.matchAll(/toast\(\s*(["`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]))];
  return { s, names, fns: new Set(fns), emitted, readSel, datasetRead, attrs, toasts };
}

export async function blockG(R, firstId = 181501) {
  const { check } = R;
  let n = firstId;
  const id = () => "P" + n++;
  const inv = inventory();
  const css = read("public/panels/tablet/style.css");
  const html = read(F_HTML);
  const shared = ["guestbell.js", "connbadge.js", "offline.js", "billcustomer.js", "myprofile.js", "issue-raise.js", "undobar.js", "maint.js", "billdoc.js"].map((f) => read("public/panels/" + f)).join("\n");

  // ── G1 · every function ───────────────────────────────────────────────────────────────────────
  const ctx = await waiterContext({ width: 1194, height: 834 });
  const { page, errors } = await openPanel(ctx);
  const types = await page.evaluate((names) => Object.fromEntries(names.map((k) => { try { return [k, typeof (0, eval)(k)]; } catch { return [k, "missing"]; } })), inv.names);
  const body = inv.s.replace(/\/\/[^\n]*/g, "");
  for (const name of inv.names) {
    const uses = (body.match(new RegExp(`(?<![\\w.$])${name}(?![\\w$])`, "g")) || []).length;
    const usedOutside = /^(tickClock)$/.test(name) || html.includes(name) || shared.includes(`.${name}`);
    await check(id(), F_APP, `${name}() is defined in the running panel and something calls it (no dead code)`, "GEN — enumerated from app.js; PAGE typeof + SRC call count", async () =>
      ok(types[name] === "function" && (uses >= 2 || usedOutside), `typeof ${types[name]} · ${uses} mention(s) in code`));
  }
  // ── G2 · every data-* attribute ───────────────────────────────────────────────────────────────
  // Read by: a [data-x] selector, a .dataset.x read, or the stylesheet. Written by: a data-x="…" in a
  // template. An attribute that is only READ by the shared bill/KOT scripts counts as read.
  const STYLE_OR_SHARED = (a) => css.includes(`[data-${a}`) || shared.includes(`data-${a}`) || shared.includes(`[data-${a}`);
  for (const a of inv.attrs) {
    const written = inv.emitted.has(a) || html.includes(`data-${a}=`) || html.includes(`data-${a} `);
    const readBy = inv.readSel.has(a) || inv.datasetRead.has(a) || STYLE_OR_SHARED(a);
    await check(id(), F_APP, `data-${a}: every one the panel writes is read by something, and every one it reads is written`, "GEN — enumerated from app.js; SRC + style.css + shared scripts", async () =>
      ok(written && readBy, `${written ? "written" : "NEVER WRITTEN"} · ${readBy ? "read" : "NEVER READ"}`));
  }
  // ── G3 · every sentence the waiter is toasted ─────────────────────────────────────────────────
  for (const t of inv.toasts) {
    const text = t.replace(/\$\{[^}]*\}/g, "X");
    const codey = /\b[a-z]+_[a-z_]+\b/.test(text.replace(/\$\{[^}]*\}/g, "")) || /\b(null|undefined|NaN|object Object)\b/.test(text);
    // A toast assembled ENTIRELY from other sentences (the table's label + a WHY_SAYS sentence) has
    // nothing literal to judge — so the sentences it is assembled from are judged instead.
    const assembledFrom = /^\$\{/.test(t) && /WHY_SAYS/.test(t) ? [...(inv.s.match(/const WHY_SAYS = \{([\s\S]*?)\};/) || ["", ""])[1].matchAll(/: "([^"]+)"/g)].map((m) => m[1]) : null;
    const empty = !assembledFrom && text.replace(/[^A-Za-z]/g, "").length < 4;
    if (assembledFrom && assembledFrom.some((x) => /\b[a-z]+_[a-z_]+\b/.test(x) || x.length < 12)) { await check(id(), F_APP, `the toast "${t.slice(0, 70)}…" is plain words, never a code`, "GEN — every toast literal in app.js", async () => ok(false, "a WHY_SAYS sentence is code-like or empty")); continue; }
    const bare = /^(error|failed|oops)\.?$/i.test(text.trim());
    await check(id(), F_APP, `the toast "${t.slice(0, 70)}${t.length > 70 ? "…" : ""}" is plain words, never a code`, "GEN — every toast literal in app.js", async () =>
      ok(!codey && !empty && !bare, codey ? "carries a code-like word" : empty ? "too short to say anything" : bare ? "a bare 'failed'" : ""));
  }
  await ctx.close();
  return { next: n, errors };
}
