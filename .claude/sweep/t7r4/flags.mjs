// Flip a per-restaurant switch on the DEV DB (My Little French House — the only one written to).
// Splitting a bill starts OFF (mig 248) and this restaurant had it off, which is why the first two
// 500-check passes could only reach the split screen through the door that ignored the switch.
import { readFileSync } from "node:fs";
const t = readFileSync(new URL("../../../.env.local", import.meta.url), "utf8");
const g = (k) => (t.match(new RegExp("^" + k + "=(.+)$", "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
const url = g("NEXT_PUBLIC_SUPABASE_URL"), key = g("SUPABASE_SERVICE_ROLE_KEY");
const RID = "00000000-0000-0000-0000-000000000001";
export const setSplit = async (on) => {
  const r = await fetch(`${url}/rest/v1/settings?restaurant_id=eq.${RID}`, { method: "PATCH", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ split_bill_enabled: !!on }) });
  if (!r.ok) throw new Error("could not set split_bill_enabled: " + r.status);
};
