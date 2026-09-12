# H12 — HRMex 10.0.0.0 · the config core: Master Setting + Employee Setting

**Captured:** 2026-09-07, live at `https://demo.hrmexweb.in`, signed in as Superadmin.
**Method:** every screen and every dialog **opened and driven live** in a real browser (each of the 8
tabs clicked, all 3 pop-outs opened, the ESS category dropdown cycled through all 7 categories, the
OT slab pop-out cycled through 6 Company × Category combinations). Current values below are what the
screen actually showed. Where I also read the page's own rendering code — only to learn the intended
shape of a table that rendered **empty** — I say so on that line.
**Nothing was saved, submitted, printed, tested or deleted.** No `Save Settings`, no `Save Onboard
Settings`, no `Save` row button, no `Test Printer`.
**Screenshots:** `.claude/capture/shots/H12/` (13 files).

---

## 0. Why this pair of screens is the whole product

HRMex does not hard-code payroll. There is **one table of salary heads** (63 of them on this demo:
`BASIC`, `HRA`, `PF`, `PT`, `OT`, `Bonus`, `ESIC`, `LOP`, …), and these two settings screens do
nothing but **point a job at a head**: "the thing called PF is *this* row", "the thing called Absent
is *this* row", "overtime hours land on *this* row". Change the pointer and every payslip in the
install changes meaning, with no code touched.

Concretely, on the Payroll tab, seven dropdowns each carry the **same complete list of 63 heads**,
and each one is currently aimed at a different row:

| The role | is currently pointed at | head id |
|---|---|---|
| PT Head | `PT` | 2007 |
| PF Head | `PF` | 2002 |
| Loan Head | `HOME_LOAN` | 2009 |
| OT Hrs Head | `OT HRS` | 3011 |
| OT Head | `OT` | 3010 |
| Bonus Head | `Bonus` | 3027 |
| ESIC Head | **not set** (`Select...`) | — |

Attendance adds three more of the same kind (`Absent Head = A`, `Present Head = P`,
`Extra Hrs Head = not set`) and Leave adds two (`Leave Type = Leave`, `COFF Head = COFF`).
**Twelve pointers in total** define the entire money model. That is the single idea to copy.

**In simple words:** the app has one big list of "money lines" — basic pay, house rent, provident
fund, overtime, bonus, and so on. These two settings pages don't calculate anything themselves. They
just say which line on that list means "provident fund", which line means "overtime", which line
means "absent". Payroll then reads those labels. So a new customer with different names for the same
things needs zero new code — somebody just re-points the twelve dropdowns.

---

## 1. Master Setting — `/Master/Master_Settings.aspx?MenuId=9`

**Where:** left sidebar → **Master** → **Master Setting**. (Opens inside the shell's iframe tab host,
same as every other HRMex screen.)

**What you see on arrival:** a white breadcrumb strip (`Home / Master Settings`) across the top; a
solid blue page header reading **Master Settings** with a gear icon; below it a row of **6 grey tab
buttons** — Master · ESS · Leave · Attendance · Payroll · Canteen — with the active one filled blue;
below that the tab's content in one or two bordered **cards**, each card with a small icon and a
title; and at the bottom-right of the card area **one blue `Save Settings` button**. In the top-right
corner a pale-green pill flashes **"Settings loaded"** for a couple of seconds on arrival, then
slides away.

**Numbers/cards on the page:** none — this screen has no tiles, no counters, no charts. It is a pure
form.

**Realtime/auto:** the "Settings loaded" pill is the only thing that moves on its own. Values arrive
over one background call after the page paints, so for a moment the fields are blank and then fill in.

**Controls at page level:**

| Control | What it does |
|---|---|
| **Save Settings** (blue, bottom-right) | Saves **all six tabs at once**, then immediately saves the whole ESS permission grid in a second call. There is no per-tab save. Switching tabs never loses what you typed on another tab. |
| The 6 tab buttons | Switch the card area. No data is re-fetched; everything was loaded once on arrival. |

There are **no** page-level Add / Delete / Export / Import / Print controls. Nothing on this screen
leaves the page except the three pop-outs on the Attendance tab.

**Empty state:** not applicable — every tab always has its fields; a field with nothing chosen shows
the literal text `Select...`.

---

### 1.1 Tab: **Master** — 16 settings, in 2 cards

#### Card **"Import & Display Settings"**

| # | Label (as printed) | Control | Current value | Notes |
|---|---|---|---|---|
| 1 | SALARY HEADS COLUMN IN EXCEL | number box | **33** | placeholder "Enter Column Number"; no min/max |
| 2 | EMAIL TO | text box | *(empty)* | placeholder "Receiver Email" |
| 3 | EMAIL CC | text box | *(empty)* | placeholder "CC Email" |
| 4 | EMAIL BCC | text box | *(empty)* | placeholder "BCC Email" |
| 5 | Show MyDepartment to All | checkbox | **ON** ☑ | |
| 6 | Send Mail on Master Change | checkbox | OFF ☐ | this is the switch the three email boxes above feed |
| 7 | Check User Wise Entry | checkbox | OFF ☐ | |
| 8 | Show Badges on ESS | checkbox | **ON** ☑ | |

#### Card **"ESS - attendance & notifications"**

| # | Label | Control | Current value | Notes |
|---|---|---|---|---|
| 9 | PUNCH MODE | number box, min 0 | **0** | the box carries its own legend in the placeholder: **"0 none, 1 in/out, 2 lens"** |
| 10 | Manual attendance on ESS | checkbox | OFF ☐ | |
| 11 | Notify on bio punch | checkbox | OFF ☐ | |
| 12 | Notify on mobile punch | checkbox | OFF ☐ | |
| 13 | Notify on leave approval | checkbox | OFF ☐ | |
| 14 | Notify on request approval | checkbox | OFF ☐ | |
| 15 | Notify birthday | checkbox | OFF ☐ | |
| 16 | Notify salary slip | checkbox | OFF ☐ | |

All seven notification switches are off on this demo, so nothing on this install emails or pushes
anybody today.

---

### 1.2 Tab: **ESS** — the self-service permission grid (15 actions × 7 categories = 105 switches)

**Card title:** "ESS Category Permissions". **Subtitle printed under it:** *"Enable or disable
categories for employees in the ESS portal"*.

Two controls sit side by side:

