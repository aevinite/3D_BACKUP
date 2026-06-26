import ComingSoon from "@/components/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      icon="fa-receipt"
      title="Orders & bills"
      blurb="Every order and bill across your restaurants in one searchable place — filter by channel, status, date and amount."
      points={["Search by table, invoice or customer", "Refund & void audit trail", "Channel & payment filters"]}
    />
  );
}
