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
export async function mergeParentTable(sb: { from: (t: string) => any }, rid: string, table: string): Promise<string> {
  const t = String(table || "").trim();
  if (!t) return t;
  try {
    const row = (await sb.from("table_merges").select("parent_table")
      .eq("restaurant_id", rid).eq("child_table", t).is("ended_at", null).limit(1))
      .data?.[0] as { parent_table?: string } | undefined;
    return row?.parent_table || t;
  } catch {
    return t; // a read hiccup must never block the action — the unmerged answer is the safe one
  }
}
