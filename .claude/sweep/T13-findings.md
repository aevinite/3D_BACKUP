# T13 findings — the owner's Menu editor, Team and Settings

Territory: `app/owner/menu/**` · `app/owner/staff/**` · `app/owner/settings/**`
Phases: P06001–P06500 · Branch: `sweep6/t13-owner-menu-staff` · Port: 4113
Restaurant written to: **French House** only (Aangan never touched). Every row created was deleted
by id in the same run; the one `owner_entitlements` flip was restored byte-for-byte and verified.

Seven real problems. All seven are the same shape: **the screen said something that was not what
had actually happened.** All seven are fixed in this branch, one commit each, each with a section
of `scripts/verify-owner-panel.mjs` (`npm run verify:owner-panel`) numbered to match.

Numbering below = the numbers in the chat report = the guard's section numbers.

---

## 1 · A refused change was refused, and the owner was never told — HIGH · confirmed

**Where:** owner panel → Team → any person's row → "Rename / edit phone" → Save.
**Phase:** P06211 (also P06207, P06327).

Two people editing the same person's name or phone is the exact case "first save wins, and the
loser is told" exists for (CLAUDE.md item 11). The server does its half perfectly: it answers 409
with `clash.plain` — *"Someone else changed the name while you had it open — it now says …"* — and
`call()` throws that sentence. `saveEdit`'s catch then ran `setErr(msg); await load();`, and
`load()` ends its success path with `setErr(null)`. So the message was erased by the reload one
line later, before a single frame was painted with it.

**Measured:** PATCH → `409 {"clash":{"plain":"Someone else changed the name…"}}` on the wire, and
zero error banners in the DOM afterwards. What the owner saw: the row quietly showing someone
else's name, their own typing still in the box, no explanation anywhere.

`verify:owner-clash` was green throughout — a text scan can see the sentence being READ out of the
response, but not being cleared afterwards.

**Fix:** refresh first (the row must show what really landed), then say why. The editor stays open
with the draft, which is what `clash.todo` tells them to do.
**Guard:** §1 — isolates `saveEdit`'s catch and requires `await load()` before `setErr(`.

## 2 · A refusal rendered ~950px above the top of the screen — HIGH · confirmed

**Where:** owner panel → Team → the "Add" form at the bottom of the roster, on a phone.
**Phase:** P06393 (also P06040, P06230, P06345, P06496).

