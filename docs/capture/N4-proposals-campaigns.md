# N4 — Proposal Exporter + Campaign Pages

**Product:** Nexeor Agency OS v2.0 — `https://os-staging.product.nexeor.com`
**Sidebar group:** Sales (items 4 and 5 of 5)
**Routes in scope:** `/crm/proposal-builder`, `/crm/campaigns`
**Captured:** 2026-09-07, signed in as the demo agency user, Chrome 1512×950 and 390×844.
**Method:** the app was driven in a browser and every screen read after it rendered. Where a
control could not be pressed without changing the owner's data, the shipped page code was read
instead and that is stated at the point it matters.

> **Headline finding, stated up front.** The brief for this terminal expected "the two deepest
> builders in the product". Neither screen is a builder in that sense. **Proposal Exporter is not
> a document builder** — it has no templates, no blocks, no sections, no canvas, no price table,
> no currency handling, no tax or discount line, no signature element and no saved-proposals
> list. It is a two-step helper: it writes a long instruction prompt for you to paste into
> ChatGPT or Claude, and then turns the HTML you paste back into a PDF. **Campaign Pages has no
> page editor at all** — you choose one of four fixed template types at creation and there is no
> screen anywhere to edit the page's content, blocks or fields afterwards. Both are real,
> working, shipped screens; they are simply much smaller than the brief assumed. Detail and
> evidence for both statements are in the sections below.

---

## 1. Proposal Exporter — `/crm/proposal-builder`

**Where:** Sidebar → **Sales** → **Proposal Exporter**. Direct address `/crm/proposal-builder`.

**What you see on arrival:** A full-screen dark two-panel workspace that replaces the normal page
layout — it fills the whole viewport height and has no page padding, no breadcrumb and no page
footer of its own. On the **left**, a fixed 450px (500px on large screens) dark column titled
**Proposal Exporter** with a back arrow beside the title, split into a numbered step **1 GENERATE
AI PROMPT** (five input fields, then a copy button) and a numbered step **2 PASTE GENERATED
HTML** (one large code textarea), with a blue **Export to PDF** bar pinned across the bottom of
the column. The **right** side is the whole remaining width: a light grey live preview area which
on arrival shows a faded sparkle icon and the words **"Paste HTML to see live preview"**.

**Numbers/cards on the page:** none. This screen counts nothing and shows no tiles, no totals and
no statistics. It reads no data from the CRM.

**Does it start from a lead, or from blank?** **Always from blank.** The screen holds all five
inputs in its own local state and reads no address parameters — opening it with a lead id on the
address does nothing. There is **no "create proposal from this lead"** path into it and nothing
is carried in from the CRM board: no client record, no service list, no prices. Everything is
typed by hand.

**Controls, in the order they appear:**

| # | Control | Where | What it does |
|---|---|---|---|
| 1 | **←** (back arrow) | Top-left of the left column, beside the title | A plain link back to `/crm` (the CRM Board). |
| 2 | **Client Name** | Step 1 | Free-text field. |
| 3 | **Project Name** | Step 1 | Free-text field. |
| 4 | **Budget** | Step 1 | Free-text field. |
| 5 | **Timeline** | Step 1 | Free-text field. |
| 6 | **Raw Notes / Requirements** | Step 1 | Large free-text area. |
| 7 | **Copy Master Prompt** | Bottom of step 1 | Builds one very long instruction text out of whatever is in the five fields and copies it to the clipboard. Nothing is sent anywhere. |
| 8 | **(paste area)** | Step 2 | Large monospace green-on-black textarea; whatever you type appears in the preview as you type. |
| 9 | **Export to PDF** | Pinned bar at the bottom of the left column | Sends the pasted HTML to the server, which returns a PDF file that downloads to your computer. |
| 10 | **Builder / Preview** | Only below 768px wide | Two tabs that switch the phone between the left column and the preview. |

### The five fields of step 1 — "GENERATE AI PROMPT"

Every one is a plain text box, **none is marked required**, and **every default is empty**. They
appear in this order, each with its own label above it:

| Order | Label | Type | Required | Default | Placeholder shown inside the box |
|---|---|---|---|---|---|
| 1 | Client Name | single-line text | no | empty | `e.g. Bissau Express` |
| 2 | Project Name | single-line text | no | empty | `e.g. Platform Build` |
| 3 | Budget | single-line text | no | empty | `e.g. $12,500` |
| 4 | Timeline | single-line text | no | empty | `e.g. 6 Months` |
| 5 | Raw Notes / Requirements | multi-line textarea | no | empty | `Paste the raw client brief, feature list, or meeting notes here...` |

**On currency:** there is **no currency handling of any kind on this screen** — no AED/INR
selector, no symbol picker, no conversion, no formatting. Budget is one free-text box and the
example inside it suggests **US dollars** (`e.g. $12,500`), which matches neither of the
currencies the rest of the product uses. Whatever you type is passed through as characters.

**On tax, discount and totals:** there is **no tax line, no discount line and no price table** on
this screen. There is no place to itemise services and no place to sum anything.

**On signature and acceptance:** there is **no signature control, no acceptance button and no
e-sign flow in the application**. The *generated document* is instructed to end with a printed
sign-off page (two blank ruled signature lines, one per party) — that is ink on a PDF, not a
feature of the screen.

### Button: **Copy Master Prompt**

- Sits at the foot of step 1, full width, height 40px, small bold text.
- Normal state: a copy icon and the words **"Copy Master Prompt"** on a translucent white button.
- Pressed state: the button turns **green** and reads **"Copied to Clipboard!"** with a tick icon,
  then reverts to normal after **2 seconds**. Confirmed by pressing it — it only writes to the
  local clipboard and makes no network call of any kind.
- Underneath it, in small grey text: **"Paste this into ChatGPT or Claude to generate the HTML."**

**What it actually copies.** One single block of text roughly 15,000 characters long, assembled
fresh each time from the five fields. Any field left blank is replaced by a bracketed instruction
telling the AI to invent or infer that value. This text is the real substance of the screen, so
it is reproduced in full below.

<details>
<summary><b>The complete Master Prompt (verbatim)</b> — click to expand</summary>

