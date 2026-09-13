// /aevinite/owners — the old address for the Owners roster, kept alive as a real HTTP redirect.
//
// The roster merged into /aevinite/people on 2026-09-13 (owner: "merge 2 section name it user and
// owner") and lives in components/admin/OwnersView.tsx. This address still resolves because it is
// written down elsewhere — other admin screens, the admin's bookmarks, links he has sent people.
//
// WHY A ROUTE HANDLER AND NOT A page.tsx THAT CALLS redirect(). A page that reads `searchParams`
// has to await them, which starts Next's streamed render — so `redirect()` came back as a
// **200 with an RSC redirect payload in the body** instead of a plain 307. Browsers follow that, but
// nothing else does, and "200 OK" is the wrong answer about a page that has moved. A route handler
// answers before any rendering begins, so this is a genuine 308.
//
// ⚠️ THE QUERY STRING IS CARRIED THROUGH, and that is not a nicety. `?staff=<id>` is how a person's
// profile is deep-linked (components/admin/useOverlayParam.ts — the owner's 2026-08-02 rule: "I
// refresh, why do I go back to the main thing? I should be staying here"). A redirect that dropped
// it would turn every saved link to a PERSON into a link to the list, silently. The first version of
// this file did exactly that; verify:admin-access-people caught it before it shipped, and now
// asserts it on every run.
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const from = new URL(req.url);
  const to = new URL("/aevinite/people", from.origin);
  // `tab` is decided HERE, not by whatever an old link happened to carry.
  from.searchParams.forEach((v, k) => { if (k !== "tab") to.searchParams.append(k, v); });
  to.searchParams.set("tab", "owners");
  // 308, not 307: this is permanent, and it keeps the method — there is nothing but GET here anyway.
  return NextResponse.redirect(to, 308);
}