Every refusal on this page renders in one place: a banner at the very top. The one-time password
card has scrolled itself into view since 2026-07-07 for exactly this reason ("an owner low on the
page used to never see it"). The banner never did.

**Measured** on a 360×780 phone: submitting the Add form put the banner at **y = −951px**. Read the
screenshot: the owner tapped Add and nothing on screen changed at all. Same for a Remove the pay
ledger protects, and for a duplicate username.

**Fix:** the same scroll-into-view the password card uses.
**Guard:** §2.

## 3 · ⚠️ VETOED BY THE OWNER (2026-08-18) — the disclosure half is REJECTED, R31

> *"owner can't know which option are not given to them only admin should know that"*
>
> What is withheld from a restaurant is Aevidine's business alone. The card now lists ONLY what is
> ON — no ✗, no greyed chip, no count — and a section he does not have is simply not mentioned.
> **What survives:** the label map covers all nine sections, so a section he genuinely HAS can never
> be missing a chip (it held six of nine, which under-reported what he had). Do not offer the
> off-state again; see `docs/REJECTED-IDEAS.md` R31.

### The original finding, kept for the record

**Where:** owner panel → Settings → the "What's enabled" card.
**Phases:** P06193, P06194, P06371, P06399, P06462, P06464b, P06488.

The card is the only place an owner can confirm "that section is off on purpose". It listed 6 of
the 12 keys the API answers, so **Menu**, **Audit & logs** and **Manager mode** had no chip at all.
Two of the six were also named after screens that no longer exist: "Staff & powers" (its Powers tab
went in the access rebuild of 2026-07-31; the sidebar was corrected to "Team" on 2026-08-05 and the
roster's crumb on 2026-08-14 — this chip was the third copy of the same stale name) and "Feedback &
issues", which every other surface calls "Feedback & complaints".

**Measured:** with `menu` switched off for French House, the Menu item vanished from the sidebar,
`/owner/menu` said "ask your administrator", and this card still showed the same six chips.
Read both screenshots side by side: the sidebar says Menu / Manager mode / Audit & logs; the card
mentions none of them and names two others wrongly.

**Fix:** nine chips, named and ordered exactly as the sidebar names them. The three `logs_*` keys
are deliberately still not chips — they are which KINDS of row the Audit & logs page shows, not
sections; a chip each would read as three more screens he does not have.
**Guard:** §3 — derives the required set from `OWNER_SECTION_KEYS` and compares every label against
`OwnerShell`'s own nav label, so both halves of this fault are caught.

## 4 · Closing a person's profile silently switched which owner you were looking at — MEDIUM · confirmed

**Where:** owner panel (opened by Aevidine for a restaurant with two owners) → Team → open a
person → close the sheet.
**Phases:** P06029, P06365.

The link INTO a person was fixed to carry `?as=` in the T19 sweep (2026-08-14). The way back built
its URL from `?rid=` alone, so the pin survived the trip out and was thrown away on the trip home:
the roster, which resolves the owner from `as`, fell back to the PRIMARY owner's estate — same tab,
same task, a different person's team, nothing on screen saying so.

**Measured:** closing from `?rid=…&as=…` returned `/owner/staff?rid=…` with no `as` at all.

**Fix:** build the return URL from both pins, memoised on both.
**Guard:** §4 — and it re-checks the outbound link too, so the T19 fix cannot regress either.

## 5 · The Menu page reported a failed query as "the admin switched it off" — MEDIUM · code-read

**Where:** owner panel → Menu.
**Phases:** P06010, P06223, P06498.

`entitledSubset` ends in `.data || []`, and the admin branch used `.data` with no error check. An
empty answer has the same shape whether the admin genuinely switched Menu off or the query simply
failed — and the page then told the owner, in words, that their menu editor *"isn't switched on for
your restaurant — ask your administrator"*. That is a lie about their configuration on a database
blip: it sends them to support about a setting that is fine.

The rest of the product refuses to guess here — `/api/owner/staff` answers 503 "please try again"
for this exact case and its comment spells out why ("a failed READ is not a switched-off feature"),
as does `lib/panelAccess.ts` → `OwnedLookupFailed`. This page was the one owner screen still guessing.

Marked **code-read**, honestly: I could not make the database fail from a browser, so I did not
watch this one happen. The two states and the read error are plainly there in the source.

**Fix:** inspect the error, and answer "couldn't open your menu just now — please reload" for it.
It is also **one read instead of two** now: asking for `owner_entitlements` alongside `id, name`
answers the entitlement and the name in a single trip, where the page previously read the
`restaurants` table twice per render.
**Guard:** §5 — including that the Menu section switch is still enforced server-side here.

## 6 · The waiter picker drew an empty box and told the owner to pick from it — LOW · confirmed (forced)

**Where:** owner panel → Team → Add → role "waiter".
**Phases:** P06052, P06423, P06142.

`tableCount` comes from one `settings.table_count` read whose `.error` is not inspected on the
server, so a blip answers 0. The picker then drew a box with nothing in it, "0 of 0 picked", and
the line "Pick at least one table" — an instruction the screen was not offering — with Add disabled
for good and nothing saying why.

**Reachable via:** that floor-size read failing. Stated plainly: the column itself is
`NOT NULL DEFAULT 12` and the admin clamps it to 1–500, so a genuinely tableless restaurant is not
a normal state. I reproduced it by forcing `tableCount: 0` and read the screenshot.

**Fix:** name the restaurant and say the floor size could not be read, instead of asking the
impossible.
**Guard:** §6. See also 🔗 HANDOFF H2 for the server-side read.

## 7 · Two limits the server enforces were not stated where the value is typed — LOW · confirmed

**Where:** owner panel → Team → the Add form (password, phone) and any row's "Rename / edit phone".
**Phases:** P06132, P06136, P06345.

* The server refuses a password under **6** characters. The field said only "blank = auto", so the
  owner learned the rule from a refusal after a round trip — which, before problem 2 was fixed,
  rendered off the top of the screen. The sibling field on `/owner/settings` already says
  "min 6 characters".
* The server cuts a phone number at **20** characters (`.slice(0, 20)`). Neither phone field had a
  cap, so a longer value — two numbers in one box, or an extension — was accepted and quietly
  truncated on save. The roster then showed a number the owner had not typed, and nothing said so.
  The username field beside it has always mirrored its server limit (80) for exactly this reason.

Kept as ONE item because it is one fault in one form: a limit the server enforces must be visible
where the value is typed. **Measured after the fix:** the password field refuses "abc" before any
request; both phone fields stop at 20.
**Guard:** §7 — it reads both limits out of `app/api/owner/staff/route.ts`, so if the server ever
changes them the guard fails until the form agrees again.

---

## 🔗 HANDOFF — the real fix lives in another terminal's file

### H3 · The first phone-Back press on a person's profile does nothing — `lib/backStack.ts` / `components/admin/useAdminModal.ts`

**Where:** owner panel → Team → "Open profile" → press the phone's Back button, on a phone.
**Phase:** P06366. **Found** 2026-08-18 in the post-merge pass, by driving it.

Measured on 360×780, logging each press: **press 1 changes nothing** — same URL, sheet still open.
Press 2 returns to the roster. Escape and the ✕ both close it on the first try, so nobody is stuck;
it is one wasted press, every time, on the control a phone user reaches for first.

**Cause:** `/owner/staff/<id>` is a ROUTE, so opening it is already one history step. `StaffProfile`
then ALSO registers a back layer through `useAdminModal` → `useBackClose` — which is right in the
Aevidine console, where that profile is a modal opened over a page without navigating. In the owner
cockpit it is a page, so there are two back-steps for one visible layer.

**Why I did not fix it:** the swallowed press is consumed inside `lib/backStack.ts` and
`components/admin/useAdminModal.ts`. Neither is my territory, and the change carries a trade-off I
should not pick alone — making the layer's close use `router.back()` fixes the double press but
strands anyone who reached the profile from a typed or bookmarked URL with no roster behind it.

**Change needed:** let a back layer opt out of pushing its own buffer entry when the thing it closes
is a ROUTE rather than an overlay — or have `StaffProfile` skip that layer when its host says it is
page-hosted (`ProfileHost` already carries a `can` capability bag that could say so).
**Severity:** low-medium. Nothing is lost or wrong; it is one dead press on every profile close.

### H4 · Opening one person's profile takes 4–10 seconds — `app/api/owner/staff/route.ts`

**Where:** owner panel → Team → "Open profile". **Measured** five times: 3.9s, 6.4s, 7.0s, 8.7s,
10.1s to the person's name appearing. One `?staff=` request, status 200, no console errors.

It is **honest** while it waits — the sheet paints "Staff profile" with "Opening…" and a working ✕ —
so this is slowness, not a lie, which is why it is not one of the numbered problems. But the detail
endpoint does a lot per open: the person, the pay summaries, a `lfh_staff_performance` RPC, the
activity feed, `accessStateFor`, `payrollByRid` and `loadLogVisibility`. Several already run in
parallel; the RPCs look like the long pole.

**Change needed:** measure which read dominates, and consider deferring the performance RPC and the
activity feed until after first paint — the name, role and pay setup are what the owner opened it for.
**Not mine:** that route is another terminal's file.

### H1 · `app/owner/layout.tsx` — a stale comment, and a first-ever blip lands on the error page

Line ~50 says `enabledOwnedRestaurantIds` *"swallows a read error into an empty list rather than
throwing"*. That stopped being true on 2026-07-31 — it now throws `OwnedLookupFailed` when it has
no cached answer (`lib/panelAccess.ts` → `staleOrThrow`). The layout's `catch` only handles
`AuthDbError` and re-throws everything else, so the FIRST such blip for a given owner (nothing
cached yet) renders `app/error.tsx` instead of the `<OwnerReconnecting />` card the block was
written to show.

**Change needed:** catch `OwnedLookupFailed` alongside `AuthDbError` and return
`<OwnerReconnecting />`, and correct the comment in the same commit.
**Severity:** low (needs a cold cache plus a failed read), but it is the difference between a calm
"reconnecting" card and a crash page for a paying owner.
**Not done here:** outside my territory. Found while checking P06022.

### H2 · `app/api/owner/staff/route.ts` — the floor-size read ignores its error

```
const tcRows = (await sb.from("settings").select("restaurant_id, table_count").in(…)).data || [];
```

A failed read answers `tableCount: 0` for every restaurant, which is what makes problem 6 above
reachable at all. Every other read in that file was given this treatment already (`transient()`,
`rd()`, `payUnread`); this one was missed.

**Change needed:** inspect `.error` and either answer `transient()` or send a `floorUnread: true`
flag the roster can word, exactly as `payUnread` does for money.
**Severity:** low. My fix makes the screen honest either way; this makes it correct.
**Not done here:** outside my territory.

---

## Checked and deliberately NOT reported

* **Leftover Powers-tab CSS** in `app/owner/staff/page.tsx` (`.ost-perms`, `.ost-perm*`,
  `.reach-chip*`, `.reach-legend`) matches no element on the page. Confirmed dead — not reported and
  not removed: no person is worse off (§5 test 1) and §6 forbids pure tidying. Recorded at P06155 so
  the next sweep does not raise it as new.
* **`window.location.href` on the settings page** (a pre-existing lint warning). It is the correct
  choice: the password change bumps `token_version`, so the session is dead and a full document
  navigation is what discards the client state. Changing it would make behaviour worse.
* **`setPayroll(s, false)`'s branch is unreachable from the roster** — the roster offers ADD only;
  removal lives in the profile sheet. The confirm sentence itself is correct. No person affected.
* **Kitchen rows being blank** — the owner's own ruling, three times. Not touched.
* **No owner-side feature toggles** on Settings — the admin owns entitlement. Correct as-is.
* **Contrast**, both skins, measured not eyeballed: the Add button 4.83:1 light / clears in dark,
  the manager badge, the "on pay list · rate not set" chip and a picked table tile all clear 4.5:1
  in both skins. The earlier fixes here are intact.
