// /api/panel-profile — the logged-in staff user's own profile.
//   GET  → { username, role, name, phone, hasPin, needsProfile, canSelfReset }
//          or { staff: false } when there is no staff user — which is a NORMAL state,
//          not a failure: the admin's super-access view has no per-user profile.
//          It used to answer 401 there, so EVERY admin panel view logged a red
//          "Failed to load resource: 401" in the console and fed the error log a
//          fake problem (seen on all six panels during the AV-live sweep 2026-07-28).
//          Now it's a plain 200 that says "nobody is signed in"; the `error` key is
//          kept alongside so existing callers branch exactly as before.
//          POST still answers 401 — writing a profile genuinely requires a login.
//   POST → set their own name/phone (first-login capture), set/change PIN, and/or
//          change their own PASSWORD (only if canSelfReset; requires the current
//          password and bumps token_version so all sessions must re-login).
// Scoped to the cookie's user id, so a user can only edit themselves.
import { NextRequest, NextResponse } from "next/server";
import { userFromCookie, USER_COOKIE, hashSecret, verifySecret, normalizeLoginName, AuthDbError } from "@/lib/userAuth";
// The one sentence a person reads when the database didn't answer — shared with every panel route.
import { BUSY_MESSAGE } from "@/lib/dbRefusal";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { logAction, deviceIdFrom } from "@/lib/oplog";
import { payrollLadder } from "@/lib/tableTags";
import { waiterTables } from "@/lib/tableAssign";
import { completeness, hasProfile, mergeProfilePatch, SELF_PROFILE_FIELDS, todayIST } from "@/lib/staffProfile";
import { rateAllowed, rateResetOnSuccess } from "@/lib/rateLimit";
import { withIdempotency } from "@/lib/idempotency";
import { expectClash, clashJson } from "@/lib/clash";

export const dynamic = "force-dynamic";

// WHO IS ASKING — and "the database didn't answer" is not "nobody" (T17 sweep, 2026-08-13,
// finding F9). `userFromCookie` THROWS `AuthDbError` when the staff_users lookup itself fails, and
// both handlers below called it bare, so a DB blip left My profile with a raw 500: the screen breaks
// instead of saying the system is busy, and the device's offline layer can't fall back to the copy
// it already has (that needs the 503 + `busy` marker every other panel route gives —
// lib/panelFailure.ts). Answering `busy` here puts this route back in step with the rest.
async function whoIsAsking(req: NextRequest): Promise<{ user: Awaited<ReturnType<typeof userFromCookie>> } | { busy: NextResponse }> {
  try {
    return { user: await userFromCookie(req.cookies.get(USER_COOKIE)?.value) };
  } catch (e) {
    if (e instanceof AuthDbError) {
      console.error("[panel-profile] auth lookup failed:", e.message);
      return {
        busy: NextResponse.json(
          { error: BUSY_MESSAGE, busy: true },
          { status: 503, headers: { "X-LFH-Busy": "1" } },
        ),
      };
    }
    throw e;
  }
}

