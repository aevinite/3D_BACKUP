---
paths:
  - "app/view/**"
  - "components/PublicModelViewer.tsx"
  - "public/content/items/**"
  - "public/models/**"
---
# The 3D dish screen — the tags, and how big the dish is in AR

Written 2026-09-20 on the owner's instruction: *"after adding it back NEVER remove them they were
the main look for 3D… and make sure you make a rule don't remove tags again."*
Both halves are also rows in `docs/REJECTED-IDEAS.md` (**R57**) and guarded by
`node scripts/verify-3d-viewer.mjs`.

## 🏷 The callout tags are the screen. They do not get removed — by anyone, for any reason.

- **They live on the DISH ROW** — `menu_items.model_tags` and `model_front_view`, migration 402 —
  never in a file named after the folder. A folder name is typed by an owner and two restaurants
  can share one; that is how the tags were lost for eighteen days in September 2026 when the
  folder-collision leak was closed. Do not move them back into
  `public/content/items/<folder>/config.json`, and do not add a second source "as a fallback".
- **No flag, no setting, no "temporarily off".** If a change means a dish shows no cards, the
  change is wrong. The ONLY place they are hidden is inside a live AR session (below).
- **A reveal must never run before the tags have arrived.** `runFullSequence`'s reset clears every
  `.hs-card-wrap` by SELECTOR and then walks the tag list to put them back — so an empty list
  hides all three cards for good, silently. Read them through `tagsRef.current` at call time, and
  keep `requestReveal`'s `dishSettled` booking. Two separate faults of exactly this shape were
  measured and fixed on 2026-09-20; both looked like "the cards just aren't there".
- **A scheduled reveal is not a played one.** The reveal timer is cleared on effect teardown, and
  the ordinary small→optimized model upgrade tears the effect down. `startedRef` means PLAYED.

## 🎬 The dish is never seen before its own animation

Owner, 2026-09-20: *"it first shows the 3D model for a very split bit of a second and then that 3D
model disappear and my animation start … it looks very unprofessional."* Measured before the fix
with a per-frame probe: the spinner came off at 904 ms with the model at FULL size, and the
cinematic's opening frame (30%) did not land until 1698 ms. Four rules keep it gone:

1. **The spinner hands over to the ANIMATION, not to the loaded file.** `setLoaderVisible(false)`
   lives in `runFullSequence`, never in `handleLoad`.
2. **`.viewer-wrapper.pre-reveal model-viewer{opacity:0}`** — the element is not painted at all
   until that moment.
3. **The opening scale is written, and *applied*, before the curtain.** Set `REVEAL_START_SCALE`,
   `await mv.updateComplete`, *then* reveal. model-viewer applies `scale` on its own update cycle,
   so doing both in one tick can still paint one full-size frame.
4. **Never set that scale as an attribute or in the `load` handler.** Both land while
   <model-viewer> is computing its framing, and the "auto" radius clamps behind `camera-orbit`
   come from the bounding box *at that moment* — measured, the 2.2 m orbit was clamped to 0.617 m
   and the dish opened 3.3× too big, and it never recovered, because growing the model back does
   not recompute those clamps. (Same asymmetry the AR handoff works around.)

## 📱 AR: 40% size, and no tags in the room

- **`AR_MODEL_SCALE = 0.4`** is applied to `<model-viewer>`'s `scale` on the way into AR, with the
  camera pulled in by the same factor so nothing changes on the screen the guest is still looking
  at, and both restored on `not-presenting`. The models really are a metre wide
  (`getDimensions()` → 1.00 × 0.33 × 1.00 m), which is why a plate arrived the size of a coffee
  table; the owner's recording shows him pinching it to **41%**. Applied at runtime, NOT baked
  into the GLBs — the same four files belong to the reference app, and a tenant's own uploaded
  model has to get the same treatment without anyone re-exporting anything.
- **`body.ar-presenting` hides the hotspots for the length of the session** (`app/globals.css`).
  Android AR is WebXR, which keeps this page's DOM on top of the camera feed; iPhone AR is Quick
  Look, a separate screen. Hidden, never unmounted.
- **Quick Look does its own lighting.** `prepareUSDZ()` exports the scene through three.js's USDZ
  exporter, which carries base colour, normal, metallic and roughness — and NOT
  `environment-image`, `exposure`, tone mapping or any KHR material extension. A dish therefore
  looks flatter in iPhone AR than on the screen, and no attribute on this page changes that; the
  only real lever is shipping a hand-tuned USDZ per dish via `ios-src`. Don't chase it in CSS.
