import ItemClient from "./ItemClient";

export default async function ItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ cat?: string }>;
}) {
  const { slug } = await params;
  const { cat } = await searchParams;
  return <ItemClient slug={slug} fromCat={cat} />;
}