export async function GET(req: NextRequest) {
  const asker = await whoIsAsking(req);
  if ("busy" in asker) return asker.busy;
  const u = asker.user;
  // No staff cookie = admin super-access (or a signed-out tab). Not an error → 200.
  // `error` stays in the body so callers that test `j.error` keep skipping the profile UI.
  if (!u) return NextResponse.json({ staff: false, error: "not logged in" });
  // Their own section (waiter sections, mig 222) — so a waiter can see which tables they
  // hold from their own profile screen, without asking a manager. Read-only here; only a
  // manager/owner/admin can change it. null = not restricted (the module is off for this
  // restaurant, or they aren't a waiter) → the screen shows nothing about sections.
  // ── EVERYTHING INDEPENDENT STARTS AT ONCE (T9 improvement 14, 2026-08-06) ──────────────────────
  // Opening this screen used to be five trips to Mumbai one after another: the waiter-tables read,
  // the payroll rung, the staff row, the payments list, then the pay-summary RPC. None of the first
  // three needs any of the others, so they were pure waiting — visible as a pause on restaurant wifi.
  // They are kicked off together here and awaited where they were already needed; the two PAY reads
  // further down were already parallel with each other.
  const tablesP = u.restaurant_id ? waiterTables(u, u.restaurant_id) : Promise.resolve(null);
  const ladderP = u.restaurant_id && hasProfile(u.role) ? payrollLadder(u.restaurant_id) : null;
  // `.then(x => x, ...)`-style catch attached IMMEDIATELY: if the payroll gate below returns early,
  // this read is never awaited, and a floating rejected promise becomes an unhandled rejection that
  // can take the whole serverless invocation down. Resolving to an error-shaped object instead keeps
  // the early return harmless, and the one place that reads it already handles a null row.
  const rowP = u.restaurant_id && hasProfile(u.role)
    ? sb.from("staff_users")
        .select("profile, joined_on, designation, employment_type, shift_label, weekly_off, pay_type, pay_amount, pay_day, pay_mode, pay_extras, can_see_own_pay, in_payroll")
        .eq("id", u.id).maybeSingle()
        .then((r) => r, (e) => { console.error("[panel-profile] own row read failed:", e?.message ?? e); return { data: null }; })
    : null;
  const limit = await tablesP;
  const myTables = limit ? limit.tables : null;   // just the numbers for display
  const base = {
    // Their OWN row id. Needed so the save can say what it was editing FROM (the clash gate's
    // `expect` names a table + id) — without it the expectation is silently ignored, which reads
    // as "protected" and isn't. Their own id on their own screen discloses nothing.
    id: u.id,
    username: u.username, role: u.role, name: u.name, phone: u.phone,
    myTables,
    hasPin: !!u.pin_hash,
    needsProfile: !u.profile_confirmed, // one-time setup card shown until confirmed once
    canSelfReset: u.can_self_reset,
    canSelfSetPin: u.can_self_set_pin, // may they set/change their own PIN? (managers)
  };

  // ── Their own profile + their own pay (mig 220) ──────────────────────────────
  // Only when the restaurant HAS the feature and their role gets a profile (kitchen doesn't).
  // A person always sees THEIR OWN salary and payments unless the owner switched that off for
  // them — it's their money, and the ledger is what settles "you never paid me".
  if (!u.restaurant_id || !hasProfile(u.role) || !ladderP || !rowP) return NextResponse.json({ ...base, profileModule: false });
  if (!(await ladderP).effective) return NextResponse.json({ ...base, profileModule: false });

  const row = (await rowP).data as Record<string, any> | null;
  const c = completeness({ ...(row || {}), phone: u.phone });
  const out: Record<string, unknown> = {
    ...base,
    profileModule: true,
    profile: row?.profile || {},
    // Their JOB is theirs to SEE but not to change (the owner sets it) — the panel renders
    // these read-only. Sent whatever the pay switch says: a shift and a joining date aren't money.
    job: {
      joined_on: row?.joined_on ?? null, designation: row?.designation ?? null,
      employment_type: row?.employment_type ?? null, shift_label: row?.shift_label ?? null,
      weekly_off: row?.weekly_off ?? null,
    },
    editable: SELF_PROFILE_FIELDS,
    completeness: { filled: c.selfFilled, total: c.selfTotal, missing: c.missing },
    canSeeOwnPay: row?.can_see_own_pay !== false && row?.in_payroll === true,
    onPayList: row?.in_payroll === true,
  };

  // Their pay section exists only if they're actually ON the pay list (mig 221) AND the owner
  // hasn't switched off their own-pay view. Someone not on the list has no pay to show.
  if (row?.can_see_own_pay !== false && row?.in_payroll === true) {
    out.pay = {
      pay_type: row?.pay_type ?? null, pay_amount: row?.pay_amount ?? null,
      pay_day: row?.pay_day ?? null, pay_mode: row?.pay_mode ?? null, pay_extras: row?.pay_extras ?? [],
    };
    const { data: pays } = await sb.from("staff_payments")
      .select("id, kind, amount, for_period, mode, paid_on, note, voided_at, void_reason")
      .eq("staff_id", u.id).eq("restaurant_id", u.restaurant_id)
      .order("paid_on", { ascending: false }).limit(40);
    out.payments = pays || [];
    const monthStart = todayIST().slice(0, 8) + "01";
    const { data: sum } = await sb.rpc("lfh_staff_pay_summary", { p_restaurant: u.restaurant_id, p_from: monthStart, p_to: todayIST() });
    const mine = ((sum || []) as any[]).find((x) => x.staff_id === u.id) || null;
    out.paySummary = {
      thisMonth: Number(mine?.paid || 0),
      advanceOutstanding: Number(mine?.advance_outstanding || 0),
      lastPaidOn: mine?.last_paid_on || null,
    };
  }
  return NextResponse.json(out);
}

