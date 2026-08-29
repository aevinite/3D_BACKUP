// scripts/sweep/make-multi-owner.mjs — creates `diagmulti`, the ONE test owner who owns TWO
// restaurants (owner asked for it, 2026-08-29).
//
// WHY IT EXISTS. Roughly a third of the owner dashboard only renders for an owner with more than
// one restaurant: the estate table and its ten columns, the side drawer, the "top performer /
// needs attention" banner, the stacked daily bars, the in-page restaurant picker, and the top-bar
// switcher's re-scope on Dashboard / Reports / Manager mode / Audit & logs. Every diag owner before
// this one owned exactly one, so six sweeps READ that code and none DROVE it — the T12 ledger says
// so, honestly, at P21092. That is the shape of gap that let two faults sit for months.
//
// WHAT IT IS. A membership only — rows in restaurant_owners (mig 097) for My Little French House
// and Pizza Palace. It owns no data of its own, seeds nothing, and is nobody's primary owner, so it
// changes no figure any other lane measures. Deliberately NOT Aangan, which stays the read-only
// control at factory defaults.
//
// Idempotent — safe to re-run. It prints the exact SQL to undo itself.
//
//   npx tsx --env-file=.env.local scripts/sweep/make-multi-owner.mjs
//
// Then sign in with it from any sweep:  await loginAs(ctx, "ownerMulti", BASE)
import { createClient } from "@supabase/supabase-js";
import { hashSecret } from "../../lib/userAuth.ts";
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const USERNAME = "diagmulti";
const PASSWORD = "diag-multi-2026";
const HOME = "00000000-0000-0000-0000-000000000001"; // My Little French House
const ALSO = "00000000-0000-0000-0000-000000000002"; // Pizza Palace
// NEVER Aangan — it is the read-only control at factory defaults.
const names = await sb.from("restaurants").select("id,slug,name").in("id",[HOME,ALSO]);
console.log("restaurants:", JSON.stringify(names.data));
if ((names.data||[]).some(r => /aangan/i.test(r.slug))) { console.error("refusing: Aangan is in the list"); process.exit(1); }
let u = (await sb.from("staff_users").select("id,username").eq("username", USERNAME).limit(1)).data?.[0];
if (!u) {
  const ins = await sb.from("staff_users").insert({
    username: USERNAME, name: "Diag Multi-Owner", role: "owner", restaurant_id: HOME,
    password_hash: await hashSecret(PASSWORD), active: true, profile_confirmed: true,
    can_self_reset: true, can_self_set_pin: true, token_version: 0,
  }).select("id,username").limit(1);
  if (ins.error) { console.error("insert failed:", ins.error.message); process.exit(1); }
  u = ins.data[0];
  console.log("CREATED staff_users row:", JSON.stringify(u));
} else console.log("already exists:", JSON.stringify(u));
for (const rid of [HOME, ALSO]) {
  const r = await sb.from("restaurant_owners").upsert({ restaurant_id: rid, user_id: u.id }, { onConflict: "restaurant_id,user_id" });
  console.log("membership", rid, r.error ? "FAILED " + r.error.message : "ok");
}
const memb = await sb.from("restaurant_owners").select("restaurant_id").eq("user_id", u.id);
console.log("memberships now:", JSON.stringify(memb.data));
console.log(`\nUNDO:  delete from restaurant_owners where user_id='${u.id}'; delete from staff_users where id='${u.id}';`);
