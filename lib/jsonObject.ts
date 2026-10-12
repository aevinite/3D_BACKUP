// lib/jsonObject.ts — read a request body as a plain object, or as {} when it is anything else.
//
// WHY (sweep #10 T29 round 2, item 26). Fourteen admin handlers read their body as
//     let body = {}; try { body = await req.json(); } catch {}
// which is right for an empty or broken body — `req.json()` throws and `body` stays {} — but WRONG for
// a body that is valid JSON and not an object. `null`, a bare number or a list parse cleanly, so `body`
// became null (or 42), and the very next `body.op` threw a TypeError: a bare "500" from five doors
// (Repair, Resolve, the Access save, the password cover, platform Settings) for a request that should
// simply have been refused in words. No screen sends such a body; the rule is that bad input gets a
// clear refusal, never a crash.
//
// Every caller then refuses the empty object with its own existing sentence ("invalid restaurant_id",
// "Type the admin password." …), so nothing a screen does changes.
export async function jsonObject(req: Request): Promise<Record<string, any>> {
  let parsed: unknown = null;
  try { parsed = await req.json(); } catch { /* empty or not JSON — treated as {} */ }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, any>) : {};
}

// ── AN ID IS TEXT, OR IT IS NOTHING (sweep #10 T29 round 2, item 29) ────────────────────────────────
// `String(body.restaurant_id || "")` turns a ONE-ITEM LIST into its item: String(["<uuid>"]) is "<uuid>",
// so `{ restaurant_id: ["<a real id>"] }` passed every id check and was written to — four admin doors
// (switch a restaurant off, clear its owner, change its colour, save an Access switch) did exactly that
// for a request no screen sends. textOf() keeps a value only when it already IS text; anything else
// becomes "" and meets the route's own existing "Missing restaurant_id" refusal.
export const textOf = (v: unknown): string => (typeof v === "string" ? v : "");