// AT MOST ONCE + NO SILENT OVERWRITES (sweep 2026-08-05).
//
// This route was the one staff write surface outside both rules. The admin's twin — which edits the
// SAME columns of the SAME row (app/api/admin/users, `set_profile`) — got the clash gate on
// 2026-08-04 when the sweep found that expectClash "appeared in the editor/kitchen/tablet routes and
// NOWHERE else". The PERSON'S OWN side of that same screen was left out, so first-save-wins held in
// one direction only: a manager correcting a waiter's phone in /aevinite was correctly refused if
// the waiter got there first, while the waiter silently overwrote the manager.
// The wrapper also makes a replayed profile save run once, so the offline queue (see
// public/panels/myprofile.js) can carry these writes like every other panel write.
export const POST = withIdempotency(postImpl, "panel-profile");
async function postImpl(req: NextRequest) {
  // Same rule as GET: a database blip answers "busy" (503), never "you are not logged in" (401),
  // which would bounce a signed-in person to the login screen mid-save. (T17, finding F9)
  const asker = await whoIsAsking(req);
  if ("busy" in asker) return asker.busy;
  const u = asker.user;
  if (!u) return NextResponse.json({ error: "not logged in" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch {}

  // The one clash gate for every branch below, exactly as the panel dispatchers do it: a no-op
  // unless the screen said what it was editing FROM (the X-LFH-Expect header), so a caller that
  // hasn't opted in is unaffected. Scoped to the person's own restaurant.
  {
    const overwrite = await expectClash(req, String(u.restaurant_id || ""));
    if (overwrite) return clashJson(overwrite);
  }

  // ── password change (own) — most sensitive, handled first ──────────────────
  if (body?.newPassword !== undefined) {
    if (!u.can_self_reset) {
      return NextResponse.json({ error: "Your admin manages your password. Ask them to reset it." }, { status: 403 });
    }
    const current = String(body?.currentPassword || "");
    const next = String(body?.newPassword || "");
    // Fetch the stored hash explicitly (it's intentionally NOT on the StaffUser
    // type, so it can never leak through a serialized user object).
    // A WALL ON THE ONE PASSWORD BOX THAT HAD NONE (sweep 2026-08-04, mig 277). This check happens
    // AFTER someone is already signed in — an unlocked tablet on a counter, a shared browser — so it
    // was the only credential check in the product a person could hammer indefinitely. Counted per
    // ACCOUNT, not per device: a guesser can clear a cookie, not change whose password they are
    // guessing. Placed BEFORE verifySecret so a wrong guess is counted, and reset on success below
    // so a person legitimately changing their password twice is never walled.
    if (!(await rateAllowed("password_change", u.id, {
      restaurantId: u.restaurant_id ?? null,
      label: `${u.name || u.username} (${u.role}) changing their own password`,
      device: deviceIdFrom(req),
    }))) {
      return NextResponse.json({ error: "Too many tries. Please wait a few minutes and try again." }, { status: 429 });
    }
    const row = (await sb.from("staff_users").select("password_hash").eq("id", u.id).limit(1)).data?.[0];
    // Re-authenticate with the current password so a hijacked open session can't
    // silently lock the real owner out.
    if (!(await verifySecret(current, row?.password_hash ?? null))) {
      return NextResponse.json({ error: "Current password is wrong." }, { status: 403 });
    }
    // They knew it → clear the counter, so a person who legitimately changes their password twice in
    // one sitting is never walled (the same rule login already follows, lib/rateLimit).
    await rateResetOnSuccess("password_change", u.id);
    if (next.length < 6) return NextResponse.json({ error: "New password must be at least 6 characters." }, { status: 400 });
    if (next === current) return NextResponse.json({ error: "New password must be different." }, { status: 400 });
    // Bump token_version → every existing cookie (incl. this one) is invalidated;
    // the user re-logs in with the new password. That's the secure, expected flow.
    //
    // A WRITE NOBODY LOOKED AT IS NOT A WRITE (T9 sweep, 2026-08-06). This `update` captured
    // neither an error nor a row count, so a failed write (row lock, timeout, statement error) still
    // fell through to `{ok:true, passwordChanged:true}` AND wrote a `password_change` line to the
    // owner's Activity log. The person was told every session had ended, their OLD password went on
    // working, and the log agreed with them — so nobody looking for the cause could find one. This is
    // the identical fault `/api/owner/staff` `reset_password` was fixed for on 2026-07-07 ("the owner
    // read out a password the DB never saved") and the same reasoning as `/api/maintenance`'s
    // zero-row check ("a record of something that didn't happen is worse than no record").
    // `.select("id")` is what makes a zero-row match visible: PostgREST answers an UPDATE that hit
    // nothing with `data: []` and NO error.
    const pw = await sb.from("staff_users")
      .update({ password_hash: await hashSecret(next), token_version: (u.token_version || 0) + 1 })
      .eq("id", u.id)
      .select("id");
    if (pw.error) {
      console.error("[panel-profile] password write failed:", pw.error.message);   // detail our side
      return NextResponse.json({ error: "Couldn't change your password — please try again." }, { status: 500 });
    }
    if (!pw.data?.length) {
      return NextResponse.json({ error: "Couldn't change your password — your account wasn't found. Ask your admin." }, { status: 409 });
    }
    // Staff-initiated change → operation log (admin resets are logged separately).
    await logAction(u.role, "password_change", {
      restaurant_id: u.restaurant_id, actor: u.name || u.username, device_id: deviceIdFrom(req),
      detail: `${u.name || u.username} changed their own password`,
    });
    return NextResponse.json({ ok: true, passwordChanged: true });
  }

  // ── their own personal details (mig 220) ────────────────────────────────────
  // Address, emergency contact, date of birth… the things only THEY know. Deliberately NOT
  // their ID-on-file (the owner is the one who verifies it), their job, or their salary —
  // nobody should be able to give themselves a raise. Whitelisted by SELF_PROFILE_FIELDS.
  if (body?.profile !== undefined) {
    if (!u.restaurant_id || !hasProfile(u.role)) return NextResponse.json({ error: "Your account doesn't have a profile." }, { status: 400 });
    if (!(await payrollLadder(u.restaurant_id)).effective)
      return NextResponse.json({ error: "Staff profiles aren't enabled for this restaurant." }, { status: 403 });
    const p = body.profile;
    if (!p || typeof p !== "object" || Array.isArray(p)) return NextResponse.json({ error: "Missing profile fields." }, { status: 400 });
    const cur = (await sb.from("staff_users").select("profile").eq("id", u.id).maybeSingle()).data?.profile as Record<string, unknown> | null;
    const merged = mergeProfilePatch(cur, p as Record<string, unknown>, SELF_PROFILE_FIELDS);
    const { error } = await sb.from("staff_users").update({ profile: merged }).eq("id", u.id);
    if (error) return NextResponse.json({ error: "Couldn't save that — please try again." }, { status: 500 });
    const who = u.name || u.username;
    await logAction(u.role, "profile_update", {
      restaurant_id: u.restaurant_id, actor: who, actor_id: u.id, device_id: deviceIdFrom(req),
      detail: `${who} updated their own details (${Object.keys(p).slice(0, 6).join(", ")})`,
    });
    const c = completeness({ profile: merged, phone: u.phone });
    return NextResponse.json({ ok: true, profile: merged, completeness: { filled: c.selfFilled, total: c.selfTotal, missing: c.missing } });
  }

  // ── name / phone / PIN (the user editing their OWN profile) ─────────────────
  const patch: Record<string, unknown> = {};
  const changes: string[] = [];

  if (body?.name !== undefined) {
    // The Name doubles as the unique login id. Store it as typed (display) and a
    // normalized copy in `username` (the matchable key); reject duplicates.
    const display = String(body.name || "").trim().slice(0, 80);
    const key = normalizeLoginName(display);
    if (!display || !key) return NextResponse.json({ error: "Your username can't be empty." }, { status: 400 });
    // Scoped to THEIR restaurant (sweep 2026-08-05). The database index is
    // `(restaurant_id, lower(username))` — mig 091 made login names unique PER restaurant — and all
    // four other places that check this scope it that way (app/api/admin/users l.139 + l.334,
    // app/api/owner/staff l.505 + l.816). This one was restaurant-blind, so a waiter at Aangan was
    // told "already taken" about a name only some other restaurant used, and no name they could
    // type would ever free it up. Refusing a name the database would accept is a wall with nothing
    // behind it.
    const clash = (await sb.from("staff_users").select("id").eq("username", key)
      .eq("restaurant_id", u.restaurant_id).neq("id", u.id).is("deleted_at", null).limit(1)).data?.[0];
    if (clash) return NextResponse.json({ error: "That username is already taken — please pick another." }, { status: 409 });
    patch.name = display;
    patch.username = key;
    if (key !== normalizeLoginName(u.name || u.username)) changes.push("name");
  }
  if (body?.phone !== undefined) {
    const phone = String(body.phone || "").trim().slice(0, 20) || null;
    if (phone !== (u.phone ?? null)) changes.push("phone");
    patch.phone = phone;
  }
  if (body?.pin !== undefined) {
    // Honor the admin toggle: if they're not allowed to manage their own PIN, the
    // admin sets it for them (via /api/admin/users). Mirrors the password rule.
    if (!u.can_self_set_pin) {
      return NextResponse.json({ error: "Your admin manages your PIN. Ask them to set it." }, { status: 403 });
    }
    const pin = String(body.pin || "").trim();
    if (!/^\d{4,8}$/.test(pin)) return NextResponse.json({ error: "PIN must be 4–8 digits." }, { status: 400 });
    patch.pin_hash = await hashSecret(pin); // salted, slow hash (same as passwords)
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "nothing to update" }, { status: 400 });

  // Once they have BOTH a name and a phone, mark the one-time setup done so the
  // welcome card never auto-opens again. A MANAGER who is allowed to self-set a PIN
  // must also HAVE a PIN before setup is complete (matches the welcome card asking
  // for it). If they can't self-set (admin owns it), name+phone is enough.
  const effName = patch.name !== undefined ? patch.name : u.name;
  const effPhone = patch.phone !== undefined ? patch.phone : u.phone;
  const willHavePin = patch.pin_hash !== undefined || !!u.pin_hash;
  const pinRequiredForSetup = u.role === "manager" && u.can_self_set_pin;
  const setupComplete = !!effName && !!effPhone && (!pinRequiredForSetup || willHavePin);
  const firstConfirm = !u.profile_confirmed && setupComplete;
  if (setupComplete) patch.profile_confirmed = true;

  // SAME RULE AS THE PASSWORD BRANCH ABOVE (T9 sweep, 2026-08-06). This wrote a name, a login
  // username and a PIN hash and looked at neither the error nor the row count, then logged
  // `pin_set` / `profile_setup` / `profile_update` and answered `{ok:true}`. The visible symptom is
  // worse here than for a password, because a PIN is only used LATER: the manager is told the PIN is
  // set, the log says so, and the refusal arrives the next time they try to approve a discount.
  // (The `profile` branch above already checked its error — the file disagreed with itself.)
  const saved = await sb.from("staff_users").update(patch).eq("id", u.id).select("id");
  if (saved.error) {
    console.error("[panel-profile] profile write failed:", saved.error.message);   // detail our side
    return NextResponse.json({ error: "Couldn't save that — please try again." }, { status: 500 });
  }
  if (!saved.data?.length) {
    return NextResponse.json({ error: "Couldn't save that — your account wasn't found. Ask your admin." }, { status: 409 });
  }

  // Operation log — STAFF edits land here; the admin's edits in /api/admin/users
  // are deliberately NOT logged. actor = their (new) name.
  const who = (patch.name as string) || u.name || u.username;
  const dev = deviceIdFrom(req);
  if (patch.pin_hash !== undefined) {
    await logAction(u.role, "pin_set", { restaurant_id: u.restaurant_id, actor: who, device_id: dev, detail: `${who} ${u.pin_hash ? "changed" : "set"} their PIN` });
  }
  if (firstConfirm) {
    await logAction(u.role, "profile_setup", { restaurant_id: u.restaurant_id, actor: who, device_id: dev, detail: `${who} completed their profile${changes.length ? " (" + changes.join(" & ") + ")" : ""}` });
  } else if (changes.length) {
    await logAction(u.role, "profile_update", { restaurant_id: u.restaurant_id, actor: who, device_id: dev, detail: `${who} updated their ${changes.join(" & ")}` });
  }
  return NextResponse.json({ ok: true });
}
