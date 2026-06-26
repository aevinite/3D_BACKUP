import ComingSoon from "@/components/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      icon="fa-chart-pie"
      title="Platform analytics"
      blurb="Cross-restaurant trends, cohort growth and platform-wide performance at a glance."
      points={["Platform GMV & growth", "Cohort & retention", "Benchmark restaurants"]}
    />
  );
}
