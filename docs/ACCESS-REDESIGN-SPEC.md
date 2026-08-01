# Access & permissions — the redesign, as the owner specified it (2026-08-01)

Working spec. **Delete this file once it is built and verified.** Everything here is his words
turned into instructions; where I am still guessing, the line is marked **❓**.

---

## 1 · The two-switch rule

Every switchable row carries **two** controls:

| | where | states | means |
|---|---|---|---|
| **Feature** | RIGHT | on / off | does this restaurant have the thing at all |
| **Default for a new user** | LEFT | **off / on / on + manager PIN** | what a brand-new person of that role starts with |

- The feature switch's **on and off must look completely different** — not a subtle slide.
- The default control needs **three** states because the waiter tablet keeps the same screen and a
  **manager PIN** unlocks the action there.
- When the feature is OFF the default control is meaningless → it goes (nothing greyed out).
- Design is being picked from a 22-option sheet. **❓ awaiting his number.**

---

## 2 · Section = "Manager" (not "Manager's menu")

```
Manager
└── Manager menu
    ├── Edit menu      → the parts already there (customisation, add dish, edit dish,
    │                     change price, delete dish, mark sold out, categories, filters, 3D)
    ├── Ratings
    ├── Log
    ├── Dashboard     → when ON: “Today” or “Today + yesterday”.  Default = TODAY, for
    │                    new restaurants and for every existing one. OFF = no dashboard.
    └── Bill          ← the fifth item
        ├── Delete a bill
        └── Reopen a bill  → allowed only within N minutes; **N is settable**
```

### What delete and reopen actually do (his rules — build exactly this)
- **Delete a bill** — the bill NUMBER still moves on (the next bill takes the next number, the
  sequence is never reused). A deleted bill simply **does not appear in the report / the main
  calculation**. It is not erased: it stays in the records.
- **Reopen a bill** — the SAME bill reopens. It must be visible that it **was reopened**, and
  **what changed**. All of that is written to the **audit**.

---

## 3 · Things that are NOT features — remove the toggle, always on

- **Take a new order**
- **Mark a bill paid**
- **Generate bills**
- **Mark a table's type**
- **Move, merge and split tables**

**Still switchable:** Give a discount, Delete a bill, Reopen a bill, Manage staff, Change
restaurant settings, and the Manager-menu rows above.

### Dead code to remove while in there
- The **undo** of "mark paid" — a table closes instantly now and comes back as a NEW order, so
  the undo path cannot happen. Rip it out, not just hide it.
- He asked me to look for **more dead paths like this** and remove them too.

---

## 4 · Owner panel

- Add **Audit** to the Owner's menu.
- Audit = everything that **was not meant to happen but did** — mistakes, reopened bills, deleted
  bills, anything corrected after the fact.
- **The Log moves INSIDE Audit** in the owner panel.

---

## 5 · Main features vs Extra features

**Extra features** holds: Platforms (Zomato / Swiggy / own website), Banquet billing, Inventory,
Payroll, **and Pay later (khata)**.

**Main features** keeps the everyday running: Menu, Auto-print kitchen tickets, Bill, Tables & QR.

---

## 6 · Bill — ONE form, not a pile of boxes

Wrong today: GSTIN, Legal name and Bill address are three separate sub-option boxes sitting above
a fourth box that holds the rest. They are all the same thing.

**Right:** Bill → **Format** — one form holding GSTIN, legal name, address, phone, invoice prefix,
footer message, the tax rows, and the customer-name rule. Same idea as Menu → Format & theme.

---

## 7 · Tables & QR — real sub-options, not one merged blob

Wrong today: every tables card was merged into one long form.

**Right:** proper expandable sub-options, e.g.
- Tables & seats (count, names, seats, per-row layout)
- **QR codes & links** — its own sub-option, expandable
- …each with its own dropdown

**Remove entirely:** the "Auto close / restart tables" card — the session decides this, so the
setting is pointless.

---

## 8 · Colours — a ramp that never repeats a neighbour

Depth 0 **blue** → depth 1 **purple** → depth 2 **pink (reddish-pink, never true red)** → depth 3
**blue** → purple → pink → …

It currently reads as blue-inside-blue because purple at 30% opacity over a navy card looks blue.
Fix by raising the border/tint strength and picking hues that stay distinct at low alpha — the
reference he sent is a smooth blue→purple→pink gradient. The **embedded editor cards** must take
the level colour too; right now they don't, which is most of why it looks wrong.

---

## 9 · Also asked

- **Check every permission actually works** — end to end, each role.
- Make the whole thing **dynamic** and the UI genuinely good, not a wall of merged forms.

---

## Still open ❓

1. Which of the 22 switch designs.
2. Does the default control appear on **every** switchable row, or only the Manager-menu rows?
3. "Feature toggle name format" — I read this as: the Bill needs a **Format** row (§6). Confirm.
4. Reopen window: what should the **default** number of minutes be (he said "under 10 minutes")?
