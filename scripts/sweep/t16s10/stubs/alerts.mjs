// Stand-in for lib/alerts: RECORDS what would have gone to the owner's phone, sends nothing.
import { G } from "../../../panel-stubs/state.mjs";
export async function sendOwnerAlert(text, key, opts) { (G.ALERTS ||= []).push({ text, key, opts }); return true; }
export function alertText(pairs, tail) { return pairs.filter((p) => p[1]).map((p) => `${p[0]}: ${p[1]}`).join("\n") + (tail ? "\n" + tail : ""); }
