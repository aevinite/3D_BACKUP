// The allergens the menu knows about. Used on the dish page, the editor, and
// the checkout warnings. Keep slugs in sync with the editor's copy in app.js.

// The shape of one allergen entry: a short code (slug), a human-readable name
// (label), and a little picture (icon) to show next to it.
export interface AllergenDef {
  slug: string;
  label: string;
  icon: string;
}

// The master list of allergens the menu can warn about. "slug" is the internal
// code stored on each dish; "label"/"icon" are what the guest actually sees.
export const ALLERGENS: AllergenDef[] = [
  { slug: "gluten", label: "Gluten", icon: "🌾" },
  { slug: "dairy", label: "Dairy", icon: "🥛" },
  { slug: "eggs", label: "Eggs", icon: "🥚" },
  { slug: "nuts", label: "Nuts", icon: "🥜" },
  { slug: "soy", label: "Soy", icon: "🫘" },
  { slug: "fish", label: "Fish", icon: "🐟" },
];

// A quick lookup table built once: given a slug like "nuts", instantly find its
// full entry. A Map is like a labelled drawer system — much faster than searching
// the whole list every time we need one allergen.
const bySlug = new Map(ALLERGENS.map((a) => [a.slug, a]));
// Turn a slug into its display name; if we don't recognise the slug, just show
// the slug itself (better than showing nothing). The "?." safely handles "not found".
export const allergenLabel = (slug: string) => bySlug.get(slug)?.label ?? slug;
// Turn a slug into its icon; unknown slugs fall back to a generic warning sign.
export const allergenIcon = (slug: string) => bySlug.get(slug)?.icon ?? "⚠️";
