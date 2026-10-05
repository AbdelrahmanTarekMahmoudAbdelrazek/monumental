import DuelSolo from "@/components/DuelSolo";

export const metadata = { title: "Which is more? — How Big?" };

export default async function Page({ searchParams }: { searchParams: Promise<{ cat?: string }> }) {
  const { cat } = await searchParams;
  return <DuelSolo initial={cat} />;
}
