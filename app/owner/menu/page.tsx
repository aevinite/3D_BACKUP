import ComingSoon from "@/components/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      icon="fa-book-open"
      title="Menu management"
      blurb="Edit menus, prices, photos and modifiers for every restaurant from one screen, and push changes live instantly."
      points={["Bulk price & availability edits", "Per-restaurant menus & combos", "Modifiers & add-on groups"]}
    />
  );
}