```text
Role & Goal:
You are an elite Enterprise Tech Sales Architect working for Nexeor Creative Technologies. Your goal is to write a highly detailed, persuasive, and premium Fixed-Price Web & Mobile Application Proposal in a specific, styled A4 HTML format.

[CLIENT CONTEXT & RAW NOTES]
Please use the following details to build the proposal. If any are missing, infer or estimate them based on enterprise standards.
- Client Name: {Client Name field, or "[Extract/Infer from notes]" if blank}
- Project Name: {Project Name field, or "[Extract/Invent professional name]" if blank}
- Budget: {Budget field, or "[Extract/Estimate realistic enterprise budget]" if blank}
- Timeline: {Timeline field, or "[Extract/Estimate realistic sprints]" if blank}
- Raw Notes/Brief: {Raw Notes field, or "[None provided, invent a generic software build based on the title]" if blank}

Task 1: Parameter Extraction
Analyze the input and extract/infer the parameters above. Expand on core web/mobile/backend modules needed.

Task 2: Content Generation & Tone
Tone: Authoritative, enterprise-focused, transparent, and execution-oriented. Focus on "ROI", "ecosystem", "scalability", "fault-tolerance," and "strategic partnership."
Detail Level: Expand extensively on the features provided. Write out business logic and user workflows.
Content Retention: CRITICAL: Do NOT omit, summarize away, or truncate any detailed workflows, SLA tables, or Exclusions.

Task 3: Strict HTML DOM Structure (CRITICAL)
Cover Page: Must be enclosed entirely in <div class="cover"> ... </div>.
Standard Pages: Every single page after the cover MUST be enclosed entirely in a <div class="page"> ... </div> container.
Page Breaks: Separate the cover and every page EXACTLY with <div class="page-break"></div>.
No Loose Content: Absolutely no text, sections, or tags can exist outside of a .cover or .page div (except the page-breaks). If content spills over, create a new <div class="page">.
Whitespace: Keep the HTML output clean. Do not add excessive blank lines.

Task 4: Required Document Structure
Cover Page: Nexeor Logo, Title, Subtitle, and metadata grid.
<div class="page-break"></div>
Page 1: Executive Summary & Scope
<div class="page-break"></div>
Page 2: Platform Architecture & Modules (use .node-dark, .node-blue, etc.)
<div class="page-break"></div>
Page 3: Tech Stack & Go-To-Market (use .tier boxes)
<div class="page-break"></div>
Page 4: Timeline & Deliverables (use .sprint layout)
<div class="page-break"></div>
Page 5: Investment & Resource Allocation (use .value-strip)
<div class="page-break"></div>
Page 6: Agreement & Sign-off (Include Nexeor Company Footer HTML)

[CSS BASE - INCLUDE EXACTLY IN <head>]
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Inter', sans-serif; background: #fdfdfd; color: #111111; font-size: 14px; line-height: 1.7; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { max-width: 210mm; min-height: 297mm; margin: 20px auto; padding: 72px 60px; background: #ffffff; box-shadow: 0 4px 15px rgba(0,0,0,0.05); position: relative; }
  @media print { body { background: #ffffff; } .page { margin: 0; padding: 50px; box-shadow: none; width: 100%; max-width: 100%; min-height: 100vh; } .page-break { page-break-before: always; break-before: page; } .pg-footer { position: fixed; bottom: 0; width: 100%; } }
  .cover { padding: 80px 60px 60px; max-width: 210mm; min-height: 297mm; margin: 0 auto; border-bottom: 2px solid #111; margin-bottom: 20px; background: #fff; position: relative;}
  .cover-logo-vertical { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; margin-bottom: 60px; }
  .cover-logo-vertical img { height: 64px; width: auto; object-fit: contain; }
  .cover-logo-vertical span { font-family: 'Inter Tight', sans-serif; font-weight: 700; font-size: 26px; letter-spacing: 3px; color: #111; }
  .logo-horizontal { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
  .logo-horizontal img { height: 36px; width: auto; object-fit: contain; }
  .logo-horizontal span { font-family: 'Inter Tight', sans-serif; font-weight: 700; font-size: 22px; letter-spacing: 2px; color: #111; }
  .cover-label { font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: #888; margin-bottom: 32px; }
  .cover-title { font-family: 'Inter Tight', sans-serif; font-size: 46px; font-weight: 700; line-height: 1.1; margin-bottom: 12px; }
  .cover-subtitle { font-size: 20px; font-weight: 400; color: #444; margin-bottom: 48px; }
  .cover-meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; padding-top: 32px; border-top: 1px solid #ddd; }
  .meta-item label { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 2px; color: #888; margin-bottom: 4px; }
  .meta-item span { font-size: 13px; font-weight: 600; }
  .section { margin-bottom: 56px; }
  .section-header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 28px; padding-bottom: 12px; border-bottom: 1px solid #e0e0e0; }
  .section-num { font-size: 14px; font-weight: 700; letter-spacing: 2px; color: #aaa; text-transform: uppercase; }
  h2 { font-family: 'Inter Tight', sans-serif; font-size: 26px; font-weight: 700; color: #111; }
  h3 { font-size: 18px; font-weight: 600; margin: 32px 0 12px; color: #222; }
  h4 { font-size: 14px; font-weight: 600; text-transform: uppercase; letter-spacing: 1px; color: #555; margin: 24px 0 10px; }
  p { color: #333; margin-bottom: 16px; font-size: 14px; }
  strong { color: #111; font-weight: 600; }
  ul { margin-bottom: 16px; padding-left: 20px; color: #333;}
  li { margin-bottom: 8px; }
  blockquote { border-left: 4px solid #1a5fa8; padding: 16px 24px; margin: 24px 0; background: #f4f8fc; border-radius: 0 4px 4px 0; }
  blockquote p { color: #1a4b82; font-style: italic; margin: 0; font-size: 15.5px; font-weight: 500; }
  .table-wrap { margin: 20px 0 32px; overflow-x: auto; border: 1px solid #e8e8e8; border-radius: 6px;}
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th { background: #f8f9fa; color: #111; padding: 14px 18px; text-align: left; font-size: 11px; letter-spacing: 1px; text-transform: uppercase; font-weight: 700; border-bottom: 2px solid #ddd;}
  td { padding: 14px 18px; border-bottom: 1px solid #eee; color: #444; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  .total-row td { background: #fdfdfd; font-weight: 700; color: #111; border-top: 2px solid #111; font-size: 15px;}
  .tc-row td { background: #111 !important; color: #fff !important; font-weight: 600; border-radius: 4px;}
  .check { color: #1a7a4a; font-weight: 700; }
  .cross { color: #999; }
  .diagram { margin: 24px 0 32px; padding: 32px 28px; border: 1px solid #eaebec; background: #fdfdfe; border-radius: 6px; overflow-x: auto; }
  .diagram-title { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #666; margin-bottom: 24px; display: flex; align-items: center; gap: 8px; }
  .diagram-title::before { content: ''; display: block; width: 6px; height: 14px; background: #1a5fa8; border-radius: 2px; }
  svg { overflow: visible; }
  .status-list { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0; }
  .status-badge { font-size: 12.5px; font-weight: 500; padding: 6px 14px; border: 1px solid; border-radius: 20px; display: inline-flex; align-items: center; gap: 6px; }
  .s-pending { border-color: #f59e0b; color: #b45309; background: #fffbeb; }
  .s-verified { border-color: #1a7a4a; color: #166534; background: #f0faf4; }
  .s-rejected { border-color: #ef4444; color: #b91c1c; background: #fef2f2; }
  .s-aip { border-color: #3b82f6; color: #1d4ed8; background: #eff6ff; }
  .s-full { border-color: #8b5cf6; color: #5b21b6; background: #f5f3ff; }
  .s-overdue { border-color: #f97316; color: #c2410c; background: #fff7ed; }
  .tiers { display: grid; grid-template-columns: repeat(3,1fr); gap: 16px; margin: 24px 0; }
  .tier { padding: 20px; border: 1px solid #eee; border-radius: 6px; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.02);}
  .tier-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; margin-bottom: 8px; }
  .tier-title { font-weight: 700; font-size: 15px; margin-bottom: 8px; color: #111;}
  .tier-desc { font-size: 13px; color: #555; line-height: 1.6; }
  .tier-t1 { border-top: 4px solid #1a7a4a; }
  .tier-t2 { border-top: 4px solid #f59e0b; }
  .tier-t3 { border-top: 4px solid #bbb; }
  .sprint { display: flex; margin-bottom: 12px; border: 1px solid #eaeaea; border-radius: 6px; overflow: hidden; background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.02);}
  .sprint-id { background: #111; color: #fff; font-size: 14px; font-weight: 700; writing-mode: vertical-lr; display: flex; align-items: center; justify-content: center; padding: 0 12px; min-width: 44px; letter-spacing: 1px; transform: rotate(180deg);}
  .sprint-body { padding: 16px 20px; flex: 1; }
  .sprint-ttl { font-weight: 700; font-size: 15px; margin-bottom: 4px; color: #111;}
  .sprint-wks { font-size: 11px; color: #1a5fa8; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 12px; display: inline-block; padding: 2px 8px; background: #f0f4fd; border-radius: 4px;}
  .sprint-tags { display: flex; flex-wrap: wrap; gap: 8px; }
  .sprint-tag { font-size: 11.5px; border: 1px solid #ddd; border-radius: 4px; padding: 4px 10px; color: #555; background: #fcfcfc;}
  .value-strip { background: #111; color: #fff; border-radius: 6px; padding: 28px; margin: 32px 0; display: flex; gap: 32px; align-items: center; box-shadow: 0 8px 20px rgba(0,0,0,0.1);}
  .vs-stat { text-align: center; min-width: 100px; }
  .vs-num { font-size: 36px; font-weight: 700; line-height: 1; color: #fff; }
  .vs-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #aaa; margin-top: 8px; font-weight: 600;}
  .vs-div { width: 1px; background: #444; align-self: stretch; }
  .vs-text { flex: 1; font-size: 14.5px; color: #e0e0e0; line-height: 1.7; font-weight: 300;}
  .vs-text strong { color: #fff; font-weight: 700; }
  .node-dark { fill: #111; stroke: #111; } .node-light { fill: #f8f9fa; stroke: #ddd; stroke-width: 1.5; } .node-green { fill: #f0faf4; stroke: #1a7a4a; stroke-width: 1.5; } .node-blue { fill: #f0f4fd; stroke: #1a5fa8; stroke-width: 1.5; } .node-amber { fill: #fffbeb; stroke: #f59e0b; stroke-width: 1.5; } .node-red { fill: #fef2f2; stroke: #ef4444; stroke-width: 1.5; }
  .lbl { font-family: 'Inter',sans-serif; font-size: 11.5px; fill: #111; } .lbl-sm { font-family: 'Inter',sans-serif; font-size: 10px; fill: #666; } .lbl-white { font-family: 'Inter',sans-serif; font-size: 11.5px; fill: #fff; } .lbl-green { font-family: 'Inter',sans-serif; font-size: 11.5px; fill: #166534; } .lbl-blue { font-family: 'Inter',sans-serif; font-size: 11.5px; fill: #1d4ed8; } .lbl-amber { font-family: 'Inter',sans-serif; font-size: 11.5px; fill: #b45309; } .lbl-red { font-family: 'Inter',sans-serif; font-size: 11.5px; fill: #b91c1c; }
  .edge { stroke: #999; stroke-width: 1.5; fill: none; } .edge-green { stroke: #1a7a4a; stroke-width: 1.5; fill: none; } .edge-blue { stroke: #1a5fa8; stroke-width: 1.5; fill: none; } .edge-amber { stroke: #f59e0b; stroke-width: 1.5; fill: none; } .edge-red { stroke: #ef4444; stroke-width: 1.5; fill: none; } .edge-dashed { stroke: #bbb; stroke-width: 1.5; stroke-dasharray: 4,4; fill: none; }
  .pg-footer { max-width: 210mm; margin: 48px auto 0; padding: 16px 60px; border-top: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #999; background: #fff; }
  .sign-section { margin-top: 40px; } .sign-header { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #666; border-bottom: 2px solid #eee; padding-bottom: 16px; margin-bottom: 36px; } .sign-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 80px; } .sign-party-name { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #1a5fa8; margin-bottom: 8px; } .sign-party-full { font-size: 16px; font-weight: 700; color: #111; margin-bottom: 40px; } .sign-field { margin-bottom: 32px; } .sign-line { border-bottom: 1px solid #ccc; height: 36px; margin-bottom: 8px; width: 100%; } .sign-field-lbl { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #888; font-weight: 500;}
  .page-break { break-before: page; }
  .pg-num { position: absolute; bottom: 28px; right: 60px; font-size: 11px; color: #bbb; font-family: 'Inter', sans-serif; letter-spacing: 1px; font-weight: 500; }
  .wf-wrap { margin: 28px 0; } .wf-phase { margin-bottom: 28px; } .wf-phase-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: #1a5fa8; margin-bottom: 10px; padding: 4px 0 4px 10px; border-left: 3px solid #1a5fa8; } .wf-steps { display: flex; align-items: flex-start; gap: 0; flex-wrap: wrap; row-gap: 8px; } .wf-step { display: flex; align-items: center; } .wf-box { background: #f8f9fa; border: 1px solid #e0e0e0; border-radius: 5px; padding: 8px 12px; font-size: 11.5px; color: #222; font-weight: 500; white-space: normal; min-width: 90px; max-width: 140px; text-align: center; line-height: 1.4; } .wf-box.green { background: #f0faf4; border-color: #1a7a4a; color: #166534; } .wf-box.blue { background: #f0f4fd; border-color: #1a5fa8; color: #1d4ed8; } .wf-box.amber { background: #fffbeb; border-color: #f59e0b; color: #92400e; } .wf-box.dark { background: #111; color: #fff; border-color: #111; } .wf-arrow { font-size: 16px; color: #bbb; padding: 0 6px; flex-shrink: 0; }
</style>

[NEXEOR REQUIRED ASSETS]
Use this for the Cover Page top section:
<div class="cover-meta-top">
  <div class="cover-logo-vertical">
    <img src="https://nexeor.com/img/logo/nexeor-logo.png" alt="Nexeor Icon">
    <span>NEXEOR</span>
  </div>
</div>

Use this for the final Agreement page footer:
<div style="margin-top: 60px; padding-top: 30px; border-top: 2px solid #eee;">
  <div class="logo-horizontal">
    <img src="https://nexeor.com/img/logo/nexeor-logo.png" alt="Nexeor Icon">
    <span>NEXEOR</span>
  </div>
  <div style="font-size:12px;color:#555;line-height:1.9">
    <strong style="color:#111">Nexeor Creative Technologies – FZCO</strong><br>
    Premises No. 46283-001, IFZA Business Park, DDP, Dubai Silicon Oasis, Dubai 342001, UAE<br>
    Dubai: +971 566 613554 &nbsp;·&nbsp; Cochin: +91 95677 00937 &nbsp;·&nbsp; <a href="http://www.nexeor.com" style="color:#111;text-decoration:none;">www.nexeor.com</a> &nbsp;·&nbsp; info@nexeor.com<br>
    <span style="color:#aaa;font-size:11px">Confidential · Prepared exclusively for {Client Name field, or "[INSERT CLIENT NAME]" if blank} · Proposal validity: 14 days</span>
  </div>
</div>
```
</details>

