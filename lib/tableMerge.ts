// Which table is REALLY in charge of this one? (mig 249)
//
// A merged child table has no open session of its own — its party, its bill and its money all
// live on the parent's session. Every endpoint that starts from a TABLE NUMBER and looks up
// "the table's open session" must resolve the merge first, or on a merged child it silently
// falls back to table-number matching and acts on HALF a joint bill (found live 2026-08-03:
// the waiter tablet's Mark-paid settled ₹662 of a ₹1,323 party).
//
// Mirrors the SQL helper lfh_merge_parent_table — one hop is enough because merges are always
// flattened onto the root when they are recorded. Returns the table itself when not merged.
// The extra read is one indexed row and only matters while a merge is live.
//
// ── "I COULDN'T ASK" IS NOT "IT ISN'T MERGED" (sweep #10 T4, item 7) ───────────────────────────────
// This used to answer the table itself whenever the read failed — `.data?.[0]` is undefined on an
// error, and a thrown blip was caught — on the reasoning "the unmerged answer is the safe one". The
// paragraph above says the opposite, and it is right: on a merged child the unmerged answer is the
// HALF-BILL answer. Traced on the waiter tablet's Mark paid: no open session is found for the child,
// so the handler falls back to the child's own orders and settles those — ₹662 of a ₹1,323 party,
// the 2026-08-03 incident this file exists for, reachable again through one statement timeout.
// A failed read now propagates. Every caller is inside the editor or tablet write handler, whose
// catch is lib/panelFailure: a database that did not answer is 503 + busy, and the panel's queue
// keeps the tap and sends it again — "blocked for a second" instead of "half a bill paid".
export async function mergeParentTable(sb: { from: (t: string) => any }, rid: string, table: string): Promise<string> {
  const t = String(table || "").trim();
  if (!t) return t;
  const r = await sb.from("table_merges").select("parent_table")
    .eq("restaurant_id", rid).eq("child_table", t).is("ended_at", null).limit(1);
  if (r.error) throw r.error; // keeps its SQLSTATE, so the route can tell busy from refused
  const row = r.data?.[0] as { parent_table?: string } | undefined;
  return row?.parent_table || t;
}
