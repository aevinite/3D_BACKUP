import ComingSoon from "@/components/ComingSoon";

export default function Page() {
  return (
    <ComingSoon
      icon="fa-crown"
      title="Owners"
      blurb="Every owner on the platform, the restaurants they run, and their account status."
      points={["Owner directory", "Restaurants per owner", "Suspend / restore accounts"]}
    />
  );
}
