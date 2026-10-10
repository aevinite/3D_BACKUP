// The alerts stand-in for terminal 13's harness: records what lib/cancelWatch.ts would have sent to
// the owner's phone, so the threshold, the grouping key and the words can be asserted. Nothing leaves.
import { G } from "../../../panel-stubs/state.mjs";
export async function sendOwnerAlert(text, key, opts) { if (G.ALERT_THROWS) throw new Error("stub: alert channel down"); (G.ALERTS ||= []).push({ text, key, opts }); }
export function alertText(rows, footer) { return rows.map(([k, v]) => `${k}: ${v}`).join("\n") + (footer ? `\n${footer}` : ""); }
