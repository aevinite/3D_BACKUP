// Verifies the owner "home restaurant" resolver — the fix for
// `staff_users_restaurant_fk` when restaurant #1 doesn't exist on a stack.
// DEV DB ONLY (reads .env.local). It creates one throwaway owner login and deletes it.
//
// Run: npm run verify:owner-home
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { resolveOwnerHomeRid, loginNameTaken, DEFAULT_RID } from "@/lib/ownerHome";

const MISSING = "00000000-0000-0000-0000-0000000009ff"; // an id no stack has → forces the fallbacks
let fails = 0;
const check = (label: string, pass: boolean, extra = "") => {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`);
  if (!pass) fails++;
};

const live = await sb.from("restaurants").select("id, slug").is("deleted_at", null)
  .order("created_at", { ascending: true }).limit(50);
const ids = (live.data ?? []).map((r) => r.id as string);
if (!ids.length) { console.log("FAIL  dev DB has no restaurants to test with"); process.exit(1); }

// 1) Normal stack: #1 exists → nothing changes.
const a = await resolveOwnerHomeRid([]);
check("#1 present → anchors to #1", a.rid === DEFAULT_RID, a.rid ?? a.error);

// 2) #1 missing + the admin picked restaurants → anchors to the first picked one.
const picked = ids.filter((i) => i !== DEFAULT_RID).slice(0, 2);
const b = await resolveOwnerHomeRid(picked, MISSING);
check("#1 gone → anchors to the first picked restaurant", b.rid === picked[0], b.rid ?? b.error);

// 3) #1 missing + nothing picked → anchors to the oldest live restaurant.
const c = await resolveOwnerHomeRid([], MISSING);
check("#1 gone, none picked → anchors to the oldest live restaurant",
  !!c.rid && ids.includes(c.rid), c.rid ?? c.error);

// 4) A picked id that isn't a real restaurant is ignored, not trusted.
const d = await resolveOwnerHomeRid([MISSING], MISSING);
check("a bogus picked id falls through to a real restaurant",
  !!d.rid && ids.includes(d.rid), d.rid ?? d.error);

// 5) The name check is global, not per-restaurant.
const known = (await sb.from("staff_users").select("username").limit(1)).data?.[0]?.username as string | undefined;
check("an existing login name reads as taken", known ? await loginNameTaken(known) : false, known ?? "no staff_users row");
check("a fresh name reads as free", !(await loginNameTaken("zz-nobody-" + Date.now())));

// 6) The real thing: a staff_users insert with the resolved anchor is accepted by the FK.
const uname = "zz-verify-owner-" + Date.now();
const home = await resolveOwnerHomeRid(picked, MISSING);
const ins = await sb.from("staff_users").insert({
  username: uname, name: uname, role: "owner", restaurant_id: home.rid!,
  password_hash: "x".repeat(20), active: false,
}).select("id, restaurant_id").single();
check("insert with the resolved anchor passes staff_users_restaurant_fk",
  !ins.error && ins.data?.restaurant_id === home.rid, ins.error?.message ?? "");
if (ins.data?.id) {
  const del = await sb.from("staff_users").delete().eq("id", ins.data.id);
  check("throwaway login cleaned up", !del.error, del.error?.message ?? "");
}

// 7) The old hardcode would have failed on such a stack — show the FK actually rejects it.
const bad = await sb.from("staff_users").insert({
  username: uname + "-old", name: uname, role: "owner", restaurant_id: MISSING,
  password_hash: "x".repeat(20), active: false,
}).select("id").single();
check("a non-existent restaurant_id is still rejected by the FK (the old bug)",
  !!bad.error && /foreign key|staff_users_restaurant_fk/i.test(bad.error.message), bad.error?.code ?? "no error!");
if (bad.data?.id) await sb.from("staff_users").delete().eq("id", bad.data.id);

console.log(fails ? `\n${fails} check(s) failed` : "\nall checks passed");
process.exit(fails ? 1 : 0);
