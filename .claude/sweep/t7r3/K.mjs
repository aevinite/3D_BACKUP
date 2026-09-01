// T7 · third 500 · BLOCK K (P40974–P41000) — THE PANEL AS A GOOD CITIZEN.
// Refreshing, polling and not overwriting other people's work: the rules that keep a floor of
// tablets from costing the restaurant money or losing a waiter's edit.
import { seatParty, retireTables } from "../../../scripts/sweep/fixture.mjs";
import { open, openTable, armToasts, heard, forget, C, dump, at, LEAK } from "./lib.mjs";
at(40974);
const T = ["13"];
let s;
try {
  await retireTables(T); await seatParty(T);
  s = await open();
  const src = await (await fetch("https://3-d-backup.vercel.app/panels/tablet/app.js")).text();

  // ── refreshing ─────────────────────────────────────────────────────────────────────────
  const rt = await s.fr.evaluate(() => ({
    bus: !!window.LFH_RT, catchUp: !!(window.LFH_RT && window.LFH_RT.catchUp),
    hidden: typeof document.hidden === "boolean", sig: typeof lastSig !== "undefined",
    // state.pickerOpen only EXISTS once a picker has been opened, so asking whether the key is
    // defined on a fresh floor answers "no" about a guard that is working perfectly. Open one.
    picker: (() => { const before = state.pickerOpen; renderKotMenu("13", null); const on = state.pickerOpen === true; const back = document.querySelector(".picker-back"); if (back) back.click(); return on && before !== true; })(),
  }));
  C("the panel has a realtime bus", rt.bus);
  C("…with a catch-up for when it has been asleep", rt.catchUp);
  C("…and a signature so an unchanged floor is not repainted", rt.sig);
  C("…and a flag that stops an automatic repaint wiping a picker", rt.picker);
  C("a hidden tab is a thing this panel knows about", /document\.hidden|visibilitychange/.test(src), "visibility is watched");
  C("…and it stands its realtime down rather than holding a channel open", /visibilitychange/.test(src));
  C("the slow backstop poll is 60 seconds, not faster", /6\s*0\s*0\s*0\s*0|60_000|60000/.test(src), "60000ms found");
  C("…and nothing polls on a one-second timer", !/setInterval\([^,]+,\s*(\d{1,3})\)/.test(src.replace(/setInterval\([^,]+,\s*\d{4,}\)/g, "")), "no sub-second interval");
  C("printing never refuses because a tab is in the background", !/document\.hidden[^\n]*return[^\n]*print/i.test(src));

  // ── not overwriting somebody else's work ──────────────────────────────────────────────
  const expects = [...src.matchAll(/expect:\s*\{/g)].length;
  C("writes that edit a value say what they were editing FROM", expects >= 3, `${expects} call sites send an expect`);
  C("…and the panel understands the server's refusal", /e\.data\.clash|clash\.plain/.test(src), "clash.plain is read");
  C("…and says it in the server's own plain sentence, not a code", /toast\(clash\.plain/.test(src), "toast(clash.plain…)");
  C("…and gives it longer on screen than an ordinary note", /toast\(clash\.plain, false, \d{4}\)/.test(src), (src.match(/toast\(clash\.plain, false, (\d+)\)/) || [])[1] + "ms");
  C("…and refreshes so the screen stops showing the losing value", /clash[\s\S]{0,120}load\(\)/.test(src));

  // ── at-most-once ───────────────────────────────────────────────────────────────────────
  const ob = await (await fetch("https://3-d-backup.vercel.app/panels/outbox.js")).text();
  C("every write goes through the outbox", /LFH_OUTBOX/.test(src) && /send/.test(ob), "outbox.send");
  C("…which stamps each one with its own id", /X-LFH-Action-Id/i.test(ob), "X-LFH-Action-Id");
  C("…and the id is made once per action, not per attempt", /crypto\.randomUUID|uuid/i.test(ob), "one id per action");

  // ── reads stay small ───────────────────────────────────────────────────────────────────
  C("the floor read and the table read are two different calls", /\/state/.test(src) && /\/tables/.test(src), "a slim summary and a per-table slice");
  C("…so opening a table does not re-read the whole floor", /selectTable/.test(src) && /ensurePartySlices/.test(src));
  C("the menu is not re-sent on every refresh", /nomenu/.test(src), "nomenu");
  C("…and the panel can tell 'no menu sent' from 'the menu is empty'", /body\.dishes|dishes\b/.test(src));

  // ── the panel's own files cannot go stale ──────────────────────────────────────────────
  const html = await (await fetch("https://3-d-backup.vercel.app/panels/tablet/index.html")).text();
  const vs = [...html.matchAll(/\?v=([0-9a-f]{8})/g)].map((m) => m[1]);
  C("every file the panel loads carries a content hash", vs.length >= 8, `${vs.length} hashed assets`);
  C("…and they are not all the same one", new Set(vs).size > 1, `${new Set(vs).size} distinct hashes`);
  C("…including app.js itself", /app\.js\?v=[0-9a-f]{8}/.test(html), (html.match(/app\.js\?v=[0-9a-f]{8}/) || [])[0]);

  // ── and it all still works ─────────────────────────────────────────────────────────────
  await openTable(s, T[0]);
  const live = await s.fr.evaluate(() => ({ tiles: document.querySelectorAll(".tile[data-t]").length, pop: !!document.querySelector(".detail-pop"), errs: 0 }));
  C("the floor and a table both open after all of that", live.tiles > 0 && live.pop, JSON.stringify(live));
  C("no uncaught page error in the whole block", s.errs.length === 0, s.errs.join(" | ").slice(0, 200));
  C("no leaked code text on screen", !LEAK.test(await s.fr.evaluate(() => document.body.innerText)));
} catch (e) { C("block K completed without crashing", false, String(e.message).slice(0, 220)); }
finally { if (s) try { await s.browser.close(); } catch {} await retireTables(T); process.exitCode = dump("K") ? 1 : 0; }
