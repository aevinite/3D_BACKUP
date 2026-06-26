import ComingSoon from "@/components/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      icon="fa-bullhorn"
      title="Marketing & offers"
      blurb="Run coupons, happy-hours and campaigns, and measure what actually drives revenue."
      points={["Coupons & happy-hour pricing", "SMS / WhatsApp campaigns", "Campaign ROI tracking"]}
    />
  );
}
