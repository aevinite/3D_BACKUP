import ComingSoon from "@/components/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      icon="fa-gear"
      title="Restaurant settings"
      blurb="Taxes, invoice details, printers, table layout and operating hours — configured per restaurant."
      points={["Tax & invoice setup", "Printer & KOT routing", "Tables & operating hours"]}
    />
  );
}
