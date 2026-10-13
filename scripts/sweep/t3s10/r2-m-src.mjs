// Round 2 · Block M — NOTHING A SCREEN STARTS OUTLIVES IT. For every component in the territory: every
// event it listens to is also un-listened (same target, same event), and every repeating timer it
// starts is cleared. Derived from the files, so a new listener without its removal turns a row red.
import { check, SRC, FILES } from "./lib.mjs";

const HOW = "SRC — every addEventListener / setInterval in the file, paired by target and event";
const COMPONENTS = ["cart", "bell", "chef", "chip", "mini", "confirm", "tracker", "stars"];
let n = 172901;
for (const k of COMPONENTS) {
  const t = SRC[k];
  const adds = [...t.matchAll(/(\b[a-zA-Z.?]+)\.addEventListener\("([a-z:-]+)"/g)].map((m) => `${m[1].replace(/\?/g, "")}|${m[2]}`);
  const rems = new Set([...t.matchAll(/(\b[a-zA-Z.?]+)\.removeEventListener\("([a-z:-]+)"/g)].map((m) => `${m[1].replace(/\?/g, "")}|${m[2]}`));
  for (const a of [...new Set(adds)]) {
    check(`P${n++}`, FILES[k], `${FILES[k].split("/").pop()} — '${a.split("|")[1]}' on ${a.split("|")[0]} is removed again when the screen goes`, HOW, () => rems.has(a));
  }
  const iv = (t.match(/setInterval\(/g) || []).length, cl = (t.match(/clearInterval\(/g) || []).length;
  if (iv) check(`P${n++}`, FILES[k], `${FILES[k].split("/").pop()} — every repeating timer it starts (${iv}) is cleared`, HOW, () => cl >= iv);
}
export const M_LAST = () => n - 1;