| Label | Control | Current value | Complete option list |
|---|---|---|---|
| CATEGORY | dropdown (`ddlEssCategory`) | **Category 1** | **7 options:** Category 1 · Category 2 · Category 3 · Category 4 · Category 5 · Category 6 · Category 7 |
| OPTIONS | a multi-tick dropdown button | reads **"0 of 15 selected"** | opens the panel below |

Clicking the **"0 of 15 selected"** button drops a white panel containing:
- a **`Search option...`** text box (filters the list as you type),
- an **`All`** button (ticks every one of the 15 for the currently-chosen Category),
- a **`None`** button (clears all 15 for that Category),
- then **15 ticked-list rows**, in this exact order:

| # | Day-action | Currently ticked, Category 1–7 |
|---|---|---|
| 1 | **Add Punch** | none of the 7 |
| 2 | **Leave Entry** | none of the 7 |
| 3 | **Change Shift** | none of the 7 |
| 4 | **Assign WO** | none of the 7 |
| 5 | **Cancel WO** | none of the 7 |
| 6 | **OD Entry** | none of the 7 |
| 7 | **OT Sanction** | none of the 7 |
| 8 | **OT Cancel** | none of the 7 |
| 9 | **COFF Generate** | none of the 7 |
| 10 | **OT Cutoff** | none of the 7 |
| 11 | **Delete Leave Entry** | none of the 7 |
| 12 | **Delete OD Entry** | none of the 7 |
| 13 | **COFF Cutoff** | none of the 7 |
| 14 | **Delete COFF** | none of the 7 |
| 15 | **Hourly Leave** | none of the 7 |

**Verified live:** I selected each of the 7 categories in turn. Every one reported **"0 of 15
selected"** and every box was clear. The grid is stored as one row per Category × action
(7 × 15 = **105 individual on/off values**), and all 105 are currently off — meaning **no employee on
this install can request anything for themselves right now**.

The Category ids behind the 7 names are 13, 14, 15, 16, 18, 19, 21 — ids 17 and 20 are missing, so
two categories were deleted from the master at some point and the surviving names were not renumbered.

Switching Category clears the search box and closes the panel, but **does not** discard edits to the
other categories — one `Save Settings` press writes all 105 values.

---

### 1.3 Tab: **Leave** — 5 settings, 1 card ("Leave Configuration")

| # | Label | Control | Current value | Complete option list |
|---|---|---|---|---|
| 1 | LEAVE TYPE | dropdown | **Leave** | **6:** Select... · Allowence · Deduction · Attendance · **Leave** · SYSTEMS |
| 2 | AUTO LEAVE | dropdown | **not set** (`Select...`) | **3:** Select... · Disable · Enable |
| 3 | AUTO LEAVE NAME | dropdown | **PL** | **7:** Select... · **PL** · COFF · CL · SL · ML · LOP |
| 4 | COFF HEAD | dropdown | **COFF** | **7:** Select... · PL · **COFF** · CL · SL · ML · LOP |
| 5 | Attendance Year Same For All | checkbox | **ON** ☑ | |

What each one means in the model:
- **Leave Type** picks which of the five *head-types* counts as "leave" — so the whole leave module
  knows which rows of the salary-head table to treat as leave balances. Currently the type literally
  named `Leave`.
- **Auto Leave** is the master on/off for auto-consuming a leave balance when somebody is absent.
  On this demo it is **left unset**, which is neither Disable nor Enable.
- **Auto Leave Name** says *which* leave gets eaten when Auto Leave fires — currently **PL**
  (privilege/earned leave).
- **COFF Head** points compensatory-off at the head named `COFF`.
- **Attendance Year Same For All** ties every company on the install to one attendance year instead
  of letting each set its own.

---

### 1.4 Tab: **Attendance** — 15 settings in 2 cards + 3 pop-out buttons

#### Card **"Attendance Configuration"**

| # | Label | Control | Current value | Complete option list |
|---|---|---|---|---|
| 1 | ATTENDANCE TYPE | dropdown | **Attendance** | **6:** Select... · Allowence · Deduction · **Attendance** · Leave · SYSTEMS |
| 2 | ABSENT HEAD | dropdown | **A** | the full 63-head list (§1.5.3) |
| 3 | PRESENT HEAD | dropdown | **P** | the full 63-head list |
| 4 | EXTRA HRS HEAD | dropdown | **not set** (`Select...`) | the full 63-head list |
| 5 | ATTENDANCE ORDER BY | dropdown | **Emp Code** | **3:** Select... · **Emp Code** · Emp Name |
| 6 | Auto Mobile Punch Approve | checkbox | **ON** ☑ | |
| 7 | Separate Holiday Minutes | checkbox | OFF ☐ | |
| 8 | Separate Holiday OT | checkbox | OFF ☐ | |
| 9 | Show Report With Full Absent | checkbox | **ON** ☑ | |
| 10 | Delete Shift Schedule On Blank | checkbox | OFF ☐ | |

#### Card **"Punch & OT Settings"**

| # | Label | Control | Current value | Notes |
|---|---|---|---|---|
| 11 | MIN DIFFERENCE BETWEEN PUNCHES | number box | **1** | placeholder "Minutes" — two punches closer than this are one punch |
| 12 | MAX DIFFERENCE BETWEEN PUNCHES | number box | **3** | placeholder "Minutes" |
| 13 | AUTO OT LIMIT | number box | **1440** | placeholder "Minutes" — 1440 = 24 hours, i.e. effectively no cap |
| 14 | ROUND TOTAL DURATION | number box | **-1** | placeholder "0-59"; the current value **-1 is outside the range the placeholder advertises**, so rounding is presumably off |
| 15 | Auto OT Sanction | checkbox | **ON** ☑ | overtime is approved automatically, nobody signs it |

Then three grey buttons in a row at the bottom of the card:

| Button | Opens |
|---|---|
| **OT Slab** | the OT Slab Configuration pop-out (§1.6.1) |
| **Holiday Slab** | the Holiday Slab Configuration pop-out (§1.6.2) |
| **Late Early Master** | the Late/Early Reason Master pop-out (§1.6.3) |

---

### 1.5 Tab: **Payroll** — 13 settings in 2 cards

#### Card **"Pay Cycle"**

