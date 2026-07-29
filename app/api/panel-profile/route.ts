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
import { userFromCookie, USER_COOKIE, hashSecret, verifySecret, normalizeLoginName } from "@/lib/userAuth";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { logAction, deviceIdFrom } from "@/lib/oplog";
import { payrollLadder } from "@/lib/tableTags";
import { waiterTables } from "@/lib/tableAssign";
import { completeness, hasProfile, mergeProfilePatch, SELF_PROFILE_FIELDS, todayIST } from "@/lib/staffProfile";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  // No staff cookie = admin super-access (or a signed-out tab). Not an error → 200.
  // `error` stays in the body so callers that test `j.error` keep skipping the profile UI.
  if (!u) return NextResponse.json({ staff: false, error: "not logged in" });
  // Their own section (waiter sections, mig 222) — so a waiter can see which tables they
  // hold from their own profile screen, without asking a manager. Read-only here; only a
  // manager/owner/admin can change it. null = not restricted (the module is off for this
  // restaurant, or they aren't a waiter) → the screen shows nothing about sections.
  const limit = u.restaurant_id ? await waiterTables(u, u.restaurant_id) : null;
  const myTables = limit ? limit.tables : null;   // just the numbers for display
  const base = {
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
  if (!u.restaurant_id || !hasProfile(u.role)) return NextResponse.json({ ...base, profileModule: false });
  if (!(await payrollLadder(u.restaurant_id)).effective) return NextResponse.json({ ...base, profileModule: false });

  const row = (await sb.from("staff_users")
    .select("profile, joined_on, designation, employment_type, shift_label, weekly_off, pay_type, pay_amount, pay_day, pay_mode, pay_extras, can_see_own_pay")
    .eq("id", u.id).maybeSingle()).data as Record<string, any> | null;
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
    canSeeOwnPay: row?.can_see_own_pay !== false,
  };

  if (row?.can_see_own_pay !== false) {
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

export async function POST(req: NextRequest) {
  const u = await userFromCookie(req.cookies.get(USER_COOKIE)?.value);
  if (!u) return NextResponse.json({ error: "not logged in" }, { status: 401 });
  let body: any = {};
  try { body = await req.json(); } catch {}

  // ── password change (own) — most sensitive, handled first ──────────────────
  if (body?.newPassword !== undefined) {
    if (!u.can_self_reset) {
      return NextResponse.json({ error: "Your admin manages your password. Ask them to reset it." }, { status: 403 });
    }
    const current = String(body?.currentPassword || "");
    const next = String(body?.newPassword || "");
    // Fetch the stored hash explicitly (it's intentionally NOT on the StaffUser
    // type, so it can never leak through a serialized user object).
    const row = (await sb.from("staff_users").select("password_hash").eq("id", u.id).limit(1)).data?.[0];
    // Re-authenticate with the current password so a hijacked open session can't
    // silently lock the real owner out.
    if (!(await verifySecret(current, row?.password_hash ?? null))) {
      return NextResponse.json({ error: "Current password is wrong." }, { status: 403 });
    }
    if (next.length < 6) return NextResponse.json({ error: "New password must be at least 6 characters." }, { status: 400 });
    if (next === current) return NextResponse.json({ error: "New password must be different." }, { status: 400 });
    // Bump token_version → every existing cookie (incl. this one) is invalidated;
    // the user re-logs in with the new password. That's the secure, expected flow.
    await sb.from("staff_users")
      .update({ password_hash: await hashSecret(next), token_version: (u.token_version || 0) + 1 })
      .eq("id", u.id);
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
    const clash = (await sb.from("staff_users").select("id").eq("username", key).neq("id", u.id).limit(1)).data?.[0];
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

  await sb.from("staff_users").update(patch).eq("id", u.id);

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
