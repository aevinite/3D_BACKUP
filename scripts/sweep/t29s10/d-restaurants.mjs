// Section D — Admin console → Restaurants (/api/admin/restaurants): the list, the owner picker, the
// recycle bin (and what is inside a binned restaurant), suspend, bin, restore, purge, create, and
// new owner logins. 848 lines and the most-touched file in the territory. Driven only along refusals
// and reads; every count the screen is handed is CROSS-CHECKED against the database's own count.
export default function section(c) {
  const F = "app/api/admin/restaurants/route.ts";
  const S = () => c.clean(F);
  const branch = (name) => { const s = S(); const a = s.indexOf(`if (action === "${name}")`); const b = s.indexOf("if (action ", a + 10); return s.slice(a, b > -1 ? b : s.length); };
  const get = async (q = "") => (c.cache[`r${q}`] ||= await c.req(`/api/admin/restaurants${q}`));

  c.sec("D · Restaurants — the list, cross-checked against the database");
  c.phase("the live list holds exactly the restaurants that are not in the bin", "GET; compare with a head count of deleted_at IS NULL", async () => {
    const r = await get(); const n = await c.count("restaurants", "deleted_at=is.null");
    return r.status === 200 && r.json.restaurants.length === n || `route ${r.json?.restaurants?.length}, database ${n}`;
  });
  c.phase("…sorted by name, as the page expects", "compare with a sorted copy", async () => {
    const names = (await get()).json.restaurants.map((x) => x.name);
    return JSON.stringify(names) === JSON.stringify([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) || "not in name order";
  });
  c.phase("every restaurant's 'has settings' flag matches whether a settings row really exists", "look each up", async () => {
    const rs = (await get()).json.restaurants;
    const rows = (await c.sq(`settings?select=restaurant_id&restaurant_id=in.(${rs.map((x) => x.id).join(",")})`)).json;
    const have = new Set(rows.map((x) => x.restaurant_id));
    const wrong = rs.filter((x) => x.hasSettings !== have.has(x.id));
    return wrong.length === 0 || wrong.map((x) => x.name).join(", ");
  });
  c.phase("every primary owner's NAME on the list is that person's own name", "look each owner up", async () => {
    const rs = (await get()).json.restaurants.filter((x) => x.ownerUserId);
    const us = (await c.sq(`staff_users?select=id,name,username&id=in.(${rs.map((x) => x.ownerUserId).join(",")})`)).json;
    const nm = new Map(us.map((u) => [u.id, u.name || u.username]));
    const wrong = rs.filter((x) => x.ownerName !== null && x.ownerName !== "—" && x.ownerName !== nm.get(x.ownerUserId));
    return wrong.length === 0 || wrong.map((x) => `${x.name}: ${x.ownerName}`).join(", ");
  });
  c.phase("French House's 'linked owners' are exactly the people in restaurant_owners for it", "compare with the join table", async () => {
    const fh = (await get()).json.restaurants.find((x) => x.id === c.FH);
    const links = (await c.sq(`restaurant_owners?select=user_id&restaurant_id=eq.${c.FH}`)).json.map((x) => x.user_id);
    const us = (await c.sq(`staff_users?select=id,name,username,role&id=in.(${links.join(",")})`)).json.filter((u) => u.role === "owner");
    const want = [...new Set(us.map((u) => u.name || u.username))].sort();
    return JSON.stringify([...(fh.linkedOwners || [])].sort()) === JSON.stringify(want) || `route ${fh.linkedOwners}, table ${want}`;
  });
  c.phase("…and Aangan's are Aangan's own (read only)", "the same, for the control", async () => {
    const a = (await get()).json.restaurants.find((x) => x.id === c.AANGAN);
    const links = (await c.sq(`restaurant_owners?select=user_id&restaurant_id=eq.${c.AANGAN}`)).json.map((x) => x.user_id);
    const us = links.length ? (await c.sq(`staff_users?select=id,name,username,role&id=in.(${links.join(",")})`)).json.filter((u) => u.role === "owner") : [];
    const want = [...new Set(us.map((u) => u.name || u.username))].sort();
    return JSON.stringify([...(a.linkedOwners || [])].sort()) === JSON.stringify(want) || `route ${a.linkedOwners}, table ${want}`;
  });
  c.phase("the owner picker lists only ACTIVE owners — never a manager, never a disabled login", "look every picker entry up", async () => {
    const os = (await get()).json.owners;
    const us = (await c.sq(`staff_users?select=id,role,active&id=in.(${os.map((o) => o.id).join(",")})`)).json;
    return us.length === os.length && us.every((u) => u.role === "owner" && u.active === true) || "a non-owner or an inactive login is offered";
  });
  c.phase("…and it holds every active owner there is", "head count of active owners", async () => {
    const n = await c.count("staff_users", "role=eq.owner&active=eq.true");
    return (await get()).json.owners.length === n || `picker ${(await get()).json.owners.length}, database ${n}`;
  });
  c.phase("no money appears anywhere in the list", "search the whole answer", async () => !/₹|"(total|revenue|amount|mrr)"/.test((await get()).text) || "money in the list");
  c.phase("a healthy list carries no 'unread' flag (so the screen shows no false warning)", "GET", async () => !("unread" in (await get()).json) || `unread: ${(await get()).json.unread}`);

  c.sec("D · Restaurants — the recycle bin, cross-checked");
  c.phase("the bin holds exactly the binned restaurants that were not permanently removed", "GET ?deleted=1 vs a head count", async () => {
    const r = await get("?deleted=1"); const n = await c.count("restaurants", "deleted_at=not.is.null&purged_at=is.null");
    return r.status === 200 && r.json.trashed.length === n || `route ${r.json?.trashed?.length}, database ${n}`;
  });
  c.phase("…newest first", "compare deletedAt order", async () => {
    const d = (await get("?deleted=1")).json.trashed.map((x) => x.deletedAt);
    return d.every((x, i) => i === 0 || d[i - 1] >= x) || "not newest first";
  });
  c.phase("…every one reports how long it has sat there, and every one can be removed (the 90-day wait is gone)", "read daysHeld / canPurge", async () => {
    const t = (await get("?deleted=1")).json.trashed;
    return t.every((x) => Number.isInteger(x.daysHeld) && x.daysHeld >= 0 && x.canPurge === true) && (await get("?deleted=1")).json.retentionDays === 0 || "daysHeld/canPurge wrong";
  });
  c.phase("what is inside a binned restaurant is counted by the database, not guessed", "bin_detail vs head counts for the newest binned restaurant", async () => {
    const b = (await get("?deleted=1")).json.trashed[0]; if (!b) return "skip:the bin is empty";
    const r = await c.req(`/api/admin/restaurants?bin_detail=${b.id}`);
    const [cats, dishes, orders, fb] = await Promise.all([
      c.count("categories", `restaurant_id=eq.${b.id}`), c.count("menu_items", `restaurant_id=eq.${b.id}`),
      c.count("orders", `restaurant_id=eq.${b.id}&deleted_at=is.null`), c.count("feedback", `restaurant_id=eq.${b.id}`)]);
    const i = r.json.inside;
    return i.categories === cats && i.dishes === dishes && i.orders === orders && i.feedback === fb || `route ${JSON.stringify(i)} vs db ${[cats, dishes, orders, fb]}`;
  });
  c.phase("…and it carries a count of unpaid Pay-later bills but never what they came to", "read the answer", async () => {
    const b = (await get("?deleted=1")).json.trashed[0]; if (!b) return "skip:the bin is empty";
    const r = await c.req(`/api/admin/restaurants?bin_detail=${b.id}`);
    return typeof r.json.inside.unpaidPayLaterBills === "number" && !/₹|"amount"|"total"/.test(r.text) || "a figure is missing or money appears";
  });
  c.phase("a malformed bin_detail id is 'not found', not a database error", "GET ?bin_detail=nope",
    async () => { const r = await c.req("/api/admin/restaurants?bin_detail=nope"); return r.status === 404 || `${r.status}`; });

  c.sec("D · Restaurants — read for every rule");
  c.phase("assigning an owner re-checks that the person IS an owner, and that the restaurant exists", "read PATCH",
    () => /\.eq\("role", "owner"\)\.limit\(1\)/.test(S()) && /Restaurant not found — it may have been removed/.test(S()));
  c.phase("replacing the primary owner removes the OLD owner's access, and refuses if that removal fails", "read PATCH",
    () => /restaurant_owners"\)\.delete\(\)\.eq\("restaurant_id", rid\)\.eq\("user_id", oldOwner\)/.test(S()) && /if \(del\.error\) return adminFail/.test(S()));
  c.phase("…co-owners added by hand are never touched by that swap", "read the delete's filter: user_id = the old primary only",
    () => !/restaurant_owners"\)\.delete\(\)\.eq\("restaurant_id", rid\);/.test(S()));
  c.phase("the new owner's membership write answers for itself (item 5)", "read PATCH", () => /if \(mem\.error\) return adminFail\("this restaurant's owner"/.test(S()));
  c.phase("suspending forgets the remembered restaurant state at once (item 38) and is logged", "read set_restaurant_active",
    () => /forgetRestaurant\(rid, await ownersOf\(rid\)\)/.test(branch("set_restaurant_active")) && /restaurant_suspend/.test(branch("set_restaurant_active")));
  c.phase("restaurant #1 can never be binned", "read soft_delete_restaurant", () => /if \(rid === DEFAULT_RID\) return bad\("The default restaurant can't be deleted\."/.test(branch("soft_delete_restaurant")));
  c.phase("binning switches the restaurant off as well, so a cached panel can't treat it as live", "read the update",
    () => /deleted_at: new Date\(\)\.toISOString\(\), deleted_by: "admin", delete_reason: reason, active: false/.test(branch("soft_delete_restaurant")));
  c.phase("binning twice is refused, not recorded twice", "read the check", () => /if \(r\.deleted_at\) return bad\("That restaurant is already in the recycle bin\.", 409\)/.test(branch("soft_delete_restaurant")));
  c.phase("a restored restaurant comes back SUSPENDED unless the admin says otherwise", "read restore", () => /const activate = body\?\.activate === true;/.test(branch("restore_restaurant")));
  c.phase("a permanently removed restaurant cannot be 'restored' into an empty shell", "read restore", () => /if \(r\.purged_at\) return bad\(/.test(branch("restore_restaurant")));
  c.phase("a restore whose web address was taken ASKS (409 + two choices) and writes nothing", "read the conflict branch",
    () => { const b = branch("restore_restaurant"); return b.indexOf("conflict: {") > -1 && b.indexOf("conflict: {") < b.indexOf('.update({ deleted_at: null'); });
  c.phase("…and the clash check that cannot read refuses rather than assuming the name is free", "read takenBy", () => /if \(q\.error\) throw q\.error;/.test(branch("restore_restaurant")));
  c.phase("…and a rename leaves the old address on record so old QR codes can find their way back", "read the history upsert",
    () => /restaurant_slug_history"\)[\s\S]*onConflict: "slug"/.test(branch("restore_restaurant")));
  c.phase("permanent removal needs the restaurant to be in the bin first, and never restaurant #1", "read purge",
    () => /Only a restaurant in the recycle bin can be removed\. Move it to the recycle bin first\./.test(branch("purge_restaurant")) && /DEFAULT_RID\) return bad/.test(branch("purge_restaurant")));
  c.phase("…and it keeps the money: bills, invoices and the Removals audit survive (the audit line says so)", "read the log line",
    () => /bills, invoices and the removals audit kept/.test(branch("purge_restaurant")));
  c.phase("creating a restaurant refuses a name under two characters", "read create", () => /if \(name\.length < 2\) return bad\("Restaurant name must be at least 2 characters\."\)/.test(branch("create_restaurant")));
  c.phase("…finds a free web address, and a failed check refuses rather than colliding", "read the slug loop", () => /if \(takenQ\.error\) return adminFail\("whether that name is free"/.test(branch("create_restaurant")));
  c.phase("…sets no permission of its own — manager grants come from the model's defaults", "read the insert", () => /manager_permissions: managerPerms/.test(branch("create_restaurant")) && /const managerPerms: Record<string, boolean> = \{ \.\.\.MP_DEFAULT \}/.test(branch("create_restaurant")));
  c.phase("…rolls the restaurant back if its settings row cannot be written, or its template read (item 4)", "read create",
    () => (branch("create_restaurant").match(/await sb\.from\("restaurants"\)\.delete\(\)\.eq\("id", rid\)/g) || []).length === 2);
  c.phase("…keys the settings row by the restaurant's own id, never its slug", "read the upsert", () => /id: rid, restaurant_id: rid, enabled_panels: panels/.test(branch("create_restaurant")));
  c.phase("…makes the owner login the restaurant's owner AND a member, and reports if either link fails", "read the owner branch",
    () => /loginErrors\.push\("owner-link"\)/.test(branch("create_restaurant")));
  c.phase("…tells the admin when a reused web address inherits another restaurant's printed QR codes", "read reusedAddress", () => /reusedAddress: \{ name: previousHolder\.name/.test(branch("create_restaurant")));
  c.phase("…remembers the form's panels and sample menu, never a permission set", "read the app_config write", () => /value: \{ panels, seedMenu \}/.test(branch("create_restaurant")));
  c.phase("a new owner login needs a free, two-character name and a six-character password", "read create_owner",
    () => /if \(key\.length < 2\) return bad\("Username must be at least 2 characters\."\)/.test(S()) && /if \(password\.length < 6\)/.test(S()) && /const taken = await nameTakenMessage\(key\)/.test(S()));

  c.sec("D · Restaurants — driven refusals (nothing changes)");
  const post = (b) => c.req("/api/admin/restaurants", { method: "POST", body: b });
  c.phase("binning restaurant #1 is refused", "POST soft_delete_restaurant for restaurant #1", async () => {
    const r = await post({ action: "soft_delete_restaurant", restaurant_id: c.FH });
    const a = (await c.sq(`restaurants?select=deleted_at&id=eq.${c.FH}`)).json[0];
    return r.status === 400 && a.deleted_at === null || `${r.status}`;
  });
  c.phase("permanently removing restaurant #1 is refused", "POST purge_restaurant for restaurant #1",
    async () => { const r = await post({ action: "purge_restaurant", restaurant_id: c.FH }); return r.status === 400 && /can.t be permanently removed/.test(r.json?.error) || `${r.status} ${r.json?.error}`; });
  c.phase("restoring a restaurant that is not in the bin is refused", "POST restore_restaurant for French House",
    async () => { const r = await post({ action: "restore_restaurant", restaurant_id: c.FH }); return r.status === 409 && /isn't in the recycle bin/.test(r.json?.error) || `${r.status}`; });
  c.phase("permanently removing a LIVE restaurant is refused — it must be binned first", "POST purge_restaurant for Aangan (refused before anything is read twice)",
    async () => { const r = await post({ action: "purge_restaurant", restaurant_id: c.AANGAN }); const a = (await c.sq(`restaurants?select=deleted_at,purged_at&id=eq.${c.AANGAN}`)).json[0]; return r.status === 409 && a.deleted_at === null && a.purged_at === null || `${r.status}`; });
  c.phase("a malformed id on suspend is 'not found', not a database error", "POST set_restaurant_active restaurant_id=nope",
    async () => { const r = await post({ action: "set_restaurant_active", restaurant_id: "nope", active: false }); return r.status === 404 || `${r.status}`; });
  c.phase("a missing id on bin is refused in words", "POST soft_delete_restaurant without an id",
    async () => { const r = await post({ action: "soft_delete_restaurant" }); return r.status === 400 && /Missing restaurant_id/.test(r.json?.error) || `${r.status}`; });
  c.phase("a one-letter restaurant name is refused before anything is created", "POST create_restaurant name='X'", async () => {
    const before = await c.count("restaurants", "select=id");
    const r = await post({ action: "create_restaurant", name: "X" });
    const after = await c.count("restaurants", "select=id");
    return r.status === 400 && before === after || `${r.status} restaurants ${before}→${after}`;
  });
  c.phase("a one-letter owner name is refused before any login is made", "POST create_owner name='Q'",
    async () => { const r = await post({ action: "create_owner", name: "Q" }); return r.status === 400 && /at least 2 characters/.test(r.json?.error) || `${r.status}`; });
  c.phase("an owner password under six characters is refused", "POST create_owner with password '123'",
    async () => { const r = await post({ action: "create_owner", name: `zz t29 ${Date.now()}`, password: "123" }); return r.status === 400 && /at least 6 characters/.test(r.json?.error) || `${r.status} ${r.json?.error}`; });
  c.phase("an owner name already in use anywhere is refused (login names are global)", "POST create_owner with an existing owner's name", async () => {
    const o = (await c.sq(`staff_users?select=username&role=eq.owner&deleted_at=is.null&limit=1`)).json[0];
    const r = await post({ action: "create_owner", name: o.username, password: "longenough" });
    return r.status === 409 || `${r.status} ${r.json?.error}`;
  });
  c.phase("assigning someone who is not an owner is refused", "PATCH French House with a manager's id", async () => {
    const before = (await c.sq(`restaurants?select=owner_user_id&id=eq.${c.FH}`)).json[0].owner_user_id;
    const m = (await c.sq(`staff_users?select=id&restaurant_id=eq.${c.FH}&role=eq.manager&limit=1`)).json[0];
    const r = await c.req("/api/admin/restaurants", { method: "PATCH", body: { restaurant_id: c.FH, owner_user_id: m.id } });
    const after = (await c.sq(`restaurants?select=owner_user_id&id=eq.${c.FH}`)).json[0].owner_user_id;
    return r.status === 400 && /isn't an owner/.test(r.json?.error) && before === after || `${r.status}`;
  });
  c.phase("…and a malformed owner id the same way", "PATCH owner_user_id=nope",
    async () => { const r = await c.req("/api/admin/restaurants", { method: "PATCH", body: { restaurant_id: c.FH, owner_user_id: "nope" } }); return r.status === 400 || `${r.status}`; });
  c.phase("an unknown action is refused", "POST action=teleport", async () => { const r = await post({ action: "teleport" }); return r.status === 400 || `${r.status}`; });
  c.phase("no refusal above created, binned, restored or reassigned anything", "count restaurants, owners and audit lines since the run began", async () => {
    const lines = await c.count("staff_actions", `action=in.(restaurant_create,restaurant_soft_delete,restaurant_restore,restaurant_purge,owner_create,restaurant_set_owner,restaurant_suspend,restaurant_reactivate)&created_at=gte.${c.T0}`);
    return lines === 0 || `${lines} audit line(s)`;
  });
}