| # | Label | Control | Current value | Complete option list |
|---|---|---|---|---|
| 1 | PAY CYCLE | dropdown | **not set** (`Select...`) | **3:** Select... · Default · Custom |
| 2 | CYCLE START DATE | dropdown | **1** | **33:** Select... then **0, 1, 2, 3, … 31** |
| 3 | CYCLE END DATE | dropdown | **not set** (`Select...`) | **33:** Select... then **0, 1, 2, 3, … 31** |

Note both date dropdowns offer a literal **`0`** as well as 1–31. Pay Cycle is unset and the end date
is unset, so this install is running on whatever the code's fallback is, not on a configured window.

#### Card **"Salary Heads"**

| # | Label | Control | Current value |
|---|---|---|---|
| 4 | ALLOWANCE TYPE | dropdown, the 6 head-types | **Allowence** |
| 5 | DEDUCTION TYPE | dropdown, the 6 head-types | **Deduction** |
| 6 | PT HEAD | dropdown, all 63 heads | **PT** |
| 7 | PF HEAD | dropdown, all 63 heads | **PF** |
| 8 | LOAN HEAD | dropdown, all 63 heads | **HOME_LOAN** |
| 9 | OT HRS HEAD | dropdown, all 63 heads | **OT HRS** |
| 10 | OT HEAD | dropdown, all 63 heads | **OT** |
| 11 | BONUS HEAD | dropdown, all 63 heads | **Bonus** |
| 12 | ESIC HEAD | dropdown, all 63 heads | **not set** (`Select...`) |
| 13 | SALARY DAYS CALCULATION | radio pair | ○ Month Day · **● Work Day** |

**Salary Days Calculation is the single most expensive control on the screen.** `Month Day` divides a
monthly salary by the calendar days in the month (28/30/31). `Work Day` divides it by the working days
only. It is currently set to **Work Day**. One click there changes the per-day rate — and therefore
every deduction for an absent day — for every employee in the install.

#### 1.5.3 The complete salary-head option list (all 63, offered identically by 10 dropdowns)

`Select...` (the blank), then:

BASIC · HRA · Conveyance · P · A · H · MD · PF · Education · OTHERS · PERQUISITES · PRODUCTION · PT ·
TDS · HOME_LOAN · BASICDA · VDA · Advance · Attendance Bonus · Other Deduction · OT · OT HRS · PL ·
WO · WOP · HP · CL · OD · COFF · Monthly Incentive · Travel Allowance · LTD · ROOM_RENT · MEDICAL ·
LTA · EXGRATIA · MEDICLAIM · Bonus · LOAN · Perf. Allow · FIX_INCENTIVE · WASHING_ALLOWANCE · Canteen ·
SL · LateBy · SHL · Salary Addition · Salary Deduction · Reimbursement · ESIC · LWF · ExtraHRS ·
Arrears · Late_Mark_Fine · Diciplinary_Fine · DLD · SPL · ML · SpecialAllowence · WorkingHrs · EPF ·
WRD · WD

(63 heads. The spellings are the demo's own, typos included: "Allowence", "Diciplinary_Fine",
"Driving Liences", "SpecialAllowence".)

#### 1.5.4 The complete head-type option list (all 5, offered by 4 dropdowns)

`Select...`, then: **Allowence · Deduction · Attendance · Leave · SYSTEMS**.

Four settings choose from this list — Leave Type, Attendance Type, Allowance Type, Deduction Type —
which is how the app knows which groups of heads add to pay, subtract from pay, count days, or count
leave.

---

### 1.6 Tab: **Canteen** — 4 settings + 1 action, 1 card ("Canteen Configuration")

| # | Label | Control | Current value | Complete option list |
|---|---|---|---|---|
| 1–2 | CANTEEN CONFIGURATION | radio pair | **neither is selected** | ○ On Timing · ○ On Workcode |
| 3 | Enable Print Receipt | checkbox | OFF ☐ | |
| 4 | SELECT PRINTER | dropdown | **not set** (`Select...`) | **3:** Select... · **Microsoft XPS Document Writer** · **Microsoft Print to PDF** |
| — | **Test Printer** | grey button | — | sends a sample canteen receipt to the chosen printer **through the same server-side print path a live canteen punch uses**. It refuses with a warning toast if no printer is picked. **Not pressed** — it would put paper (or a file) on somebody else's machine. |

The printer list is the printer list of the **server**, not of your own PC — both entries are Windows
virtual printers, so this demo has no real canteen printer attached.

---

### 1.6.1 Pop-out: **OT Slab Configuration** (opened live)

**Opened by:** Attendance tab → **OT Slab** button. Appears as a wide dialog with a blue header
("OT Slab Configuration", clock icon) and an **×** close button.

**Fields:**

| Label | Control | Current value | Complete option list |
|---|---|---|---|
| COMPANY | dropdown | **Company 1** (it self-selects the first company when opened blank) | **3:** Select... · **Company 1** · Company 2 |
| CATEGORY | dropdown | **Category 1** (also self-selected) | **8:** Select... · Category 1 · Category 2 · Category 3 · Category 4 · Category 5 · Category 6 · Category 7 |

**Table below, once both are chosen** — 4 visible columns plus an actions column:

| From OT (in minutes) | To OT (in minutes) | Set OT (in minutes) | Total Hrs | |
|---|---|---|---|---|
| number box | number box | number box (min 0) | read-only, shows `0h 00m (0.00 hrs)` | **Save** button on the row |

Below the table: an **Add Row** button.

**Empty state:** with either dropdown blank it shows a grey panel reading
*"Please select **Company** and **Category** to add OT slab."* With both chosen and no saved slabs, it
shows **one blank row** that the screen adds itself (all three boxes 0, Total Hrs `0h 00m (0.00 hrs)`).

**Verified live across 6 combinations** — Company 1 × Categories 1, 2, 7 and Company 2 × Categories 1,
2, 7 — **every one was empty**. So no OT banding is configured anywhere on this demo; the row you see
is the blank one, not data.

**What it is for:** "any overtime between *From* and *To* minutes is paid as *Set* minutes" — i.e. band
and round overtime before it reaches the OT head. It is stored **per Company × per Category**, which
makes it one of only two per-company settings in the entire config core.

### 1.6.2 Pop-out: **Holiday Slab Configuration** (opened live — renders nothing)

**Opened by:** Attendance tab → **Holiday Slab** button. Same wide dialog, blue header with a calendar
icon and an **×**.

