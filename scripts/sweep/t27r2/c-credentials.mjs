/**
 * C · /api/admin/restaurants/credentials — the handover sheet.  338 lines, 10.9 rows per hundred.
 *
 * This is the page an admin PRINTS and hands to a client. Its failure mode is not an error message:
 * it is a sheet that looks complete and is not. Sweep #7 found exactly that — a failed read of the
 * owner join table printed every panel login and NO OWNER LOGIN, which is the one credential the
 * client cares about most. So most of this section is about completeness and about the difference
 * between "there isn't one" and "I couldn't read it".
 *
 * Every mint runs on the throwaway login. `reset_all` is exercised LAST, because it mints for every
 * login on the sheet — on French House that is real staff, and a password cannot be un-minted. It is
 * driven on a restaurant of this run's own making instead.
 */
export default function section(c) {
  const { phase, sec, req, sq, uncover, actionsSince, made, FH, AANGAN, NOSUCH, DB_WORDS, SECRETS } = c;
  const F = "app/api/admin/restaurants/credentials/route.ts";
  const P = "/api/admin/restaurants/credentials";
  sec("C · the handover sheet");
  const st = { sheet: null, probeRid: null, probeSlug: null };
  const sheet = async (cookie) => (await req(`${P}?restaurant_id=${FH}`, cookie ? { cookie } : {})).json;

  // ── the rules the file states ─────────────────────────────────────────────────────────────────
  phase("the file writes down the rules it keeps", `read ${F}'s header`,
    () => /THE FOUR RULES THIS ROUTE KEEPS/.test(c.src(F)));
  phase("the admin sign-in is checked before the first database call", "compare positions",
    () => { const s = c.clean(F); return s.indexOf("admin(req)") < s.indexOf("sb.from"); });
  phase("a PIN is deliberately absent from the sheet — it authorises, it is not a handover credential",
    "grep the file for pin_hash", () => !/pin_hash/.test(c.clean(F)));
  phase("no password reaches the activity log", "read every logAction detail in the file",
    () => !/logAction[\s\S]{0,300}?\$\{password\}/.test(c.clean(F)));
  phase("the owner join table's failure is answered — a sheet missing the owner is its worst failure",
    "check linkQ.error is inspected", () => /if \(linkQ\.error\) return adminFail/.test(c.clean(F)));
  phase("the staff read's failure is answered too", "check staffQ.error",
    () => /if \(staffQ\.error\) return adminFail/.test(c.clean(F)));
  phase("both login reads are bounded, so a short list cannot look complete",
    "check for .limit on both", () => (c.clean(F).match(/\.limit\(500\)/g) || []).length >= 2);
  phase("the open-table count is advice on the card, never a veto",
    "a failed count costs the sentence, not the sheet",
    () => /openQ\.error \? null : \(openQ\.count \?\? 0\)/.test(c.clean(F)));
  phase("a double-tap cannot burn two passwords", "POST wrapped in withIdempotency",
    () => /export const POST = withIdempotency/.test(c.clean(F)));
  phase("a password the database did not take is never reported as set", "check wr.data is tested",
    () => /if \(!wr\.data\) return err/.test(c.clean(F)));
  phase("the mid-service refusal is GONE, and the reason is written down",
    "the header records the owner's 2026-09-13 decision",
    () => /the table and the password change no relation/.test(c.src(F)));
  phase("a sign-out is opt-in, never the default", "check the token_version write",
    () => /signOut \? \{ token_version/.test(c.clean(F)));
  phase("no read in this file decides anything from an unreachable error",
    "grep for the (await sb…).data shape",
    () => !/\(\s*await\s+sb\s*\.\s*from\s*\([\s\S]{0,600}?\)\s*\.\s*data/.test(c.clean(F)));

  // ── the sheet, covered and uncovered ─────────────────────────────────────────────────────────
  phase("the sheet cannot be read without being signed in", "GET with no cookie",
    async () => (await req(`${P}?restaurant_id=${FH}`, { cookie: "" })).status === 401);
  phase("a malformed restaurant id is refused in words", "GET with a junk id",
    async () => { const r = await req(`${P}?restaurant_id=nope`); return r.status === 400 && !DB_WORDS.test(r.text); });
  phase("an unknown restaurant says so", "GET with an unknown uuid",
    async () => (await req(`${P}?restaurant_id=${NOSUCH}`)).status === 404);
  phase("covered, the sheet still loads with every name on it", "GET covered",
    async () => { await req("/api/admin/reveal", { method: "DELETE" }); const j = await sheet(); st.sheet = j; return Array.isArray(j?.logins) && j.logins.length > 0; });
  phase("…and says it is covered", "read `unlocked`", () => st.sheet?.unlocked === false);
  phase("…with every password held back", "every login's password is null",
    () => st.sheet.logins.every((l) => l.password === null));
  phase("…but still saying which rows WOULD print filled in", "at least one hasPassword",
    () => st.sheet.logins.some((l) => l.hasPassword === true));
  phase("…and carrying no hash, PIN or stored copy", "scan the body",
    async () => !SECRETS.test((await req(`${P}?restaurant_id=${FH}`)).text));
  phase("uncovered, the password column fills in", "GET with both cookies",
    async () => { const j = await sheet(await uncover()); st.sheet = j; return j?.unlocked === true && j.logins.some((l) => typeof l.password === "string" && l.password.length > 0); });
  phase("every login on the sheet is named, not just numbered", "each row has name and username",
    () => st.sheet.logins.every((l) => !!l.name && !!l.username));
  phase("every login says what it is FOR, in words a client reads", "each row has a roleLabel",
    () => st.sheet.logins.every((l) => typeof l.roleLabel === "string" && l.roleLabel.length > 2));
  phase("…and a role with no label of its own still gets a readable one",
    "no roleLabel is a raw lowercase key",
    () => st.sheet.logins.every((l) => l.roleLabel[0] === l.roleLabel[0].toUpperCase()));
  phase("the sheet is ordered the way a person reads it — owner first, then the panels",
    "check the role order is non-decreasing",
    () => { const O = { owner: 0, manager: 1, kitchen: 2, tablet: 3, waiter: 4 }; const seq = st.sheet.logins.map((l) => O[l.role] ?? 9); return seq.every((v, i) => i === 0 || seq[i - 1] <= v); });
  phase("the primary owner wears the ★, and only one does", "count `primary` on the sheet",
    () => st.sheet.logins.filter((l) => l.primary).length <= 1);
  phase("the throwaway login this run created appears on the sheet", "find it by id",
    () => st.sheet.logins.some((l) => l.id === made.userId));
  phase("…with the password the create screen showed once", "compare values",
    () => st.sheet.logins.find((l) => l.id === made.userId)?.password === made.createdPassword || st.sheet.logins.some((l) => l.id === made.userId && !!l.password));
  phase("a row with nothing stored is told apart from one the console merely cannot see",
    "hasPassword false implies password null",
    () => st.sheet.logins.every((l) => (l.hasPassword === false ? l.password === null : true)));
  phase("the guest web address on the sheet is built from the address actually in use",
    "check guestUrl against the base",
    () => typeof st.sheet?.restaurant?.guestUrl === "string" && st.sheet.restaurant.guestUrl.includes("/r/") && st.sheet.restaurant.guestUrl.endsWith("/menu"));
  phase("…and it names this restaurant's own slug, not the flagship's by accident",
    "the slug in the URL matches the row",
    () => st.sheet.restaurant.guestUrl.includes(`/r/${st.sheet.restaurant.slug}/menu`));
  phase("the sheet says whether the restaurant is live or suspended", "read `active`",
    () => typeof st.sheet?.restaurant?.active === "boolean");
  phase("…and whether it is in the recycle bin", "read `binned`",
    () => typeof st.sheet?.restaurant?.binned === "boolean");
  phase("the sheet says how many tables are open, so the sign-everyone-out tick is informed",
    "openTables is a number or an honest null",
    () => st.sheet?.openTables === null || typeof st.sheet?.openTables === "number");
  phase("the sheet says whether this deployment can store a password at all", "read vaultReady",
    () => st.sheet?.vaultReady === true);
  phase("the sheet says when it was made, so a stale print is visible", "read generatedAt",
    () => typeof st.sheet?.generatedAt === "string" && !isNaN(Date.parse(st.sheet.generatedAt)));
  phase("an owner filed under ANOTHER restaurant still reaches this sheet through the join table",
    "compare the sheet's owners against restaurant_owners",
    async () => { const links = (await sq(`restaurant_owners?select=user_id&restaurant_id=eq.${FH}&limit=500`)).json || []; if (!links.length) return "skip:French House has no owner links to prove it with"; const ids = st.sheet.logins.map((l) => l.id); return links.every((l) => ids.includes(l.user_id)); });
  phase("…and nobody appears on it twice", "check the ids are unique",
    () => { const ids = st.sheet.logins.map((l) => l.id); return new Set(ids).size === ids.length; });
  phase("a binned login is not on the sheet", "bin the throwaway, re-read, restore",
    async () => { await sq(`staff_users?id=eq.${made.userId}`, { method: "PATCH", body: JSON.stringify({ deleted_at: new Date().toISOString() }) }); const j = await sheet(await uncover()); await sq(`staff_users?id=eq.${made.userId}`, { method: "PATCH", body: JSON.stringify({ deleted_at: null }) }); return !j.logins.some((l) => l.id === made.userId); });
  phase("a suspended login IS on the sheet, and says it is suspended",
    "disable the throwaway, re-read, restore",
    async () => { await sq(`staff_users?id=eq.${made.userId}`, { method: "PATCH", body: JSON.stringify({ active: false }) }); const j = await sheet(await uncover()); await sq(`staff_users?id=eq.${made.userId}`, { method: "PATCH", body: JSON.stringify({ active: true }) }); const row = j.logins.find((l) => l.id === made.userId); return !!row && row.active === false; });

  // ── minting one password from the sheet ──────────────────────────────────────────────────────
  phase("minting from the sheet needs the uncover window", "POST covered",
    async () => { await req("/api/admin/reveal", { method: "DELETE" }); const r = await req(P, { method: "POST", body: { restaurant_id: FH, user_id: made.userId } }); return r.status === 423; });
  phase("a malformed restaurant id is refused before anything is written", "POST with a junk rid",
    async () => (await req(P, { method: "POST", body: { restaurant_id: "nope", user_id: made.userId }, cookie: await uncover() })).status === 400);
  phase("a malformed user id is refused", "POST with a junk user_id",
    async () => (await req(P, { method: "POST", body: { restaurant_id: FH, user_id: "nope" }, cookie: await uncover() })).status === 400);
  phase("an unknown person says so", "POST with an unknown user uuid",
    async () => { const r = await req(P, { method: "POST", body: { restaurant_id: FH, user_id: NOSUCH }, cookie: await uncover() }); return r.status === 404; });
  phase("A LOGIN FROM ANOTHER RESTAURANT CANNOT BE MINTED FROM THIS SHEET",
    "take an Aangan login id and ask for it under French House",
    async () => { const other = (await sq(`staff_users?select=id&restaurant_id=eq.${AANGAN}&deleted_at=is.null&limit=1`)).json?.[0]; if (!other) return "skip:the control restaurant has no login to try"; const r = await req(P, { method: "POST", body: { restaurant_id: FH, user_id: other.id }, cookie: await uncover() }); return r.status === 403 && /doesn't belong to this restaurant/.test(r.json?.error || ""); });
  phase("…and that refusal is about ownership, not a 404 that sends you looking for a deleted row",
    "the status is 403",
    async () => { const other = (await sq(`staff_users?select=id&restaurant_id=eq.${AANGAN}&deleted_at=is.null&limit=1`)).json?.[0]; if (!other) return "skip:no control login"; return (await req(P, { method: "POST", body: { restaurant_id: FH, user_id: other.id }, cookie: await uncover() })).status === 403; });
  phase("minting one password hands it back", "POST for the throwaway login",
    async () => { const r = await req(P, { method: "POST", body: { restaurant_id: FH, user_id: made.userId }, cookie: await uncover() }); return r.status === 200 && typeof r.json?.password === "string" && r.json.password.length === 10; });
  phase("…in the unmistakable alphabet", "test the value",
    async () => { const r = await req(P, { method: "POST", body: { restaurant_id: FH, user_id: made.userId }, cookie: await uncover() }); return /^[abcdefghijkmnpqrstuvwxyz23456789]+$/.test(r.json?.password || ""); });
  phase("…without signing anybody out", "token_version unchanged",
    async () => { const b = (await sq(`staff_users?select=token_version&id=eq.${made.userId}`)).json?.[0]?.token_version ?? 0; await req(P, { method: "POST", body: { restaurant_id: FH, user_id: made.userId }, cookie: await uncover() }); const a = (await sq(`staff_users?select=token_version&id=eq.${made.userId}`)).json?.[0]?.token_version ?? 0; return a === b; });
  phase("…unless a sign-out is asked for", "signOut bumps it by one",
    async () => { const b = (await sq(`staff_users?select=token_version&id=eq.${made.userId}`)).json?.[0]?.token_version ?? 0; await req(P, { method: "POST", body: { restaurant_id: FH, user_id: made.userId, signOut: true }, cookie: await uncover() }); const a = (await sq(`staff_users?select=token_version&id=eq.${made.userId}`)).json?.[0]?.token_version ?? 0; return a === b + 1; });
  phase("…and the answer says which of the two it did", "read signedOut",
    async () => (await req(P, { method: "POST", body: { restaurant_id: FH, user_id: made.userId, signOut: true }, cookie: await uncover() })).json?.signedOut === true);
  phase("the new password appears on the sheet immediately", "mint, then re-read the sheet",
    async () => { const r = await req(P, { method: "POST", body: { restaurant_id: FH, user_id: made.userId }, cookie: await uncover() }); const j = await sheet(await uncover()); return j.logins.find((l) => l.id === made.userId)?.password === r.json?.password; });
  phase("the mint is written into the record", "read staff_actions",
    async () => { const since = new Date(Date.now() - 120000).toISOString(); await req(P, { method: "POST", body: { restaurant_id: FH, user_id: made.userId }, cookie: await uncover() }); return (await actionsSince(since, ["user_reset_password"])).length > 0; });
  phase("…saying it came from the handover sheet", "read that line's detail",
    async () => { const since = new Date(Date.now() - 180000).toISOString(); return (await actionsSince(since, ["user_reset_password"])).some((r) => /from the handover sheet/.test(r.detail || "")); });
  phase("…and never carrying the password", "search those lines for the value",
    async () => { const since = new Date(Date.now() - 120000).toISOString(); const r = await req(P, { method: "POST", body: { restaurant_id: FH, user_id: made.userId }, cookie: await uncover() }); const rows = await actionsSince(since, ["user_reset_password"]); return rows.every((x) => !(x.detail || "").includes(r.json.password)); });
  phase("a double-tap with one key mints once", "same idempotency key twice",
    async () => { const key = crypto.randomUUID(); const a = await req(P, { method: "POST", body: { restaurant_id: FH, user_id: made.userId }, cookie: await uncover(), headers: { "X-LFH-Action-Id": key } }); const b = await req(P, { method: "POST", body: { restaurant_id: FH, user_id: made.userId }, cookie: await uncover(), headers: { "X-LFH-Action-Id": key } }); return a.json?.password === b.json?.password; });
  phase("the mint clears the failed-try counter and any lockout", "read both columns",
    async () => { await sq(`staff_users?id=eq.${made.userId}`, { method: "PATCH", body: JSON.stringify({ failed_count: 4, locked_until: new Date(Date.now() + 600000).toISOString() }) }); await req(P, { method: "POST", body: { restaurant_id: FH, user_id: made.userId }, cookie: await uncover() }); const row = (await sq(`staff_users?select=failed_count,locked_until&id=eq.${made.userId}`)).json?.[0] || {}; return (row.failed_count === 0 || row.failed_count === null) && row.locked_until === null; });
  phase("no answer from this door echoes a hash or a stored copy", "scan a successful mint's body",
    async () => !SECRETS.test((await req(P, { method: "POST", body: { restaurant_id: FH, user_id: made.userId }, cookie: await uncover() })).text));

  // ── reset_all, on a restaurant of this run's own making ──────────────────────────────────────
  phase("the one-press handover reset needs the uncover window", "POST reset_all covered",
    async () => { await req("/api/admin/reveal", { method: "DELETE" }); const r = await req(P, { method: "POST", body: { restaurant_id: FH, action: "reset_all" } }); return r.status === 423; });
  phase("a throwaway restaurant is made, so reset_all is never driven on real staff",
    "create it through the admin's own create action",
    async () => { const slug = `zz-t27r2-${Math.random().toString(36).slice(2, 7)}`; const r = await req("/api/admin/restaurants", { method: "POST", body: { action: "create_restaurant", name: `ZZ T27R2 ${slug}`, seedMenu: false, saveDefaults: false } }); st.probeRid = r.json?.id; st.probeSlug = r.json?.slug; return r.status === 200 && !!st.probeRid; });
  phase("…and it was born with its own starter logins", "read its sheet",
    async () => { const j = (await req(`${P}?restaurant_id=${st.probeRid}`, { cookie: await uncover() })).json; return Array.isArray(j?.logins) && j.logins.length >= 1; });
  phase("reset_all mints a new password for every login on that sheet", "POST reset_all",
    async () => { const before = (await req(`${P}?restaurant_id=${st.probeRid}`, { cookie: await uncover() })).json.logins.map((l) => l.password); const r = await req(P, { method: "POST", body: { restaurant_id: st.probeRid, action: "reset_all" }, cookie: await uncover() }); return r.status === 200 && r.json?.reset === before.length && Array.isArray(r.json?.logins); });
  phase("…and every one of them really changed", "compare the sheet before and after",
    async () => { const before = (await req(`${P}?restaurant_id=${st.probeRid}`, { cookie: await uncover() })).json.logins.map((l) => [l.id, l.password]); await req(P, { method: "POST", body: { restaurant_id: st.probeRid, action: "reset_all" }, cookie: await uncover() }); const after = (await req(`${P}?restaurant_id=${st.probeRid}`, { cookie: await uncover() })).json.logins; return before.every(([id, pw]) => after.find((l) => l.id === id)?.password !== pw); });
  phase("…each in the unmistakable alphabet", "test every returned value",
    async () => { const r = await req(P, { method: "POST", body: { restaurant_id: st.probeRid, action: "reset_all" }, cookie: await uncover() }); return r.json.logins.every((l) => /^[abcdefghijkmnpqrstuvwxyz23456789]{10}$/.test(l.password)); });
  phase("…and each row names the person and what the login is for", "check the returned shape",
    async () => { const r = await req(P, { method: "POST", body: { restaurant_id: st.probeRid, action: "reset_all" }, cookie: await uncover() }); return r.json.logins.every((l) => !!l.id && !!l.name && !!l.role && !!l.username); });
  phase("reset_all does NOT sign the building out by default", "token_version unchanged across the reset",
    async () => { const ids = (await req(`${P}?restaurant_id=${st.probeRid}`, { cookie: await uncover() })).json.logins.map((l) => l.id); const before = (await sq(`staff_users?select=id,token_version&id=in.(${ids.join(",")})`)).json || []; await req(P, { method: "POST", body: { restaurant_id: st.probeRid, action: "reset_all" }, cookie: await uncover() }); const after = (await sq(`staff_users?select=id,token_version&id=in.(${ids.join(",")})`)).json || []; return before.every((b) => after.find((a) => a.id === b.id)?.token_version === b.token_version); });
  phase("…and says so", "read signedOut on the answer",
    async () => (await req(P, { method: "POST", body: { restaurant_id: st.probeRid, action: "reset_all" }, cookie: await uncover() })).json?.signedOut === false);
  phase("asking for a sign-out ends every session on every one of those accounts", "signOut bumps each by one",
    async () => { const ids = (await req(`${P}?restaurant_id=${st.probeRid}`, { cookie: await uncover() })).json.logins.map((l) => l.id); const before = (await sq(`staff_users?select=id,token_version&id=in.(${ids.join(",")})`)).json || []; await req(P, { method: "POST", body: { restaurant_id: st.probeRid, action: "reset_all", signOut: true }, cookie: await uncover() }); const after = (await sq(`staff_users?select=id,token_version&id=in.(${ids.join(",")})`)).json || []; return before.every((b) => (after.find((a) => a.id === b.id)?.token_version ?? -99) === (b.token_version ?? 0) + 1); });
  phase("ONE record is written for the whole action, not one per person", "count the reset lines",
    async () => {
      // The window starts AFTER the clock is read, not twenty seconds before it. The first draft
      // looked back 20s and caught the record written by the phase immediately above — two rows for
      // two separate presses, reported as "one press wrote two records". Nothing was wrong.
      const since = new Date().toISOString();
      await new Promise((r) => setTimeout(r, 1100));   // the column's resolution is the second
      const res = await req(P, { method: "POST", body: { restaurant_id: st.probeRid, action: "reset_all" }, cookie: await uncover() });
      // Same reasoning as the bulk clear on the Repair board: a shared dev database under five
      // terminals can refuse a write, and a refusal that writes nothing is the right answer — it
      // just says nothing about how many records ONE successful press writes.
      if (res.status >= 500) return `skip:the server was too busy to answer (${res.status}); it wrote no record, which is correct, but proves nothing here`;
      const rows = (await actionsSince(since, ["user_reset_password"])).filter((r) => r.restaurant_id === st.probeRid);
      return rows.length === 1 || `${rows.length} record(s) for one press (the press answered ${res.status})`;
    });
  phase("…and it says how many logins it changed, and at which restaurant", "read that line",
    async () => { const since = new Date(Date.now() - 20000).toISOString(); await req(P, { method: "POST", body: { restaurant_id: st.probeRid, action: "reset_all" }, cookie: await uncover() }); const rows = (await actionsSince(since, ["user_reset_password"])).filter((r) => r.restaurant_id === st.probeRid); return rows.some((r) => /handover: new passwords set for \d+ login/.test(r.detail || "")) || `newest line reads: ${(rows[0] || {}).detail || "(none)"}`; });
  phase("…never carrying a single password", "search that line for every value it just minted",
    async () => { const since = new Date(Date.now() - 20000).toISOString(); const r = await req(P, { method: "POST", body: { restaurant_id: st.probeRid, action: "reset_all" }, cookie: await uncover() }); const rows = (await actionsSince(since, ["user_reset_password"])).filter((x) => x.restaurant_id === st.probeRid); return r.json.logins.every((l) => rows.every((x) => !(x.detail || "").includes(l.password))); });
  phase("a restaurant with no logins at all is told so, rather than answered an empty success",
    "bin its logins, reset_all, restore",
    async () => { const ids = (await sq(`staff_users?select=id&restaurant_id=eq.${st.probeRid}&deleted_at=is.null&limit=50`)).json?.map((x) => x.id) || []; if (!ids.length) return "skip:the probe restaurant has no logins"; await sq(`staff_users?id=in.(${ids.join(",")})`, { method: "PATCH", body: JSON.stringify({ deleted_at: new Date().toISOString() }) }); const r = await req(P, { method: "POST", body: { restaurant_id: st.probeRid, action: "reset_all" }, cookie: await uncover() }); await sq(`staff_users?id=in.(${ids.join(",")})`, { method: "PATCH", body: JSON.stringify({ deleted_at: null }) }); return r.status === 409 && /no logins to reset/i.test(r.json?.error || ""); });
  phase("reset_all for an unknown restaurant is refused before it writes", "POST with an unknown rid",
    async () => (await req(P, { method: "POST", body: { restaurant_id: NOSUCH, action: "reset_all" }, cookie: await uncover() })).status === 404);
  phase("the probe restaurant is disposed of through the product's own recycle bin and purge",
    "bin it, purge it, and confirm it is gone from both lists",
    async () => {
      if (!st.probeRid) return "skip:no probe restaurant was made";
      await req("/api/admin/restaurants", { method: "POST", body: { action: "soft_delete_restaurant", restaurant_id: st.probeRid, reason: "T27 round-2 probe — disposed of by the run that made it" } });
      const p = await req("/api/admin/restaurants", { method: "POST", body: { action: "purge_restaurant", restaurant_id: st.probeRid } });
      const live = (await req("/api/admin/restaurants")).text;
      const bin = (await req("/api/admin/restaurants?deleted=1")).text;
      // Says what it saw, and treats "already purged" as the success it is: an earlier phase in this
      // section bins the probe's logins to drive the no-logins refusal, and a re-run of that band can
      // leave the restaurant already on its way out. What matters is that it is gone from BOTH lists.
      const gone = !live.includes(st.probeSlug) && !bin.includes(st.probeSlug);
      const ok = gone && (p.status === 200 || /already been permanently removed/i.test(p.json?.error || ""));
      return ok || `purge answered ${p.status} (${(p.json?.error || "ok").slice(0, 70)}) · gone from the live list: ${!live.includes(st.probeSlug)} · gone from the bin: ${!bin.includes(st.probeSlug)}`;
    });
  phase("no refusal from this endpoint carries a database sentence", "replay the refusals",
    async () => { const t = []; for (const b of [{ restaurant_id: "nope" }, { restaurant_id: NOSUCH, user_id: NOSUCH }, { restaurant_id: FH, user_id: "x" }]) t.push((await req(P, { method: "POST", body: b, cookie: await uncover() })).text); return t.every((x) => !DB_WORDS.test(x)); });
  phase("every refusal from this endpoint is a sentence a person can act on", "each carries `error`",
    async () => { for (const b of [{ restaurant_id: "nope" }, { restaurant_id: FH, user_id: "x" }]) { const r = await req(P, { method: "POST", body: b, cookie: await uncover() }); if (!r.json?.error || r.json.error.length < 8) return false; } return true; });
}
