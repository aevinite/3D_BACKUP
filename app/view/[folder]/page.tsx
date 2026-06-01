import ViewerClient from "./ViewerClient";

export default async function ViewerPage({
  params,
}: {
  params: Promise<{ folder: string }>;
}) {
  const { folder } = await params;
  return (
    <>
      <ViewerClient folder={folder} />
    </>
  );
}
