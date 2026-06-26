import ComingSoon from "@/components/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      icon="fa-user-group"
      title="Customers & loyalty"
      blurb="A CRM for your diners — visit history, spend, feedback and a loyalty / points programme."
      points={["Customer profiles & spend", "Loyalty points & rewards", "Win-back campaigns"]}
    />
  );
}
