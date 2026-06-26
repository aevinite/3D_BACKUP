import ComingSoon from "@/components/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      icon="fa-truck-fast"
      title="Online & aggregators"
      blurb="Manage Zomato, Swiggy and your own online ordering — menus, availability and orders in one inbox."
      points={["Unified Zomato / Swiggy inbox", "Toggle items online instantly", "Your own online-ordering link"]}
    />
  );
}
