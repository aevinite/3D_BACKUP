import { test } from "node:test";
import assert from "node:assert/strict";
import { loadStarterMenu, toCategoryRows, toFilterRows, toItemRows } from "./starterMenu.ts";

const RID = "11111111-1111-1111-1111-111111111111";

test("loadStarterMenu returns categories, filters, items", () => {
  const m = loadStarterMenu();
  assert.ok(m.categories.length >= 1);
  assert.ok(m.filters.length >= 1);
  assert.ok(m.items.length >= 1);
});

test("category rows are scoped + snake_case", () => {
  const rows = toCategoryRows(loadStarterMenu(), RID);
  for (const r of rows) {
    assert.equal(r.restaurant_id, RID);
    assert.ok(typeof r.slug === "string" && r.slug.length > 0);
    assert.ok("sort_order" in r);
    assert.equal(r.active, true);
  }
});

test("filter rows are scoped + snake_case", () => {
  const rows = toFilterRows(loadStarterMenu(), RID);
  for (const r of rows) {
    assert.equal(r.restaurant_id, RID);
    assert.ok(typeof r.slug === "string" && r.slug.length > 0);
    assert.ok("sort_order" in r);
  }
});

test("item rows: scoped, snake_case, 3D stripped, unique ids", () => {
  const rows = toItemRows(loadStarterMenu(), RID);
  const ids = new Set();
  for (const r of rows) {
    assert.equal(r.restaurant_id, RID);
    assert.equal(r.is4d, false);
    assert.equal(r.model_folder, null);
    assert.equal(r.model_small_url, null);
    assert.equal(r.model_optimized_url, null);
    assert.ok(typeof r.id === "string" && r.id.length > 0);
    assert.ok(!ids.has(r.id), "ids must be unique");
    ids.add(r.id);
    assert.ok(typeof r.slug === "string" && r.slug.length > 0);
    assert.ok("sort_order" in r);
  }
  // ids must NOT equal the source slug (would collide across restaurants)
  assert.ok(rows.every((r) => r.id !== r.slug));
});
