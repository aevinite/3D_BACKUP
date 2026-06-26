import ComingSoon from "@/components/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      icon="fa-chart-line"
      title="Sales & reports"
      blurb="Deep day-wise, item-wise, category and tax reports across all your restaurants — exportable to PDF and Excel."
      points={["Day-wise & item-wise sales", "GST / tax summaries", "Compare restaurants side by side", "Schedule reports to your inbox"]}
    />
  );
}
