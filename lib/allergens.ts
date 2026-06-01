// The allergens the menu knows about. Used on the dish page, the editor, and
// the checkout warnings. Keep slugs in sync with the editor's copy in app.js.

export interface AllergenDef {
  slug: string;
  label: string;
  icon: string;
}

export const ALLERGENS: AllergenDef[] = [
  { slug: "gluten", label: "Gluten", icon: "🌾" },
  { slug: "dairy", label: "Dairy", icon: "🥛" },
  { slug: "eggs", label: "Eggs", icon: "🥚" },
  { slug: "nuts", label: "Nuts", icon: "🥜" },
  { slug: "soy", label: "Soy", icon: "🫘" },
  { slug: "fish", label: "Fish", icon: "🐟" },
];

const bySlug = new Map(ALLERGENS.map((a) => [a.slug, a]));
export const allergenLabel = (slug: string) => bySlug.get(slug)?.label ?? slug;
export const allergenIcon = (slug: string) => bySlug.get(slug)?.icon ?? "⚠️";
