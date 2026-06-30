# Phase 3 — Logo Image Upload (splash + search bar) Implementation Plan

> **For agentic workers:** Execute task-by-task; commit per task; verify live before claiming done.

**Goal:** From `/aevinite/restaurants` → a restaurant → Branding, the admin uploads a logo **image**; it shows on the opening splash AND beside the search bar on that restaurant's guest menu. No logo → falls back to the styled name / magnifying glass. Restaurant #1 keeps its own hardcoded logo.

**Architecture:** New `restaurants.logo_url` column (additive migration) + a public Supabase Storage bucket `branding`. An admin-gated upload route stores the image and writes `logo_url`. The tenant resolver returns it; the guest render shows it in IntroSplash + the search-row (both gated to non-#1 with a logo). The branding GET/POST + BrandingCard gain a logo control.

---

## File Structure
- **Create** `supabase/migrations/108_restaurant_logo_url.sql` — `ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS logo_url text;`
- **Create** `scripts/create-branding-bucket.mjs` — idempotently create the public `branding` storage bucket via the service role.
- **Create** `app/api/admin/restaurants/logo/route.ts` — admin-gated POST (upload image → storage → write logo_url) + DELETE (clear).
- **Modify** `app/api/admin/restaurants/branding/route.ts` — GET also returns `logo_url`.
- **Modify** `lib/tenant.ts` — `Restaurant.logoUrl` + select `logo_url`.
- **Modify** `app/r/[restaurant]/menu/page.tsx` — pass `logoUrl`.
- **Modify** `components/MenuView.tsx` — accept `logoUrl`; pass to AppShell; render it in the search-row (replace the SVG glyph when a non-#1 restaurant has a logo).
- **Modify** `components/AppShell.tsx` — accept `logoUrl`, pass to IntroSplash.
- **Modify** `components/IntroSplash.tsx` — render `<img class="intro-logo" src={logoUrl}>` for non-#1 when present.
- **Modify** `app/aevinite/restaurants/page.tsx` — BrandingCard: logo upload control (file picker → POST), current-logo preview, Remove button.

---

### Task 1: Migration + storage bucket
- [ ] Create `supabase/migrations/108_restaurant_logo_url.sql`:
```sql
-- Per-restaurant logo IMAGE (Phase 3). Additive, nullable; existing rows unaffected.
-- The image itself lives in the public Storage bucket `branding`; this column holds its URL.
ALTER TABLE restaurants ADD COLUMN IF NOT EXISTS logo_url text;
```
- [ ] Apply: `node scripts/apply-migration.mjs supabase/migrations/108_restaurant_logo_url.sql` — expect `200` + `✓ applied`.
- [ ] Create `scripts/create-branding-bucket.mjs`:
```js
import { readFileSync } from "node:fs"; import { join, dirname } from "node:path"; import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(readFileSync(join(root, ".env.local"),"utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return [l.slice(0,i).trim(), l.slice(i+1).trim().replace(/^["']|["']$/g,"")];}));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data, error } = await sb.storage.createBucket("branding", { public: true, fileSizeLimit: 1048576, allowedMimeTypes: ["image/png","image/jpeg","image/webp","image/svg+xml"] });
if (error && !/already exists/i.test(error.message)) { console.error(error.message); process.exit(1); }
console.log("✓ branding bucket ready", data || "(existed)");
```
- [ ] Run: `node scripts/create-branding-bucket.mjs` — expect `✓ branding bucket ready`.
- [ ] Commit (migration + script).

### Task 2: Upload route `app/api/admin/restaurants/logo/route.ts`
- [ ] Create the route — admin-gated, accepts `multipart/form-data` with `restaurant_id` + `file`; validates image type + ≤1MB; uploads to `branding/<rid>/logo-<ts>.<ext>` (upsert), writes `restaurants.logo_url` to the public URL; logs. DELETE clears `logo_url` (and best-effort removes the object).
```ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin as sb } from "@/lib/supabaseAdmin";
import { AUTH_COOKIE, tokenIsValid } from "@/lib/staffAuth";
import { logAction } from "@/lib/oplog";
export const dynamic = "force-dynamic";
const ok = (d:any,s=200)=>NextResponse.json(d,{status:s});
const bad = (m:string,s=400)=>NextResponse.json({error:m},{status:s});
const admin = (req:NextRequest)=>tokenIsValid(req.cookies.get(AUTH_COOKIE)?.value);
const EXT: Record<string,string> = { "image/png":"png", "image/jpeg":"jpg", "image/webp":"webp", "image/svg+xml":"svg" };
export async function POST(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized",401);
  const form = await req.formData().catch(()=>null);
  const rid = String(form?.get("restaurant_id")||"");
  const file = form?.get("file");
  if (!rid || !(file instanceof File)) return bad("Missing restaurant_id or file.");
  const ext = EXT[file.type]; if (!ext) return bad("Logo must be PNG, JPG, WEBP or SVG.");
  if (file.size > 1048576) return bad("Logo must be 1 MB or smaller.");
  const path = `${rid}/logo-${Date.now()}.${ext}`;
  const buf = new Uint8Array(await file.arrayBuffer());
  const up = await sb.storage.from("branding").upload(path, buf, { contentType: file.type, upsert: true });
  if (up.error) return bad(up.error.message,500);
  const url = sb.storage.from("branding").getPublicUrl(path).data.publicUrl;
  const { error } = await sb.from("restaurants").update({ logo_url: url }).eq("id", rid);
  if (error) return bad(error.message,500);
  await logAction("admin","restaurant_logo",{actor:"admin",restaurant_id:rid,detail:"uploaded logo"});
  return ok({ ok:true, logo_url: url });
}
export async function DELETE(req: NextRequest) {
  if (!(await admin(req))) return bad("unauthorized",401);
  const rid = req.nextUrl.searchParams.get("restaurant_id")||"";
  if (!rid) return bad("Missing restaurant_id.");
  const { error } = await sb.from("restaurants").update({ logo_url: null }).eq("id", rid);
  if (error) return bad(error.message,500);
  await logAction("admin","restaurant_logo",{actor:"admin",restaurant_id:rid,detail:"removed logo"});
  return ok({ ok:true });
}
```
- [ ] Add `logo_url` to the branding GET (`app/api/admin/restaurants/branding/route.ts`): add `logo_url` to its select + response.
- [ ] `tsc` + commit.

### Task 3: Tenant resolver + thread to render
- [ ] `lib/tenant.ts`: add `logoUrl: string | null` to the interface; select `logo_url`; return `logoUrl: data.logo_url ?? null`.
- [ ] `app/r/[restaurant]/menu/page.tsx`: add `logoUrl={r.logoUrl ?? undefined}`.
- [ ] `tsc` + commit.

### Task 4: Guest render — splash + search-bar logo
- [ ] `components/MenuView.tsx`: add `logoUrl?: string` to props; pass `logoUrl={isDefault ? undefined : logoUrl}` to `<AppShell>`; in the search-row (line ~608), change the non-default branch to: if `logoUrl` present render `<img className="search-logo" src={logoUrl} alt="" aria-hidden />`, else the existing SVG glyph.
- [ ] `components/AppShell.tsx`: add `logoUrl?: string`; pass to `<IntroSplash wordmark=... accentColor=... logoUrl={logoUrl} />`.
- [ ] `components/IntroSplash.tsx`: add `logoUrl?: string`; render `{logoUrl ? <img className="intro-logo" src={logoUrl} alt="" /> : (isDefault && <img className="intro-logo" src={LOGO} alt="" />)}` so a themed restaurant with a logo shows it, #1 keeps `/lfh-logo.png`, others (no logo) show none.
- [ ] `tsc` + commit.

### Task 5: BrandingCard logo control
- [ ] In `BrandingCard` (`app/aevinite/restaurants/page.tsx`): load `logo_url` from the branding GET into state; add a section with the current logo `<img>` (if any), a `<input type="file" accept="image/*">` that POSTs `multipart/form-data` (restaurant_id + file) to `/api/admin/restaurants/logo`, a "Remove logo" button (DELETE), and busy/error messages. On success, refresh the shown logo.
- [ ] `tsc` + commit.

### Task 6: Live verification (desktop + ~390px)
- [ ] Upload a logo for Demo Bistro via the BrandingCard → success.
- [ ] `/r/demo-bistro/menu?table=1`: logo appears on the opening splash AND beside the search bar; no console errors; both light & dark.
- [ ] Remove the logo → splash + search fall back to name / glyph (no broken image).
- [ ] `/r/french-house/menu`: #1 still shows its own logo in both spots (unchanged).
- [ ] A restaurant with no logo (e.g. a fresh one): shows styled name + magnifying glass, no broken image.

---

## Self-Review
- Spec Phase 3 coverage: logo_url column ✓ (T1), storage bucket ✓ (T1), upload route + size/type cap ✓ (T2), render splash + search both places ✓ (T4), fallback when absent ✓ (T4/T6), #1 keeps its logo ✓ (T4), admin branding control ✓ (T5).
- Egress: logo served from Storage CDN (not DB); tenant read adds one column to the existing scoped row read. ✓
- Security: upload admin-gated; type+size validated server-side; bucket public-read only (writes via service role). ✓
- No placeholders; types (`logoUrl`) consistent across tenant→page→MenuView→AppShell→IntroSplash.
