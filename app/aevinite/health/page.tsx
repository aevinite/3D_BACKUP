import ComingSoon from "@/components/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      icon="fa-heart-pulse"
      title="System health"
      blurb="Uptime, realtime connections, error rates and background jobs across the platform."
      points={["Realtime & database health", "Error-rate monitoring", "Background job status"]}
    />
  );
}
