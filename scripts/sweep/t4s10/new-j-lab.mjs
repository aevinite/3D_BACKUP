// Block J — ROUND 2 (2026-10-15): THE SCREEN LAB (P173641…). My territory's seven screens and the
// restaurant context, bundled for a browser and driven in Chromium with the database's answers held in
// the page — so every branch a diner can reach is reached, measured (cover.mjs --lab) and checked
// against deliberate breaks (mutate.mjs). The order of the parts below fixes the ids; append, never insert.
import { band } from "./lib.mjs";
band(173641);
await import("./lab/j1-trap-ban-ctx.mjs");
await import("./lab/j2-owner-cart-bill.mjs").catch((e) => { if (!/Cannot find module/.test(e.message)) throw e; });
await import("./lab/j3-card.mjs").catch((e) => { if (!/Cannot find module/.test(e.message)) throw e; });
await import("./lab/j4-gate.mjs").catch((e) => { if (!/Cannot find module/.test(e.message)) throw e; });
await import("./lab/j5-gaps.mjs").catch((e) => { if (!/Cannot find module/.test(e.message)) throw e; });