**Reading the master prompt — what it tells you about the intended document.** The prompt hard-codes
the whole proposal specification, so this is effectively the product's proposal template even
though no template picker exists:

- **Persona:** "an elite Enterprise Tech Sales Architect working for Nexeor Creative Technologies."
- **Document type:** a **Fixed-Price Web & Mobile Application Proposal**, in styled A4 HTML.
- **Tone required:** authoritative, enterprise-focused, transparent, execution-oriented, leaning on
  the words *ROI, ecosystem, scalability, fault-tolerance, strategic partnership*.
- **Fixed page order (7 pages):** Cover Page → 1 Executive Summary & Scope → 2 Platform
  Architecture & Modules → 3 Tech Stack & Go-To-Market → 4 Timeline & Deliverables → 5 Investment
  & Resource Allocation → 6 Agreement & Sign-off.
- **Structural rules:** the cover must be one `.cover` div, every later page one `.page` div, pages
  separated by `.page-break`, and no content may sit loose outside those containers.
- **A complete stylesheet is embedded in the prompt**, which names the visual components the
  document may use — and this is the closest thing the product has to a list of "blocks":
  cover with vertical logo and a four-column metadata grid · numbered section headers · tables
  with a highlighted **total row** and a black **terms row** · tick/cross cells · SVG architecture
  diagrams with six node colours (dark, light, green, blue, amber, red) and five edge styles ·
  status badges in six colours (pending, verified, rejected, approved-in-principle, full,
  overdue) · three-column **tier** boxes · **sprint** rows with a vertical sprint number ·
  a black **value strip** with big statistics · a workflow diagram with phased boxes and arrows ·
  a two-column **sign-off grid** with ruled signature lines · page numbers and a page footer.