| Label | Control | Current value | Complete option list |
|---|---|---|---|
| COMPANY | dropdown | **not set** (`Select...`) — unlike the OT dialog it does **not** self-select | **3:** Select... · Company 1 · Company 2 |
| CATEGORY | dropdown | **not set** (`Select...`) | **8:** Select... · Category 1 … Category 7 |

**The table area is blank.** I opened the dialog, chose Company 1 and Category 1 live, waited, and
**nothing appeared at all** — not a table, not a header row, not an empty-state message. The dialog's
data call answers with a failure and the message *"Object cannot be cast from DBNull to other types."*,
so the screen never draws.

**Intended shape**, read from the page's own rendering code because it could not be seen on screen:
three columns — **From Holiday (min) · To Holiday (min) · Set Holiday (min)** — with a **Save** button
per row. **There is no "Total Hrs" column and no "Add Row" button** here, unlike the OT dialog, so
this dialog can only edit rows that already exist. Marked clearly: *this shape was read, not seen.*

### 1.6.3 Pop-out: **Late/Early Reason Master** (opened live — renders nothing)

**Opened by:** Attendance tab → **Late Early Master** button.

**What you actually see:** the blue header bar reading **"Late/Early Reason Master"** with a list icon
and an **×** — and a completely **empty white body**, about 30px tall. No fields, no table, no message,
no buttons. Screenshot: `reason-master.png`. Its data call fails with the same
*"Object cannot be cast from DBNull to other types."*

**Intended shape**, read from the page's rendering code (*read, not seen*): a table of
**Name (text) · Value (number) · Limit (number)** with a **Save** button per row, and — notably — **no
Add-Row control**, so this master can only be edited, never extended from here. This is the list a
manager would pick from when marking somebody late or leaving early, with a value and a limit attached
to each reason (which is how a reason can carry a fine or a monthly allowance of "free" late marks).

---

## 2. Employee Setting — `/Master/Employee_Settings.aspx?MenuId=93`

**Where:** left sidebar → **Master** → **Employee Setting**.

**What you see on arrival:** the same breadcrumb strip (`Home / Employee Settings`), a blue page header
**Employee Settings** with a gear icon, then **2 tabs** — **Emp Master** (active on arrival) and
**Onboard** — then bordered section cards, then a save button at the bottom right of the card area.

**Numbers/cards on the page:** none. Another pure form.
**Empty state:** none applicable; unset dropdowns read `Select Length` / `Select Source` /
`Select Day` / `Select Method`.
**Realtime/auto:** the Onboard tab's two lists (KYC and Education) are **built at load time from the
Document master and the Education master**, so their length changes when those masters change. The
`Enable 2nd Week Off` checkbox greys and un-greys six controls beneath it.

**Controls at page level:** none — each tab carries its own save button, and the two buttons are
**different mechanisms**: Emp Master's `Save Settings` is a classic full-page postback, Onboard's
`Save Onboard Settings` posts in the background without reloading.

---

### 2.1 Tab: **Emp Master** — 19 settings in 4 cards

#### Card **"Employee Code Configuration"**

| # | Label | Control | Current value | Complete option list |
|---|---|---|---|---|
| 1 | CODE LENGTH | dropdown | **2** | **11:** Select Length · 1 · **2** · 3 · 4 · 5 · 6 · 7 · 8 · 9 · 10 |
| 2 | AUTO GENERATION → *Enable Auto Code* | checkbox | OFF ☐ | |
| 3 | Short Code Source | dropdown | **Location** | **9:** Select Source · None · **Location** · Company · Category · Location + Company · Company + Category · Location + Category · Location + Company + Category |

**Short Code Source** is how an employee code gets its prefix — from the location, the company, the
category, or any combination of the three. With `Code Length = 2`, an auto code would be a 2-digit
number behind that prefix.

#### Card **"Identity & Validation"**

| # | Label | Control | Current value |
|---|---|---|---|
| 4 | Aadhar Card Mandatory | checkbox | OFF ☐ |
| 5 | PAN Card Mandatory | checkbox | OFF ☐ |
| 6 | Bank Details Mandatory | checkbox | OFF ☐ |
| 7 | Joining Date Required | checkbox | OFF ☐ |
| 8 | Age Restriction | checkbox | OFF ☐ |
| 9 | Verify Aadhar on Resignation | checkbox | OFF ☐ |
| 10 | Verify Aadhar by Location | checkbox | OFF ☐ |

All seven are off, so on this demo an employee record can be created with no ID, no bank account and
no joining date.

#### Card **"Weekly Off Configuration"**

| # | Label | Control | Current value | Complete option list |
|---|---|---|---|---|
| 11 | PRIMARY WEEKLY OFF | dropdown | **not set** (`Select Day`) | **9:** Select Day · **No WO** · Sunday · Monday · Tuesday · Wednesday · Thursday · Friday · Saturday |
| 12 | SECONDARY WEEKLY OFF → *Enable 2nd Week Off* | checkbox | OFF ☐ | |
| 13 | 2nd Week Off Day | dropdown | **not set**, and **greyed out** | **8:** Select Day · Sunday · Monday · Tuesday · Wednesday · Thursday · Friday · Saturday (**no "No WO" option here**) |
| 14 | Week Occurrence → 1st Week | checkbox | OFF ☐, **greyed out** | |
| 15 | Week Occurrence → 2nd Week | checkbox | OFF ☐, **greyed out** | |
| 16 | Week Occurrence → 3rd Week | checkbox | OFF ☐, **greyed out** | |
| 17 | Week Occurrence → 4th Week | checkbox | OFF ☐, **greyed out** | |
| 18 | Week Occurrence → 5th Week | checkbox | OFF ☐, **greyed out** | |

Items 13–18 are **disabled until "Enable 2nd Week Off" is ticked** — verified live, they render greyed.
That combination is how "second Saturday off" is expressed: 2nd Week Off Day = Saturday, Week
Occurrence = 2nd Week only.

#### Card **"Overtime Configuration"**

| # | Label | Control | Current value | Complete option list |
|---|---|---|---|---|
| 19 | CALCULATION METHOD | dropdown | **not set** (`Select Method`) | **3:** Select Method · **Applicable** · **Not Applicable** |

Despite the generic name, this sits alone under the card headed **Overtime Configuration** and its two
choices are Applicable / Not Applicable — it is the "does overtime apply to employees by default"
switch, not a general calculation-mode picker.

