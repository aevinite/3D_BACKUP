# T16 improvements

## 🟢 Built in this branch (inside my territory, small, no migration, no new screen)

| # | where | what changed | ledger rows |
|---|---|---|---|
| 6 | Admin → Restaurants → New restaurant | the "Guest link" preview applies the same numeric-suffix loop the create route applies, so a name whose address is taken previews `/r/<slug>-2/menu` and says why — the address that goes on printed QR codes | P07536, P07822, P07823 |
| 7 | Admin → Billing & plans → "Collected this year" | the tile names the currency it counted and lists, underneath, any non-rupee payments it did NOT add in (the server only sums INR on purpose; the tile now says so) | P07678, P07867, P07922 |
| 10 | Admin → Live floor → the "Load live floor" button | it now really is 44px tall on a phone — its own declaration was losing to the platform's two-class 40px rule | P07913 |
| 11 | Admin → Billing editor + the three Owners dialogs | `min(96vw, …)` next to the wrapper's 16px padding overflowed a 360px screen, so the card could not centre; `min(100%, …)` insets it properly | P07923, P07903 |

| 15 | Admin → Live floor → tap a restaurant with a pop-up blocker on | a blocked tab no longer reads like a refusal. A card names the restaurant, offers its manager panel **in this tab** (no pop-up needed at all) and its guest menu, and points at its details & settings page for everything else. His words: "admin has access to everything… it should take you to the restaurant" | P07667 |
| 16 | Admin → Restaurants → New restaurant | redesigned to three short sections — **Name** (with the live guest-link preview), **Menu** (the one real choice, with what each answer means), **What it starts with** (stated, not asked). The four panel switches and the saved-setup dropdown are gone | P07531, P07533, P07534, P07816 |

## 🟡 Listed for him, NOT built

| # | where | what it is | why it is a decision, not a fix |
|---|---|---|---|
| ~~Y1~~ | Admin → Restaurants → New restaurant → the "Panels" section | **ANSWERED, and built as improvement 16.** He said: "the panel is something that you pick — we don't even need that. Solve that thing", and left the sample-menu switch to me: I kept it, because a restaurant whose real menu comes from a PDF does not want 70-odd demo dishes to delete first | — |
| Y1-original | Admin → Restaurants → New restaurant → the "Panels" section | its four switches no longer decide which staff apps a restaurant HAS — every panel has been always-on since the owner removed the switches (2026-07-31, and `/api/admin/restaurants/panels` POST answers 410 Gone). They only decide which starter LOGINS are minted, and turning them all off is still refused with "Turn on at least one panel." | Renaming the section to "Starter logins" is honest but assumes he wants the panel idea gone from onboarding too. Restoring meaning to the switches is the other answer. His call |
