"use client";
// The OWNER cockpit's door to the one person-profile (components/admin/StaffProfile).
//
// docs/STAFF-PROFILE.md: every person has ONE profile and it always looks the same. The owner
// panel used to have a second one — a six-tab page of its own, with its own hand-written
// permission list that had already drifted from the model (three waiter rows missing, khata gated
// on the wrong module, no manager rows at all). That page is deleted. The owner now opens the same
// component Aevidine does, and this file is the only thing that differs: which endpoint it knocks
// on, and what this console is allowed to do.
//
// TWO VOCABULARIES, ONE SCREEN. The admin route and the owner route grew separately and don't
// name every action the same way, so the translation lives HERE rather than in the component:
//
//   set_job { job: {...} }      → set_job { ...flat }        (the owner route reads flat fields)
//   set_job { in_payroll: b }   → set_payroll { in_payroll } (a different action there)
//   set_permissions { k: "" }   → set_permissions { k: null } ("" and null both mean "default")
//
// Anything the owner route has no action for is simply not offered (`can`), because a control that
// always refuses is the dead switch the access rebuild removed.
import type { ProfileHost } from "@/components/admin/StaffProfile";

/** `scopePin` = the admin's per-tab ?rid=, so an admin viewing an owner's cockpit stays in the
 *  right restaurant; null for a real owner (the server scopes them by membership regardless). */
export function ownerProfileHost(userId: string, scopePin: string | null, asPin: string | null): ProfileHost {
  const q = (path: string) => {
    const u = new URL(path, "http://x");                    // base is thrown away, we keep the query
    if (scopePin) u.searchParams.set("scope", scopePin);
    if (asPin) u.searchParams.set("as", asPin);
    return u.pathname + (u.search || "");
  };

  const translate = (payload: Record<string, unknown>): Record<string, unknown> => {
    const action = String(payload.action || "");
    if (action === "set_job") {
      // in_payroll is its own action on this route, and it never travels with job fields.
      if ("in_payroll" in payload) return { action: "set_payroll", in_payroll: payload.in_payroll };
      const job = (payload.job && typeof payload.job === "object" ? payload.job : {}) as Record<string, unknown>;
      return { action: "set_job", ...job };
    }
    if (action === "set_permissions") {
      const src = (payload.permissions || {}) as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(src)) out[k] = v === "" || v === "default" ? null : v;
      return { action: "set_permissions", permissions: out };
    }
    return payload;
  };

  return {
    load: async () => {
      const r = await fetch(q(`/api/owner/staff?staff=${encodeURIComponent(userId)}`), { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      // A calm "not switched on" answer is not a failure to open the person — the profile shows
      // the sentence the server sent rather than a red network error.
      if (j?.disabled || j?.notEligible) return { ok: false, data: { error: j.error || "Not available." } };
      return { ok: r.ok, data: j };
    },
    patch: async (payload, expect) => {
      const r = await fetch(q("/api/owner/staff"), {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(expect ? { "X-LFH-Expect": JSON.stringify({ table: "staff_users", id: userId, fields: expect.fields }) } : {}),
        },
        body: JSON.stringify({ id: userId, ...translate(payload) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        // A refusal carries the plain sentence in `clash.plain` + what to do next (lib/clash.ts).
        // Show THOSE — the machine code "clash_changed_elsewhere" tells a person nothing, and this
        // is the message that stops them believing their number landed.
        const c = j?.clash as { plain?: string; todo?: string } | undefined;
        throw new Error(c?.plain ? `${c.plain}${c.todo ? ` ${c.todo}` : ""}` : (j.error || "That didn't save."));
      }
      return j;
    },
    remove: async () => {
      const r = await fetch(q(`/api/owner/staff?id=${encodeURIComponent(userId)}`), { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      return { ok: r.ok, error: j.error };
    },
    // No photo endpoint on this side, and no route for a PIN or for the two signing-in switches —
    // those stay Aevidine's. The cards still appear; they show the facts instead of dead controls.
    // `visitAsPerson` needs /api/admin/act-as/go and an admin cookie; `accessLink` points into
    // /aevinite. Neither exists for an owner, so neither is offered — the profile shows a plain
    // link to the panel instead, with a title that admits whose access it opens with.
    can: { pin: false, signIn: false, role: false, visitAsPerson: false, accessLink: false },
  };
}