**Button:** **Save Settings** (bottom-right of the tab). Full-page postback.

---

### 2.2 Tab: **Onboard** — 48 controls in 3 cards

This is the form a **candidate** fills in themselves before they become an employee. Every row here
answers "must the candidate supply this?" — and for documents, additionally "how?".

#### Card **"KYC"** — 14 documents, each with a tick **and** a field-mode dropdown

Each row is: `☑ <document name>` + a dropdown offering exactly **3 options: `text` · `upload` ·
`both`**. Every one of the 14 dropdowns currently reads **`both`**.

| # | Document | Mandatory now | Field mode |
|---|---|---|---|
| 1 | **10TH** | ☑ ON | both |
| 2 | **12TH** | ☑ ON | both |
| 3 | **Aadhar** | ☑ ON | both |
| 4 | **Appointment Letter** | ☑ ON | both |
| 5 | **Bank Passbook /Cheque book** | ☑ ON | both |
| 6 | **DIPLOMA** | ☐ off | both |
| 7 | **Driving Liences** *(demo's spelling)* | ☑ ON | both |
| 8 | **GRADUATION** | ☑ ON | both |
| 9 | **OFFER LETTER** | ☐ off | both |
| 10 | **PAN** | ☑ ON | both |
| 11 | **POST GRADUATION** | ☐ off | both |
| 12 | **Termination Letter** | ☐ off | both |
| 13 | **Voter Id** | ☑ ON | both |
| 14 | **Warning Letter** | ☐ off | both |

9 of the 14 are mandatory today. **`text`** means the candidate types the number only, **`upload`**
means they attach a scan only, **`both`** means they must do both. This list is **not fixed** — it is
the Document master, so adding a document type there adds a row here.

#### Card **"Education"** — 5 levels, same tick + field-mode shape

| # | Level | Mandatory now | Field mode |
|---|---|---|---|
| 1 | **10th** | ☑ ON | both |
| 2 | **12th** | ☑ ON | both |
| 3 | **Diploma** | ☐ off | both |
| 4 | **Graduate Degree** | ☑ ON | both |
| 5 | **Master Degree** | ☐ off | both |

Also driven from a master (the Education master), so it grows the same way. Note it overlaps the KYC
list — `10TH` / `12TH` / `GRADUATION` / `DIPLOMA` / `POST GRADUATION` appear in **both** cards, and
their ticks disagree in one place (`DIPLOMA` off under KYC, `Diploma` off under Education — consistent
today, but they are two separate stored values that can drift).

#### Card **"Personal"** — 10 plain ticks, no field-mode dropdown

| # | Field | Mandatory now |
|---|---|---|
| 1 | **Bank Details** | ☑ ON |
| 2 | **Employee Photo** | ☑ ON |
| 3 | **Date of Birth** | ☑ ON |
| 4 | **Gender** | ☑ ON |
| 5 | **Emergency Contact** | ☑ ON |
| 6 | **Nominee** | ☑ ON |
| 7 | **Cast** *(demo's spelling of caste)* | ☑ ON |
| 8 | **Blood Group** | ☑ ON |
| 9 | **Address** | ☑ ON |
| 10 | **Emergency Contact 2** | ☑ ON |

All ten are on.

**Button:** **Save Onboard Settings** (blue, bottom-right). Background save, no page reload.

---

## 3. What these settings actually decide

### 3.1 Which settings change money — and which head each one points at

**The twelve pointers.** Every one of these aims a payroll job at a row of the 63-head table. Change
one and the payslip changes with no code touched:

| Setting | Where | Currently points at |
|---|---|---|
| PT Head | Master Setting → Payroll | `PT` |
| PF Head | Master Setting → Payroll | `PF` |
| Loan Head | Master Setting → Payroll | `HOME_LOAN` |
| OT Hrs Head | Master Setting → Payroll | `OT HRS` |
| OT Head | Master Setting → Payroll | `OT` |
| Bonus Head | Master Setting → Payroll | `Bonus` |
| ESIC Head | Master Setting → Payroll | **nothing** — ESIC has no home on this install |
| Absent Head | Master Setting → Attendance | `A` |
| Present Head | Master Setting → Attendance | `P` |
| Extra Hrs Head | Master Setting → Attendance | **nothing** |
| Leave Type | Master Setting → Leave | the head-type `Leave` |
| COFF Head | Master Setting → Leave | `COFF` |

**The two group pointers.** `Allowance Type = Allowence` and `Deduction Type = Deduction` decide which
whole *families* of heads add to pay and which subtract. Getting these two wrong inverts a payslip.

**The one that changes every rupee.** `Salary Days Calculation` — **Month Day** vs **Work Day**,
currently **Work Day**. It is the divisor for a day's pay, so it sets the value of every absence and
every part-month joiner.

**The window payroll sums.** `Pay Cycle` (unset) · `Cycle Start Date` (1) · `Cycle End Date` (unset).
Until these are set, the month boundary is whatever the code falls back to — not a configured choice.

**The ones that change how many paid minutes exist:**
- `Auto OT Limit` = **1440** minutes (24h) — effectively no ceiling on overtime.
- `Auto OT Sanction` = **ON** — overtime is approved automatically, so nobody has to agree to the cost.
- `Min / Max Difference Between Punches` = **1 / 3** minutes — how close two taps must be to count as
  one punch, which changes worked minutes.
- `Round Total Duration` = **-1** (the box advertises 0–59) — rounding of the day's total.
- `Separate Holiday Minutes` / `Separate Holiday OT` — both **OFF**; when on, holiday work is counted
  and paid on its own track.
- **OT Slab** and **Holiday Slab** pop-outs — band and rewrite overtime minutes before they hit
  `OT Head`/`OT HRS Head`. Both are **empty on this install** (OT verified across 6 Company × Category
  combinations; Holiday cannot even display).
- **Late/Early Reason Master** — each reason carries a **Value** and a **Limit**, which is how a late
  mark turns into a fine or an allowance of free late marks. **Cannot be seen on this install.**

**Leave, which is money in a balance:** `Auto Leave` (unset) and `Auto Leave Name` = **PL** decide
whether an absence silently eats a leave balance and which one.

**Employee Setting also moves money:** `Overtime Configuration → Calculation Method`
(Applicable / Not Applicable, currently unset) decides whether OT applies at all, and
`Primary Weekly Off` + `2nd Week Off Day` + `Week Occurrence` decide which days are paid non-working
days — which feeds straight back into the Work Day divisor above.

**One import setting:** `Salary Heads Column in Excel = 33` — which column of an uploaded sheet the
importer starts reading salary heads from. Wrong number, wrong money, silently.

### 3.2 Which settings change what a person can do to their own record

**The main answer: the 15 day-actions on the ESS tab, ticked per Category.** They are the self-service
permission list, and they are what lets an employee act on their **own** attendance day:
Add Punch · Leave Entry · Change Shift · Assign WO · Cancel WO · OD Entry · OT Sanction · OT Cancel ·
COFF Generate · OT Cutoff · Delete Leave Entry · Delete OD Entry · COFF Cutoff · Delete COFF ·
Hourly Leave. **All 15 are off for all 7 categories**, so today no employee can request anything.
Note four of them are *delete* rights (Delete Leave Entry, Delete OD Entry, Delete COFF, OT Cancel) —
granting those lets an employee remove their own record of a day.

**Alongside them, on the Master tab:**
- `Manual attendance on ESS` (OFF) — whether an employee may type attendance at all, rather than punch.
- `Show Badges on ESS` (ON) — whether the self-service side shows achievement badges.
- `Show MyDepartment to All` (ON) — whether an employee sees their whole department or only themselves.
- `Check User Wise Entry` (OFF) — whether entries are filtered to the signed-in user.

**On the Attendance tab:** `Auto Mobile Punch Approve` (**ON**) — a punch made from a phone is accepted
without a manager approving it. That is the single biggest self-service permission on the screen and it
is on.

**On Employee Setting → Onboard:** the **29 mandatory ticks** (14 KYC + 5 Education + 10 Personal) are
exactly "what the candidate must fill in about themselves before they can finish", and the
`text / upload / both` picker per document says whether they type it, attach it, or both.

**On Employee Setting → Emp Master:** the seven `Identity & Validation` switches (Aadhar / PAN / Bank
mandatory, Joining Date Required, Age Restriction, Verify Aadhar on Resignation, Verify Aadhar by
Location) gate what a record must contain before it can be saved or a resignation processed. All seven
are off.

### 3.3 Which settings are per-company, and which are global

**Global — one row for the whole install.** Every setting on **all six** Master Setting tabs, and
**both** Employee Setting tabs. There is no company picker anywhere on either page, and the save
request carries no company at all: one set of values serves Company 1 and Company 2 alike. That
includes all twelve head pointers, the Month Day / Work Day divisor, the pay cycle, the punch rules,
the notification switches, the code-length rules, the weekly-off rules and the entire onboarding
checklist.

**Per Company × Category — exactly two things**, both hidden behind buttons on the Attendance tab:
- **OT Slab Configuration** — pick Company (Company 1 / Company 2) and Category (1–7), edit that
  combination's bands. 14 possible combinations.
- **Holiday Slab Configuration** — same two pickers, same 14 combinations.

**Per Category, but not per company — one thing:** the **ESS 15 day-actions**, ticked per Category
(7 × 15 = 105 values). Categories are install-wide, not company-owned, so Category 3 has the same
self-service rights in every company.

**Also install-wide by explicit choice:** `Attendance Year Same For All` (ON) forces one attendance
year across every company instead of per-company years.

**The honest reading:** this is a multi-company product whose entire money configuration is
single-company. Two dialogs are per-company; everything else is one shared row. If HRMex's two demo
companies ever needed different PF heads, different pay cycles, or different weekly offs, this screen
could not express it. For anyone copying this design, **that is the thing to change** — carry a company
(and ideally a from-date) on the settings row itself rather than bolting per-company tables onto the
two settings that happened to need it.

---

## 4. Corrections to the 2026-08-16 capture

Checked `docs/HRMEX-SCREEN-BY-SCREEN.md` §2.1–§2.2 (lines 100–151) line by line against the live
screens. The structure held up — still 6 tabs + 3 pop-outs on Master Setting, still 2 tabs on Employee
Setting, same names, same order, and every value it recorded still reads the same today. Ten things
need fixing or adding:

1. **"the 17 day-actions" → there are 15.** The old note says *"tick which of the **17** day-actions"*
   and then lists **15**. The screen itself settles it: the control reads **"0 of 15 selected"**, and
   the server returns permission ids **1 through 15**. The 15 names the old doc listed are correct and
   in the right order — only the count was wrong.

2. **"Pop-out: Holiday Slab Configuration — same shape for holiday working" → wrong twice.** Its
   columns are **From Holiday (min) · To Holiday (min) · Set Holiday (min)** — there is **no "Total
   Hrs" column and no "Add Row" button**, so it is not the same shape as the OT dialog. And more
   importantly, **it renders nothing at all**: I opened it, chose Company 1 and Category 1, and the
   table area stayed blank because its data call fails.

3. **"Pop-out: Late/Early Reason Master — the reason list used by Late/Early Entry" → the dialog is
   empty.** Live it is a blue title bar and a blank white body, no fields at all. Its intended shape
   (Name · Value · Limit · Save per row, with no add-row control) had to be read rather than seen.

4. **Employee Setting → Onboard was captured at about a fifth of its real size.** The old note lists
   only the 10 "Personal" checkboxes. The tab actually has **three** cards: **KYC** (14 documents, each
   with a mandatory tick *and* a `text / upload / both` picker), **Education** (5 levels, same shape),
   then Personal (the 10 it recorded). That is **38 of 48 controls unrecorded**, including the whole
   idea that a document can be demanded as a typed number, a scan, or both.

5. **The two Onboard lists are dynamic, which the old note doesn't say.** KYC is built from the
   Document master and Education from the Education master — so those 19 rows are today's data, not a
   fixed feature list. A new document type adds a row here by itself.

6. **"Calculation Method" is the overtime switch.** The old note lists it as a bare
   `Calculation Method` at the end of Emp Master. Live it sits alone under a card headed **Overtime
   Configuration** and offers **Applicable / Not Applicable** (currently unset).

7. **The 2nd-week-off controls are disabled, not merely unticked.** The old note shows
   `☐ Enable 2nd Week Off` + `2nd Week Off Day` + `☐1st ☐2nd ☐3rd ☐4th ☐5th` as six independent boxes.
   Live, all six render **greyed out** until `Enable 2nd Week Off` is ticked. Also, `2nd Week Off Day`
   offers 7 days but **not** the `No WO` option that `Primary Weekly Off` has.

8. **`Punch mode = 0` has a legend the old note dropped:** the box's own placeholder reads
   **"0 none, 1 in/out, 2 lens"**, which is the only place the meaning of the number appears.

9. **One button saves everything, which changes how you'd rebuild it.** The old note implies six tabs
   of settings. Live, the single `Save Settings` press writes all six tabs **and** then all 105 ESS
   permission cells in a second call — and switching tabs or categories never discards edits. On
   Employee Setting the two tabs behave differently from each other: Emp Master saves by full page
   reload, Onboard saves in the background.

10. **Values, option lists and ids the old note left blank, now filled:** the 5 head-types
    (Allowence · Deduction · Attendance · Leave · SYSTEMS) behind Leave/Attendance/Allowance/Deduction
    Type; all **63** salary heads; the **9** Short Code Source combinations; the printer list
    (Microsoft XPS Document Writer · Microsoft Print to PDF); `Cycle Start/End` offering a literal
    **0** as well as 1–31; `Auto Leave` and `Cycle End Date` and `ESIC Head` and `Extra Hrs Head` and
    `Primary Weekly Off` and `Pay Cycle` and `Calculation Method` all sitting **unset**; both Canteen
    radios unselected; and the OT slab tables being empty in **all 6** Company × Category combinations
    I checked (the row you see is one the screen adds itself).

Nothing in the old capture's §2.1 turned out to have *changed since* 2026-08-16 — every value it
recorded still matches. The gaps above were gaps on the day.

---

## 5. Odd things I noticed

- **Two of the three pop-outs cannot show their data.** Holiday Slab and Late/Early Reason Master both
  come back with *"Object cannot be cast from DBNull to other types."* and draw nothing — the Reason
  dialog not even an empty-state message. Two configuration features are unreachable from the screen
  that owns them.
- **`Round Total Duration` holds `-1` while its own hint says `0-59`.** Presumably "-1 = don't round",
  but the field never says so.
- **`ESIC Head` and `Extra Hrs Head` are unset** while PT, PF, OT, Bonus and Loan all have homes. Any
  ESIC or extra-hours amount has nowhere to land.
- **`Pay Cycle` is unset and `Cycle End Date` is unset** while `Cycle Start Date` is 1 — a half-defined
  month window on a payroll product.
- **The Canteen radio pair has neither option chosen**, yet there is no "off" choice — the feature is
  in a third state the screen doesn't name.
- **Changing Company or Category in the OT Slab dialog fires the load twice.** The dropdown has an
  inline handler *and* a delegated one, so every change makes two identical fetches. Harmless, but it
  doubles the traffic on that dialog.
- **Category ids skip 17 and 20** (13, 14, 15, 16, 18, 19, 21) while the names run "Category 1" to
  "Category 7" — two categories were deleted and the display names were re-used, so a name no longer
  tells you which id you're editing.
- **Four onboarding fields exist in the page's logic but never render** (Aadhar, PAN, Driving Licence
  and Education as *Personal* items) — the code defends against their absence, which reads like they
  moved into the KYC list and their old switches were left behind.
- **Five items sit in both the KYC and Education lists** (10th, 12th, Graduation, Diploma, Post
  Graduation) as two separate stored values. They agree today; nothing keeps them agreeing.
- **`Test Printer` prints through the live canteen path.** It is a real-world side effect sitting one
  click away inside a settings screen, with no confirmation step. Not pressed.
- **The whole money model is one global row on a multi-company install** — see §3.3.

---

## In human language — every feature in this area, as points

- **One settings page that runs the whole system** — a single page called Master Setting where the
  company sets every rule the app follows: how pay is worked out, what counts as present or absent,
  how overtime is treated, when the salary month starts and ends. Click Master in the left menu, then
  Master Setting. It is the control room: nothing about pay is written into the program itself, it is
  all set here, so a new client with different rules needs settings changed, not software rebuilt.

- **A list of "money lines" that everything points at** — the app keeps one master list of 63 pay
  lines (basic pay, house rent, provident fund, professional tax, overtime, bonus, and so on). The
  settings page never does sums; it just says which line means what. Twelve dropdowns do this: "the
  provident fund line is *this* one", "overtime lands on *this* one", "an absent day is *this* one".
  Point them somewhere else and every payslip changes meaning instantly.

- **The single biggest money switch: how a day's pay is worked out** — one choice with two options.
  Either a monthly salary is divided by all the days in the month, or only by the working days. On this
  demo it is set to working days. This one click decides what a single day of absence costs, for every
  employee. Payroll tab of Master Setting.

- **Setting the salary month** — say whether the pay month is the normal calendar month or a custom
  window, and pick which date it starts and ends on (any date from 1 to 31). Useful for companies whose
  pay month runs, say, the 26th to the 25th. On this demo it is only half filled in.

- **Deciding which groups of pay lines add and which subtract** — two dropdowns say which family of
  lines counts as "money paid to the employee" and which counts as "money taken off". Getting these two
  backwards would turn a payslip inside out, which is exactly why they are settings and not guesses.

- **Telling the system what present, absent and extra hours mean** — three dropdowns aim "present",
  "absent" and "extra hours" at pay lines, so the attendance side and the pay side speak the same
  language. Attendance tab.

- **Telling the system which thing is "leave"** — one dropdown picks which family of lines counts as
  leave, and another aims compensatory-off at its own line. Without this the leave module wouldn't know
  what a leave balance is.

- **Automatically eating a leave day when somebody is absent** — a switch that says "if a person is
  absent, quietly use up one of their leave days instead", plus a second dropdown choosing which leave
  gets used (earned leave, casual, sick, maternity, loss of pay, or compensatory off). Currently the
  switch is not set either way.

- **Rules for reading a biometric machine's taps** — how close together two taps must be before they
  count as the same tap, and how far apart before they count as separate. Two small numbers that decide
  how many hours the machine thinks somebody worked.

- **An overtime ceiling and automatic overtime approval** — a maximum number of overtime minutes the
  system will accept in a day (set to 24 hours here, so effectively no limit), and a switch that
  approves overtime automatically with nobody signing it off. Both matter because overtime is money.

- **Overtime bands, per company and per staff group** — a pop-out where you write rules like "anything
  between 30 and 60 minutes of overtime is paid as 60 minutes". You choose the company and the staff
  category first, so a factory and an office can have different overtime rounding. Attendance tab →
  OT Slab button. Nothing is set up on this demo.

- **Holiday-work bands** — the same idea for hours worked on a holiday, in its own pop-out. **On this
  demo it opens and shows nothing at all** — the screen fails to load its own data, so the feature
  cannot be used from here.

- **A list of reasons for being late or leaving early, each with a value and a limit** — this is how a
  company allows, say, three free late marks a month and charges after that. **On this demo the pop-out
  opens completely blank**, so the list cannot be seen or edited.

- **Counting holiday work separately** — two switches that keep hours and overtime worked on a holiday
  on their own track rather than mixed in with ordinary days. Both off here.

- **Choosing whether reports list people by code or by name** — one small dropdown that changes the
  order of every attendance report.

- **Showing or hiding fully-absent people in reports** — a switch that decides whether somebody absent
  the whole month still appears on the report or drops off it. On here.

- **A self-service portal permission list — the 15 things an employee may do about their own day** —
  add a missed punch, apply for leave, change their shift, take a week-off, cancel a week-off, mark
  themselves on official duty, claim overtime, cancel overtime, generate a compensatory off, close
  their overtime period, delete their own leave entry, delete their own official-duty entry, close
  their compensatory-off period, delete a compensatory off, and take leave by the hour. Master Setting
  → ESS tab.

- **Those 15 permissions are set per staff group, not per person** — pick a staff category (there are
  seven), then tick what that whole group may do. Seven groups × fifteen actions is 105 separate
  switches, and on this demo **every single one is off**, so nobody can request anything right now.
  There is a search box and All/None buttons so you aren't clicking fifteen boxes by hand.

- **Four of those permissions let an employee delete their own record of a day** — deleting a leave
  entry, deleting an official-duty entry, deleting a compensatory off, and cancelling overtime. Worth
  knowing before switching them on, because they let a person erase evidence of how a day was recorded.

- **Accepting phone punches without a manager** — one switch that says a punch made on a phone is
  accepted straight away rather than waiting for someone to approve it. It is **on** here, and it is
  the most permissive setting on the whole page.

- **Letting employees type their attendance instead of punching it** — a separate switch for manual
  attendance in the self-service portal. Off here.

- **Deciding how much an employee sees of their department** — one switch shows them their whole
  department's information; without it they see only themselves.

- **Achievement badges in the employee portal** — a switch to show or hide badges on the self-service
  side. On here.

- **Seven kinds of notification, each with its own switch** — tell people when a biometric punch is
  recorded, when a phone punch is recorded, when leave is approved, when a request is approved, on a
  birthday, and when a salary slip is ready. All seven are off on this demo, so this install notifies
  nobody.

- **Emailing somebody whenever a master record changes** — a switch plus To, CC and BCC boxes, so a
  named person gets told every time a core record is edited. A simple change-watch feature.

- **Telling the importer which column holds the pay lines** — one number (33 here) saying where in an
  uploaded spreadsheet the salary lines begin. Wrong number, wrong pay, with no warning.

- **A canteen mode and a canteen receipt printer** — choose whether canteen meals are counted by the
  time of day or by a meal code, switch receipt printing on, pick the printer, and send a test
  receipt. The test button prints for real, through the same path a live meal punch uses.

- **A second settings page for what an employee record must contain** — called Employee Setting, under
  Master in the left menu. Two tabs: one about the employee record itself, one about what a new joiner
  must fill in.

- **How employee codes are made** — how many digits the number has (1 to 10), whether the system
  generates it automatically, and what the prefix comes from: the location, the company, the staff
  category, or any combination of those three (nine choices in total). This is how "MUM-OFF-07" style
  codes get built without anybody typing them.

- **Seven "you can't save this without it" rules** — demand an Aadhaar number, demand a PAN, demand
  bank details, demand a joining date, restrict by age, re-verify Aadhaar when somebody resigns, and
  verify Aadhaar by location. All seven are off on this demo, meaning a record can be created here with
  no ID and no bank account at all.

- **Weekly offs, including "second Saturday off"** — pick the normal weekly off day (or "no weekly
  off"), then optionally switch on a second one, pick its day, and tick which weeks of the month it
  applies to (1st to 5th). Those last six controls stay greyed out until you switch the second weekly
  off on. This is how the very common Indian "second and fourth Saturday off" pattern is expressed.

- **Whether overtime applies to employees at all** — one dropdown, Applicable or Not Applicable,
  sitting on its own. Not set on this demo.

- **A joining checklist the new person fills in themselves** — the Onboard tab is the form a candidate
  completes before they become an employee, and this screen is where you tick what is compulsory.

- **Fourteen documents you can demand, each in three ways** — school certificate, higher-secondary
  certificate, Aadhaar, appointment letter, bank passbook or cheque, diploma, driving licence, degree,
  offer letter, PAN, post-graduate degree, termination letter, voter ID, warning letter. For each one
  you tick whether it is compulsory **and** choose whether the person types the number, uploads a scan,
  or must do both. Nine of the fourteen are compulsory here, all set to "both".

- **Five education levels, demanded the same way** — 10th, 12th, diploma, graduate degree, master
  degree, each with a compulsory tick and the same type/upload/both choice.

- **The document and education lists grow by themselves** — they are built from the company's own
  document and education lists, so adding a new document type elsewhere in the app adds a new row here
  automatically. Nobody has to change this screen.

- **Ten personal details you can make compulsory** — bank details, photo, date of birth, gender,
  emergency contact, nominee, caste, blood group, address, and a second emergency contact. All ten are
  compulsory on this demo.

- **One button that saves the whole control room** — on Master Setting a single Save press writes all
  six tabs plus all 105 self-service permissions at once, and moving between tabs never loses what you
  changed. On Employee Setting each of the two tabs has its own save button.

- **Almost every rule here applies to the entire installation, not per company** — this demo runs two
  companies, but there is only one set of pay rules, one pay cycle, one weekly-off rule and one joining
  checklist shared between them. Only two features can differ per company: the overtime bands and the
  holiday-work bands. If you are copying this design, that is the part to do differently.
