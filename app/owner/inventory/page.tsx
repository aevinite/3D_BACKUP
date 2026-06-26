import ComingSoon from "@/components/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      icon="fa-boxes-stacked"
      title="Inventory & stock"
      blurb="Track stock, recipes and wastage with low-stock alerts and auto-deduction as orders come in."
      points={["Low-stock & expiry alerts", "Recipe-level consumption", "Purchase orders & vendors"]}
    />
  );
}
