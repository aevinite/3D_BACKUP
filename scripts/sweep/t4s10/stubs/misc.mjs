// Stand-ins for the small server helpers my files lean on: the activity log, the removal audit, the
// issue-media store, the menu bundle and the table-of-action resolver. Each records what it was asked.
import { W } from "./world.mjs";
const rec = (k, v) => { ((W.misc.log ||= []).push({ k, v })); };
export async function logAction(panel, action, fields) { rec("logAction", { panel, action, fields }); }
export async function recordRemoval(x) { rec("recordRemoval", x); }
export function deviceIdFrom() { return W.misc.device ?? "dev-stub"; }
export async function storeIssueMedia(rid, file, kind) { rec("store", { rid, kind, size: file && file.size }); if (W.misc.storeThrows) throw new Error(W.misc.storeThrows); return "https://stub/issue-media/" + rid + "/x"; }
export async function getMenuBundle(rid) { rec("bundle", rid); if (W.misc.bundleThrows) throw new Error("bundle read failed"); return W.misc.bundle ?? { items: [{ id: "d1", title: "Dish" }], categories: [{ id: "c1", title: "Cat" }] }; }
export const normTable = (v) => { const n = parseInt(String(v ?? "").trim(), 10); return Number.isFinite(n) && n > 0 ? String(n) : ""; };
export async function affectedTables(rid, a, b, c) { rec("affected", { rid, a, b, c }); return W.misc.affected ?? { tables: [normTable(b)], unknown: false }; }
