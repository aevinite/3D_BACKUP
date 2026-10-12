// Section G — the handover sheet (/restaurants/credentials) and the password cover (/reveal,
// /reveal/password). Driven only in the COVERED state: no password is uncovered, none typed, none
// minted — the gate's wrong-try wall is five per five minutes and this run spends none of it.
export default function section(c) {
  const CR = "app/api/admin/restaurants/credentials/route.ts";
  const RV = "app/api/admin/reveal/route.ts";
  const RP = "app/api/admin/reveal/password/route.ts";
  const sheet = async (rid) => (c.cache[`cr${rid}`] ||= await c.req(`/api/admin/restaurants/credentials?restaurant_id=${rid}`));

  c.sec("G · the handover sheet — covered, cross-checked");
  c.phase("covered, French House's sheet lists every login it should: its own staff plus every linked owner", "compare with staff_users + restaurant_owners", async () => {
    const r = await sheet(c.FH);
    const own = (await c.sq(`staff_users?select=id&restaurant_id=eq.${c.FH}&deleted_at=is.null&limit=600`)).json.map((x) => x.id);
    const links = (await c.sq(`restaurant_owners?select=user_id&restaurant_id=eq.${c.FH}`)).json.map((x) => x.user_id);
    const owners = links.length ? (await c.sq(`staff_users?select=id&id=in.(${links.join(",")})&deleted_at=is.null`)).json.map((x) => x.id) : [];
    const want = new Set([...own, ...owners]);
    const got = new Set(r.json.logins.map((l) => l.id));
    return got.size === want.size && [...want].every((x) => got.has(x)) || `sheet ${got.size}, database ${want.size}`;
  });
  c.phase("…every password is held back while covered, and the sheet says so", "unlocked:false and every password null", async () => { const j = (await sheet(c.FH)).json; return j.unlocked === false && j.logins.every((l) => l.password === null) || "a password shown while covered"; });
  c.phase("…the ★ sits on exactly the restaurant's primary owner", "compare with restaurants.owner_user_id", async () => {
    const prim = (await c.sq(`restaurants?select=owner_user_id&id=eq.${c.FH}`)).json[0].owner_user_id;
    const stars = (await sheet(c.FH)).json.logins.filter((l) => l.primary).map((l) => l.id);
    return JSON.stringify(stars) === JSON.stringify(prim ? [prim] : []) || `stars ${stars}, primary ${prim}`;
  });
  c.phase("…the 'tables open right now' number is the database's own count", "head count of open/pending sessions", async () => {
    const n = await c.count("sessions", `restaurant_id=eq.${c.FH}&status=in.(open,pending)`);
    return (await sheet(c.FH)).json.openTables === n || `sheet ${(await sheet(c.FH)).json.openTables}, database ${n}`;
  });
  c.phase("…the guest address on the paper is this restaurant's own /r/<slug>/menu", "compare with the slug", async () => {
    const s = (await c.sq(`restaurants?select=slug&id=eq.${c.FH}`)).json[0].slug;
    return (await sheet(c.FH)).json.restaurant.guestUrl.endsWith(`/r/${s}/menu`) || (await sheet(c.FH)).json.restaurant.guestUrl;
  });
  c.phase("…'has a password on file' matches whether a readable copy is stored", "compare hasPassword with password_shown is not null", async () => {
    const rows = (await c.sq(`staff_users?select=id,password_shown&id=in.(${(await sheet(c.FH)).json.logins.map((l) => l.id).join(",")})`)).json;
    const m = new Map(rows.map((x) => [x.id, x.password_shown != null]));
    const wrong = (await sheet(c.FH)).json.logins.filter((l) => l.hasPassword && !m.get(l.id));
    return wrong.length === 0 || `${wrong.length} claim a stored password that is not there`;
  });
  c.phase("…no PIN of any kind on the sheet — a PIN authorises, it is not handed over", "search the answer", async () => !/pin/i.test(JSON.stringify((await sheet(c.FH)).json.logins.map((l) => Object.keys(l)))) || "a PIN field");
  c.phase("Aangan's sheet lists Aangan's logins only (read only)", "every login is Aangan's staff or a linked Aangan owner", async () => {
    const r = await sheet(c.AANGAN);
    const ids = r.json.logins.map((l) => l.id); if (!ids.length) return { ok: r.status === 200, note: "Aangan has no logins" };
    const rows = (await c.sq(`staff_users?select=id,restaurant_id,role&id=in.(${ids.join(",")})`)).json;
    const links = new Set((await c.sq(`restaurant_owners?select=user_id&restaurant_id=eq.${c.AANGAN}`)).json.map((x) => x.user_id));
    return rows.every((u) => u.restaurant_id === c.AANGAN || links.has(u.id)) || "a login from another restaurant";
  });
  c.phase("a malformed restaurant id on the sheet is refused in words", "GET restaurant_id=nope", async () => { const r = await c.req("/api/admin/restaurants/credentials?restaurant_id=nope"); return r.status === 400 || `${r.status}`; });

  c.sec("G · the handover sheet — covered actions refused, read for every rule");
  c.phase("covered, minting ONE new password is refused 423 before anything is read", "POST {restaurant_id, user_id}", async () => {
    const u = (await sheet(c.FH)).json.logins[0];
    const before = (await c.sq(`staff_users?select=token_version,password_shown&id=eq.${u.id}`)).json[0];
    const r = await c.post("/api/admin/restaurants/credentials", { restaurant_id: c.FH, user_id: u.id });
    const after = (await c.sq(`staff_users?select=token_version,password_shown&id=eq.${u.id}`)).json[0];
    return r.status === 423 && JSON.stringify(before) === JSON.stringify(after) || `${r.status}`;
  });
  c.phase("…with the one sentence every screen reacts to", "read the 423 body", async () => {
    const r = await c.post("/api/admin/restaurants/credentials", { restaurant_id: c.FH, action: "reset_all" });
    return r.json?.error === "Passwords are covered. Type the admin password to uncover them." || r.json?.error;
  });
  c.phase("the single-login reset is refused for someone who does not belong to the restaurant", `read ${CR}`, () => /That login doesn't belong to this restaurant\./.test(c.clean(CR)));
  c.phase("nobody is signed out by a reset unless that is asked for", "read both reset paths", () => (c.clean(CR).match(/\.\.\.\(signOut \? \{ token_version:/g) || []).length === 2);
  c.phase("a handover reset names every login that FAILED instead of skipping it quietly", "read resetAll", () => /failed\.push\(p\.name \|\| p\.username\)/.test(c.clean(CR)) && /FAILED \(\$\{failed\.join/.test(c.clean(CR)));
  c.phase("a password is reported only after the database took it", "read both writes", () => (c.clean(CR).match(/Couldn't set that password — nothing was changed|if \(wr\.error \|\| !wr\.data\)/g) || []).length >= 2);
  c.phase("a double press cannot burn two passwords (once-only POST)", "read the export", () => /export const POST = withIdempotency\(postImpl, "admin"\)/.test(c.clean(CR)));
  c.phase("no vault key on a deployment → the sheet says so instead of offering a button that does nothing", "read vaultReady", () => /vaultReady: vaultReady\(\)/.test(c.clean(CR)) && /This deployment has no credential key set/.test(c.clean(CR)));

  c.sec("G · the password cover — read for every rule, driven covered");
  c.phase("the cover reports itself COVERED with nothing typed", "GET /api/admin/reveal", async () => { const r = await c.req("/api/admin/reveal"); return r.json.unlocked === false && r.json.until === null || JSON.stringify(r.json); });
  c.phase("covered, one person's password is refused 423 and the database is not touched", "POST /reveal/password {user_id}", async () => {
    const u = (await sheet(c.FH)).json.logins[0];
    const r = await c.post("/api/admin/reveal/password", { user_id: u.id });
    return r.status === 423 && !/"password"\s*:/.test(r.text) || `${r.status}`;
  });
  c.phase("…and so is minting a new one for them", "POST /reveal/password {user_id, action:'set'}", async () => {
    const u = (await sheet(c.FH)).json.logins[0];
    const before = (await c.sq(`staff_users?select=password_shown,token_version&id=eq.${u.id}`)).json[0];
    const r = await c.post("/api/admin/reveal/password", { user_id: u.id, action: "set", signOut: true });
    const after = (await c.sq(`staff_users?select=password_shown,token_version&id=eq.${u.id}`)).json[0];
    return r.status === 423 && JSON.stringify(before) === JSON.stringify(after) || `${r.status}`;
  });
  c.phase("covering again when already covered is harmless and says covered", "DELETE /reveal", async () => { const r = await c.req("/api/admin/reveal", { method: "DELETE" }); return r.status === 200 && r.json.unlocked === false || `${r.status}`; });
  c.phase("the uncover window is checked BEFORE the person is read", `read ${RP}`, () => { const s = c.clean(RP); return s.indexOf("revealUnlocked(") < s.indexOf('sb.from("staff_users")'); });
  c.phase("a wrong password is counted per signed-in console and stops answering after five", `read ${RV}`, () => /const MAX_TRIES = 5;/.test(c.clean(RV)) && /if \(g\.blocked\)/.test(c.clean(RV)));
  c.phase("…the counter can't grow without bound on a long-lived server", "read sweep()", () => /if \(tries\.size < 200\) return;/.test(c.clean(RV)));
  c.phase("…and a wrong try says how many are left and nothing about how close it was", "read the 403 sentence", () => /That isn't the admin password\. \$\{left\} tr/.test(c.clean(RV)) && !/close|almost|nearly/.test(c.clean(RV)));
  c.phase("the typed password is never echoed, logged or stored", "read POST: typed appears only in the comparison", () => { const v = c.clean(RV); return !/\$\{\s*typed\s*\}|json\([^)]*typed|console\.[a-z]+\([^)]*typed|detail:\s*typed|\+\s*typed/.test(v) && /revealPasswordMatches\(typed\)/.test(v); });
  c.phase("an empty box is asked for a password, not counted as a wrong try", "read the order", () => { const s = c.clean(RV); return s.indexOf('if (!typed) return err("Type the admin password."') < s.indexOf("countWrong(key)"); });
  c.phase("the uncover cookie's life is the signature's own life (5 minutes)", "read maxAge", () => /maxAge: Math\.ceil\(REVEAL_TTL_MS \/ 1000\)/.test(c.clean(RV)));
  c.phase("a person is read by id only — the screen cannot widen what comes back", `read ${RP}`, () => /\.eq\("id", userId\)\.is\("deleted_at", null\)\.maybeSingle\(\)/.test(c.clean(RP)));
  c.phase("looking at a password leaves a record naming who was looked at — never the password", "read the logAction", () => /looked at the password for "\$\{who\}"/.test(c.clean(RP)));
  c.phase("a PIN is not a password and is not on this door", "grep for pin", () => !/pin_hash|\bpin\b/.test(c.clean(RP)));
  c.phase("the generator alphabet has no lookalikes (no l, o, 0, 1) on every door that mints", "every minting route imports the ONE maker (lib/readablePassword, round 2 item 15) and none keeps its own copy", () => { const lib = c.clean("lib/readablePassword.ts"); const doors = ["app/api/admin/reveal/password/route.ts", CR, "app/api/admin/restaurants/route.ts", "app/api/admin/users/route.ts"]; return /READABLE_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"/.test(lib) && doors.every((f) => /readablePassword\(\)/.test(c.clean(f)) && !/function genPassword/.test(c.clean(f))) || "a door keeps its own copy"; });
}
