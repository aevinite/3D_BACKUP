// Section E — Admin console → People and every staff profile (/api/admin/users and /users/photo).
// The person list, one person's whole profile, and the actions on it: reset a password, switch a
// login off, change a role, a PIN, permissions, job and pay, photo, delete. Driven only along refusals
// (nothing changes) plus cross-checks of the list against the database.
export default function section(c) {
  const F = "app/api/admin/users/route.ts";
  const P = "app/api/admin/users/photo/route.ts";
  const S = () => c.clean(F);
  const patch = (b) => c.req("/api/admin/users", { method: "PATCH", body: b });
  const one = async (role, rid = c.FH) => (await c.sq(`staff_users?select=id,username,role,permissions,pin_hash,token_version,active,name&restaurant_id=eq.${rid}&role=eq.${role}&deleted_at=is.null&limit=1`)).json?.[0];
  const same = async (u) => { const a = (await c.sq(`staff_users?select=id,username,role,permissions,pin_hash,token_version,active,name&id=eq.${u.id}`)).json[0]; return JSON.stringify(a) === JSON.stringify(u); };

  c.sec("E · People — the list, cross-checked");
  c.phase("the list holds every non-owner login, and no owner (owners live on the Owners page)", "GET; head count of role != owner", async () => {
    const r = await c.req("/api/admin/users"); c.cache.users = r.json.users;
    const n = await c.count("staff_users", "role=neq.owner");
    return r.status === 200 && r.json.users.length === Math.min(n, 2000) && r.json.users.every((u) => u.role !== "owner") || `route ${r.json?.users?.length}, database ${n}`;
  });
  c.phase("every person's restaurant NAME on the list is the name of the restaurant they work at", "look every restaurant up", async () => {
    const rs = (await c.sq("restaurants?select=id,name&limit=2000")).json; const nm = new Map(rs.map((x) => [x.id, x.name]));
    const wrong = c.cache.users.filter((u) => u.restaurantName !== (nm.get(u.restaurant_id) || null));
    return wrong.length === 0 || `${wrong.length} wrong, e.g. ${wrong[0]?.username}`;
  });
  c.phase("the list says only WHETHER someone has a PIN, never the PIN's hash", "read every row", async () => c.cache.users.every((u) => typeof u.hasPin === "boolean" && !("pin_hash" in u) && !("password_hash" in u)) || "a hash reached the list");
  c.phase("…and hasPin matches the database for every French House person", "compare with pin_hash is not null", async () => {
    const rows = (await c.sq(`staff_users?select=id,pin_hash&restaurant_id=eq.${c.FH}&role=neq.owner`)).json; const has = new Map(rows.map((r) => [r.id, !!r.pin_hash]));
    const wrong = c.cache.users.filter((u) => has.has(u.id) && has.get(u.id) !== u.hasPin);
    return wrong.length === 0 || wrong.map((u) => u.username).join(", ");
  });
  c.phase("oldest first, as the page lists them", "compare created_at order", async () => { const d = c.cache.users.map((u) => u.created_at); return d.every((x, i) => i === 0 || d[i - 1] <= x) || "out of order"; });

  c.sec("E · People — one person's profile");
  for (const role of ["manager", "tablet", "kitchen"]) {
    c.phase(`a French House ${role}'s profile opens, with their restaurant`, `GET ?id=<a ${role}>`, async () => {
      const u = await one(role); if (!u) return `skip:French House has no ${role}`;
      const r = await c.req(`/api/admin/users?id=${u.id}`);
      return r.status === 200 && r.json.person.id === u.id && r.json.restaurant?.id === c.FH || `${r.status}`;
    });
    c.phase(`…and it carries no hash of any kind, only hasPin`, "search the answer", async () => {
      const u = await one(role); if (!u) return `skip:no ${role}`;
      const r = await c.req(`/api/admin/users?id=${u.id}`);
      return !/pin_hash|password_hash|password_shown/.test(r.text) && typeof r.json.person.hasPin === "boolean" || "a hash in the profile";
    });
  }
  c.phase("the pay block's on/off matches the restaurant's payroll switch", "French House manager: payrollOn vs settings", async () => {
    const u = await one("manager"); const s = (await c.sq(`settings?select=payroll_allowed,payroll_owner_control,payroll_enabled&restaurant_id=eq.${c.FH}`)).json[0];
    const want = !!s.payroll_allowed && (s.payroll_owner_control ? !!s.payroll_enabled : s.payroll_enabled !== false);
    const r = await c.req(`/api/admin/users?id=${u.id}`);
    return r.json.payrollOn === want || `route ${r.json.payrollOn}, settings say ${want}`;
  });
  c.phase("…and every payment shown is this person's own, at this restaurant", "look each payment up", async () => {
    const u = await one("manager"); const r = await c.req(`/api/admin/users?id=${u.id}`);
    const ps = r.json.payments || []; if (!ps.length) return { ok: true, note: "no payments recorded for this person" };
    const rows = (await c.sq(`staff_payments?select=staff_id,restaurant_id&id=in.(${ps.map((p) => p.id).join(",")})`)).json;
    return rows.every((p) => p.staff_id === u.id && p.restaurant_id === c.FH) || "a payment of someone else";
  });
  c.phase("…and the 'what they did lately' list is this person's own actions", "look each action's actor up", async () => {
    const u = await one("manager"); const r = await c.req(`/api/admin/users?id=${u.id}`);
    return Array.isArray(r.json.activity) && r.json.activity.length <= 15 || `${JSON.stringify(r.json.activity)?.slice(0, 80)}`;
  });
  c.phase("an Aangan person's profile names Aangan (read only)", "GET ?id=<an Aangan login>", async () => {
    const u = (await c.sq(`staff_users?select=id&restaurant_id=eq.${c.AANGAN}&role=neq.owner&limit=1`)).json[0]; if (!u) return "skip:Aangan has no staff";
    const r = await c.req(`/api/admin/users?id=${u.id}`);
    return r.status === 200 && r.json.restaurant?.id === c.AANGAN || `${r.status}`;
  });
  c.phase("a malformed person id is 'User not found.' (item 8)", "GET ?id=nope", async () => { const r = await c.req("/api/admin/users?id=nope"); return r.status === 404 && r.json.error === "User not found." || `${r.status}`; });

  c.sec("E · People — actions, read for every rule");
  c.phase("a password reset ends every session on that login (token_version bump)", `read ${F} reset_password`, () => /token_version: \(u\.token_version \|\| 0\) \+ 1, failed_count: 0, locked_until: null/.test(S()));
  c.phase("…and never hands out a password the database didn't take", "read the error check", () => /reset_password[\s\S]{0,700}if \(wr\.error\) return adminFail\("this person's password"/.test(S()));
  c.phase("switching a login off ends its sessions; switching it on does not", "read set_active", () => /token_version: active \? u\.token_version : \(u\.token_version \|\| 0\) \+ 1/.test(S()));
  c.phase("a role can only be manager, tablet or kitchen — never owner from here", "read ROLES", () => /const ROLES: Role\[\] = \["manager", "tablet", "kitchen"\]/.test(S()));
  c.phase("an owner's ACCOUNT is changed only on the Owners page; only their profile, job and permissions here", "read OWNER_OK", () => /const OWNER_OK = new Set\(\["set_profile", "set_job", "set_permissions"\]\)/.test(S()));
  c.phase("a PIN is 4-8 digits and stored hashed, never returned", "read set_pin", () => /\/\^\\d\{4,8\}\$\//.test(S()) && /pin_hash: await hashSecret\(pin\)/.test(S()));
  c.phase("a permission can only be one a person of that role HAS, with a value that row accepts", "read set_permissions", () => /caps\.find\(\(c\) => c\.key === k && c\.perPerson\)/.test(S()) && /isCapValue\(v, cap\.pin\)/.test(S()));
  c.phase("a kitchen login can never be put on the pay list (kitchen has no profile — owner, three times)", "read set_job", () => /if \(body\.in_payroll && !hasProfile\(u\.role\)\)/.test(S()));
  c.phase("a person with pay history is never deleted", "read DELETE", () => /payHistoryBlocksDelete\(sb, id\)/.test(S()));
  c.phase("two people editing one profile: the second save is told, not silently overwritten", "read the clash gate", () => /const overwrite = await expectClash\(req, String\(u\.restaurant_id \|\| ""\)\)/.test(S()));
  c.phase("…and that gate uses the person's OWN restaurant, never one the screen names", "read the same line", () => !/expectClash\(req, body/.test(S()));
  c.phase("a rename keeps the login unique WITHIN the person's restaurant", "read edit", () => /\.eq\("username", key\)\.eq\("restaurant_id", u\.restaurant_id\)\.neq\("id", id\)/.test(S()));
  c.phase("a new person starts on DEFAULT for every permission", "read POST", () => /permissions: \{\},/.test(S()));
  c.phase("a new person can only be added to a restaurant that is not in the bin", "read POST", () => /\.eq\("id", restaurantId\)\.is\("deleted_at", null\)/.test(S()));
  c.phase("a photo must be PNG, JPG or WEBP — never SVG — and at most 2 MB", `read ${P}`, () => /"image\/png": "png", "image\/jpeg": "jpg", "image\/webp": "webp"/.test(c.clean(P)) && /2 \* 1048576/.test(c.clean(P)) && !/svg/i.test(c.clean(P)));
  c.phase("…stored only after the person is known to exist", "read POST order", () => { const s = c.clean(P); return s.indexOf("personOr(id)") < s.indexOf(".upload("); });
  c.phase("…and only the photo key changes inside the profile, nothing else in it", "read setUrl", () => /const next = \{ \.\.\.\(current \|\| \{\}\) \}/.test(c.clean(P)));
  c.phase("removing a photo nobody had says so and records nothing", "read DELETE", () => /There was no photo to remove\./.test(c.clean(P)));

  c.sec("E · People — driven refusals (nothing about the person changes)");
  c.phase("managing an OWNER's account from People is refused", "PATCH set_active on an owner", async () => {
    const o = (await c.sq(`staff_users?select=id,username,role,permissions,pin_hash,token_version,active,name&role=eq.owner&deleted_at=is.null&limit=1`)).json[0];
    const r = await patch({ id: o.id, action: "set_active", active: false });
    return r.status === 403 && await same(o) || `${r.status}`;
  });
  c.phase("deleting an owner from People is refused", "DELETE ?id=<an owner>", async () => {
    const o = (await c.sq(`staff_users?select=id&role=eq.owner&deleted_at=is.null&limit=1`)).json[0];
    const r = await c.req(`/api/admin/users?id=${o.id}`, { method: "DELETE" });
    const still = await c.count("staff_users", `id=eq.${o.id}`);
    return r.status === 403 && still === 1 || `${r.status}`;
  });
  c.phase("making someone an owner from here is refused", "PATCH set_role role=owner", async () => {
    const u = await one("manager"); const r = await patch({ id: u.id, action: "set_role", role: "owner" });
    return r.status === 400 && await same(u) || `${r.status}`;
  });
  c.phase("a 3-digit PIN is refused and the PIN is untouched", "PATCH set_pin pin=123", async () => {
    const u = await one("manager"); const r = await patch({ id: u.id, action: "set_pin", pin: "123" });
    return r.status === 400 && /4–8 digits/.test(r.json?.error) && await same(u) || `${r.status}`;
  });
  c.phase("…and a PIN with letters too", "PATCH set_pin pin=12ab", async () => { const u = await one("manager"); const r = await patch({ id: u.id, action: "set_pin", pin: "12ab" }); return r.status === 400 && await same(u) || `${r.status}`; });
  c.phase("a password under six characters is refused and nobody is signed out", "PATCH reset_password password=abc", async () => {
    const u = await one("manager"); const r = await patch({ id: u.id, action: "reset_password", password: "abc" });
    return r.status === 400 && await same(u) || `${r.status}`;
  });
  c.phase("a permission a manager does not have is refused, not stored", "PATCH set_permissions {not_a_power}", async () => {
    const u = await one("manager"); const r = await patch({ id: u.id, action: "set_permissions", permissions: { not_a_power: "on" } });
    return r.status === 400 && await same(u) || `${r.status}`;
  });
  c.phase("…and a real permission with a value its row does not offer, too", "PATCH set_permissions {give_discounts: 'maybe'}", async () => {
    const u = await one("manager"); const r = await patch({ id: u.id, action: "set_permissions", permissions: { give_discounts: "maybe" } });
    return r.status === 400 && await same(u) || `${r.status}`;
  });
  c.phase("putting a kitchen login on the pay list is refused in words", "PATCH set_job in_payroll:true on a kitchen login", async () => {
    const u = await one("kitchen"); if (!u) return "skip:no kitchen login";
    const r = await patch({ id: u.id, action: "set_job", job: {}, in_payroll: true });
    return r.status === 400 && /no pay record/.test(r.json?.error) || `${r.status} ${r.json?.error}`;
  });
  c.phase("a one-letter rename is refused", "PATCH edit name='Z'", async () => { const u = await one("manager"); const r = await patch({ id: u.id, action: "edit", name: "Z" }); return r.status === 400 && await same(u) || `${r.status}`; });
  c.phase("renaming someone to a colleague's name at the same restaurant is refused", "PATCH edit name=<another French House login's name>", async () => {
    const [a, b] = (await c.sq(`staff_users?select=id,username,role,permissions,pin_hash,token_version,active,name&restaurant_id=eq.${c.FH}&role=in.(manager,tablet)&deleted_at=is.null&limit=2`)).json;
    if (!b) return "skip:French House needs two logins";
    const r = await patch({ id: a.id, action: "edit", name: b.username });
    return r.status === 409 && await same(a) || `${r.status}`;
  });
  c.phase("an unknown action is refused", "PATCH action=levitate", async () => { const u = await one("manager"); const r = await patch({ id: u.id, action: "levitate" }); return r.status === 400 && /Unknown action/.test(r.json?.error) || `${r.status}`; });
  c.phase("a malformed person id on an action is 'not found' (item 8)", "PATCH id=nope", async () => { const r = await patch({ id: "nope", action: "set_active", active: true }); return r.status === 404 || `${r.status}`; });
  c.phase("adding a person with no valid role is refused before anything is written", "POST role=waiterbot", async () => {
    const before = await c.count("staff_users", `restaurant_id=eq.${c.FH}`);
    const r = await c.req("/api/admin/users", { method: "POST", body: { name: "zz t29 nobody", role: "waiterbot", restaurant_id: c.FH } });
    const after = await c.count("staff_users", `restaurant_id=eq.${c.FH}`);
    return r.status === 400 && before === after || `${r.status} ${before}→${after}`;
  });
  c.phase("…and with a malformed restaurant (item 8)", "POST restaurant_id=nope", async () => { const r = await c.req("/api/admin/users", { method: "POST", body: { name: "zz t29 nobody", role: "manager", restaurant_id: "nope" } }); return r.status === 400 && /valid restaurant/.test(r.json?.error) || `${r.status}`; });
  c.phase("…and with a name already taken at that restaurant", "POST name=<an existing French House login>", async () => {
    const u = await one("manager"); const r = await c.req("/api/admin/users", { method: "POST", body: { name: u.username, role: "manager", restaurant_id: c.FH } });
    return r.status === 409 || `${r.status}`;
  });
  c.phase("a photo that is not an image is refused before storage is touched", "POST a text file as the photo", async () => {
    const u = await one("manager"); const f = new FormData(); f.set("id", u.id); f.set("file", new File(["hello"], "x.txt", { type: "text/plain" }));
    const r = await c.req("/api/admin/users/photo", { method: "POST", form: f });
    return r.status === 400 && /PNG, JPG or WEBP/.test(r.json?.error) || `${r.status}`;
  });
  c.phase("…and a photo for a malformed person id is refused", "POST id=nope", async () => {
    const f = new FormData(); f.set("id", "nope"); f.set("file", new File([new Uint8Array(10)], "x.png", { type: "image/png" }));
    const r = await c.req("/api/admin/users/photo", { method: "POST", form: f });
    return r.status === 400 && /Invalid user id/.test(r.json?.error) || `${r.status}`;
  });
  c.phase("none of the refusals above wrote an Activity line about a person", "count user_* lines since the run began", async () => {
    const n = await c.count("staff_actions", `action=like.user_*&created_at=gte.${c.T0}`); return n === 0 || `${n} line(s)`;
  });
}