- **Fixed company details** are baked in for the last page: *Nexeor Creative Technologies – FZCO,
  Premises No. 46283-001, IFZA Business Park, DDP, Dubai Silicon Oasis, Dubai 342001, UAE;
  Dubai +971 566 613554; Cochin +91 95677 00937; www.nexeor.com; info@nexeor.com*, plus a fixed
  **"Proposal validity: 14 days"** line and the logo at `https://nexeor.com/img/logo/nexeor-logo.png`.

### Step 2 — "PASTE GENERATED HTML"

One large textarea, no label of its own beyond the step heading, **no placeholder text**, styled as
green monospace on near-black. It is the only input to the preview and the only input to the export.
There is no upload, no file picker and no import.

### The preview

- Occupies the entire right-hand side; light grey background.
- **Empty state:** a faded sparkle icon above the text **"Paste HTML to see live preview"**.
- As soon as anything is typed or pasted into step 2, the placeholder is replaced by a scrollable
  frame titled *Proposal Preview* that renders the pasted HTML exactly as written, full height.
  Verified live: pasting a one-line HTML snippet produced the rendered frame immediately.
- The preview updates on every keystroke. There is no refresh button and no zoom control.

### Button: **Export to PDF** — described, not pressed

- Full-width blue bar, 48px tall, at the very bottom of the left column.
- **Disabled while the paste box is empty** (verified: it is greyed out on arrival and becomes
  active the moment HTML is present).
