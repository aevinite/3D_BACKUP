import ComingSoon from "@/components/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      icon="fa-file-invoice-dollar"
      title="Billing & plans"
      blurb="Subscription plans, invoices and usage-based billing for every restaurant on the platform."
      points={["Plans & subscriptions", "Per-restaurant invoices", "Usage & limits"]}
    />
  );
}
