import SoloGame from "@/components/SoloGame";

export default async function Page({ searchParams }: { searchParams: Promise<{ level?: string }> }) {
  const { level } = await searchParams;
  return <SoloGame levelId={Number(level) || 1} />;
}
