// Round 2 · Block K — every refusal code × every kind of saved thing × both tenses: the sentence a
// diner reads is never a code, never empty, and never names the WRONG thing (an order to someone who
// only rang the bell; "order again" to someone who left).
import { check, CODE } from "./lib.mjs";
import { phone } from "./phone.mjs";

const F = "lib/guestOutbox.ts";
const HOW = "STUB — real reasonMsg, every code read off lib/guestOutbox.ts itself";
const CODES = [...new Set([...CODE.outbox.matchAll(/case "([a-z_]+)":/g)].map((m) => m[1]))];
let P = null;
const M = async () => { if (!P) { P = await phone(); P.restore(); } return P.M; };
let n = 172841;
for (const code of CODES) {
  check(`P${n++}`, F, `"${code}" — a saved CALL reads as being about a call or the table, never about an order`, HOW, async () => {
    const s = (await M()).reasonMsg(code, { queued: true, kind: "call" });
    return { ok: !!s && !/[a-z]+_[a-z]+/.test(s) && !/\border(ed)?\b(?! again)/i.test(s.replace(/sold out|menu/gi, "")) , note: s };
  });
  check(`P${n++}`, F, `"${code}" — a saved LEAVE never tells the diner to order again`, HOW, async () => {
    const s = (await M()).reasonMsg(code, { queued: true, kind: "leave" });
    return { ok: !!s && !/[a-z]+_[a-z]+/.test(s) && !/order again|please order/i.test(s), note: s };
  });
}
check(`P${n++}`, F, "the code list this block walked is the function's own, not a typed copy (derived from the file)", "SRC", () => ({ ok: CODES.length >= 19, note: `${CODES.length} codes: ${CODES.join(", ")}` }));