- While working it shows a spinner and the words **"Compiling PDF..."**.
- **This button was deliberately not pressed.** Reading the page code shows what it does, and it is
  worth recording precisely because it removes a worry: it sends the pasted HTML and the Client
  Name to the server, gets a PDF back, and triggers a **download to your own computer** named
  `Nexeor_Proposal_<Client Name with spaces as underscores>.pdf` (falling back to
  `Nexeor_Proposal_Client.pdf` if the name is blank). **It does not email anybody and it does not
  save the proposal anywhere in the product.**
- Two messages can appear as pop-up alerts: **"Please paste the generated HTML first."** if the box
  is empty, and **"Error exporting PDF. Ensure the backend route is setup."** if the server fails.

### Tabs — phone only

Below 768px the two panels cannot sit side by side, so a two-tab strip appears at the very top:
**Builder** (file icon) and **Preview** (eye icon), with the active tab underlined in blue.
Confirmed rendered at 390px. Above 768px the strip is hidden and both panels show at once.

**Every form/dialog it opens:** **none.** This screen has no dialogs, no drawers, no modals and no
confirmations. There was nothing to cancel out of.

**Tables/lists:** none.

**Empty state:** the preview placeholder described above. There is no other empty state, because
there is no list on this screen.

**Any saved/previous proposals list:** **there is none, anywhere.** No list on this screen, no
second Sales menu item for it, and no route for it — the Sales group contains exactly five items
(CRM Board, Payment Calendar, Reports, Proposal Exporter, Campaign Pages). A proposal exists only
as the PDF that lands in your downloads folder. Nothing about it is stored against the lead, so
there is no history, no version, no status and no record that a proposal was ever made.

**Realtime/auto:** the preview redraws as you type. Nothing else moves on its own; the screen polls
nothing and receives nothing.

---

## 2. Campaign Pages (the list) — `/crm/campaigns`

**Where:** Sidebar → **Sales** → **Campaign Pages**. Direct address `/crm/campaigns`.

**What you see on arrival:** A normal in-shell page. At the top, the heading **Campaign Pages** with
the subtitle *"Create trackable, mobile-optimized landing pages to collect leads without Meta
integrations."* Below it a blue-tinted banner strip carrying a target icon, the words **Campaign
Pages** and *"Create specific landing pages to generate leads. They pull in tracking parameters
(utm, fbclid) automatically!"*, with a bright blue **New Campaign** button on its right. Beneath
that, the campaigns themselves as **cards in a grid** — one per row on a phone, two columns from
768px, three from 1280px. There is **no table view and no list view**; cards are the only display.

**Numbers/cards on the page:** two figures inside every campaign card —

| Tile | What it counts | Live value, Corporate Web Design | Live value, Ecommerce Special Deal |
|---|---|---|---|
| **Total Views** | Times the public landing page has been loaded (a stored counter on the campaign) | **1208** | **744** |
| **Leads Generated** | Everyone the page has captured — those already imported into the CRM **plus** those still waiting to be reviewed | **0** | **57** |

**The two campaigns present at capture time:**

| Name | Status | Slug | Template type | Total Views | Leads Generated |
|---|---|---|---|---|---|
| Corporate Web Design | Active | `/corporate-web` | WEBSITE | 1208 | 0 |
| Ecommerce Special Deal | Active | `/ecom-deal` | ECOMMERCE | 744 | 57 |

### What one card shows, top to bottom

1. **Campaign name**, truncated if long.
2. **Status pill** beside the name — see the status table below.
3. **Second line:** `/<slug> • <TEMPLATE TYPE>`, e.g. `/ecom-deal • ECOMMERCE`. Where a campaign has
   no type stored, this line falls back to the word `CUSTOM`.
4. **Two icon buttons, top-right** (see the row actions table).
5. **The two number tiles**, side by side from 640px, stacked below it.
6. **A footer row with two controls:** a wide **Copy URL** button and a narrow square link button.
7. **The card itself is clickable** — clicking anywhere that is not one of those buttons opens the
   campaign's own screen (section 3).

### Statuses — the complete list

There are exactly **two**, driven by one on/off flag:

| Status pill | Colour | What it means |
|---|---|---|
| **Active** | green | The public landing page is live and can be visited, viewed and submitted. |
| **Paused** | red/rose | The campaign is switched off. The card, its numbers and its captured leads all remain; the page is simply not running. |

There is no draft, no archived, no scheduled and no expired status.

### Row actions — every one

