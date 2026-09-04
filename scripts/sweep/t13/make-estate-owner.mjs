// scripts/sweep/t13/make-estate-owner.mjs — creates `diagestate`, a test owner who owns FIVE
// restaurants, so the 4+ tier of the owner dashboard can be DRIVEN for the first time.
//
// WHY IT EXISTS. `diagmulti` (scripts/sweep/make-multi-owner.mjs) owns TWO, which reaches the
// 2–3 tier: the stacked daily bars, the estate table, the drawer, the picker. It cannot reach the
// 4+ tier at all, and that tier is a different screen:
//
//   · the "🏆 Top performer / ⚠️ Needs attention" split banner (page.tsx `callouts`) — drawn ONLY
//     at 4+ restaurants, and therefore never once rendered by a sweep. The T12 ledger says so at
//     P40015 ("no top-performer banner at the 2-restaurant tier") and admits the gap at P21092.
//   · "Who earns more" (LeaderBar) side by side with the multi-LINE AreaTrend, instead of the
//     stacked bars — the `groupTrend.stacked` false branch.
//   · `portfolioColor(id)` as each restaurant's identity colour rather than the theme greens,
//     which is the whole reason that palette exists (owner, 2026-07-27: most restaurants default
//     to the same gold accent).
//
// WHAT IT IS. A membership only — rows in `restaurant_owners` (mig 097) — plus one staff_users
// row. It owns no data, seeds nothing, is nobody's primary owner, and changes no figure any other
// lane measures. NEVER Aangan, which stays the read-only control at factory defaults.
//
// Idempotent, and it prints the exact SQL to undo itself.
//
//   npx tsx --env-file=.env.local scripts/sweep/t13/make-estate-owner.mjs
//   npx tsx --env-file=.env.local scripts/sweep/t13/make-estate-owner.mjs --undo
//
// Then:  await loginAs(ctx, DIAG_ESTATE, BASE)   // see live-estate.mjs
import { createClient } from "@supabase/supabase-js";
import { hashSecret } from "../../../lib/userAuth.ts";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
export const USERNAME = "diagestate";
export const PASSWORD = "diag-estate-2026";
const HOME = "00000000-0000-0000-0000-000000000001"; // My Little French House
const IDS = [
  HOME,
  "00000000-0000-0000-0000-000000000002", // Pizza Palace
  "00000000-0000-0000-0000-000000000003", // Burger Barn
  "00000000-0000-0000-0000-000000000004", // Spice Route
  "00000000-0000-0000-0000-000000000005", // Sakura Sushi
];
const UNDO = (uid) => [
  `-- undo scripts/sweep/t13/make-estate-owner.mjs`,
  `DELETE FROM restaurant_owners WHERE user_id = '${uid}';`,
  `DELETE FROM staff_users WHERE id = '${uid}' AND username = '${USERNAME}';`,
].join("\n");

const undoMode = process.argv.includes("--undo");

// REFUSE if Aangan is anywhere in the list, by id OR by slug. The list is hard-coded above, so
// this can only fire if someone edits it — which is exactly when a guard earns its keep.
const names = await sb.from("restaurants").select("id,slug,name,active,deleted_at").in("id", IDS);
if (names.error) { console.error("could not read the restaurants:", names.error.message); process.exit(1); }
if ((names.data || []).some((r) => /aangan/i.test(r.slug) || /aangan/i.test(r.name))) {
  console.error("REFUSING: Aangan is in the list — it is the read-only control at factory defaults.");
  process.exit(1);
}
const missing = IDS.filter((id) => !(names.data || []).some((r) => r.id === id));
if (missing.length) { console.error("REFUSING: these ids are not restaurants:", missing); process.exit(1); }
const notLive = (names.data || []).filter((r) => !r.active || r.deleted_at);
if (notLive.length) { console.error("REFUSING: not live/unbinned:", notLive.map((r) => r.slug)); process.exit(1); }
console.log("restaurants:", (names.data || []).map((r) => r.slug).join(", "));

let u = (await sb.from("staff_users").select("id,username").eq("username", USERNAME).limit(1)).data?.[0];

if (undoMode) {
  if (!u) { console.log("nothing to undo — no", USERNAME, "row exists"); process.exit(0); }
  const m = await sb.from("restaurant_owners").delete().eq("user_id", u.id);
  console.log("memberships removed:", m.error ? "FAILED " + m.error.message : "ok");
  const s = await sb.from("staff_users").delete().eq("id", u.id).eq("username", USERNAME);
  console.log("staff_users row removed:", s.error ? "FAILED " + s.error.message : "ok");
  // Prove it, rather than assume it — "delete the exact rows you inserted" is only true if you look.
  const left = await sb.from("restaurant_owners").select("restaurant_id").eq("user_id", u.id);
  const still = (await sb.from("staff_users").select("id").eq("username", USERNAME)).data || [];
  console.log("VERIFIED gone — memberships left:", (left.data || []).length, "· staff rows left:", still.length);
  process.exit((left.data || []).length === 0 && still.length === 0 ? 0 : 1);
}

if (!u) {
  const ins = await sb.from("staff_users").insert({
    username: USERNAME, name: "Diag Estate Owner", role: "owner", restaurant_id: HOME,
    password_hash: await hashSecret(PASSWORD), active: true, profile_confirmed: true,
    can_self_reset: true, can_self_set_pin: true, token_version: 0,
  }).select("id,username").limit(1);
  if (ins.error) { console.error("insert failed:", ins.error.message); process.exit(1); }
  u = ins.data[0];
  console.log("CREATED staff_users row:", JSON.stringify(u));
} else console.log("already exists:", JSON.stringify(u));

for (const rid of IDS) {
  const r = await sb.from("restaurant_owners").upsert({ restaurant_id: rid, user_id: u.id }, { onConflict: "restaurant_id,user_id" });
  console.log("membership", rid.slice(-4), r.error ? "FAILED " + r.error.message : "ok");
}
const check = await sb.from("restaurant_owners").select("restaurant_id").eq("user_id", u.id);
console.log("memberships now:", (check.data || []).length);
console.log("\n" + UNDO(u.id) + "\n");