| Control | Appearance | What it does |
|---|---|---|
| **Pause Campaign / Activate Campaign** | Small square icon button, top-right of the card, always visible. Shows a "power off" icon while the campaign is Active and a "power" icon while it is Paused; the tooltip reads **"Pause Campaign"** or **"Activate Campaign"** to match. | **This is the publish / unpublish control.** One press, no confirmation and no dialog — the pill flips between Active and Paused immediately and the change is saved. **Not pressed during this capture**, because it changes what the public can see. |
| **Delete Campaign** | Second square icon button, a red trash icon. **Hidden until you hover the card** (it fades in with the card's hover state), tooltip **"Delete Campaign"**. | Raises the browser's own confirmation box reading exactly **"Are you sure you want to delete this campaign? This cannot be undone."** Accepting removes the campaign from the grid and deletes it. **Not pressed** — the wording is quoted from the shipped page rather than triggered. |
| **Copy URL** | Wide button across the bottom of the card, copy icon plus the words **Copy URL**. | Copies the campaign's full public web address to your clipboard. The button then shows a green tick and the words **"Copied Link!"** for **2 seconds** before reverting. |
| **(open the live page)** | Narrow square button beside Copy URL, a chain-link icon, tooltip **"View Landing Page"**. | Opens the public landing page in a **new browser tab**. **Not pressed** — loading that page counts a page view against the owner's real statistics. |
| **(the card body)** | The whole card, cursor changes to a pointer | Opens that campaign's own screen at `/crm/campaigns/<id>`. |

### How the public address is composed

- The public page lives at **`/c/<slug>`** on the same site — so `origin + "/c/" + slug`, giving
  `https://os-staging.product.nexeor.com/c/ecom-deal` for the second campaign above.
- **Copy URL** builds exactly that, using whatever address the app is being served from, so the
  copied link automatically points at staging on staging and at the live site on live.
- The slug is stored without a leading slash; the card displays it with one for readability.
- The Create dialog shows a different hint — **`agencyos.com/c/...`** — which is a fixed piece of
  helper text and does not match the address actually copied. Noted below.

### Tabs / sort / filter / paging

**There are none.** The list has no tabs, no search box, no sort control, no filter, no page size
and no pagination — every campaign is rendered in one grid. With two campaigns this is invisible;
with a few hundred it would be the whole page.

### Empty state

When there are no campaigns at all, the grid is replaced by a dashed-border panel containing a
target icon, the heading **"No campaigns yet"**, the sentence **"Create a campaign to generate a
landing page URL you can use in your ads."**, and a button reading **"Create First Campaign"** which
opens the same Create Campaign dialog as the header button.

### Realtime/auto

Nothing moves on its own. The numbers are read when the page loads and do not refresh; pausing or
deleting updates the card instantly in the browser, but new views and new leads only appear after
you reload the page.

### Dialog: **Create Campaign** — opened and cancelled

**Opened by:** the **New Campaign** button in the header strip, or **Create First Campaign** in the
empty state. It appears as a centred panel over a blurred dark backdrop, maximum 448px wide.

- **Title:** Create Campaign
- **Subtitle:** *Set up a new trackable landing page.*
- **Error area:** if the server rejects the campaign, a red bar appears at the top of the form with
  the reason in it. Nothing was submitted, so no live example was seen.

**Every field, in order:**

| # | Label | Type | Required | Default | Placeholder / hint | Notes |
|---|---|---|---|---|---|---|
| 1 | **Campaign Name** | single-line text | **yes** | empty | `e.g. Meta Summer Sale` | Free text. |
| 2 | **URL Slug** | single-line text | **yes** | empty | `e.g. summer-sale`; a grey hint sits on the right of the label reading `agencyos.com/c/...` | **Fills itself in from the name as you type** — verified: typing *"Test Name Example"* produced `test-name-example`. It stops auto-filling once you edit it by hand. Typing directly into it **silently strips every character that is not a-z, 0-9 or a hyphen**, and forces lower case. Shown in a monospace font. |
| 3 | **Template Type** | dropdown | **yes** | **Custom Multi-Step Form** | — | Complete list of options below. |
| 4 | **WhatsApp Number** | single-line text | no | empty | `+1234567890 (Optional)` | **Only appears for two of the four template types** (see below). Helper text under the box: *"If provided, this number will be embedded in the landing page for quick contact."* |

**Template Type — the complete list of options (all four):**

| Stored value | Shown in the dropdown | Shows the WhatsApp field? |
|---|---|---|
| `CUSTOM` | **Custom Multi-Step Form** *(the default)* | **yes** |
| `ECOMMERCE` | **E-Commerce** | **yes** |
| `WEBSITE` | **Website Redesign** | no |
| `DIGITAL_MARKETING` | **Digital Marketing** | no |

Each of the four was selected in turn to confirm the WhatsApp field appearing and disappearing;
the dropdown was then returned to its default and the dialog cancelled.

**Buttons on the dialog:** **Cancel** (plain, closes the dialog and clears the form) and **Create
Campaign** (blue, submits; reads **"Creating..."** and is disabled while it works). **Create
Campaign was never pressed.** The dialog was closed with **Cancel** every time.

**One behaviour worth writing down:** pressing **Escape does not close this dialog** — it was still
open after Escape and only Cancel dismissed it. There is also no ✕ in the corner, and clicking the
dark backdrop does not close it either. Cancel is the only way out.

### The public landing page — `/c/<slug>` — described, never opened

This page was **deliberately not visited**, because every visit adds one to the campaign's Total
Views and would put false numbers into the owner's real statistics. What the rest of the product
reveals about it, and which is reliable:

- It is a **public page needing no sign-in**, one per campaign, at `/c/<slug>`.
- Its content is chosen entirely by the **Template Type** picked at creation. There are four
  layouts and **no way to edit any of them** — see section 3.
- It **reads advertising tracking parameters off its own web address automatically** — the banner
  on the list page names `utm` and `fbclid` specifically — and stores them against any lead the
  page captures.
- It carries a **lead capture form**; submissions land in that campaign's Captured Leads (section 3).
- For the **Custom Multi-Step Form** and **E-Commerce** types it is a **multi-step** form, since the
  analytics count which step people abandon.
- Where a **WhatsApp Number** was supplied it is embedded in the page for one-tap contact, and taps
  on it are counted.
- Its measured furniture, from the analytics it feeds back, includes a **portfolio section**, a
  **pricing/packages section** with selectable **tiers**, a **hero button** and a **sticky bottom
  bar**.

**No QR code anywhere.** Neither screen offers a QR code, a share sheet, an email-this-link action
or a social share button. Sharing is exactly one thing: copy the address and paste it yourself.

---

## 3. A single campaign — `/crm/campaigns/<id>` — the leads inbox

**Where:** Sidebar → Sales → Campaign Pages → **click any campaign card**. There is no menu item
for it and no link back to the list on the page itself.

> **This is where the expected page editor would be, and it is not here.** Opening a campaign does
> not give you a canvas, a block list, a field editor or any content control. It gives you the
> people the page has caught and the numbers it has recorded. **There is no screen anywhere in the
> product that edits a campaign page's content, and no screen that edits a campaign's name, slug,
> type or WhatsApp number after it has been created.** A campaign is created once, from four fixed
> template types, and then it can only be paused, deleted, or read.

**What you see on arrival:** The campaign's **name** as the page title with its **template type**
beside it in small caps, and under it the line *"Review collected leads from this campaign and
import them to your CRM board."* Below that a two-tab strip on a dark bar, and under the strip the
contents of the selected tab. The tab open by default is **Captured Leads**.

**Tabs:** exactly two.

| Tab | Label | What it shows |
|---|---|---|
| 1 | **Captured Leads (n)** — the count is in the label | The list of people the page has caught who have **not yet been imported** into the CRM. |
| 2 | **Analytics & Reports** | Four number tiles and up to four panels of visitor behaviour. |

### Tab 1 — Captured Leads

Not a table — a **stack of rows**, one per submission, divided by hairlines. **There are no column
headers, no sort, no filter, no search and no paging.** Each row carries:

- A round **initial badge** made from the first letter of the person's name.
- Their **name**, and beside it a grey pill giving **how long ago** they submitted, written in
  words — *"seconds ago" / "n minutes ago" / "n hours ago" / "n days ago" / "n months ago" /
  "n years ago"*.
- **Email** (envelope icon) and **Phone** (phone icon) on one line under the name.
- **Company** (building icon) and **Service** (briefcase icon) as small labelled blocks — each
  shown **only if the person supplied it**.
- **Tracking Parameters** — a row of small monospace chips, one per parameter the landing page
  picked up off the advertising link (`utm_source`, `fbclid` and so on), each showing the name and
  the value. Shown only when the submission carried any.
- **On the right of the row, one action:** a blue **Import to Board** button with a download icon.
  While it works it reads **"Importing..."**. Afterwards the row dims, the button is replaced by a
  green **Imported** pill, and a small **"View in Board ↗"** link appears beneath it which jumps
  to the CRM board with that lead selected.
- If importing fails, the reason is shown as a pop-up alert, or the words **"Failed to import"**.

**Import to Board was not pressed** — it creates a real lead in the owner's CRM.

**Which stage does an imported lead land in?** This is decided on the server and **is not shown
anywhere on this screen** — there is no stage picker, no owner picker and no confirmation step, so
importing is a single press with no choices. The screen's only clue is the link it leaves behind,
which opens the CRM board with the new lead selected. **Stated honestly: the destination stage
could not be established from this screen, and the only way to see it would have been to import a
real lead, which was not done.** The CRM board terminal (N2) is the one that can answer it.

**Empty state:** a user icon in a grey circle, the heading **"No submissions yet"**, and the
sentence *"When users fill out your campaign form, they will appear here for you to review and
import."*

### Tab 2 — Analytics & Reports

**Four number tiles across the top:**

| Tile | What it counts | Colour |
|---|---|---|
| **Total Page Views** | Times the landing page was opened | white |
| **Lead Conversions** | Leads captured, with a second line reading **"Conversion Rate: n%"** — conversions divided by views, to one decimal | green |
| **Form Drop-offs** | People who started the form and left before finishing | orange |
| **WhatsApp Clicks** | Taps on the embedded WhatsApp contact | WhatsApp green |

**Then up to four panels:**

1. **User Engagement** — two labelled progress bars, each with a count and a percentage of views:
   **"Scrolled to Portfolio"** (blue bar) and **"Scrolled to Pricing/Packages"** (indigo bar).
2. **Call-to-Action Clicks** — three rows, each a label and a count: **Hero Button**, **Sticky
   Bottom Bar**, **Other CTAs**.
3. **Tier Popularity** — a grid of small cards, one per pricing tier the page offers, each showing
   the tier name, a big number and the word **"Selections"**. **This panel only appears once at
   least one tier has been clicked**, and was therefore not visible on either campaign.
4. **Form Abandonment Analysis** — a red-tinted panel listing which step of the form people quit
   at, as pills reading *"<step name>: n abandoned"*, with unnamed steps grouped under **"Unknown
   Step"**. **Only appears once there has been at least one drop-off**, so it was not visible.

**Live values read on Ecommerce Special Deal:** Total Page Views **2**, Lead Conversions **0**
(Conversion Rate 0.0%), Form Drop-offs **0**, WhatsApp Clicks **0**; Scrolled to Portfolio **1
(50%)**, Scrolled to Pricing/Packages **2 (100%)**; Hero Button **0**, Sticky Bottom Bar **1**,
Other CTAs **0**.

**Empty state:** there is none. With no data the tiles simply show zeros and the two conditional
panels are absent.

**Realtime/auto:** nothing. Both tabs are filled once when the page loads and never refresh; you
reload to see anything new.

**Every form/dialog on this screen:** **none.** No dialogs, no drawers, no confirmations.

---

## Every dialog opened during this capture

| Dialog | Screen | Opened by | How it was closed |
|---|---|---|---|
| **Create Campaign** | `/crm/campaigns` | New Campaign button | **Cancel** (three separate times, including once after confirming Escape does nothing) |

That is the complete list — **the whole of my scope contains exactly one dialog.** The Proposal
Exporter has none, and the campaign detail screen has none. Two further confirmations exist in the
product and were **not** opened, on purpose: the delete confirmation on a campaign card, and the
browser print/download that follows Export to PDF.

---

## Odd things I noticed

- **The campaign list and the campaign's own analytics disagree, badly.** The Ecommerce Special
  Deal card says **744 Total Views** and **57 Leads Generated**; opening that same campaign shows
  **Total Page Views 2**, **Lead Conversions 0** and **Captured Leads (0)**. Corporate Web Design
  shows the same shape of gap (1208 views on the card). The two screens are counting from
  different places — the card reads stored totals on the campaign, the detail screen counts
  individual recorded visitor events — and they have drifted a long way apart. Whichever is right,
  the owner is currently shown two very different answers to "how is this campaign doing?"
  depending on which screen he is standing on.
- **"Leads Generated 57" with an empty Captured Leads tab is confusing rather than wrong.** The
  card's figure includes leads already imported into the CRM; the tab lists only those still
  waiting. Nothing on either screen explains that, so the campaign looks like it has lost 57 people.
- **The Create dialog's slug hint names the wrong website.** It reads `agencyos.com/c/...` while the
  link the product actually builds and copies uses whatever address the app is served from —
  `os-staging.product.nexeor.com/c/...` here. It looks like leftover text from an earlier name.
- **Escape does not close the Create Campaign dialog**, nor does clicking the backdrop, and there is
  no ✕. Cancel is the only exit.
- **Pause / Activate is a one-press change to a public page with no confirmation**, while deleting a
  campaign — which the owner can at least see the consequences of — does ask. The heavier of the
  two consequences for a running advertising campaign is arguably the silent one.
- **A campaign cannot be edited after it is created.** Not its name, not its slug, not its template
  type, not its WhatsApp number, and not one word of the page's content. A typo in a slug means
  deleting the campaign and losing its statistics and its leads with it.
- **Nothing in the campaign list is searchable, sortable or paged.** Every campaign renders at once.
- **The Proposal Exporter's Budget example is in US dollars** (`e.g. $12,500`), which is neither of
  the currencies the rest of the product deals in.
- **A proposal leaves no trace in the product.** It is not saved, not attached to the lead, not
  versioned and not logged — the only copy is the PDF in the user's downloads folder, so nobody
  can later ask "what did we quote them?" inside the system.
- **The Proposal Exporter depends on a person doing the middle step by hand** in a different
  product (ChatGPT or Claude). If nobody does that, the screen produces nothing.

---

## In human language — every feature in this area, as points

- **Proposal writing helper** — a page where you type a few facts about a client and it writes you a
  very long, very detailed set of instructions for an AI to turn into a smart-looking proposal
  document. You find it under Sales, called Proposal Exporter. It is for getting a professional,
  properly branded proposal out to a client in minutes instead of an afternoon.
- **The five client questions** — client name, project name, budget, timeline, and a big box for
  your rough notes from the meeting. You can leave any of them blank, and the instructions will
  simply tell the AI to make a sensible guess for whatever is missing. It is for capturing what you
  know without forcing you to have all the answers.
- **Copy the instructions in one press** — one button copies the whole instruction text to your
  clipboard and turns green to tell you it worked. You then paste it into ChatGPT or Claude
  yourself. It is for moving the work to the AI without any typing.
- **The proposal's fixed recipe** — the instructions already spell out a seven-page document: a
  cover, a summary, how the system is built, the technology and launch plan, the timeline, the money,
  and a page to sign. They also fix the company's own address and phone numbers, the logo, and a
  fourteen-day validity note. It is for making sure every proposal that leaves the company looks the
  same and says the same things about who you are.
- **See the document before you send it** — paste back whatever the AI gives you and the right-hand
  side of the screen shows it as a real page immediately, updating as you type. It is for catching a
  mistake before a client ever sees it.
- **Turn it into a PDF** — one blue button turns what you are looking at into a proper PDF file that
  downloads to your computer, named after the client. It does not email anybody; sending it is still
  your job. It is for getting a file you can attach to an email or print.
- **Works on a phone** — on a small screen the writing side and the preview side become two tabs you
  swap between. It is for checking a proposal while you are not at your desk.
- **What this tool does not do** — it does not remember proposals. Once you close the page, the only
  copy is the file on your computer. It also does not know anything about the client you already
  have on the sales board, does not add up prices for you, and does not handle a currency, tax or a
  discount. Everything is typed by hand. It is worth knowing, because it means nobody can later
  look up what was quoted.
- **Advertising landing pages** — a place to make simple public web pages that you can point your ads
  at, so people can leave their details without you needing anything connected to Facebook. You find
  it under Sales, called Campaign Pages. It is for turning ad spend into names and phone numbers you
  actually own.
- **Making a new page** — one button opens a short form: give the campaign a name, and the web
  address ending writes itself from that name as you type. It is for getting a live page up in
  under a minute.
- **Four ready-made page styles** — a step-by-step form, an online-shop offer, a website-redesign
  pitch, or a digital-marketing pitch. You pick one when you create the page. It is for having a
  page that already suits what you are selling.
- **A WhatsApp button on the page** — for the step-by-step and online-shop styles you can add a phone
  number, and the page gets a one-tap WhatsApp contact. It is for catching the people who would
  rather message than fill in a form.
- **Copy the link to your page** — one press puts the page's full web address on your clipboard,
  ready to paste into an advert. It is for launching a campaign without hunting for the address.
- **Open the live page** — a small link button opens the page exactly as the public sees it, in a
  new tab. It is for checking what you have actually put out there.
- **Switch a campaign off and on** — one press pauses a page so it stops running, and another press
  starts it again. There is no "are you sure", so it happens the instant you press it. It is for
  stopping an advert's landing page the moment a promotion ends.
- **Two clear states** — every campaign is either running or paused, shown as a green or red tag on
  its card. It is so you can see at a glance what is live.
- **Delete a campaign** — a red bin button appears when you hover over a card, and it asks you to
  confirm before removing the campaign for good. It is for clearing out old promotions.
- **Two numbers per campaign at a glance** — how many people opened the page, and how many left their
  details. It is for seeing which advert is working without opening anything.
- **The people your page caught** — open a campaign and you get everyone who filled in the form:
  their name, email, phone, and their company and what service they asked about where they gave it,
  each with how long ago they got in touch. It is for working through new enquiries in one place.
- **Where the enquiry came from** — each person's entry also shows the tracking tags picked up from
  the advert link they clicked, so you can tell which advert or platform sent them. It is for
  knowing which advert is worth more money.
- **Move someone onto the sales board with one press** — a button on each person turns them into a
  proper lead on your sales board, and the entry then shows as imported with a link straight to
  them. It is for not retyping enquiries.
- **See how people behaved on the page** — a second tab shows how many opened it, how many became
  leads and what percentage that is, how many gave up part-way through the form, and how many
  tapped WhatsApp. It is for understanding why a page is or is not working.
- **How far down people read** — bars showing how many scrolled as far as your portfolio and as far
  as your prices. It is for telling whether people lose interest before they reach the offer.
- **Which buttons people press** — counts for the button at the top of the page, the bar that
  follows you down the screen, and everything else. It is for knowing which call to action earns
  its place.
- **Which price package people pick** — once people start choosing, a panel appears showing how
  often each package was selected. It is for pricing the next offer better.
- **Where people give up** — once people start abandoning the form, a panel appears naming the exact
  step they quit at and how many quit there. It is for fixing the one question that is costing you
  enquiries.
- **What this area does not do** — you cannot change anything about a campaign page once you have
  made it. Not its name, not its web address, not its style, and not a single word on the page
  itself. There is also no search, no sorting and no QR code. If you get something wrong, the only
  way out is to delete the campaign, and you lose its numbers and its enquiries along with it.
